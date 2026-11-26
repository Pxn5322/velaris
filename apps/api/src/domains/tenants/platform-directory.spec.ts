/**
 * Platform user directory page (D-87; follows D-86).
 *
 * `GET /tenants/users` read every membership on the platform and sorted the
 * result by tenant name, while the browser paged the rows. These cases pin the
 * replacement contract: one page window, the filters inside the query, the
 * newest membership first, and a text filter that resolves its matches through
 * the trigram indexes instead of scanning every membership.
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SupabaseAdminService } from '../auth/supabase-admin.service.js';
import { GovernanceController } from './governance.controller.js';
import type { GovernanceService } from './governance.service.js';
import type { TenantRolesService } from './tenant-roles.service.js';
import {
  TEXT_MATCH_LIMIT,
  TOTAL_CACHE_TTL_MS,
  TenantUsersService,
  type PlatformDirectoryQuery,
} from './tenant-users.service.js';

const MEMBERSHIP_ID = '34343434-3434-4434-8434-343434343434';
const TENANT_ID = '12121212-1212-4212-8212-121212121212';

type QueryArgs = {
  where?: Record<string, unknown>;
  orderBy?: Record<string, string>[];
  skip?: number;
  take?: number;
  select?: Record<string, boolean>;
};

/**
 * Records each query and answers one membership row. The account lookup runs
 * one query per column, so the fake answers by the column in `where`.
 */
function fakePrisma(
  options: {
    total?: number;
    emails?: string[];
    names?: string[];
    tenants?: string[];
  } = {},
) {
  const total = options.total ?? 42;
  const emails = options.emails ?? ['user-1'];
  const names = options.names ?? ['user-1'];
  const tenantIds = options.tenants ?? [TENANT_ID];
  // The mock answers both reads, so its rows stay untyped here.
  const findMany = vi.fn(async (args: QueryArgs): Promise<unknown[]> => {
    expect(args).toBeDefined();
    return [
      {
        id: MEMBERSHIP_ID,
        userId: 'user-1',
        tenantId: TENANT_ID,
        status: 'ACTIVE',
        user: {
          id: 'user-1',
          emailNormalized: 'agent@acme.test',
          displayName: 'Acme Agent',
          avatarDataUrl: null,
        },
        tenant: { id: TENANT_ID, name: 'Acme' },
        roles: [{ role: { code: 'R-agent' } }],
      },
    ];
  });
  const count = vi.fn(async () => total);
  const findUnique = vi.fn(async () => ({
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    status: 'ACTIVE',
    roles: [],
  }));
  const update = vi.fn(async () => ({
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    status: 'SUSPENDED',
  }));
  const userFindMany = vi.fn(
    async (args: { where?: Record<string, unknown> }) => {
      const where = args.where ?? {};
      const ids = 'emailNormalized' in where ? emails : names;
      return ids.map((id) => ({ id }));
    },
  );
  const tenantFindMany = vi.fn(async () => tenantIds.map((id) => ({ id })));
  return {
    findMany,
    count,
    userFindMany,
    tenantFindMany,
    prisma: {
      tenantMembership: { findMany, count, findUnique, update },
      user: { findMany: userFindMany },
      tenant: { findMany: tenantFindMany },
    } as unknown as PrismaService,
  };
}

/** One membership row as the row read returns it. */
function membershipRow(id: string, email: string) {
  return {
    id,
    userId: `user-${id}`,
    tenantId: TENANT_ID,
    status: 'ACTIVE',
    user: {
      id: `user-${id}`,
      emailNormalized: email,
      displayName: email,
      avatarDataUrl: null,
    },
    tenant: { id: TENANT_ID, name: 'Acme' },
    roles: [{ role: { code: 'R-agent' } }],
  };
}

function serviceWith(prisma: PrismaService) {
  return new TenantUsersService(prisma, {} as unknown as SupabaseAdminService);
}

function queryOf(findMany: ReturnType<typeof vi.fn>): QueryArgs {
  return queryAt(findMany, 0);
}

function queryAt(findMany: ReturnType<typeof vi.fn>, index: number): QueryArgs {
  return findMany.mock.calls[index]?.[0] as QueryArgs;
}

/** The account lookup that names one column, or undefined when it did not run. */
function lookupFor(
  userFindMany: ReturnType<typeof vi.fn>,
  column: 'emailNormalized' | 'displayName',
): QueryArgs | undefined {
  return userFindMany.mock.calls
    .map((call) => call[0] as QueryArgs)
    .find((args) => column in (args.where ?? {}));
}

