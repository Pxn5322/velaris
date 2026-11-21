"use client";

/**
 * Step-up runner for sensitive browser actions (T6.08, D-58).
 *
 * A caller supplies the action and tenant scope. The runner tries the
 * operation first. If the API refuses with `MFA_REQUIRED` or
 * `STEP_UP_REQUIRED`, the runner opens the re-authentication dialog, receives
 * one grant, and retries with it as an `x-step-up-token` header value. Grants
 * are single use, so no token is cached between actions.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { StepUpDialog } from "@/components/auth/StepUpDialog";
import { isStepUpChallenge, type StepUpAction } from "@/lib/auth/step-up";

type Operation<T> = (stepUpToken: string) => Promise<T>;

interface PendingStepUp {
  action: StepUpAction;
  tenantId: string | null;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

interface StepUpContextValue {
  runWithStepUp: <T>(
    action: StepUpAction,
    tenantId: string | null,
    operation: Operation<T>,
  ) => Promise<T>;
}

const StepUpContext = createContext<StepUpContextValue | undefined>(undefined);

export const STEP_UP_CANCELLED =
  "This action was cancelled before confirmation.";

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingStepUp | null>(null);

  const requestGrant = useCallback(
    (action: StepUpAction, tenantId: string | null) =>
      new Promise<string>((resolve, reject) => {
        setPending({ action, tenantId, resolve, reject });
      }),
    [],
  );

  const runWithStepUp = useCallback(
    async <T,>(
      action: StepUpAction,
      tenantId: string | null,
      operation: Operation<T>,
    ): Promise<T> => {
      try {
        return await operation("");
      } catch (error) {
        if (!isStepUpChallenge(error)) {
          throw error;
        }
      }
      const token = await requestGrant(action, tenantId);
      return operation(token);
    },
    [requestGrant],
  );

  const value = useMemo(() => ({ runWithStepUp }), [runWithStepUp]);

  return (
    <StepUpContext.Provider value={value}>
      {children}
      {pending && (
        <StepUpDialog
          action={pending.action}
          tenantId={pending.tenantId}
          onGranted={(token) => {
            pending.resolve(token);
            setPending(null);
          }}
          onCancel={() => {
            pending.reject(new Error(STEP_UP_CANCELLED));
            setPending(null);
          }}
        />
      )}
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const context = useContext(StepUpContext);
  if (!context) {
    throw new Error("useStepUp must be used within a StepUpProvider");
  }
  return context;
}
