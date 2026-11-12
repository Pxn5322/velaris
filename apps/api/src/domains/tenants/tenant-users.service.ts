/**
 * Tenant user management (F-03, AC-F03-1/AC-F03-2).
 *
 * Three operations a tenant administrator needs to run a workspace:
 * list the members and their roles, add or invite a member, change a
 * membership, and remove a membership. The routes declare their own
 * permission (ROLE_MANAGE / USER_CREATE / USER_DISABLE) and are scoped to
 * the tenant in the path, so a caller can only manage their own tenant.
 *
 * Two rules protect the tenant:
 * - a tenant route accepts only tenant-scoped role codes, so a tenant
 *   administrator cannot grant the platform role (AC-F03-3);
 * - the last active tenant administrator cannot be suspended or removed,
 *   because that would lock every administrator out of the tenant.
 *
 * Identity note: an application user row exists only after the identity
 * provider knows the account. `add` therefore resolves the account in
 * this order - an existing VELARIS user row, then a Supabase Auth lookup
 * by email, then an invitation, then creating a new auth account when the
 * caller supplies a password. Without any of those it refuses with 409
 * instead of inventing an identity that can never sign in.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SupabaseAdminService } from '../auth/supabase-admin.service.js';
import type {
  AddMemberDto,
  SetMembershipStatusDto,
} from './dto/governance.dto.js';
import { hasMembershipRole, isTenantAssignableRole } from './tenant-roles.js';

/** Membership states an administrator may set (docs/DATABASE.md E-tenant). */
const SETTABLE_MEMBERSHIP_STATUS = ['ACTIVE', 'SUSPENDED'] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface TenantMemberView {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
}

export interface AddMemberResult extends TenantMemberView {
  /** True only when this request sent a Supabase invitation email. */
  invited: boolean;
}

export interface RemoveMemberResult {
  membershipId: string;
  tenantId: string;
  email: string;
  removed: true;
}

