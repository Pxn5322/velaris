/**
 * Password change for the signed-in caller (T6.08, D-58).
 *
 * This is the only path that clears `password_reset_required`. It verifies the
 * current password, applies the reset policy, updates the provider password,
 * clears the flag and advances the token cutoff so every earlier access token
 * is refused. Recovery links and MFA reset remain T6.09.
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthAccountService } from './auth-account.service.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { StepUpService, currentPasswordInvalid } from './step-up.service.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

export interface ChangePasswordInput {
  currentPassword?: unknown;
  newPassword?: unknown;
}

@Injectable()
export class PasswordChangeService {
  constructor(
    @Inject(AuthAccountService) private readonly accounts: AuthAccountService,
    private readonly policy: PasswordPolicyService,
    private readonly verifier: SupabaseTokenVerifier,
    private readonly stepUps: StepUpService,
  ) {}

  async change(
    identity: AuthenticatedIdentity,
    token: string | undefined,
    input: ChangePasswordInput,
  ): Promise<void> {
    if (!token) {
      throw new UnauthorizedException();
    }
    if (!identity.email) {
      throw new BadRequestException({
        code: 'EMAIL_REQUIRED',
        message: 'The account has no email address for a password change',
      });
    }
    const currentPassword =
      typeof input.currentPassword === 'string' ? input.currentPassword : '';
    this.policy.assertAcceptable({
      newPassword: input.newPassword,
      currentPassword,
      email: identity.email,
    });

    const account = await this.accounts.findState(identity);
    if (!account) {
      throw new UnauthorizedException();
    }
    if (
      !(await this.verifier.verifyPassword(identity.email, currentPassword))
    ) {
      throw currentPasswordInvalid();
    }

    await this.verifier.changePassword(
      token,
      currentPassword,
      input.newPassword as string,
    );
    await this.accounts.completePasswordChange(account.userId);
    await this.stepUps.revokeForSubject(identity.subject);
  }
}
