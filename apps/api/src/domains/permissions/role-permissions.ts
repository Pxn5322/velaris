/**
 * Role-to-permission baseline map (T1.03, docs/SECURITY.md section 3).
 *
 * Every role grants an explicit set of permission codes. A role that is
 * missing here, or a null/unknown role, resolves to an empty set: the
 * policy denies by default (TH-02). R-developer holds no application
 * permission without an explicit API scope, and R-anonymous holds none.
 * Per-resource scope (which tickets, which tenant) is enforced next to
 * this map by TenantsService.requireTenantAccess, not by the map.
 */

import type { CanonicalRole, PermissionCode } from './permission.codes.js';
import { PERMISSIONS } from './permission.codes.js';

const P = PERMISSIONS;

/** Platform scope: governs tenants, platform users and platform audit. */
const ENTERPRISE_ADMIN: readonly PermissionCode[] = [
  P.TENANT_MANAGE_PLATFORM,
  P.USER_CREATE,
  P.USER_DISABLE,
  P.ROLE_MANAGE,
  P.AUDIT_READ,
  P.ANALYTICS_READ,
];

/** Own-tenant scope only. Platform governance stays denied (AC-F03-3). */
const TENANT_ADMIN: readonly PermissionCode[] = [
  P.USER_CREATE,
  P.USER_DISABLE,
  P.ROLE_MANAGE,
  P.TICKET_READ,
  P.TICKET_WRITE,
  P.NOTE_INTERNAL_READ,
  P.NOTE_INTERNAL_WRITE,
  P.KNOWLEDGE_MANAGE,
  P.AI_AGENT_CONFIGURE,
  P.AI_AGENT_PUBLISH,
  P.AUDIT_READ,
  P.ANALYTICS_READ,
];

/** Support work on permitted tickets; no governance, no knowledge admin. */
const AGENT: readonly PermissionCode[] = [
  P.TICKET_READ,
  P.TICKET_WRITE,
  P.NOTE_INTERNAL_READ,
  P.NOTE_INTERNAL_WRITE,
];

/** Customer-visible ticket reads only (TH-05 keeps internal notes out). */
const CUSTOMER: readonly PermissionCode[] = [P.TICKET_READ];

export const ROLE_PERMISSIONS: Record<
  CanonicalRole,
  readonly PermissionCode[]
> = {
  'R-enterprise-admin': ENTERPRISE_ADMIN,
  'R-tenant-admin': TENANT_ADMIN,
  'R-agent': AGENT,
  'R-customer': CUSTOMER,
  'R-developer': [],
  'R-anonymous': [],
};

/** Resolve the granted permission set. Unknown or absent role -> deny. */
export function permissionsForRole(
  role: string | null | undefined,
): readonly PermissionCode[] {
  if (!role) {
    return [];
  }
  return ROLE_PERMISSIONS[role as CanonicalRole] ?? [];
}

/**
 * Privilege order for combining several assigned roles. A membership that
 * holds more than one role resolves to the first match here; unknown codes
 * never outrank a real role.
 */
const ROLE_PRECEDENCE: readonly CanonicalRole[] = [
  'R-enterprise-admin',
  'R-tenant-admin',
  'R-agent',
  'R-customer',
  'R-developer',
  'R-anonymous',
];

/** Highest-privilege canonical role among the codes, or null when none applies. */
export function highestPrivilegeRole(
  codes: readonly string[],
): CanonicalRole | null {
  for (const role of ROLE_PRECEDENCE) {
    if (codes.includes(role)) {
      return role;
    }
  }
  return null;
}