@Injectable()
export class TenantUsersService {
  // Explicit token: resolves without emitDecoratorMetadata (see PRISMA_SERVICE).
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdminService,
  ) {}

  /** Members of one tenant with their resolved role codes. */
  async list(tenantId: string): Promise<TenantMemberView[]> {
    requireText(tenantId, 'tenantId');
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { tenantId },
      include: {
        user: true,
        roles: { include: { role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.emailNormalized,
      displayName: membership.user.displayName,
      status: membership.status,
      roles: membership.roles.map((assignment) => assignment.role.code),
    }));
  }

  /**
   * Add or invite a member with one role (AC-F03-1). The role must exist,
   * be tenant-scoped and be in scope for the tenant (AC-F03-2). An unknown
   * or platform role is a 400 before anything is written.
   */
  async add(tenantId: string, input: AddMemberDto): Promise<AddMemberResult> {
    requireText(tenantId, 'tenantId');
    const email = normalizeEmail(input.email);
    requireText(input.roleCode, 'roleCode');
    if (!isTenantAssignableRole(input.roleCode)) {
      throw new BadRequestException(
        `Role code ${input.roleCode} cannot be assigned from a tenant route`,
      );
    }

    const role = await this.prisma.role.findFirst({
      where: {
        code: input.roleCode,
        OR: [{ tenantId: null }, { tenantId }],
      },
    });
    if (!role) {
      throw new BadRequestException(`Unknown role code: ${input.roleCode}`);
    }

    const identity = await this.resolveIdentity(
      email,
      input.password,
      input.invite === true,
    );
    const existingMembership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: identity.userId } },
    });
    if (existingMembership) {
      throw new ConflictException('That user is already a member');
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tenantMembership.create({
        data: { tenantId, userId: identity.userId, status: 'ACTIVE' },
      });
      await tx.membershipRole.create({
        data: { membershipId: row.id, roleId: role.id },
      });
      return row;
    });

    return {
      membershipId: membership.id,
      userId: identity.userId,
      email,
      displayName: email,
      status: membership.status,
      roles: [input.roleCode],
      invited: identity.invited,
    };
  }

  /** Suspend or reinstate one membership (USER_DISABLE, AC-F03-1). */
  async setMembershipStatus(
    tenantId: string,
    membershipId: string,
    input: SetMembershipStatusDto,
  ) {
    requireText(tenantId, 'tenantId');
    if (
      !SETTABLE_MEMBERSHIP_STATUS.includes(
        input.status as (typeof SETTABLE_MEMBERSHIP_STATUS)[number],
      )
    ) {
      throw new BadRequestException(
        `status must be one of ${SETTABLE_MEMBERSHIP_STATUS.join(', ')}`,
      );
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { id: membershipId },
      include: { roles: { include: { role: true } } },
    });
    // A membership of another tenant reads as missing, so an attacker
    // learns nothing about other tenants' identifiers (AC-F04-3).
    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException(
        `Membership with ID ${membershipId} not found`,
      );
    }

    if (hasMembershipRole(membership, 'R-enterprise-admin')) {
      throw new ForbiddenException(
        'Platform administrator memberships are managed outside the tenant routes',
      );
    }

    if (
      input.status === 'SUSPENDED' &&
      membership.status === 'ACTIVE' &&
      hasMembershipRole(membership, 'R-tenant-admin')
    ) {
      await this.assertOtherActiveAdmin(tenantId, membershipId);
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { id: membershipId },
      data: { status: input.status },
    });
    return {
      membershipId,
      tenantId,
      status: updated.status,
    };
  }

  /**
   * Remove one membership from a tenant (USER_DISABLE). The auth account is
   * not deleted because the same person may belong to other tenants. The
   * last active tenant administrator cannot be removed.
   */
  async remove(
    tenantId: string,
    membershipId: string,
  ): Promise<RemoveMemberResult> {
    requireText(tenantId, 'tenantId');
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { id: membershipId },
      include: {
        user: true,
        roles: { include: { role: true } },
      },
    });
    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException(
        `Membership with ID ${membershipId} not found`,
      );
    }
    if (hasMembershipRole(membership, 'R-enterprise-admin')) {
      throw new ForbiddenException(
        'Platform administrator memberships are managed outside the tenant routes',
      );
    }
    if (
      membership.status === 'ACTIVE' &&
      hasMembershipRole(membership, 'R-tenant-admin')
    ) {
      await this.assertOtherActiveAdmin(tenantId, membershipId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.tenantMembership.delete({ where: { id: membershipId } });
    });

    return {
      membershipId,
      tenantId,
      email: membership.user.emailNormalized,
      removed: true,
    };
  }

  /**
   * Resolve the application user for an email. An invitation is sent only
   * when the caller asks for one and no local or provider account exists.
   * A password creates a confirmed account when no invitation is requested.
   */
  private async resolveIdentity(
    email: string,
    password: unknown,
    invite: boolean,
  ): Promise<{ userId: string; invited: boolean }> {
    const localUser = await this.prisma.user.findFirst({
      where: { provider: 'supabase', emailNormalized: email },
    });
    if (localUser) {
      return { userId: localUser.id, invited: false };
    }

    this.admin.requireConfigured();
    const authUser = await this.admin.findUserByEmail(email);
    if (authUser) {
      const row = await this.prisma.user.create({
        data: {
          provider: 'supabase',
          externalSubject: authUser.id,
          emailNormalized: email,
          displayName: email,
        },
      });
      return { userId: row.id, invited: false };
    }

    if (invite) {
      const invited = await this.admin.inviteUser(email);
      const row = await this.prisma.user.create({
        data: {
          provider: 'supabase',
          externalSubject: invited.id,
          emailNormalized: email,
          displayName: email,
        },
      });
      return { userId: row.id, invited: true };
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new ConflictException(
        `No account exists for ${email}. Supply a password of at least ${MIN_PASSWORD_LENGTH} characters to create it, or send an invitation`,
      );
    }
    const created = await this.admin.createUser(email, password);
    const row = await this.prisma.user.create({
      data: {
        provider: 'supabase',
        externalSubject: created.id,
        emailNormalized: email,
        displayName: email,
      },
    });
    return { userId: row.id, invited: false };
  }

  /** Refuse a change that would leave the tenant without an active admin. */
  private async assertOtherActiveAdmin(
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const otherAdmins = await this.prisma.tenantMembership.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        id: { not: membershipId },
        roles: { some: { role: { code: 'R-tenant-admin' } } },
      },
    });
    if (otherAdmins === 0) {
      throw new ConflictException(
        'A tenant must keep at least one active administrator',
      );
    }
  }
}

/** Lower-cased, trimmed email; rejects a missing or malformed value. */
function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new BadRequestException('email must be a valid email address');
  }
  return email;
}

/** Reject a missing or empty required field before any write (AC-F03-2). */
function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
}
