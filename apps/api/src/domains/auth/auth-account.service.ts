/**
 * Application account security state (T6.08, D-58).
 *
 * The flag and cutoff live on the application user row, not in the token, so
 * an operator or a completed reset changes the next request immediately. The
 * verifier cache does not bypass this lookup: the guard reads the row after it
 * verifies the token.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuthenticatedIdentity } from './auth.interface.js';

export interface AuthAccountState {
  userId: string;
  passwordResetRequired: boolean;
  /** Access tokens issued at or before this instant are refused. */
  tokenInvalidBefore: Date | null;
}

@Injectable()
export class AuthAccountService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Read the caller's own security state; null when no application row exists. */
  async findState(
    identity: AuthenticatedIdentity,
  ): Promise<AuthAccountState | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        provider_externalSubject: {
          provider: identity.provider,
          externalSubject: identity.subject,
        },
      },
      select: {
        id: true,
        passwordResetRequired: true,
        tokenInvalidBefore: true,
      },
    });
    if (!user) {
      return null;
    }
    return {
      userId: user.id,
      passwordResetRequired: user.passwordResetRequired,
      tokenInvalidBefore: user.tokenInvalidBefore,
    };
  }

  /**
   * Finish a password reset and refuse every access token minted before this
   * instant. Supabase also revokes the provider sessions on a password change;
   * this cutoff covers access JWTs that were already issued.
   */
  async completePasswordChange(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetRequired: false,
        tokenInvalidBefore: new Date(),
      },
    });
  }

  /** Refuse every access token issued before now for this account. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenInvalidBefore: new Date() },
    });
  }
}
