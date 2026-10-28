"use client";

/**
 * Customer portal sign-in (T2.04, F-02/F-05, journey J-03).
 *
 * Email/password form against Supabase Auth (D-03) through the session
 * library. On success the caller lands on /portal/conversations, which
 * reads their own conversation timeline through the guarded API. The
 * page renders the four states the design system requires of an
 * authorization-sensitive flow: idle, submitting, refusal (bad
 * credentials or outage) and not-configured (missing public build
 * configuration).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { isAuthConfigured, signIn } from "@/lib/auth/session";

export default function PortalSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const configured = isAuthConfigured();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.push("/portal/conversations");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
      setSubmitting(false);
    }
  }

  return (
    <section className="flex-1 flex items-start justify-center pt-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-800 p-6 space-y-4"
        data-testid="sign-in-form"
      >
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <LogIn aria-hidden="true" className="h-5 w-5" /> Customer sign in
        </h1>
        {!configured && (
          <p
            className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-200"
            data-testid="sign-in-unconfigured"
          >
            Sign-in is not configured for this build. Set
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then
            rebuild.
          </p>
        )}
        <label className="block text-sm">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-transparent px-2 py-1.5"
            data-testid="sign-in-email"
            autoComplete="email"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-transparent px-2 py-1.5"
            data-testid="sign-in-password"
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p
            className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200"
            data-testid="sign-in-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600 disabled:opacity-50"
          data-testid="sign-in-submit"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-slate-500">
          Conversations and tickets stay inside your tenant; internal notes
          never appear in the customer view.
        </p>
        <Link href="/portal" className="text-xs underline text-slate-400">
          Back to portal
        </Link>
      </form>
    </section>
  );
}
