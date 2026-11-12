import type { ReactNode } from "react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <RequireAdmin>{children}</RequireAdmin>;
}
