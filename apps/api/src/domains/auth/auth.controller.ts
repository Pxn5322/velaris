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

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthSessionResponse,
  AuthenticatedIdentity,
} from './auth.interface.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { SignupDto } from './dto/signup.dto.js';
import { SignupService } from './signup.service.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { highestPrivilegeRole } from '../permissions/role-permissions.js';
import { TokenRevocationService } from './token-revocation.service.js';
import { ProfileService } from './profile.service.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type SessionRequest = Request & {
  user?: AuthenticatedIdentity;
  accessToken?: string;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tenants: TenantsService,
    @Inject(ROLE_RESOLVER) private readonly roles: RoleResolver,
    private readonly signupService: SignupService,
    private readonly audit: AuditService,
    private readonly revocations: TokenRevocationService,
    private readonly profiles: ProfileService,
  ) {}

  /**
   * Tenant registration for the landing-page "Start Free" button (F-01).
   * Public by design: there is no caller yet. Validation runs before the
   * identity provider is touched (AC-F01-2), and one audit event records
   * the new account (AC-F11-1 intent).
   */
  @Post('signup')
  async signup(@Body() signupDto: SignupDto) {
    const result = await this.signupService.signup(signupDto);
    await this.audit.record({
      action: 'user.registered',
      resourceType: 'user',
      resourceId: result.userId,
      tenantId: result.tenantId,
      actorId: result.authSubject,
      metadata: { slug: result.slug },
    });
    return {
      tenantId: result.tenantId,
      slug: result.slug,
      email: result.email,
    };
  }

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
    const profile = await this.profiles.findForIdentity(identity);
    return {
      identity: {
        ...identity,
        ...(profile ? { displayName: profile.displayName } : {}),
        ...(profile?.hasAvatarOverride
          ? { avatarUrl: profile.avatarDataUrl ?? undefined }
          : {}),
      },
      tenantContext,
      role,
    };
  }

  /** Update the caller's own display name and uploaded profile photo. */
  @Patch('profile')
  @UseGuards(SupabaseAuthGuard)
  async updateProfile(
    @Req() request: SessionRequest,
    @Body() body: { displayName?: string; avatarDataUrl?: string | null },
  ) {
    const identity = request.user as AuthenticatedIdentity;
    const profile = await this.profiles.update(identity, body);
    await this.audit.record({
      action: 'user.profile_updated',
      resourceType: 'user',
      actorId: identity.subject,
      metadata: {
        displayNameChanged: body.displayName !== undefined,
        avatarChanged: body.avatarDataUrl !== undefined,
      },
    });
    return profile;
  }

  /**
   * Sign out the caller's current Supabase session. The guard has already
   * verified the bearer token; this route records the token/session denial
   * before revoking the refresh token at Supabase, so a copied access token
   * is refused immediately by every API instance.
   */
  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SupabaseAuthGuard)
  async signout(@Req() request: SessionRequest): Promise<void> {
    const token = request.accessToken;
    if (!token) {
      throw new UnauthorizedException();
    }
    await this.revocations.revoke(token);
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
