/**
 * Bearer-token guard for protected routes (T1.02, AC-F02-2, D-03).
 *
 * Rejects a request without a Bearer header, with a malformed header, or
 * with a token the SupabaseTokenVerifier cannot confirm. Every rejection
 * raises Nest's UnauthorizedException, so all 401 bodies are identical.
 * A verifier outage (503) propagates instead of reading as 401.
 *
 * On success the guard attaches AuthenticatedIdentity to request.user,
 * which controllers read through the request object.
 */

import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  type CanActivate,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from './auth.interface.js';
// Value import on purpose: with emitDecoratorMetadata the Nest injector
// reads design:paramtypes from this import. `import type` erases the class
// and the guard cannot resolve its dependency at runtime.
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

const BEARER_PATTERN = /^\s*Bearer\s+(\S+)\s*$/i;

type GuardedRequest = {
  headers: { authorization?: string };
  user?: AuthenticatedIdentity;
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly verifier: SupabaseTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const match = BEARER_PATTERN.exec(request.headers.authorization ?? '');
    if (!match) {
      throw new UnauthorizedException();
    }

    const identity = await this.verifier.verify(match[1]);
    if (!identity) {
      throw new UnauthorizedException();
    }

    request.user = identity;
    return true;
  }
}
