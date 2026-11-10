/**
 * Supabase access-token verification (T1.02, AC-F02-2, D-03; cache D-39).
 *
 * Calls Supabase Auth's userinfo endpoint (GET /auth/v1/user) with the
 * caller's bearer token. Supabase validates the signature and expiry
 * server-side, so this service never handles signing secrets.
 *
 * A successful verification is cached for a short, bounded window. The cache
 * stores only a SHA-256 digest of the token, never the token itself. A cache
 * hit avoids one remote round trip per request, which matters because the
 * deployed API and Supabase Auth are in different regions. Invalid tokens are
 * not cached, so a revoked credential stops working after at most the TTL.
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

import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedIdentity } from './auth.interface.js';

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_000;

interface CacheEntry {
  identity: AuthenticatedIdentity;
  /** Epoch milliseconds after which the entry must not be used. */
  expiresAt: number;
}

interface SupabaseConfiguration {
  baseUrl: string;
  apiKey: string;
}

export class SupabaseTokenVerifier {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<
    string,
    Promise<AuthenticatedIdentity | null>
  >();

  /**
   * The two numeric arguments exist for tests. Production uses the defaults:
   * 60 seconds and 1,000 entries. A shorter TTL narrows the revocation window;
   * a zero TTL disables the cache.
   */
  constructor(
    private readonly cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly maxCacheEntries: number = DEFAULT_MAX_CACHE_ENTRIES,
  ) {}

  /**
   * Verify one bearer token against Supabase Auth, using a bounded cache for
   * successful answers. Returns null when the token is invalid, expired or
   * stale.
   */
  async verify(token: string): Promise<AuthenticatedIdentity | null> {
    const configuration = this.configuration();
    const key = this.cacheKey(token);
    const cached = this.readCache(key);
    if (cached) {
      return cached;
    }

    // Coalesce concurrent requests for the same token. Without this, a burst
    // of requests after expiry would still make one Supabase call per request.
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const verification = this.verifyWithSupabase(token, configuration)
      .then((identity) => {
        if (identity) {
          this.remember(key, token, identity);
        }
        return identity;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, verification);
    return verification;
  }

  private configuration(): SupabaseConfiguration {
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
    return { baseUrl, apiKey };
  }

  private async verifyWithSupabase(
    token: string,
    configuration: SupabaseConfiguration,
  ): Promise<AuthenticatedIdentity | null> {
    let response: Response;
    try {
      response = await fetch(`${configuration.baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: configuration.apiKey,
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

    const body = (await response.json()) as {
      sub?: unknown;
      id?: unknown;
      email?: unknown;
    };
    // GoTrue's userinfo answer carries the user UUID in `id`; `sub` appears
    // in some versions and proxies. Accept both, prefer `sub` (verified
    // against the live project on 2026-10-26).
    const subject =
      typeof body.sub === 'string' && body.sub.length > 0
        ? body.sub
        : typeof body.id === 'string' && body.id.length > 0
          ? body.id
          : null;
    if (!subject) {
      return null;
    }
    return {
      provider: 'supabase',
      subject,
      email: typeof body.email === 'string' ? body.email : undefined,
    };
  }

  private readCache(key: string): AuthenticatedIdentity | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.identity;
  }

  private remember(
    key: string,
    token: string,
    identity: AuthenticatedIdentity,
  ): void {
    if (this.cacheTtlMs <= 0 || this.maxCacheEntries <= 0) {
      return;
    }
    const now = Date.now();
    const tokenExpiry = tokenExpiryMs(token);
    const expiresAt = Math.min(
      now + this.cacheTtlMs,
      tokenExpiry ?? Number.POSITIVE_INFINITY,
    );
    // Do not cache a token that is already expired, even if Supabase answered
    // successfully. The JWT payload is read only for this bound; it is not a
    // substitute for Supabase's signature check.
    if (expiresAt <= now) {
      return;
    }

    this.pruneExpired(now);
    while (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
    this.cache.set(key, { identity, expiresAt });
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  /** A digest is enough for the key; the raw bearer token stays out of memory. */
  private cacheKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

/** Read the `exp` claim without trusting it; it only bounds the cache TTL. */
function tokenExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1_000
      : null;
  } catch {
    return null;
  }
}
