/**
 * Roles a tenant administrator may assign through the tenant user routes.
 *
 * R-enterprise-admin is a platform role. It is provisioned separately and
 * must never be granted from a tenant-scoped route, or a tenant administrator
 * could escalate to platform-wide governance (AC-F03-3). The tenant routes
 * therefore accept only the tenant-scoped roles below.
 */
export const TENANT_ASSIGNABLE_ROLE_CODES = [
  'R-tenant-admin',
  'R-agent',
  'R-customer',
] as const;

export function isTenantAssignableRole(code: string): boolean {
  return (TENANT_ASSIGNABLE_ROLE_CODES as readonly string[]).includes(code);
}

/** True when a membership holds the given role code. */
export function hasMembershipRole(
  membership: { roles?: { role: { code: string } }[] },
  code: string,
): boolean {
  return (membership.roles ?? []).some(
    (assignment) => assignment.role.code === code,
  );
}
