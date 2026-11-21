/**
 * Permit one handler while the account must verify a new MFA factor (T6.09).
 *
 * SupabaseAuthGuard refuses every protected route after a privileged factor
 * reset unless the handler carries this metadata. Only the session read and
 * sign-out use it, which is what lets the browser see the account state and
 * reach the enrollment UI (AC-F02-4).
 */

import { SetMetadata } from '@nestjs/common';

export const ALLOW_MFA_RESET_KEY = 'velaris.allowMfaResetRequired';

export const AllowMfaResetRequired = () =>
  SetMetadata(ALLOW_MFA_RESET_KEY, true);
