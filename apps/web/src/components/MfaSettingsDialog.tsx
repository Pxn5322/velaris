"use client";

/**
 * Authenticator settings for the signed-in account (T6.09, D-59 option A).
 *
 * The dialog lists verified TOTP factors and lets the user add one backup
 * factor. Supabase requires an AAL2 session before it enrolls another factor,
 * so an existing factor is verified first. The new factor is removed when the
 * user closes the dialog before verification.
 *
 * Mandatory mode serves a reset account (T6.09): no factor exists, so the
 * dialog enrolls one at once, cannot be dismissed, and offers sign-out.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Loader2,
  Plus,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import {
  enrollTotp,
  listTotpFactors,
  removeTotpFactor,
  totpFactorLabel,
  verifyTotp,
  type TotpEnrollment,
  type TotpFactor,
} from "@/lib/auth/mfa";

interface MfaSettingsDialogProps {
  onClose: () => void;
  /** A privileged reset removed every factor; enrollment is required. */
  mandatory?: boolean;
  /** Runs after the new factor is verified so the caller can read state again. */
  onVerified?: () => void | Promise<void>;
}

type Stage = "loading" | "list" | "verify" | "enroll";

function describe(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The authenticator request failed.";
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      data-testid="mfa-settings-error"
      className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-300"
    >
      {message}
    </p>
  );
}

