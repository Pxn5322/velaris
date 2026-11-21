/**
 * Require a recent step-up for a sensitive handler (T6.08, D-58).
 *
 * StepUpGuard reads the action name and consumes the grant supplied in the
 * `x-step-up-token` header. The action policy decides whether `aal2` is also
 * required. `when: 'attachments'` makes the check conditional on a non-empty
 * `attachments` array, so an ordinary message does not need a grant.
 */

import { SetMetadata } from '@nestjs/common';

export const STEP_UP_DECORATOR_KEY = 'velaris.requiredStepUp';

export interface StepUpRequirement {
  action: string;
  when?: 'attachments';
}

export const RequireStepUp = (
  action: string,
  options: Omit<StepUpRequirement, 'action'> = {},
) => SetMetadata(STEP_UP_DECORATOR_KEY, { action, ...options });
