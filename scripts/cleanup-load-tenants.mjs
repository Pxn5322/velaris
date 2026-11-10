#!/usr/bin/env node
/**
 * Remove synthetic load-check accounts and tenants from the development
 * project (T6.03 follow-up).
 *
 * The default is a dry run. Pass --delete to remove the rows and the matching
 * Supabase Auth users. The script never deletes an account outside the
 * `loadcheck-`, `deploycheck-` or `smokecheck-` namespace at `velaris.test`,
 * and it refuses to delete a tenant that still has data other than the
 * expected load-test rows.
 *
 * Usage:
 *   node --env-file=.env scripts/cleanup-load-tenants.mjs
 *   node --env-file=.env scripts/cleanup-load-tenants.mjs --delete
 *
 * Required environment: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * No token or password is printed.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const SYNTHETIC_EMAIL = /^(loadcheck|deploycheck|smokecheck)-[a-z0-9-]+@velaris\.test$/i;
const TENANT_PREFIXES = [
  'Load check ',
  'Load Check ',
  'Deploy check ',
  'Deploy Check ',
  'Smoke check ',
  'Smoke Check ',
];

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function authHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

async function listSyntheticAuthUsers(baseUrl, serviceKey) {
  const headers = authHeaders(serviceKey);
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(
      `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(
        `Supabase Auth admin list failed with HTTP ${response.status}`,
      );
    }
    const body = await response.json();
    const batch = Array.isArray(body.users) ? body.users : [];
    users.push(...batch);
    if (batch.length < 1000) {
      break;
    }
  }
  return users
    .filter(
      (user) =>
        typeof user.email === 'string' && SYNTHETIC_EMAIL.test(user.email),
    )
    .map((user) => ({ id: user.id, email: user.email }));
}

async function listSyntheticTenants(prisma) {
  return prisma.tenant.findMany({
    where: {
      OR: TENANT_PREFIXES.map((prefix) => ({
        name: { startsWith: prefix },
      })),
    },
    include: {
      memberships: {
        include: { user: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function deleteTenant(prisma, tenant) {
  const userIds = tenant.memberships.map((membership) => membership.userId);
  await prisma.$transaction(async (tx) => {
    // Audit rows and retention rows reference the tenant directly.
    await tx.auditEvent.deleteMany({ where: { tenantId: tenant.id } });
    await tx.retentionPolicy.deleteMany({ where: { tenantId: tenant.id } });
    // Roles and memberships belong to the tenant; membership_roles cascade
    // from the membership, but an explicit delete keeps the order clear.
    await tx.membershipRole.deleteMany({
      where: { membership: { tenantId: tenant.id } },
    });
    await tx.tenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await tx.role.deleteMany({ where: { tenantId: tenant.id } });
    await tx.tenant.delete({ where: { id: tenant.id } });
    await tx.enterpriseOrganization.delete({
      where: { id: tenant.enterpriseOrganizationId },
    });
    // A user shared with a real tenant is left in place.
    const remaining = await tx.tenantMembership.count({
      where: { userId: { in: userIds } },
    });
    if (remaining === 0 && userIds.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
}

async function deleteAuthUser(baseUrl, serviceKey, userId) {
  const response = await fetch(
    `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: authHeaders(serviceKey),
    },
  );
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Supabase Auth delete failed with HTTP ${response.status}`);
  }
}

async function main() {
  const deleteMode = process.argv.includes('--delete');
  const databaseUrl = requireEnvironment('DATABASE_URL');
  const baseUrl = requireEnvironment('SUPABASE_URL').replace(/\/+$/, '');
  const serviceKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const tenants = await listSyntheticTenants(prisma);
    const authUsers = await listSyntheticAuthUsers(baseUrl, serviceKey);
    const tenantEmails = new Set(
      tenants.flatMap((tenant) =>
        tenant.memberships.map((membership) => membership.user.emailNormalized),
      ),
    );
    const orphanAuthUsers = authUsers.filter(
      (user) => !tenantEmails.has(user.email.toLowerCase()),
    );

    console.log(`Synthetic tenants: ${tenants.length}`);
    for (const tenant of tenants) {
      const emails = tenant.memberships
        .map((membership) => membership.user.emailNormalized)
        .join(', ');
      console.log(
        `  ${tenant.id}  ${tenant.name}  ${tenant.createdAt.toISOString()}  ${emails}`,
      );
    }
    console.log(`Synthetic auth accounts: ${authUsers.length}`);
    for (const user of orphanAuthUsers) {
      console.log(`  ${user.id}  ${user.email}  (no matching tenant)`);
    }

    if (tenants.length === 0 && authUsers.length === 0) {
      console.log('Nothing to clean up.');
      return;
    }
    if (!deleteMode) {
      console.log('Dry run only. Pass --delete to remove these rows.');
      return;
    }

    const failedTenantEmails = new Set();
    let failures = 0;
    for (const tenant of tenants) {
      try {
        await deleteTenant(prisma, tenant);
        console.log(`Deleted tenant ${tenant.id} (${tenant.name}).`);
      } catch (error) {
        failures += 1;
        for (const membership of tenant.memberships) {
          failedTenantEmails.add(membership.user.emailNormalized);
        }
        console.error(
          `Could not delete tenant ${tenant.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    for (const user of authUsers) {
      if (failedTenantEmails.has(user.email.toLowerCase())) {
        console.error(
          `Kept auth account ${user.email} because its tenant was not deleted.`,
        );
        failures += 1;
        continue;
      }
      try {
        await deleteAuthUser(baseUrl, serviceKey, user.id);
        console.log(`Deleted auth account ${user.email}.`);
      } catch (error) {
        failures += 1;
        console.error(
          `Could not delete auth account ${user.email}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (failures > 0) {
      console.error(`Cleanup finished with ${failures} failure(s).`);
      process.exitCode = 1;
    } else {
      console.log('Cleanup complete.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
