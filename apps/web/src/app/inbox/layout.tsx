import type { ReactNode } from "react";
import { RequireRole } from "@/components/auth/RequireRole";

export default function InboxLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={["ENTERPRISE", "ADMIN", "AGENT"]}>
      {children}
    </RequireRole>
  );
}
