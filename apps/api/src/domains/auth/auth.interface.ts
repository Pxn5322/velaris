/**
 * Auth-layer types (T1.02, F-02).
 *
 * AuthenticatedIdentity is what the token verifier proves about a caller:
 * the identity provider (D-03: Supabase Auth), the provider's subject
 * claim, and an optional email. AuthSessionResponse is the body of
 * GET /auth/session (AC-F02-1).
 */

import type { CanonicalRole } from '../permissions/permission.codes.js';
import type { TenantContext } from '../tenants/tenants.service.js';

export interface AuthenticatedIdentity {
  provider: string;
  subject: string;
  email?: string;
}

export interface AuthSessionResponse {
  identity: AuthenticatedIdentity;
  tenantContext: TenantContext | null;
  /**
   * Highest-privilege canonical role across the caller's active tenant
   * memberships, resolved server-side from membership_roles (never from a
   * client claim). Null when no membership resolves a role; the web nav
   * renders signed-out/denied states from it.
   */
  role: CanonicalRole | null;
}