export function MfaSettingsDialog({
  onClose,
  mandatory = false,
  onVerified,
}: MfaSettingsDialogProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadFactors = async () => {
    const list = await listTotpFactors();
    setFactors(list);
    setStage("list");
  };

  useEffect(() => {
    let active = true;
    if (mandatory) {
      // A reset account has no factor to verify first, so enroll at once.
      enrollTotp("VELARIS")
        .then((created) => {
          if (!active) return;
          setEnrollment(created);
          setFactorId(created.factorId);
          setStage("enroll");
        })
        .catch((caught) => {
          if (!active) return;
          setError(describe(caught));
          setStage("list");
        });
      return () => {
        active = false;
      };
    }
    listTotpFactors()
      .then((list) => {
        if (!active) return;
        setFactors(list);
        setStage("list");
      })
      .catch((caught) => {
        if (!active) return;
        setError(describe(caught));
        setStage("list");
      });
    return () => {
      active = false;
    };
  }, [mandatory]);

  const close = useCallback(() => {
    // A mandatory enrollment belongs to the reset account; sign-out keeps it.
    if (enrollment && !mandatory) {
      void removeTotpFactor(enrollment.factorId);
    }
    onClose();
  }, [enrollment, mandatory, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !mandatory) {
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, close, mandatory]);

  const createEnrollment = async (name: string): Promise<void> => {
    const created = await enrollTotp(name);
    setEnrollment(created);
    setFactorId(created.factorId);
    setCode("");
    setStage("enroll");
  };

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const enrollFirst = () => {
    setNotice("");
    void run(() => createEnrollment("VELARIS"));
  };

  const startBackup = () => {
    if (!factors[0]) return;
    setFactorId(factors[0].id);
    setCode("");
    setError("");
    setNotice("");
    setStage("verify");
  };

  const verifyExisting = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!factorId) return;
    void run(async () => {
      await verifyTotp(factorId, code.trim());
      await createEnrollment("VELARIS backup");
    });
  };

  const verifyNew = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollment) return;
    const enrolledId = enrollment.factorId;
    void run(async () => {
      await verifyTotp(enrolledId, code.trim());
      setEnrollment(null);
      setCode("");
      if (mandatory) {
        // Read the factors first, so a session read that does not clear the
        // flag leaves a usable panel instead of an empty dialog.
        setNotice("Authenticator verified.");
        setStage("list");
        await loadFactors().catch(() => undefined);
        await onVerified?.();
        return;
      }
      await loadFactors();
      setNotice("Backup authenticator added.");
    });
  };

  const backToList = () => {
    setStage("list");
    setCode("");
    setError("");
  };

  const qrImage =
    enrollment?.qrCode && enrollment.qrCode.startsWith("data:image")
      ? enrollment.qrCode
      : null;

  const codeInput = (testId: string) => (
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
      data-testid={testId}
      className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 tracking-[0.35em] text-heading focus:border-brand-cyan focus:outline-none"
    />
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !mandatory)
          close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mfa-settings-title"
        data-testid="mfa-settings"
        data-stage={stage}
        data-required={mandatory ? "true" : undefined}
        className="glass-panel relative w-full max-w-md space-y-5 rounded-3xl border border-[var(--card-border)] p-6 shadow-2xl"
      >
        {!mandatory && (
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Close authenticator settings"
            data-testid="mfa-settings-close"
            className="absolute right-4 top-4 text-muted-custom hover:text-heading disabled:opacity-60"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        <div className="flex items-start gap-3 pr-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="space-y-1">
            <h2
              id="mfa-settings-title"
              className="font-display text-xl font-bold text-heading"
            >
              {mandatory
                ? "Set up your authenticator"
                : "Authenticator settings"}
            </h2>
            <p className="text-xs text-muted-custom">
              {mandatory
                ? "A privileged reset removed your authenticator. Set up a new one to continue."
                : "Add a backup authenticator so a lost device does not lock you out."}
            </p>
          </div>
        </div>

        {stage === "loading" && (
          <p
            className="flex items-center gap-2 font-mono text-xs text-muted-custom"
            role="status"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading authenticators…
          </p>
        )}

        {stage === "list" && (
          <div className="space-y-4 font-mono text-xs">
            {factors.length === 0 ? (
              <p className="rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] p-3 text-muted-custom">
                {mandatory
                  ? "No authenticator is enrolled. Set one up to continue."
                  : "No authenticator is enrolled. Set up one before you add a backup."}
              </p>
            ) : (
              <ul className="space-y-2">
                {factors.map((factor, index) => (
                  <li
                    key={factor.id}
                    data-testid="mfa-factor"
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] p-3"
                  >
                    <span className="flex items-center gap-2 text-heading">
                      <Smartphone className="h-4 w-4 text-cyan-300" />
                      {totpFactorLabel(factor, index)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verified
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!mandatory && factors.length === 1 && (
              <p className="text-[11px] text-muted-custom">
                Verify the current authenticator before you add a backup.
              </p>
            )}

            {!mandatory && factors.length > 1 && (
              <p
                className="inline-flex items-center gap-1 text-[11px] text-emerald-300"
                data-testid="mfa-backup-ready"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />A backup authenticator
                is enrolled.
              </p>
            )}

            {notice && (
              <p
                role="status"
                data-testid="mfa-settings-notice"
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-300"
              >
                {notice}
              </p>
            )}

            <ErrorNotice message={error} />

            <div className="flex flex-wrap justify-end gap-2">
              {factors.length === 0 && (
                <button
                  type="button"
                  onClick={() => void enrollFirst()}
                  disabled={busy}
                  data-testid="mfa-enroll-start"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Set up authenticator
                </button>
              )}
              {!mandatory && factors.length === 1 && (
                <button
                  type="button"
                  onClick={startBackup}
                  disabled={busy}
                  data-testid="mfa-add-backup"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add backup authenticator
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="rounded-xl glass-panel px-4 py-2 font-bold text-muted-custom hover:text-heading"
              >
                {mandatory ? "Sign out" : "Close"}
              </button>
            </div>
          </div>
        )}

        {stage === "verify" && (
          <form
            onSubmit={verifyExisting}
            className="space-y-4 font-mono text-xs"
            data-testid="mfa-verify-form"
          >
            <p className="text-muted-custom">
              Verify{" "}
              <strong className="text-heading">
                {factors[0]
                  ? totpFactorLabel(factors[0], 0)
                  : "the authenticator"}
              </strong>{" "}
              before you add a backup.
            </p>
            <label className="block space-y-1">
              <span className="text-muted-custom">Six-digit code</span>
              {codeInput("mfa-existing-code")}
            </label>

            <ErrorNotice message={error} />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={backToList}
                disabled={busy}
                className="rounded-xl glass-panel px-4 py-2 font-bold text-muted-custom hover:text-heading disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                data-testid="mfa-existing-submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Verifying…" : "Verify and continue"}
              </button>
            </div>
          </form>
        )}

        {stage === "enroll" && enrollment && (
          <form
            onSubmit={verifyNew}
            className="space-y-4 font-mono text-xs"
            data-testid="mfa-enroll-form"
          >
            <div className="space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] p-3">
              <p className="flex items-center gap-2 font-bold text-heading">
                <Smartphone className="h-4 w-4 text-cyan-300" />
                {mandatory
                  ? "Set up the new authenticator"
                  : "Set up the backup authenticator"}
              </p>
              <p className="text-[11px] text-muted-custom">
                {mandatory
                  ? "Scan the code or enter the secret in the authenticator app, then enter the six-digit code below."
                  : "Scan the code or enter the secret in the backup device, then enter the six-digit code below."}
              </p>
              {qrImage && (
                // The data URL comes from the identity provider.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImage}
                  alt="Backup authenticator enrollment QR code"
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

            <label className="block space-y-1">
              <span className="text-muted-custom">Six-digit code</span>
              {codeInput("mfa-new-code")}
            </label>

            <ErrorNotice message={error} />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                data-testid="mfa-enroll-cancel"
                className="rounded-xl glass-panel px-4 py-2 font-bold text-muted-custom hover:text-heading disabled:opacity-60"
              >
                {mandatory ? "Sign out" : "Cancel setup"}
              </button>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                data-testid="mfa-new-submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy
                  ? "Verifying…"
                  : mandatory
                    ? "Verify authenticator"
                    : "Verify backup"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
