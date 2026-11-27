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
import type { Prisma } from '@prisma/client';
import { pageOffset, resolvePageWindow } from '../../common/paging.js';
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

/** Every membership state a platform directory filter may name. */
const MEMBERSHIP_STATUSES = [
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
  'REVOKED',
] as const;

/**
 * Largest text match set the directory turns into identifiers. A broader
 * phrase keeps the joined-text filter, because a truncated set would lose
 * rows (D-87).
 */
export const TEXT_MATCH_LIMIT = 2000;

/**
 * Shortest phrase that produces a trigram. A shorter phrase cannot use the
 * trigram indexes, so the directory skips the lookups for it (D-87).
 */
const MIN_TRIGRAM_LENGTH = 3;

/** A phrase with whitespace cannot appear in an email address. */
const WHITESPACE_PATTERN = /\s/;

/**
 * How long a total stays usable for the same filter shape (D-87). A membership
 * write in this process clears the totals, so the delay only affects a write
 * made by another process or instance.
 */
export const TOTAL_CACHE_TTL_MS = 15_000;

/** Largest number of filter totals kept, so the memory stays bounded. */
const TOTAL_CACHE_LIMIT = 64;

/** A cursor is the identifier of one membership row. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface TenantMemberView {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  /** Uploaded profile photo as a bounded data URL, or null. */
  avatarDataUrl: string | null;
  status: string;
  roles: string[];
  /** Included by the platform-wide directory. */
  tenantId?: string;
  tenantName?: string;
}

/** One page of the platform-wide directory (D-87). */
export interface TenantMemberPage {
  items: TenantMemberView[];
  total: number;
  page: number;
  pageSize: number;
}

