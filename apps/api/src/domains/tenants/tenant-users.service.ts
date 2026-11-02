/**
 * Tenant user management (F-03, AC-F03-1/AC-F03-2).
 *
 * Three operations a tenant administrator needs to run a workspace:
 * list the members and their roles, add a member, and suspend or
 * reinstate a membership. The routes declare their own permission
 * (ROLE_MANAGE / USER_CREATE / USER_DISABLE) and are scoped to the
 * tenant in the path, so a caller can only manage their own tenant.
 *
 * Identity note: an application user row exists only after the identity
 * provider knows the account. `add` therefore resolves the account in
 * this order - an existing VELARIS user row, then a Supabase Auth lookup
 * by email, then creating a new auth account when the caller supplies a
 * password. Without any of those it refuses with 409 instead of
 * inventing an identity that can never sign in.
 */

import {
  BadRequestException,
  ConflictException,
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
   * Add a member with one role (AC-F03-1). The role must exist and be in
   * scope for the tenant: a system role or a role that belongs to it
   * (AC-F03-2), and an unknown code is a 400 before anything is written.
   */
  async add(tenantId: string, input: AddMemberDto) {
    requireText(tenantId, 'tenantId');
    const email = normalizeEmail(input.email);
    requireText(input.roleCode, 'roleCode');

    const role = await this.prisma.role.findFirst({
      where: {
        code: input.roleCode,
        OR: [{ tenantId: null }, { tenantId }],
      },
    });
    if (!role) {
      throw new BadRequestException(`Unknown role code: ${input.roleCode}`);
    }

    const identity = await this.resolveIdentity(email, input.password);
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
      status: membership.status,
      roles: [input.roleCode],
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
    });
    // A membership of another tenant reads as missing, so an attacker
    // learns nothing about other tenants' identifiers (AC-F04-3).
    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException(
        `Membership with ID ${membershipId} not found`,
      );
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
   * Resolve the application user for an email, creating the auth account
   * only when the caller supplies a password. Order: existing VELARIS
   * user row, Supabase Auth lookup, then account creation.
   */
  private async resolveIdentity(
    email: string,
    password: unknown,
  ): Promise<{ userId: string }> {
    const localUser = await this.prisma.user.findFirst({
      where: { provider: 'supabase', emailNormalized: email },
    });
    if (localUser) {
      return { userId: localUser.id };
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
      return { userId: row.id };
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new ConflictException(
        `No account exists for ${email}. Supply a password of at least ${MIN_PASSWORD_LENGTH} characters to create it`,
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
    return { userId: row.id };
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
