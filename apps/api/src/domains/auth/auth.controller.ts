/**
 * Session endpoint (T1.02, AC-F02-1).
 *
 * GET /auth/session proves the full F-02 happy path over HTTP: the guard
 * verifies the bearer token (AC-F02-2), then TenantsService resolves the
 * caller's active tenant memberships. tenantContext is null when no user
 * row exists yet for the verified identity; provisioning decisions belong
 * to a later task.
 */

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type {
  AuthSessionResponse,
  AuthenticatedIdentity,
} from './auth.interface.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type SessionRequest = Request & { user?: AuthenticatedIdentity };
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { TenantsService } from '../tenants/tenants.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('session')
  @UseGuards(SupabaseAuthGuard)
  async session(@Req() request: SessionRequest): Promise<AuthSessionResponse> {
    // The guard set user before the controller runs; the cast states that.
    const identity = request.user as AuthenticatedIdentity;
    const tenantContext = await this.tenants.resolveContext(
      identity.provider,
      identity.subject,
    );
    return { identity, tenantContext };
  }
}
