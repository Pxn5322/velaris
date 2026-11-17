/**
 * Shared step-up service stub for route suites that test other behavior.
 *
 * The dedicated auth assurance suite runs the real service. These suites only
 * need a reachable route after authentication, permission and tenant checks,
 * so the guard resolves a permissive service instead of a grant per case.
 */

import { StepUpService } from '../src/domains/auth/step-up.service.js';

export const STEP_UP_SERVICE_TEST_PROVIDER = {
  provide: StepUpService,
  useValue: {
    requiresMfa: () => false,
    verify: async () => true,
  },
};
