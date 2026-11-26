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

/** Records each query and answers one membership row plus the text matches. */
function fakePrisma(
  options: { total?: number; users?: string[]; tenants?: string[] } = {},
) {
  const total = options.total ?? 42;
  const userIds = options.users ?? ['user-1'];
  const tenantIds = options.tenants ?? [TENANT_ID];
  const findMany = vi.fn(async (args: QueryArgs) => {
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
  const userFindMany = vi.fn(async () => userIds.map((id) => ({ id })));
  const tenantFindMany = vi.fn(async () => tenantIds.map((id) => ({ id })));
  return {
    findMany,
    count,
    userFindMany,
    tenantFindMany,
    prisma: {
      tenantMembership: { findMany, count },
      user: { findMany: userFindMany },
      tenant: { findMany: tenantFindMany },
    } as unknown as PrismaService,
  };
}

function serviceWith(prisma: PrismaService) {
  return new TenantUsersService(prisma, {} as unknown as SupabaseAdminService);
}

function queryOf(findMany: ReturnType<typeof vi.fn>): QueryArgs {
  return findMany.mock.calls[0]?.[0] as QueryArgs;
}

describe('TenantUsersService.listPage (platform directory, D-87)', () => {
  it('reads one page of every membership, newest first', async () => {
    const fake = fakePrisma();
    const service = serviceWith(fake.prisma);

    const page = await service.listPage({ page: 3, pageSize: 10 });

    const query = queryOf(fake.findMany);
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(query.skip).toBe(20);
    expect(query.take).toBe(10);
    expect(query.where).toEqual({});
    expect(fake.count).toHaveBeenCalledWith({ where: {} });
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

  it('resolves the text filter to matching accounts and tenants first', async () => {
    const fake = fakePrisma({ users: ['user-1'], tenants: [TENANT_ID] });
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: ' globex ' });

    // Both lookups run the case-insensitive match the trigram indexes serve.
    expect(fake.userFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { emailNormalized: { contains: 'globex', mode: 'insensitive' } },
          { displayName: { contains: 'globex', mode: 'insensitive' } },
        ],
      },
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

  it('answers an empty page when the text filter matches nothing', async () => {
    const fake = fakePrisma({ users: [], tenants: [] });
    const service = serviceWith(fake.prisma);

    const page = await service.listPage({ q: 'nothing-matches' });

    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    expect(fake.findMany).not.toHaveBeenCalled();
    expect(fake.count).not.toHaveBeenCalled();
  });

  it('keeps the relation filter when a phrase matches too many rows', async () => {
    const fake = fakePrisma({
      users: Array.from(
        { length: TEXT_MATCH_LIMIT + 1 },
        (_, index) => `user-${index}`,
      ),
    });
    const service = serviceWith(fake.prisma);

    await service.listPage({ q: 'a' });

    // A phrase this broad cannot be turned into a bounded id set, so the
    // query keeps the joined-text filter rather than losing matches.
    expect(queryOf(fake.findMany).where).toEqual({
      OR: [
        {
          user: {
            emailNormalized: { contains: 'a', mode: 'insensitive' },
          },
        },
        { user: { displayName: { contains: 'a', mode: 'insensitive' } } },
        { tenant: { name: { contains: 'a', mode: 'insensitive' } } },
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
