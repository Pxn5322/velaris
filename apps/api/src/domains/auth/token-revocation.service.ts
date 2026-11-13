/**
 * Signed-out access-token denial (D-51).
 *
 * Supabase logout removes the session and revokes its refresh token, but an
 * already-issued access JWT remains a valid signature until `exp`. The guard
 * checks this store before the verifier's 60-second cache, so a copied token
 * is refused immediately after sign-out on every API instance.
 *
 * Only a SHA-256 digest of the token enters the database; the bearer value is
 * never stored. The JWT `session_id` is also recorded so another access token
 * minted for the same Supabase session is denied by the same row.
 */

import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

const FALLBACK_TTL_MS = 60 * 60 * 1_000;

interface TokenClaims {
  tokenHash: string;
  sessionId: string | null;
  expiresAt: number;
}

@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly verifier: SupabaseTokenVerifier,
  ) {}

  /** True when this token, or its Supabase session, was signed out. */
  async isRevoked(token: string): Promise<boolean> {
    const claims = readTokenClaims(token);
    const clauses: Prisma.RevokedAccessTokenWhereInput[] = [
      { tokenHash: claims.tokenHash },
    ];
    if (claims.sessionId) {
      clauses.push({ sessionId: claims.sessionId });
    }
    const row = await this.prisma.revokedAccessToken.findFirst({
      where: {
        expiresAt: { gt: new Date() },
        OR: clauses,
      },
      select: { tokenHash: true },
    });
    return row !== null;
  }

  /**
   * Persist the denial first, then revoke the provider session. The database
   * row is what protects every API instance; the provider call stops the
   * refresh token from minting a replacement access token.
   */
  async revoke(token: string): Promise<void> {
    const claims = readTokenClaims(token);
    if (claims.expiresAt <= Date.now()) {
      return;
    }
    await this.prisma.revokedAccessToken.upsert({
      where: { tokenHash: claims.tokenHash },
      create: {
        tokenHash: claims.tokenHash,
        sessionId: claims.sessionId,
        expiresAt: new Date(claims.expiresAt),
      },
      update: {
        sessionId: claims.sessionId,
        expiresAt: new Date(claims.expiresAt),
      },
    });

    try {
      await this.verifier.revokeProviderSession(token);
    } catch (error) {
      this.logger.error(
        `Supabase session revocation failed after the access token was denied: ${
          error instanceof Error ? error.name : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException(
        'The session was denied locally, but Supabase could not be reached to revoke it',
      );
    }
  }
}

function readTokenClaims(token: string): TokenClaims {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const fallbackExpiry = Date.now() + FALLBACK_TTL_MS;
  const parts = token.split('.');
  if (parts.length < 2) {
    return { tokenHash, sessionId: null, expiresAt: fallbackExpiry };
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown; session_id?: unknown };
    const expiresAt =
      typeof payload.exp === 'number' && Number.isFinite(payload.exp)
        ? payload.exp * 1_000
        : fallbackExpiry;
    const sessionId =
      typeof payload.session_id === 'string' &&
      payload.session_id.length > 0 &&
      payload.session_id.length <= 64
        ? payload.session_id
        : null;
    return { tokenHash, sessionId, expiresAt };
  } catch {
    return { tokenHash, sessionId: null, expiresAt: fallbackExpiry };
  }
}
