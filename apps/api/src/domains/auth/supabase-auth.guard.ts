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
 * token issued before a password change or global session revocation.
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
import { ALLOW_PASSWORD_RESET_KEY } from './allow-password-reset-required.decorator.js';
import type { AuthAccountState } from './auth-account.service.js';
import { AuthAccountService } from './auth-account.service.js';
import type { AuthAssurance } from './auth-assurance.js';
import { readAuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import { TokenRevocationService } from './token-revocation.service.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

const BEARER_PATTERN = /^\s*Bearer\s+(\S+)\s*$/i;

type GuardedRequest = {
  headers: { authorization?: string };
  user?: AuthenticatedIdentity;
  accessToken?: string;
  authAssurance?: AuthAssurance;
  account?: AuthAccountState | null;
  passwordResetRequired?: boolean;
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: SupabaseTokenVerifier,
    @Optional()
    @Inject(TokenRevocationService)
    private readonly revocations: TokenRevocationService | null = null,
    @Optional()
    @Inject(AuthAccountService)
    private readonly accounts: AuthAccountService | null = null,
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
    const account = this.accounts
      ? await this.accounts.findState(identity)
      : null;
    if (
      account?.tokenInvalidBefore &&
      (assurance.issuedAt === null ||
        assurance.issuedAt * 1_000 <= account.tokenInvalidBefore.getTime())
    ) {
      throw new UnauthorizedException();
    }
    if (account?.passwordResetRequired && !this.allowsResetRequired(context)) {
      throw new ForbiddenException({
        code: 'PASSWORD_RESET_REQUIRED',
        message: 'The account must change its password before normal use',
      });
    }

    request.user = identity;
    request.accessToken = token;
    request.authAssurance = assurance;
    request.account = account;
    request.passwordResetRequired = account?.passwordResetRequired ?? false;
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
}
