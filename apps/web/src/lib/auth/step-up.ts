/** Step-up action names shared with the API decorators (T6.08). */
export const STEP_UP_ACTIONS = {
  ROLE_CHANGE: "role.change",
  MEMBERSHIP_CHANGE: "membership.change",
  TENANT_CHANGE: "tenant.change",
  PROVIDER_CHANGE: "provider.change",
  RETENTION_CHANGE: "retention.change",
  ATTACHMENT_SEND: "attachment.send",
  SESSION_REVOKE: "session.revoke",
} as const;

export type StepUpAction =
  (typeof STEP_UP_ACTIONS)[keyof typeof STEP_UP_ACTIONS];

export interface StepUpApiError extends Error {
  status: number;
  body: Record<string, unknown>;
}

/** True when an API response asks for re-authentication or a higher AAL. */
export function isStepUpChallenge(error: unknown): error is StepUpApiError {
  if (!(error instanceof Error) || !("body" in error)) {
    return false;
  }
  const code = (error as StepUpApiError).body.code;
  return code === "MFA_REQUIRED" || code === "STEP_UP_REQUIRED";
}

export function isMfaRequired(error: unknown): boolean {
  return isStepUpChallenge(error) && error.body.code === "MFA_REQUIRED";
}

/** User-facing name for the action being confirmed. */
export function stepUpActionLabel(action: StepUpAction): string {
  switch (action) {
    case STEP_UP_ACTIONS.ROLE_CHANGE:
      return "change a role or permission profile";
    case STEP_UP_ACTIONS.MEMBERSHIP_CHANGE:
      return "change workspace membership";
    case STEP_UP_ACTIONS.TENANT_CHANGE:
      return "change a workspace";
    case STEP_UP_ACTIONS.PROVIDER_CHANGE:
      return "change the AI model gateway";
    case STEP_UP_ACTIONS.RETENTION_CHANGE:
      return "change a retention window";
    case STEP_UP_ACTIONS.ATTACHMENT_SEND:
      return "send an attachment";
    case STEP_UP_ACTIONS.SESSION_REVOKE:
      return "revoke your sessions";
  }
}