describe('TenantUsersService.listPage (platform directory, D-87)', () => {
  it('reads one page of every membership, newest first', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    const page = await service.listPage({ page: 3, pageSize: 10 });

    // First the identifier page, which walks the index without joining it.
    const ids = queryOf(fake.findMany);
    expect(ids.select).toEqual({ id: true });
    expect(ids.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(ids.skip).toBe(20);
    expect(ids.take).toBe(10);
    expect(ids.where).toEqual({});
    expect(fake.count).toHaveBeenCalledWith({ where: {} });
    // Then the rows for those identifiers, with the includes and the order.
    expect(fake.findMany).toHaveBeenCalledTimes(2);
    expect(queryAt(fake.findMany, 1)).toEqual({
      where: { id: { in: [MEMBERSHIP_ID] } },
      include: {
        user: true,
        tenant: true,
        roles: { include: { role: true } },
      },
    });
    expect(fake.userFindMany).not.toHaveBeenCalled();
    expect(page).toMatchObject({ total: 42, page: 3, pageSize: 10 });
    expect(page.items).toEqual([
      {
        membershipId: MEMBERSHIP_ID,
        userId: 'user-1',
        email: 'agent@acme.test',
        displayName: 'Acme Agent',
        avatarDataUrl: null,
        status: 'ACTIVE',
        roles: ['R-agent'],
        tenantId: TENANT_ID,
        tenantName: 'Acme',
      },
    ]);
  });

  it('keeps the identifier page order when the row read returns another', async () => {
    const fake = fakePrisma();
    fake.findMany
      .mockResolvedValueOnce([{ id: 'member-b' }, { id: 'member-a' }])
      .mockResolvedValueOnce([
        membershipRow('member-a', 'a@acme.test'),
        membershipRow('member-b', 'b@acme.test'),
      ]);
    const service = serviceWith(fake.prisma);

    const page = await service.listPage({ pageSize: 2 });

    // The row read carries no order, so the page order cannot change here.
    expect(queryAt(fake.findMany, 1).orderBy).toBeUndefined();
    expect(page.items.map((item) => item.membershipId)).toEqual([
      'member-b',
      'member-a',
    ]);
  });

  it('reuses the total for the same filter until the entry expires', async () => {
    vi.useFakeTimers();
    try {
      const fake = fakePrisma();
      const service = serviceWith(fake.prisma);

      await service.listPage({ page: 1, pageSize: 10 });
      await service.listPage({ page: 2, pageSize: 10 });
      expect(fake.count).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(TOTAL_CACHE_TTL_MS + 1);
      await service.listPage({ page: 3, pageSize: 10 });
      expect(fake.count).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a new total when the filter changes', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await service.listPage({ status: 'ACTIVE' });
    await service.listPage({ status: 'SUSPENDED' });

    expect(fake.count).toHaveBeenCalledTimes(2);
  });

  it('does not cache the total of a text search', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: 'globex' });
    await service.listPage({ q: 'globex', page: 2 });

    // A search changes with each phrase and its identifiers, so it always
    // counts its own matches.
    expect(fake.count).toHaveBeenCalledTimes(2);
  });

  it('drops the cached total after a membership change', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await service.listPage({ page: 1 });
    await service.listPage({ page: 2 });
    expect(fake.count).toHaveBeenCalledTimes(1);

    await service.setMembershipStatus(TENANT_ID, MEMBERSHIP_ID, {
      status: 'SUSPENDED',
    });
    await service.listPage({ page: 3 });

    expect(fake.count).toHaveBeenCalledTimes(2);
  });

  it('answers an empty page without reading any row', async () => {
    const fake = fakePrisma();
    fake.findMany.mockResolvedValueOnce([]);
    const service = serviceWith(fake.prisma);

    const page = await service.listPage({ page: 5, pageSize: 10 });

    expect(page).toEqual({ items: [], total: 42, page: 5, pageSize: 10 });
    expect(fake.findMany).toHaveBeenCalledTimes(1);
    expect(fake.count).toHaveBeenCalledWith({ where: {} });
  });

  it('puts the status and role filters inside the query', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await service.listPage({
      role: 'R-agent',
      status: 'SUSPENDED',
    } satisfies PlatformDirectoryQuery);

    const query = queryOf(fake.findMany);
    expect(query.where).toEqual({
      status: 'SUSPENDED',
      roles: { some: { role: { code: 'R-agent' } } },
    });
    expect(fake.count).toHaveBeenCalledWith({ where: query.where });
  });

  it('resolves the text filter one column at a time', async () => {
    const fake = fakePrisma({ emails: ['user-1'], names: ['user-1'] });
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: ' globex ' });

    // Each account leg names one column, so each leg reads one trigram index
    // instead of a bitmap over both.
    expect(lookupFor(fake.userFindMany, 'emailNormalized')).toEqual({
      where: {
        emailNormalized: { contains: 'globex', mode: 'insensitive' },
      },
      select: { id: true },
      take: TEXT_MATCH_LIMIT + 1,
    });
    expect(lookupFor(fake.userFindMany, 'displayName')).toEqual({
      where: { displayName: { contains: 'globex', mode: 'insensitive' } },
      select: { id: true },
      take: TEXT_MATCH_LIMIT + 1,
    });
    expect(fake.tenantFindMany).toHaveBeenCalledWith({
      where: { name: { contains: 'globex', mode: 'insensitive' } },
      select: { id: true },
      take: TEXT_MATCH_LIMIT + 1,
    });
    // The membership read filters on the resolved identifiers, so it can use
    // the membership indexes instead of matching joined text per row.
    expect(queryOf(fake.findMany).where).toEqual({
      OR: [{ userId: { in: ['user-1'] } }, { tenantId: { in: [TENANT_ID] } }],
    });
  });

  it('skips the email leg when the phrase contains a space', async () => {
    const fake = fakePrisma({ names: ['user-1'], emails: ['never-read'] });
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: 'Person 09999' });

    // An email address has no whitespace, so the email leg cannot match and
    // its common trigrams would only build a large bitmap.
    expect(lookupFor(fake.userFindMany, 'emailNormalized')).toBeUndefined();
    expect(lookupFor(fake.userFindMany, 'displayName')?.where).toEqual({
      displayName: { contains: 'Person 09999', mode: 'insensitive' },
    });
    expect(queryOf(fake.findMany).where).toEqual({
      OR: [{ userId: { in: ['user-1'] } }, { tenantId: { in: [TENANT_ID] } }],
    });
  });

  it('merges the two account legs without repeating an account', async () => {
    const fake = fakePrisma({
      emails: ['user-1', 'user-2'],
      names: ['user-2', 'user-3'],
      tenants: [],
    });
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: 'acme' });

    expect(queryOf(fake.findMany).where).toEqual({
      OR: [{ userId: { in: ['user-1', 'user-2', 'user-3'] } }],
    });
  });

  it('answers an empty page when the text filter matches nothing', async () => {
    const fake = fakePrisma({ emails: [], names: [], tenants: [] });
    const service = serviceWith(fake.prisma);

    const page = await service.listPage({ q: 'nothing-matches' });

    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    expect(fake.findMany).not.toHaveBeenCalled();
    expect(fake.count).not.toHaveBeenCalled();
  });

  it('skips the trigram lookups for a one- or two-character phrase', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: 'ab' });

    // A short phrase produces no trigram, so the lookups cannot help it.
    expect(fake.userFindMany).not.toHaveBeenCalled();
    expect(fake.tenantFindMany).not.toHaveBeenCalled();
    expect(queryOf(fake.findMany).where).toEqual({
      OR: [
        { user: { emailNormalized: { contains: 'ab', mode: 'insensitive' } } },
        { user: { displayName: { contains: 'ab', mode: 'insensitive' } } },
        { tenant: { name: { contains: 'ab', mode: 'insensitive' } } },
      ],
    });
  });

  it('keeps the relation filter when a phrase matches too many accounts', async () => {
    const fake = fakePrisma({
      emails: Array.from(
        { length: TEXT_MATCH_LIMIT + 1 },
        (_, index) => `user-${index}`,
      ),
    });
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: 'abc' });

    // A phrase this broad cannot be turned into a bounded id set, so the
    // query keeps the joined-text filter rather than losing matches.
    expect(queryOf(fake.findMany).where).toEqual({
      OR: [
        {
          user: {
            emailNormalized: { contains: 'abc', mode: 'insensitive' },
          },
        },
        { user: { displayName: { contains: 'abc', mode: 'insensitive' } } },
        { tenant: { name: { contains: 'abc', mode: 'insensitive' } } },
      ],
    });
  });

  it('refuses a page size above the cap and a non-positive page', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await expect(service.listPage({ pageSize: 101 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.listPage({ page: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fake.findMany).not.toHaveBeenCalled();
  });

  it('refuses an unknown membership status before the read', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    await expect(
      service.listPage({ status: 'DELETED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.findMany).not.toHaveBeenCalled();
  });
});

describe('GovernanceController platform directory (D-87)', () => {
  function controllerWith(listPage: ReturnType<typeof vi.fn>) {
    return new GovernanceController(
      {} as unknown as GovernanceService,
      { listPage } as unknown as TenantUsersService,
      {} as unknown as TenantRolesService,
      {} as unknown as AuditService,
    );
  }

  it('parses the page window and the filters from the query', async () => {
    const listPage = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 5,
    });

    await controllerWith(listPage).listAllUsers(
      '2',
      '5',
      ' globex ',
      'R-agent',
      'ACTIVE',
    );

    expect(listPage).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      q: 'globex',
      role: 'R-agent',
      status: 'ACTIVE',
    });
  });

  it('sends no optional value when the caller sends none', async () => {
    const listPage = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });

    await controllerWith(listPage).listAllUsers(undefined, '', '', '', '');

    expect(listPage).toHaveBeenCalledWith({});
  });
});