/** Filters and window for one platform directory page (D-87). */
export interface PlatformDirectoryQuery {
  page?: number;
  pageSize?: number;
  /** Matches the user's email, display name or the tenant name. */
  q?: string;
  /** Exact role code the membership holds. */
  role?: string;
  /** Exact membership status. */
  status?: string;
  /**
   * Identifier of the last row of the previous page. The page then starts at
   * that position instead of skipping the rows in front of it (D-87).
   */
  cursor?: string;
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
  /** Totals read for one filter shape, until the entry expires (D-87). */
  private readonly totals = new Map<
    string,
    { total: number; expiresAt: number }
  >();

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
      avatarDataUrl: membership.user.avatarDataUrl || null,
      status: membership.status,
      roles: membership.roles.map((assignment) => assignment.role.code),
    }));
  }

  /**
   * One bounded page of every membership on the platform for the platform
   * administrator's User Directory (D-87). The route requires
   * TENANT_MANAGE_PLATFORM; tenant administrators keep `list`, which can only
   * read their own tenant.
   *
   * The filters are part of the query, so `total` counts the matching rows and
   * a page never filters after the read. The order is `(createdAt desc, id
   * desc)`, so a new membership appears on page 1; the committed indexes serve
   * that order and the id breaks a tie on equal creation time so offset pages
   * stay stable.
   *
   * A text filter resolves the matching accounts and tenants first and then
   * filters on their identifiers, so the membership read uses its own indexes
   * instead of matching joined text per row (migration 0024). A one- or
   * two-character phrase skips both lookups, because it produces no trigram and
   * the trigram indexes cannot help it.
   *
   * The page reads identifiers first and then the rows for them, so a deep
   * offset walks the index for the skipped rows without joining or reading
   * roles for each of them.
   *
   * A `cursor` names the last row of the previous page, so the identifier read
   * starts at that position and skips nothing. A deep page of a large filtered
   * set therefore never sorts the whole match set (D-87). The page number and
   * the total keep their meaning: the total counts the filtered set, and the
   * page number is the one the caller asked for.
   *
   * A role code resolves to its role identifiers before the page is built, so
   * each candidate row probes the assignment table alone instead of hopping to
   * `roles` as well. A rare role then reads its few assignments and sorts them
   * instead of walking the ordered memberships until the page fills (D-87;
   * measured 2026-11-27: 129.6 ms against 0.7 ms for a role held by 115 of
   * 100,000 memberships). A code that names no role answers an empty page from
   * one indexed lookup.
   */
  async listPage(
    options: PlatformDirectoryQuery = {},
  ): Promise<TenantMemberPage> {
    const window = resolvePageWindow(options);
    const status = options.status?.trim() ?? '';
    if (
      status.length > 0 &&
      !MEMBERSHIP_STATUSES.includes(
        status as (typeof MEMBERSHIP_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(
        `status must be one of ${MEMBERSHIP_STATUSES.join(', ')}`,
      );
    }
    const needle = options.q?.trim() ?? '';
    const role = options.role?.trim() ?? '';
    let roleIds: string[] | null = null;
    if (role) {
      roleIds = (
        await this.prisma.role.findMany({
          where: { code: role },
          select: { id: true },
        })
      ).map((row) => row.id);
      if (roleIds.length === 0) return { items: [], total: 0, ...window };
    }
    const where: Prisma.TenantMembershipWhereInput = {
      ...(status
        ? { status: status as (typeof MEMBERSHIP_STATUSES)[number] }
        : {}),
      ...(roleIds ? { roles: { some: { roleId: { in: roleIds } } } } : {}),
    };
    if (needle) {
      const matches =
        needle.length < MIN_TRIGRAM_LENGTH
          ? null
          : await this.textMatches(needle);
      if (matches) {
        if (matches.userIds.length === 0 && matches.tenantIds.length === 0) {
          return { items: [], total: 0, ...window };
        }
        where.OR = [
          ...(matches.userIds.length > 0
            ? [{ userId: { in: matches.userIds } }]
            : []),
          ...(matches.tenantIds.length > 0
            ? [{ tenantId: { in: matches.tenantIds } }]
            : []),
        ];
      } else {
        where.OR = [
          {
            user: {
              emailNormalized: { contains: needle, mode: 'insensitive' },
            },
          },
          { user: { displayName: { contains: needle, mode: 'insensitive' } } },
          { tenant: { name: { contains: needle, mode: 'insensitive' } } },
        ];
      }
    }
    // A cursor replaces the offset. The anchor row supplies the position; a
    // row that no longer exists falls back to the offset, so a stale cursor
    // cannot fail the page after a membership is removed.
    const cursor = options.cursor?.trim() ?? '';
    const anchor = cursor ? await this.anchorFor(cursor) : null;
    // `createdAt <= anchor` is one index condition, so the scan starts at the
    // anchor instead of at the newest row. The NOT prunes the rows of the
    // anchor's own millisecond that come before it in the id order. An OR over
    // the two tie branches would be a filter with no index condition, and the
    // scan would then walk every skipped row (D-87; measured 2026-11-27).
    const pageWhere: Prisma.TenantMembershipWhereInput = anchor
      ? {
          AND: [
            where,
            { createdAt: { lte: anchor.createdAt } },
            {
              NOT: {
                createdAt: anchor.createdAt,
                id: { gte: anchor.id },
              },
            },
          ],
        }
      : where;
    // A search carries its own identifiers and changes with each phrase, so
    // only a status and role shape reuses a total.
    const cacheKey = needle ? null : `${status}|${role}`;
    const cached = cacheKey ? this.totals.get(cacheKey) : undefined;
    const now = Date.now();
    const cachedTotal = cached && cached.expiresAt > now ? cached.total : null;
    // The identifier page walks the index only, so a deep offset does not join
    // or read roles for every skipped row (D-87; measured 2026-11-26).
    const [page, total] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: pageWhere,
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: anchor ? 0 : pageOffset(window),
        take: window.pageSize,
      }),
      cachedTotal !== null
        ? Promise.resolve(cachedTotal)
        : this.prisma.tenantMembership.count({ where }),
    ]);
    if (cacheKey && cachedTotal === null) {
      this.totals.set(cacheKey, { total, expiresAt: now + TOTAL_CACHE_TTL_MS });
      this.evictTotals(now);
    }
    if (page.length === 0) {
      return { items: [], total, ...window };
    }
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      include: {
        user: true,
        tenant: true,
        roles: { include: { role: true } },
      },
    });
    // The identifier page holds the order. A `sort` on the row read would only
    // re-sort 25 rows, and it costs more than the read itself.
    const rowsById = new Map(memberships.map((row) => [row.id, row]));
    const ordered = page.flatMap((row) => {
      const found = rowsById.get(row.id);
      return found ? [found] : [];
    });
    return {
      items: ordered.map((membership) => ({
        membershipId: membership.id,
        userId: membership.userId,
        email: membership.user.emailNormalized,
        displayName: membership.user.displayName,
        avatarDataUrl: membership.user.avatarDataUrl || null,
        status: membership.status,
        roles: membership.roles.map((assignment) => assignment.role.code),
        tenantId: membership.tenantId,
        tenantName: membership.tenant.name,
      })),
      total,
      ...window,
    };
  }

  /**
   * Position of the cursor row, or null when that row no longer exists. A value
   * that is not a membership identifier is a 400 before any read runs.
   */
  private async anchorFor(
    cursor: string,
  ): Promise<{ id: string; createdAt: Date } | null> {
    if (!UUID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor must be a membership identifier');
    }
    return this.prisma.tenantMembership.findUnique({
      where: { id: cursor },
      select: { createdAt: true, id: true },
    });
  }

  /** Drop expired totals and keep the map bounded. */
  private evictTotals(now: number): void {
    for (const [key, entry] of this.totals) {
      if (entry.expiresAt <= now) this.totals.delete(key);
    }
    while (this.totals.size > TOTAL_CACHE_LIMIT) {
      const oldest = this.totals.keys().next().value;
      if (oldest === undefined) break;
      this.totals.delete(oldest);
    }
  }

  /**
   * Resolve the accounts and tenants whose text matches `needle` (D-87).
   *
   * Both lookups run the case-insensitive `contains` that the directory used to
   * apply through the relation, and migration 0024 gives each column a pg_trgm
   * index, so the planner reads a match set instead of the table. The page then
   * filters memberships on `userId` and `tenantId`, which their own indexes
   * serve.
   *
   * Each account leg names one column, so each leg reads one trigram index.
   * An `OR` over both columns makes the planner build a bitmap over both, and a
   * phrase whose trigrams are common in the other column then pays for matches
   * it rechecks away. A phrase that contains whitespace skips the email leg,
   * because an email address has none.
   *
   * Returns null when either leg or the merged set is larger than
   * TEXT_MATCH_LIMIT: a phrase that broad is not a bounded identifier set, and
   * truncating it would drop real matches, so the caller keeps the joined-text
   * filter.
   */
  private async textMatches(
    needle: string,
  ): Promise<{ userIds: string[]; tenantIds: string[] } | null> {
    const emailLookup = WHITESPACE_PATTERN.test(needle)
      ? null
      : this.prisma.user.findMany({
          where: {
            emailNormalized: { contains: needle, mode: 'insensitive' },
          },
          select: { id: true },
          take: TEXT_MATCH_LIMIT + 1,
        });
    const [names, emails, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { displayName: { contains: needle, mode: 'insensitive' } },
        select: { id: true },
        take: TEXT_MATCH_LIMIT + 1,
      }),
      emailLookup ?? Promise.resolve<{ id: string }[]>([]),
      this.prisma.tenant.findMany({
        where: { name: { contains: needle, mode: 'insensitive' } },
        select: { id: true },
        take: TEXT_MATCH_LIMIT + 1,
      }),
    ]);
    if (
      names.length > TEXT_MATCH_LIMIT ||
      emails.length > TEXT_MATCH_LIMIT ||
      tenants.length > TEXT_MATCH_LIMIT
    ) {
      return null;
    }
    const userIds = new Set(emails.map((row) => row.id));
    for (const row of names) userIds.add(row.id);
    if (userIds.size > TEXT_MATCH_LIMIT) return null;
    return {
      userIds: [...userIds],
      tenantIds: tenants.map((row) => row.id),
    };
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

    this.totals.clear();
    return {
      membershipId: membership.id,
      userId: identity.userId,
      email,
      displayName: email,
      avatarDataUrl: null,
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
    this.totals.clear();
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

    this.totals.clear();
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
