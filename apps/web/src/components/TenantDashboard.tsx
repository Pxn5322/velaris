"use client";

/**
 * Tenant Dashboards tab, following the admin-v2.7 tenant overview.
 *
 * Reads the tenant from GET /auth/session and the KPI summary from
 * GET /analytics/summary. The API owns tenant scoping and the EMPTY/STALE
 * states, so this panel never invents a zero for a missing observation.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface AnalyticsSummary {
  tenantId: string;
  state: "OK" | "EMPTY" | "STALE";
  lastEventAt: string | null;
  metrics: {
    code: string;
    label: string;
    unit: "ratio" | "hours" | "count" | "milliseconds";
    value: number | null;
    sample: number;
  }[];
}

type Phase = "loading" | "error" | "ready";

function formatValue(metric: AnalyticsSummary["metrics"][number]): string {
  if (metric.value === null) return "—";
  if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "hours") return `${metric.value.toFixed(2)} h`;
  if (metric.unit === "milliseconds") return `${Math.round(metric.value)} ms`;
  return metric.value.toLocaleString("en-US");
}

export function TenantDashboard() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState("this workspace");

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const session = await apiFetch<{
        tenantContext: {
          tenants: { tenantId: string; name: string }[];
        } | null;
      }>("/auth/session");
      const tenant = session.tenantContext?.tenants[0];
      if (!tenant) {
        setError("This account has no active tenant membership.");
        setPhase("error");
        return;
      }
      setTenantName(tenant.name);
      setSummary(
        await apiFetch<AnalyticsSummary>(
          `/analytics/summary?tenantId=${encodeURIComponent(tenant.tenantId)}`,
        ),
      );
      setPhase("ready");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The tenant dashboard could not be loaded.",
      );
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <section className="space-y-4" data-testid="tenant-dashboard">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--card-border)] pb-4 sm:flex-row sm:items-center">
        <div>
          <div
            className="inline-flex items-center gap-1.5 font-mono text-xs font-bold"
            style={{ color: "var(--accent-rose)" }}
          >
            <Building2 className="h-3.5 w-3.5" /> TENANT METRICS
          </div>
          <h2 className="font-display text-2xl font-bold text-heading sm:text-3xl">
            Organization Operational Overview
          </h2>
          <p className="mt-1 text-xs font-mono text-muted-custom">
            {tenantName} · live support and AI operations
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={phase === "loading"}
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-[var(--card-border)] px-3 py-1.5 text-xs font-mono font-bold text-heading hover:border-cyan-500/40 disabled:opacity-60"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {phase === "loading" && (
        <p
          role="status"
          className="glass-panel rounded-2xl p-5 text-xs text-muted-custom"
        >
          Loading organization metrics…
        </p>
      )}

      {phase === "error" && (
        <div
          role="alert"
          className="glass-panel flex items-start gap-2 rounded-2xl border border-rose-500/40 p-5 text-xs text-rose-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {phase === "ready" && summary && (
        <>
          {summary.state === "EMPTY" && (
            <p className="rounded-xl border border-[var(--card-border)] p-3 text-xs text-muted-custom">
              No observation exists in the current range. Values are shown as
              gaps, not zero.
            </p>
          )}
          {summary.state === "STALE" && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              The newest observation is older than the freshness window, so
              these values may be out of date.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 font-mono text-xs sm:gap-4 xl:grid-cols-3">
            {summary.metrics.map((metric, index) => (
              <article
                key={metric.code}
                className="glass-panel rounded-2xl border border-[var(--card-border)] p-4"
                style={
                  index < 2
                    ? { borderLeft: "4px solid var(--accent-rose)" }
                    : undefined
                }
              >
                <span className="font-bold text-muted-custom">
                  {metric.label}
                </span>
                <div className="mt-1.5 font-display text-2xl font-bold text-heading sm:text-3xl">
                  {formatValue(metric)}
                </div>
                <span className="mt-1 block text-[10px] text-muted-custom">
                  {metric.sample} sample{metric.sample === 1 ? "" : "s"}
                </span>
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                href: "/inbox",
                label: "Support Inbox",
                detail: "Open live ticket queue",
              },
              {
                href: "/studio",
                label: "AI Studio",
                detail: "Tune agent knowledge and evals",
              },
              {
                href: "/audit",
                label: "Audit Trail",
                detail: "Review security events",
              },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group glass-panel flex items-center justify-between gap-3 rounded-2xl p-4 transition hover:border-cyan-500/40"
              >
                <span>
                  <span className="block text-xs font-bold text-heading">
                    {link.label}
                  </span>
                  <span className="text-[10px] font-mono text-muted-custom">
                    {link.detail}
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-custom transition group-hover:text-cyan-300" />
              </Link>
            ))}
          </div>

          <p className="flex items-center gap-1.5 text-[10px] font-mono text-muted-custom">
            <BarChart3 className="h-3.5 w-3.5" /> Figures come from the tenant
            analytics summary; definitions live on the Analytics page.
          </p>
        </>
      )}
    </section>
  );
}
