"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { RequireRole } from "@/components/auth/RequireRole";

/**
 * Customer portal guard. The sign-in page stays public; both portal views
 * require the server-resolved customer role.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/portal/sign-in") {
    return <>{children}</>;
  }
  return <RequireRole roles={["USER"]}>{children}</RequireRole>;
}
