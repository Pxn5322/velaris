"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { apiFetch } from "@/lib/api/client";
import {
  isAuthConfigured,
  requestPasswordReset,
  signIn,
  signOut,
} from "@/lib/auth/session";
import { fetchSessionRole, routeForRole } from "@/lib/auth/uiRole";

interface LandingAuthModalProps {
  isOpen: boolean;
  mode: "signin" | "signup";
  onClose: () => void;
}

export function LandingAuthModal({
  isOpen,
  mode,
  onClose,
}: LandingAuthModalProps) {
  const router = useRouter();
  const { setRole } = useRole();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const isSignup = mode === "signup";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!isAuthConfigured()) {
      setError("Sign-in is not configured.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        // F-01: "Start Free" registers a tenant workspace through the API.
        // The server validates every field before it creates anything
        // (AC-F01-2) and answers 409/400/503 with a readable message.
        const tenantName = workspaceName.trim();
        if (tenantName.length < 2) {
          setError("Enter a name for your workspace.");
          setSubmitting(false);
          return;
        }
        await apiFetch("/auth/signup", {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            password,
            tenantName,
          }),
        });
      }
      // Real Supabase Auth sign-in (D-03); the token rides apiFetch.
      await signIn(email.trim(), password);
      // The role comes from the server (membership_roles), never a picker.
      const uiRole = await fetchSessionRole();
      if (!uiRole) {
        await signOut();
        setError(
          isSignup
            ? "Your workspace was created but has no role yet. Contact support."
            : "This account has no workspace access.",
        );
        setSubmitting(false);
        return;
      }
      setRole(uiRole);
      onClose();
      router.push(routeForRole(uiRole));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email first, then request the reset link.");
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setNotice(
        "If an account exists for that address, a reset link is on its way. Check the inbox and spam folder.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The reset email could not be sent.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
      <div className="glass-panel rounded-3xl max-w-md w-full p-6 space-y-6 border border-[var(--card-border)] relative shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-custom hover:text-heading transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <h3 className="font-display text-2xl font-bold text-heading">
            {isSignup ? "Create your workspace" : "Sign In to VELARIS"}
          </h3>
          <p className="text-xs text-muted-custom">
            {isSignup
              ? "Register a new tenant workspace. You become its administrator."
              : "Access your tenant operations console or agent copilot workspace."}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 font-mono text-xs"
          data-testid="sign-in-form"
        >
          {isSignup && (
            <div>
              <label className="block text-muted-custom mb-1">
                Workspace name
              </label>
              <input
                type="text"
                placeholder="Acme Support"
                required
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
                data-testid="sign-up-workspace"
              />
            </div>
          )}
          <div>
            <label className="block text-muted-custom mb-1">Work Email</label>
            <input
              type="email"
              placeholder="name@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
              data-testid="sign-in-email"
            />
          </div>
          <div>
            <label className="block text-muted-custom mb-1">Password</label>
            <input
              type="password"
              placeholder="........"
              required
              minLength={isSignup ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
              data-testid="sign-in-password"
            />
          </div>
          {!isSignup && (
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={submitting}
              className="text-[11px] font-bold underline text-muted-custom hover:text-heading disabled:opacity-60"
              data-testid="forgot-password"
            >
              Forgot password?
            </button>
          )}
          {notice && (
            <p role="status" className="text-xs text-emerald-300">
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="text-red-400 font-bold text-xs"
              data-testid="sign-in-error"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs shadow-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            data-testid="sign-in-submit"
          >
            {submitting
              ? isSignup
                ? "Creating workspace..."
                : "Signing in..."
              : isSignup
                ? "Create workspace"
                : "Continue to Platform"}
          </button>
        </form>
      </div>
    </div>
  );
}
