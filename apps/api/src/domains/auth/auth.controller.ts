/**
 * Session endpoint (T1.02, AC-F02-1; role field added for the phase-2
 * role-aware navigation).
 *
 * GET /auth/session proves the full F-02 happy path over HTTP: the guard
 * verifies the bearer token (AC-F02-2), then TenantsService resolves the
 * caller's active tenant memberships. tenantContext is null when no user
 * row exists yet for the verified identity; provisioning decisions belong
 * to a later task.
 *
 * The response also carries the caller's canonical role: the controller
 * resolves it per active membership through RoleResolver (server-side
 * membership_roles, never a client claim) and reports the highest
 * privilege. The web nav shows links for that role and nothing else.
 */

import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type {
  AuthSessionResponse,
  AuthenticatedIdentity,
} from './auth.interface.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { TenantsService } from '../tenants/tenants.service.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { highestPrivilegeRole } from '../permissions/role-permissions.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type SessionRequest = Request & { user?: AuthenticatedIdentity };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tenants: TenantsService,
    @Inject(ROLE_RESOLVER) private readonly roles: RoleResolver,
  ) {}

  @Get('session')
  @UseGuards(SupabaseAuthGuard)
  async session(@Req() request: SessionRequest): Promise<AuthSessionResponse> {
    // The guard set user before the controller runs; the cast states that.
    const identity = request.user as AuthenticatedIdentity;
    const tenantContext = await this.tenants.resolveContext(
      identity.provider,
      identity.subject,
    );
    const role = await this.resolveRole(identity, tenantContext?.tenants ?? []);
    return { identity, tenantContext, role };
  }

  /** Highest-privilege role across active memberships; null when none. */
  private async resolveRole(
    identity: AuthenticatedIdentity,
    tenants: { tenantId: string }[],
  ): Promise<AuthSessionResponse['role']> {
    const codes = [];
    for (const tenant of tenants) {
      const resolved = await this.roles.resolveRole({
        identity,
        tenantId: tenant.tenantId,
      });
      if (resolved) {
        codes.push(resolved);
      }
    }
    return highestPrivilegeRole(codes);
  }
}
