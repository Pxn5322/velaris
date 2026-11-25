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
  // T5.05 (D-30): the platform owner may register webhook endpoints.
  P.INTEGRATION_MANAGE,
  // T4.04 (D-20): a platform owner may decide a consequential tool action.
  P.AI_TOOL_APPROVE,
  // D-58 to D-62 code reservations (D-65): `user.mfa.reset` (D-59),
  // `audit.export` (D-60), `access.review.manage` and `role.change.approve`
  // (D-62) exist in the catalog but stay unassigned until those records are
  // Recorded. A role without a code is refused, so the capability fails shut.
];

/** Own-tenant scope only. Platform governance stays denied (AC-F03-3). */
const TENANT_ADMIN: readonly PermissionCode[] = [
  P.USER_CREATE,
  P.USER_DISABLE,
  P.ROLE_MANAGE,
  P.TICKET_READ,
  P.TICKET_WRITE,
  // T6.05 (API-13): replying in a conversation is its own capability, so a
  // customer can be granted a reply without ticket write access.
  P.MESSAGE_CREATE,
  P.NOTE_INTERNAL_READ,
  P.NOTE_INTERNAL_WRITE,
  P.KNOWLEDGE_MANAGE,
  // T6.06 (D-38): retention windows are tenant governance, so only the
  // tenant administrator configures them.
  P.RETENTION_MANAGE,
  P.AI_AGENT_CONFIGURE,
  P.AI_AGENT_PUBLISH,
  // T4.04 (D-20): the tenant owner approves consequential tool actions;
  // R-agent and R-customer never hold this code (AC-F10-3).
  P.AI_TOOL_APPROVE,
  P.AUDIT_READ,
  P.ANALYTICS_READ,
  // T5.05 (D-30): a tenant owner registers the tenant's own endpoints.
  P.INTEGRATION_MANAGE,
  // D-58 to D-62 code reservations (D-65): the four security-policy codes are
  // deliberately absent here too, so no tenant administrator gains a recovery,
  // export, access-review or role-approval capability before D-58, D-60 and
  // D-62 are Recorded. D-59 forbids a tenant administrator from resetting a
  // peer, a foreign member or a platform administrator; the recovery service
  // enforces that matrix and the two-person rule when the codes are assigned.
];

/** Support work on permitted tickets; no governance, no knowledge admin. */
const AGENT: readonly PermissionCode[] = [
  P.TICKET_READ,
  P.TICKET_WRITE,
  P.MESSAGE_CREATE,
  P.NOTE_INTERNAL_READ,
  P.NOTE_INTERNAL_WRITE,
];

/**
 * Customer-visible reads of its own records, plus the reply capability
 * (T6.05, API-13). TH-05 still keeps internal notes out: a customer never
 * holds note.internal.read or note.internal.write, and the controller denies
 * an INTERNAL note from a customer author.
 */
const CUSTOMER: readonly PermissionCode[] = [
  P.TICKET_READ,
  P.MESSAGE_CREATE,
  // A customer opens its own ticket; the server derives the customer row and
  // the tenant, so this code never reaches another customer's data.
  P.TICKET_REQUEST,
];

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
