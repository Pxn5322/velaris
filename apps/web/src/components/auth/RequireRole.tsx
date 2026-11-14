"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useRole, type UserRole } from "@/context/RoleContext";
import { getSession } from "@/lib/auth/session";

/**
 * Route-level role gate for the non-administrator work areas.
 *
 * A missing session renders nothing and redirects to sign-in. A signed-in
 * caller whose server-resolved role is not listed also redirects, so an agent
 * cannot open the customer portal and a customer cannot open the inbox by
 * typing the URL. The role is never read from client storage.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly UserRole[];
  children: ReactNode;
}) {
  const { role, roleLoading } = useRole();
  const router = useRouter();
  const allowed = role !== null && roles.includes(role);

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
      <div className="flex flex-1 items-center justify-center p-8">
        <p role="status" className="text-xs font-mono text-muted-custom">
          Checking access…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
