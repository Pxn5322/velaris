"use client";

import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AuditView } from "@/components/audit/AuditView";

export default function AuditPage() {
  return (
    <RequireAdmin>
      <AuditView />
    </RequireAdmin>
  );
}
