"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { useRole } from "@/context/RoleContext";

/**
 * Administrator route guard.
 *
 * Server-resolved roles decide access. A signed-out visitor, an agent or a
 * customer never sees an administrator view, even when the URL is typed
 * directly. An unauthorized visitor is sent to the landing page with the
 * sign-in modal open (/?signin=1). The guard renders a checking state until
 * the session role is known, so protected content never flashes first.
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { role, roleLoading } = useRole();
  const router = useRouter();
  const allowed = role === "ENTERPRISE" || role === "ADMIN";

  useEffect(() => {
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
          <Shield
            className="w-10 h-10 mx-auto"
            style={{ color: "var(--accent-cyan)" }}
          />
          <p role="status" className="text-xs text-muted-custom">
            Checking administrator access…
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
