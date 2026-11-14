import type { ReactNode } from "react";
import { RequireRole } from "@/components/auth/RequireRole";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <RequireRole roles={["AGENT"]}>{children}</RequireRole>;
}
