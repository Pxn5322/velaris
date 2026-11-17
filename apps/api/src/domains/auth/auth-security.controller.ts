/**
 * Self-service auth assurance routes (T6.08; AC-F02-2, AC-F03-1).
 *
 * POST /auth/step-up re-authenticates with the current password and returns a
 * one-time grant. POST /auth/password completes a required reset. POST
 * /auth/sessions/revoke terminates every Supabase session and advances the
 * access-token cutoff. Recovery and MFA reset stay out of this controller
 * until T6.09 and D-59.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { AllowPasswordResetRequired } from './allow-password-reset-required.decorator.js';
import { AuthAccountService } from './auth-account.service.js';
import type { AuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import { PasswordChangeService } from './password-change.service.js';
import { RequireStepUp } from './require-step-up.decorator.js';
import {
  STEP_UP_ACTIONS,
  StepUpService,
  type StepUpInput,
} from './step-up.service.js';
import { StepUpGuard } from './step-up.guard.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

type AuthSecurityRequest = Request & {
  user?: AuthenticatedIdentity;
  accessToken?: string;
  authAssurance?: AuthAssurance;
  account?: { userId: string } | null;
};

@Controller('auth')
export class AuthSecurityController {
  constructor(
    private readonly passwords: PasswordChangeService,
    private readonly stepUps: StepUpService,
    private readonly accounts: AuthAccountService,
    private readonly verifier: SupabaseTokenVerifier,
    private readonly audit: AuditService,
  ) {}

  /** Re-authenticate and return a one-time grant for one action. */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async stepUp(@Req() request: AuthSecurityRequest, @Body() body: StepUpInput) {
    return this.stepUps.issue(
      request.user as AuthenticatedIdentity,
      request.authAssurance as AuthAssurance,
      body ?? {},
    );
  }

  /** Change the caller's password and clear a required-reset flag. */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowPasswordResetRequired()
  @UseGuards(SupabaseAuthGuard)
  async changePassword(
    @Req() request: AuthSecurityRequest,
    @Body() body: { currentPassword?: unknown; newPassword?: unknown },
  ): Promise<void> {
    const identity = request.user as AuthenticatedIdentity;
    await this.passwords.change(identity, request.accessToken, body ?? {});
    await this.audit.record({
      action: 'auth.password_changed',
      resourceType: 'user',
      actorId: identity.subject,
      metadata: { sessionsRevoked: true },
    });
  }

  /** Revoke every session and refuse every access token issued before now. */
  @Post('sessions/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SupabaseAuthGuard, StepUpGuard)
  @RequireStepUp(STEP_UP_ACTIONS.SESSION_REVOKE)
  async revokeSessions(@Req() request: AuthSecurityRequest): Promise<void> {
    const identity = request.user as AuthenticatedIdentity;
    const token = request.accessToken;
    const account = request.account;
    if (!token || !account) {
      throw new UnauthorizedException();
    }

    // Revoke the provider refresh tokens first. If that call fails, no local
    // cutoff is written and the caller can retry with a fresh grant.
    await this.verifier.revokeProviderSession(token, 'global');
    await this.accounts.revokeAllSessions(account.userId);
    await this.stepUps.revokeForSubject(identity.subject);
    await this.audit.record({
      action: 'auth.sessions_revoked',
      resourceType: 'user',
      actorId: identity.subject,
      metadata: { scope: 'global' },
    });
  }
}
