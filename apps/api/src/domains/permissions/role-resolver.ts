/**
 * Role resolution port (T1.03, roles storage).
 *
 * The permission guard asks this port for the caller's canonical role in
 * the tenant that the request targets. The role must come from a server-
 * side membership record: a client-supplied tenantId only selects which
 * membership to read, and it never grants a role by itself
 * (docs/SECURITY.md section 4).
 *
 * The default implementation is DatabaseRoleResolver: it reads
 * membership_roles and returns null when no active, in-scope role exists,
 * so permission-gated routes still deny by default. Tests may inject any
 * resolver through the ROLE_RESOLVER token.
 */

import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import type { CanonicalRole } from './permission.codes.js';

export const ROLE_RESOLVER = 'ROLE_RESOLVER';

export interface RoleLookup {
  identity: AuthenticatedIdentity;
  /** Tenant the request targets; provisional source until a request context exists. */
  tenantId?: string;
}

export interface RoleResolver {
  resolveRole(lookup: RoleLookup): Promise<CanonicalRole | null>;
}
