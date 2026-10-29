"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { isAuthConfigured, signIn, signOut } from "@/lib/auth/session";
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
      // Real Supabase Auth sign-in (D-03); the token rides apiFetch.
      await signIn(email.trim(), password);
      // The role comes from the server (membership_roles), never a picker.
      const uiRole = await fetchSessionRole();
      if (!uiRole) {
        await signOut();
        setError("This account has no workspace access.");
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
            {mode === "signup"
              ? "Start Free Platform Trial"
              : "Sign In to VELARIS"}
          </h3>
          <p className="text-xs text-muted-custom">
            {mode === "signup"
              ? "Accounts are provisioned by your administrator. Sign in with your work account."
              : "Access your tenant operations console or agent copilot workspace."}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 font-mono text-xs"
          data-testid="sign-in-form"
        >
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
              data-testid="sign-in-password"
            />
          </div>
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
            {submitting ? "Signing in..." : "Continue to Platform"}
          </button>
        </form>
      </div>
    </div>
  );
}
