"use client";

import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";

export default function AnalyticsPage() {
  return (
    <RequireAdmin>
      <AnalyticsView />
    </RequireAdmin>
  );
}
