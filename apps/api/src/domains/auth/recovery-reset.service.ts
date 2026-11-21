/**
 * Privileged recovery reset (T6.09; D-59 matrix, D-62 section 12).
 *
 * One approved execution removes every MFA factor of the target and revokes
 * their sessions. The caller (the recovery approval service) stores the result
 * and reports SUCCEEDED or FAILED, so a provider fault becomes a recorded
 * outcome instead of a 5xx that loses the execution.
 *
 * GoTrue has no admin endpoint that logs out another user. Deleting a verified
 * factor revokes that user's provider sessions, and the local token cutoff
 * refuses every access token issued before this instant on every API instance
 * (D-39, D-51). The same write sets `mfaResetRequired`, so normal routes stay
 * refused until the target verifies a new factor (AC-F02-4). The reset never
 * reads or stores a TOTP secret.
 */

import { Injectable } from '@nestjs/common';
import { AuthAccountService } from './auth-account.service.js';
import { SupabaseAdminService } from './supabase-admin.service.js';

export const RESET_RESULTS = {
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;

export type ResetResult = (typeof RESET_RESULTS)[keyof typeof RESET_RESULTS];

export interface ResetOutcome {
  result: ResetResult;
  failureCode: string | null;
}

@Injectable()
export class RecoveryResetService {
  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly accounts: AuthAccountService,
  ) {}

  /** Remove every factor, then revoke sessions; report one safe outcome. */
  async perform(
    targetUserId: string,
    targetSubject: string,
  ): Promise<ResetOutcome> {
    try {
      const factors = await this.admin.listMfaFactors(targetSubject);
      for (const factor of factors) {
        await this.admin.deleteMfaFactor(targetSubject, factor.id);
      }
    } catch {
      return {
        result: RESET_RESULTS.FAILED,
        failureCode: 'PROVIDER_FACTOR_RESET_FAILED',
      };
    }

    try {
      await this.accounts.beginFactorReset(targetUserId);
    } catch {
      return {
        result: RESET_RESULTS.FAILED,
        failureCode: 'SESSION_REVOKE_FAILED',
      };
    }

    return { result: RESET_RESULTS.SUCCEEDED, failureCode: null };
  }
}
