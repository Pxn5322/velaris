"use client";

/**
 * Re-authentication dialog for a sensitive action (T6.08, D-58).
 *
 * The API requires a current password and an `aal2` session. An administrator
 * with no factor is enrolled here: the dialog shows the TOTP secret and QR,
 * verifies the first code, replaces the stored session tokens with the `aal2`
 * pair, then requests the one-time grant. The grant is never cached because
 * the API consumes it on first use.
 */

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2, ShieldCheck, Smartphone, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import {
  enrollTotp,
  listTotpFactors,
  removeTotpFactor,
  verifyTotp,
  type TotpEnrollment,
} from "@/lib/auth/mfa";
import {
  isMfaRequired,
  stepUpActionLabel,
  type StepUpAction,
} from "@/lib/auth/step-up";

interface StepUpDialogProps {
  action: StepUpAction;
  tenantId: string | null;
  onGranted: (token: string) => void;
  onCancel: () => void;
}

type Stage = "password" | "mfa" | "enroll";

function describe(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The confirmation could not be completed.";
}

export function StepUpDialog({
  action,
  tenantId,
  onGranted,
  onCancel,
}: StepUpDialogProps) {
  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const label = stepUpActionLabel(action);

  const cancel = () => {
    if (enrollment && !verified) {
      void removeTotpFactor(enrollment.factorId);
    }
    onCancel();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        if (enrollment && !verified) {
          void removeTotpFactor(enrollment.factorId);
        }
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, enrollment, onCancel, verified]);

  const issueGrant = async (): Promise<string> => {
    const result = await apiFetch<{ token: string }>("/auth/step-up", {
      method: "POST",
      body: JSON.stringify({ action, tenantId, password }),
    });
    return result.token;
  };

  const prepareFactor = async () => {
    const factors = await listTotpFactors();
    if (factors.length > 0) {
      setFactorId(factors[0].id);
      setStage("mfa");
      return;
    }
    const created = await enrollTotp();
    setEnrollment(created);
    setFactorId(created.factorId);
    setStage("enroll");
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onGranted(await issueGrant());
    } catch (caught) {
      if (isMfaRequired(caught)) {
        try {
          await prepareFactor();
        } catch (factorError) {
          setError(describe(factorError));
        }
      } else {
        setError(describe(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError("");
    try {
      await verifyTotp(factorId, code.trim());
      setVerified(true);
      onGranted(await issueGrant());
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const qrImage =
    enrollment?.qrCode && enrollment.qrCode.startsWith("data:image")
      ? enrollment.qrCode
      : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) cancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        data-testid="step-up-dialog"
        className="glass-panel relative w-full max-w-md space-y-5 rounded-3xl border border-[var(--card-border)] p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          aria-label="Cancel confirmation"
          data-testid="step-up-cancel"
          className="absolute right-4 top-4 text-muted-custom hover:text-heading disabled:opacity-60"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="space-y-1">
            <h2
              id="step-up-title"
              className="font-display text-xl font-bold text-heading"
            >
              Confirm this change
            </h2>
            <p className="text-xs text-muted-custom">
              To {label}, enter your current password
              {stage === "password" ? "." : " and an authenticator code."}
            </p>
          </div>
        </div>

        {stage === "password" ? (
          <form
            onSubmit={submitPassword}
            className="space-y-4 font-mono text-xs"
            data-testid="step-up-password-form"
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-custom">
              <KeyRound className="h-3.5 w-3.5 text-cyan-300" />
              The grant expires after 10 minutes and works once.
            </div>
            <label className="block space-y-1">
              <span className="text-muted-custom">Current password</span>
              <input
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid="step-up-password"
                className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading focus:border-brand-cyan focus:outline-none"
              />
            </label>

            {error && (
              <p
                role="alert"
                data-testid="step-up-error"
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-300"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="rounded-xl glass-panel px-4 py-2 font-bold text-muted-custom hover:text-heading disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || password.length === 0}
                data-testid="step-up-password-submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={submitCode}
            className="space-y-4 font-mono text-xs"
            data-testid="step-up-mfa-form"
          >
            {stage === "enroll" && enrollment && (
              <div className="space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] p-3">
                <p className="flex items-center gap-2 font-bold text-heading">
                  <Smartphone className="h-4 w-4 text-cyan-300" />
                  Set up an authenticator
                </p>
                <p className="text-[11px] text-muted-custom">
                  Scan the code or enter the secret in your authenticator app,
                  then enter the six-digit code below.
                </p>
                {qrImage && (
                  // The data URL comes from the identity provider.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrImage}
                    alt="Authenticator enrollment QR code"
                    className="mx-auto h-40 w-40 rounded-lg bg-white p-2"
                  />
                )}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-custom">
                    Secret
                  </span>
                  <code className="block break-all rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-2 text-[11px] text-heading">
                    {enrollment.secret}
                  </code>
                </div>
              </div>
            )}

            {stage === "mfa" && (
              <p className="flex items-center gap-2 text-[11px] text-muted-custom">
                <Smartphone className="h-3.5 w-3.5 text-cyan-300" />
                Enter the current code from your authenticator app.
              </p>
            )}

            <label className="block space-y-1">
              <span className="text-muted-custom">Six-digit code</span>
              <input
                type="text"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                data-testid="step-up-code"
                className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 tracking-[0.35em] text-heading focus:border-brand-cyan focus:outline-none"
              />
            </label>

            {error && (
              <p
                role="alert"
                data-testid="step-up-error"
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-300"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="rounded-xl glass-panel px-4 py-2 font-bold text-muted-custom hover:text-heading disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                data-testid="step-up-code-submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Verifying…" : "Verify and continue"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
