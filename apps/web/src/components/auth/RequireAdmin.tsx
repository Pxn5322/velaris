"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/context/RoleContext";
import { getSession } from "@/lib/auth/session";

/**
 * Administrator route guard.
 *
 * Server-resolved roles decide access. A signed-out visitor, an agent or a
 * customer never sees an administrator view, even when the URL is typed
 * directly. An unauthorized visitor is sent to the landing page with the
 * sign-in modal open (/?signin=1). The guard renders a checking state until
 * the session role is known, so protected content never flashes first.
 *
 * The guard lives in each administrator route layout, not in the page. This
 * keeps its small chunk separate from the heavy view chunks, so it can
 * hydrate and redirect while those views are still downloading. A missing
 * session redirects at once; only a signed-in caller waits for the server
 * role. The guard never uses client state to grant access.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { role, roleLoading } = useRole();
  const router = useRouter();
  const allowed = role === "ENTERPRISE" || role === "ADMIN";

  useEffect(() => {
    if (!getSession()) {
      router.replace("/?signin=1");
      return;
    }
    if (roleLoading || allowed) return;
    router.replace("/?signin=1");
  }, [allowed, roleLoading, router]);

  if (roleLoading || !allowed) {
    return (
      <div
        className="flex-1 flex items-center justify-center p-8"
        data-testid="admin-access-check"
      >
        <div className="glass-panel rounded-2xl p-8 text-center space-y-3 border border-slate-700/50">
          <svg
            className="w-10 h-10 mx-auto"
            style={{ color: "var(--accent-cyan)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <p role="status" className="text-xs text-muted-custom">
            Checking administrator access…
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
