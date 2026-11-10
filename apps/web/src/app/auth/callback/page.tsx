"use client";

/**
 * Supabase Auth email callback (T6.07; D-03).
 *
 * Supabase sends password-recovery and sign-up confirmation links back here.
 * The tokens arrive in the URL fragment, which the browser does not send to a
 * server. This page stores the session, removes the fragment from the address
 * bar, and offers the recovery form. Confirmation links show a short success
 * state. Invalid or expired links show an actionable message.
 */

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { fetchSessionRole, routeForRole } from "@/lib/auth/uiRole";
import {
  getSession,
  storeSession,
  updatePassword,
  type AuthSession,
} from "@/lib/auth/session";

type Phase = "loading" | "recovery" | "confirmed" | "error";

function readFragment(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    // Defer the fragment read so hydration completes before state changes; a
    // synchronous setState in the effect body would cascade a render.
    const timer = setTimeout(() => {
      const params = readFragment();
      const failure = params.get("error_description") || params.get("error");
      if (failure) {
        setError(failure.replace(/\+/g, " "));
        setPhase("error");
        return;
      }

      const accessToken = params.get("access_token");
      if (!accessToken) {
        setError(
          "This link is missing its sign-in token. Request a new email and open the newest link.",
        );
        setPhase("error");
        return;
      }

      const expiresAt = Number(params.get("expires_at"));
      const expiresIn = Number(params.get("expires_in"));
      const session: AuthSession = {
        accessToken,
        refreshToken: params.get("refresh_token") ?? "",
        expiresAt:
          Number.isFinite(expiresAt) && expiresAt > 0
            ? expiresAt
            : Number.isFinite(expiresIn) && expiresIn > 0
              ? Math.floor(Date.now() / 1000) + expiresIn
              : 0,
        email: "",
      };
      storeSession(session);
      window.history.replaceState(null, "", window.location.pathname);

      const type = params.get("type");
      if (type === "recovery") {
        setPhase("recovery");
      } else {
        setPhase("confirmed");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirmation("");
      setUpdated(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The password could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  };

  const continueToWorkspace = async () => {
    if (!getSession()) {
      router.push("/");
      return;
    }
    const role = await fetchSessionRole();
    router.push(role ? routeForRole(role) : "/");
  };

  return (
    <main className="flex-1 flex items-center justify-center p-4 md:p-8">
      <section
        className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-5 border border-[var(--card-border)]"
        aria-labelledby="auth-callback-heading"
      >
        {phase === "loading" && (
          <p role="status" className="text-xs text-muted-custom">
            Checking your link…
          </p>
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert
                className="w-5 h-5 text-red-400"
                aria-hidden="true"
              />
              <h1
                id="auth-callback-heading"
                className="text-lg font-bold text-heading"
              >
                Link not accepted
              </h1>
            </div>
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
            <Link
              href="/"
              className="inline-flex text-xs font-bold underline"
              style={{ color: "var(--accent-cyan)" }}
            >
              Return to sign in
            </Link>
          </div>
        )}

        {phase === "confirmed" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="w-5 h-5 text-emerald-400"
                aria-hidden="true"
              />
              <h1
                id="auth-callback-heading"
                className="text-lg font-bold text-heading"
              >
                Email confirmed
              </h1>
            </div>
            <p className="text-xs text-muted-custom">
              Your email address is confirmed. You can continue to your
              workspace.
            </p>
            <button
              type="button"
              onClick={() => void continueToWorkspace()}
              className="px-3 py-2 rounded-xl text-xs font-bold border border-cyan-500/40 text-cyan-300"
            >
              Continue
            </button>
          </div>
        )}

        {phase === "recovery" && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h1
                id="auth-callback-heading"
                className="text-lg font-bold text-heading"
              >
                {updated ? "Password updated" : "Choose a new password"}
              </h1>
              <p className="text-xs text-muted-custom">
                {updated
                  ? "Your new password is ready. Use it the next time you sign in."
                  : "Enter a new password for your account. Use at least 8 characters."}
              </p>
            </div>

            {updated ? (
              <button
                type="button"
                onClick={() => void continueToWorkspace()}
                className="px-3 py-2 rounded-xl text-xs font-bold border border-cyan-500/40 text-cyan-300"
              >
                Continue to workspace
              </button>
            ) : (
              <form
                onSubmit={submitPassword}
                className="space-y-3"
                data-testid="recovery-form"
              >
                <div className="space-y-1">
                  <label
                    htmlFor="recovery-password"
                    className="block text-[10px] uppercase font-mono font-bold text-muted-custom"
                  >
                    New password
                  </label>
                  <input
                    id="recovery-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-xs text-heading focus:outline-none focus:border-brand-cyan"
                    data-testid="new-password"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="recovery-confirmation"
                    className="block text-[10px] uppercase font-mono font-bold text-muted-custom"
                  >
                    Confirm password
                  </label>
                  <input
                    id="recovery-confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-xs text-heading focus:outline-none focus:border-brand-cyan"
                    data-testid="confirm-password"
                  />
                </div>
                {error && (
                  <p role="alert" className="text-xs text-red-400">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs disabled:opacity-60"
                  data-testid="update-password"
                >
                  {saving ? "Updating…" : "Update password"}
                </button>
              </form>
            )}

            {updated && (
              <p role="status" className="text-xs text-emerald-300">
                Password updated.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
