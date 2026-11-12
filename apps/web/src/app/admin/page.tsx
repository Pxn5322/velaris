"use client";

import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AdminView } from "@/components/AdminView";

export default function AdminPage() {
  return (
    <RequireAdmin>
      <AdminView />
    </RequireAdmin>
  );
}
