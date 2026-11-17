/**
 * Require a recent step-up for a sensitive handler (T6.08, D-58).
 *
 * StepUpGuard reads the action name and consumes the grant supplied in the
 * `x-step-up-token` header. The action policy decides whether `aal2` is also
 * required.
 */

import { SetMetadata } from '@nestjs/common';

export const STEP_UP_DECORATOR_KEY = 'velaris.requiredStepUp';

export const RequireStepUp = (action: string) =>
  SetMetadata(STEP_UP_DECORATOR_KEY, action);
