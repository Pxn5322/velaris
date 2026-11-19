/**
 * Bearer-token guard for protected routes (T1.02, AC-F02-2, D-03).
 *
 * Rejects a request without a Bearer header, with a malformed header, or
 * with a token the SupabaseTokenVerifier cannot confirm. Every rejection
 * raises Nest's UnauthorizedException for the same 401 body. A verifier
 * outage (503) propagates instead of reading as 401.
 *
 * On success the guard attaches AuthenticatedIdentity, the token assurance
 * claims and the application account state to request.user. T6.08 uses that
 * state to refuse a flagged account outside its reset routes and to refuse a
 * token issued before a password change or global session revocation. T6.09
 * uses `mfaResetRequired` to refuse normal routes after a privileged factor
 * reset until the account verifies a new factor (AC-F02-4).
 *
 * The account lookup is mandatory. A verified provider identity with no
 * application user row is refused instead of being treated as an account with
 * no restrictions. A lookup failure propagates, so a database outage cannot
 * grant access.
 */

import {
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  type CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_MFA_RESET_KEY } from './allow-mfa-reset-required.decorator.js';
import { ALLOW_PASSWORD_RESET_KEY } from './allow-password-reset-required.decorator.js';
import type { AuthAccountState } from './auth-account.service.js';
import { AuthAccountService } from './auth-account.service.js';
import type { AuthAssurance } from './auth-assurance.js';
import { readAuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import { TokenRevocationService } from './token-revocation.service.js';
import { SupabaseAdminService } from './supabase-admin.service.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

const BEARER_PATTERN = /^\s*Bearer\s+(\S+)\s*$/i;

type GuardedRequest = {
  headers: { authorization?: string };
  user?: AuthenticatedIdentity;
  accessToken?: string;
  authAssurance?: AuthAssurance;
  account?: AuthAccountState;
  passwordResetRequired?: boolean;
  mfaResetRequired?: boolean;
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: SupabaseTokenVerifier,
    @Inject(AuthAccountService)
    private readonly accounts: AuthAccountService,
    @Optional()
    @Inject(TokenRevocationService)
    private readonly revocations: TokenRevocationService | null = null,
    @Optional()
    @Inject(SupabaseAdminService)
    private readonly admin: SupabaseAdminService | null = null,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const match = BEARER_PATTERN.exec(request.headers.authorization ?? '');
    if (!match) {
      throw new UnauthorizedException();
    }

    // Sign-out writes this row before the verifier cache can accept a reused
    // access token, so the denial is shared across API instances.
    if (this.revocations && (await this.revocations.isRevoked(match[1]))) {
      throw new UnauthorizedException();
    }

    const token = match[1];
    const identity = await this.verifier.verify(token);
    if (!identity) {
      throw new UnauthorizedException();
    }

    const assurance = readAuthAssurance(token);
    // Fail closed: no application row means no verified account state, so the
    // caller cannot prove that the reset flag and token cutoff are clear.
    const account = await this.accounts.findState(identity);
    if (!account) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_PROVISIONED',
        message: 'No active application account exists for this identity',
      });
    }
    if (
      account.tokenInvalidBefore &&
      (assurance.issuedAt === null ||
        assurance.issuedAt * 1_000 <= account.tokenInvalidBefore.getTime())
    ) {
      throw new UnauthorizedException();
    }
    if (account.passwordResetRequired && !this.allowsResetRequired(context)) {
      throw new ForbiddenException({
        code: 'PASSWORD_RESET_REQUIRED',
        message: 'The account must change its password before normal use',
      });
    }
    if (
      account.mfaResetRequired &&
      !this.allowsMfaResetRequired(context) &&
      !(await this.enrollsNewFactor(identity, account))
    ) {
      throw new ForbiddenException({
        code: 'MFA_RESET_REQUIRED',
        message: 'The account must verify a new MFA factor before normal use',
      });
    }

    request.user = identity;
    request.accessToken = token;
    request.authAssurance = assurance;
    request.account = account;
    request.passwordResetRequired = account.passwordResetRequired;
    request.mfaResetRequired = account.mfaResetRequired;
    return true;
  }

  private allowsResetRequired(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_RESET_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private allowsMfaResetRequired(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_RESET_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /**
   * Read the provider's factor list once the reset flag is set. A verified
   * factor clears the flag, so the next request is normal again. A provider
   * fault keeps the flag and the denial: the reset stays fail-closed.
   */
  private async enrollsNewFactor(
    identity: AuthenticatedIdentity,
    account: AuthAccountState,
  ): Promise<boolean> {
    if (!this.admin) {
      return false;
    }
    let factors: { id: string; verified: boolean }[];
    try {
      factors = await this.admin.listMfaFactors(identity.subject);
    } catch {
      return false;
    }
    if (!factors.some((factor) => factor.verified)) {
      return false;
    }
    await this.accounts.clearFactorReset(account.userId);
    return true;
  }
}
