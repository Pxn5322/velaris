"use client";

/**
 * Mandatory password change after a required reset (T6.08, D-58).
 *
 * The API reports `passwordResetRequired` on GET /auth/session and refuses
 * every other route with `403 PASSWORD_RESET_REQUIRED`. This gate asks for the
 * current password and a new one, then calls POST /auth/password. The change
 * advances the access-token cutoff, so the session ends: the gate signs out and
 * returns to the landing page, where the user signs in with the new password.
 * Sign out stays available at any time.
 */

import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { changeRequiredPassword } from "@/lib/auth/password";

const MIN_PASSWORD_LENGTH = 12;

export function PasswordResetGate() {
  const { passwordResetRequired, endSession } = useRole();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!passwordResetRequired) return null;

  const signOutNow = () => {
    void endSession().then(() => window.location.replace("/?signin=1"));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(
        `The new password must have at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    if (newPassword === currentPassword) {
      setError("The new password must differ from the current password.");
      return;
    }
    setBusy(true);
    void changeRequiredPassword({ currentPassword, newPassword })
      .then(() => {
        // The password change ends this session; sign in with the new one.
        return endSession();
      })
      .then(() => window.location.replace("/?signin=1"))
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "The password could not be changed.",
        );
        setBusy(false);
      });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-reset-title"
        data-testid="password-reset"
        data-required="true"
        className="glass-panel relative w-full max-w-md space-y-5 rounded-3xl border border-[var(--card-border)] p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10">
            <KeyRound className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="space-y-1">
            <h2
              id="password-reset-title"
              className="font-display text-xl font-bold text-heading"
            >
              Set a new password
            </h2>
            <p className="text-xs text-muted-custom">
              Your account must set a new password before you can continue.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 font-mono text-xs">
          <label className="block space-y-1">
            <span className="text-muted-custom">Current password</span>
            <input
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              data-testid="password-reset-current"
              className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading focus:border-brand-cyan focus:outline-none"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-muted-custom">New password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              data-testid="password-reset-new"
              className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading focus:border-brand-cyan focus:outline-none"
            />
            <span className="block text-[11px] text-muted-custom">
              At least {MIN_PASSWORD_LENGTH} characters, and different from the
              current password.
            </span>
          </label>

          {error && (
            <p
              role="alert"
              data-testid="password-reset-error"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-300"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={signOutNow}
              disabled={busy}
              data-testid="password-reset-signout"
              className="rounded-xl glass-panel px-4 py-2 font-bold text-muted-custom hover:text-heading disabled:opacity-60"
            >
              Sign out
            </button>
            <button
              type="submit"
              disabled={busy}
              data-testid="password-reset-submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
