/**
 * Supabase access-token verification (T1.02, AC-F02-2, D-03).
 *
 * Calls Supabase Auth's userinfo endpoint (GET /auth/v1/user) with the
 * caller's bearer token. Supabase validates the signature and expiry
 * server-side, so this service never handles signing secrets.
 *
 * Contract:
 * - valid token   -> AuthenticatedIdentity
 * - invalid/expired token (non-2xx answer) -> null, which the guard maps
 *   to one consistent 401 body (AC-F02-2)
 * - unreachable Supabase or missing configuration -> 503, so a transport
 *   fault never reads as "your credential is bad"
 *
 * Environment (docs/SETUP_GUIDE.md section 4): SUPABASE_URL (project URL)
 * and SUPABASE_PUBLISHABLE_KEY (public apikey header). Error messages
 * name a missing variable but never print its value.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedIdentity } from './auth.interface.js';

const REQUEST_TIMEOUT_MS = 5_000;

export class SupabaseTokenVerifier {
  /**
   * Verify one bearer token against Supabase Auth.
   * Returns null when the token is invalid, expired or stale.
   */
  async verify(token: string): Promise<AuthenticatedIdentity | null> {
    const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!baseUrl) {
      throw new ServiceUnavailableException('SUPABASE_URL is not configured');
    }
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'SUPABASE_PUBLISHABLE_KEY is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('Supabase Auth is unreachable');
    }

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { sub?: unknown; email?: unknown };
    if (typeof body.sub !== 'string' || body.sub.length === 0) {
      return null;
    }
    return {
      provider: 'supabase',
      subject: body.sub,
      email: typeof body.email === 'string' ? body.email : undefined,
    };
  }
}
