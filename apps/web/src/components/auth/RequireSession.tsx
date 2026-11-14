"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession } from "@/lib/auth/session";

const PUBLIC_ROUTES = new Set([
  "/",
  "/landing",
  "/portal/sign-in",
  "/auth/callback",
]);

/**
 * App-wide session gate.
 *
 * Every route except the public landing, customer sign-in and auth callback
 * requires a stored session before its content renders. A typed URL such as
 * /inbox or an unknown path therefore redirects to the sign-in modal instead
 * of exposing the workspace shell. The API still verifies the bearer token;
 * this gate only prevents an unauthenticated browser from reaching protected
 * route content.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic =
    PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/auth/callback");
  // The allowed path, not a boolean: a client-side move to another protected
  // path must not reuse an earlier session check for the previous URL.
  const [allowedPath, setAllowedPath] = useState<string | null>(
    isPublic ? pathname : null,
  );
  const allowed = isPublic || allowedPath === pathname;

  useEffect(() => {
    let cancelled = false;
    // Defer the state write so the effect does not trigger a synchronous
    // cascading render; the read itself must still run after hydration.
    const check = async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (isPublic || getSession()) {
        setAllowedPath(pathname);
        return;
      }
      const next = encodeURIComponent(pathname);
      router.replace(`/?signin=1&next=${next}`);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [isPublic, pathname, router]);

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <p role="status" className="text-xs font-mono text-muted-custom">
          Checking your session…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
