"use client";

import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { TenantStudioView } from "@/components/TenantStudioView";

export default function StudioPage() {
  return (
    <RequireAdmin>
      <TenantStudioView />
    </RequireAdmin>
  );
}
