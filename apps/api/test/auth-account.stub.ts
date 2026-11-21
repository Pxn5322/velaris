/**
 * Shared account-state stub for route integration suites.
 *
 * `SupabaseAuthGuard` requires AuthAccountService so a missing account row
 * fails closed. Most route suites exercise authorization and data rules, not
 * reset state, so they provide this unrestricted synthetic account. The auth
 * assurance suites use the real service and their own Prisma store.
 */

import type { AuthenticatedIdentity } from '../src/domains/auth/auth.interface.js';
import { AuthAccountService } from '../src/domains/auth/auth-account.service.js';

export const AUTH_ACCOUNT_TEST_PROVIDER = {
  provide: AuthAccountService,
  useValue: {
    findState: async (identity: AuthenticatedIdentity) => ({
      userId: `test-${identity.subject}`,
      passwordResetRequired: false,
      tokenInvalidBefore: null,
    }),
    completePasswordChange: async () => undefined,
    revokeAllSessions: async () => undefined,
  },
};
