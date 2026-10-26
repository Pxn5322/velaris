/**
 * Role resolution port (T1.03).
 *
 * The permission guard asks this port for the caller's canonical role in
 * the tenant that the request targets. The role must come from a server-
 * side membership record: a client-supplied tenantId only selects which
 * membership to read, and it never grants a role by itself
 * (docs/SECURITY.md section 4).
 *
 * Role storage does not exist yet: the schema has no membership_roles
 * table (docs/DATABASE.md section 5), so the default implementation
 * always returns null and every permission-gated route denies. That is
 * the deny-by-default behaviour TH-02 requires. Tests inject a resolver.
 */

import { Injectable } from '@nestjs/common';
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

/** Deny-all resolver used until membership_roles storage exists. */
@Injectable()
export class DenyRoleResolver implements RoleResolver {
  async resolveRole(): Promise<CanonicalRole | null> {
    return null;
  }
}
