/**
 * Permit one handler while the account must change its password (T6.08).
 *
 * SupabaseAuthGuard refuses every protected route for a flagged account unless
 * the handler carries this metadata. Only the session read, the password
 * change and sign-out use it.
 */

import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_RESET_KEY = 'velaris.allowPasswordResetRequired';

export const AllowPasswordResetRequired = () =>
  SetMetadata(ALLOW_PASSWORD_RESET_KEY, true);
