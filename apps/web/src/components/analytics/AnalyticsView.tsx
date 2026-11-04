"use client";

/**
 * Tenant analytics view (T5.04; F-12; AC-F12-1, AC-F12-3).
 *
 * Reads the caller's tenant from GET /auth/session, then GET
 * /analytics/summary. The API is the authority: it answers 401 without a
 * credential, 403 without `analytics.read`, and 403 for a tenant outside the
 * caller's memberships, so a denied viewer sees a denial instead of numbers.
 *
 * States (each has a test id for the journey test):
 * - loading
 * - denied (signed out, expired session, missing permission, foreign tenant)
 * - error with Retry
 * - EMPTY: no observation in the range, so every value is null (AC-F12-2)
 * - STALE: values exist but the newest observation is old, so the page shows
 *   its age instead of implying live data
 * - ready: values plus the formula and definition version behind each one
 *   (AC-F12-1)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Clock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";

interface TenantEntry {
  tenantId: string;
}

interface AuthSessionResponse {
  tenantContext: { tenants: TenantEntry[] } | null;
}

type KpiUnit = "ratio" | "hours" | "count" | "milliseconds";

interface KpiValue {
  code: string;
  label: string;
  unit: KpiUnit;
  definitionVersion: string;
  formula: string;
  value: number | null;
  sample: number;
}

interface AnalyticsSummary {
  tenantId: string;
  range: { from: string; to: string };
  generatedAt: string;
  state: "OK" | "EMPTY" | "STALE";
  staleAfterMinutes: number;
  lastEventAt: string | null;
  metrics: KpiValue[];
}

type Phase = "loading" | "denied" | "error" | "ready";

/** Unit-aware value; a null value is a measured gap, never a zero. */
export function formatKpiValue(metric: KpiValue): string {
  if (metric.value === null) {
    return "—";
  }
  switch (metric.unit) {
    case "ratio":
      return `${(metric.value * 100).toFixed(1)}%`;
    case "hours":
      return `${metric.value.toFixed(2)} h`;
    case "milliseconds":
      return `${Math.round(metric.value)} ms`;
    default:
      return metric.value.toLocaleString("en-US");
  }
}

function shortInstant(value: string | null): string {
  if (!value) return "never";
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function AnalyticsView() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [denial, setDenial] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setFailure("");
    try {
      const session = await apiFetch<AuthSessionResponse>("/auth/session");
      const tenants = session.tenantContext?.tenants ?? [];
      if (tenants.length === 0) {
        setDenial("This account has no active tenant membership.");
        setPhase("denied");
        return;
      }
      const data = await apiFetch<AnalyticsSummary>(
        `/analytics/summary?tenantId=${encodeURIComponent(tenants[0].tenantId)}`,
      );
      setSummary(data);
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDenial("Your session has expired. Sign in again.");
        setPhase("denied");
      } else if (error instanceof ApiError && error.status === 403) {
        setDenial(
          "Your role cannot read analytics for this tenant, or the tenant is outside your membership.",
        );
        setPhase("denied");
      } else {
        setFailure(
          error instanceof Error ? error.message : "Analytics are unavailable.",
        );
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    // Scheduled kick: a sync setState in the effect body would cascade a
    // render (react-hooks/set-state-in-effect), same as the knowledge panel.
    const timer = setTimeout(() => {
      if (!getSession()) {
        setDenial("Sign in to read tenant analytics.");
        setPhase("denied");
        return;
      }
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-5">
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3"
        style={{ borderColor: "var(--card-border)" }}
      >
        <div>
          <div
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold"
            style={{ color: "var(--accent-cyan)" }}
          >
            <BarChart3 className="w-3.5 h-3.5" /> OPERATIONAL ANALYTICS
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-heading">
            Tenant KPI Dashboard
          </h1>
        </div>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-xl glass-panel text-heading text-xs font-mono font-bold flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {phase === "loading" && (
        <div
          data-testid="analytics-loading"
          className="glass-panel p-8 rounded-2xl text-center text-xs font-mono"
          style={{ color: "var(--text-muted)" }}
        >
          Loading the tenant summary…
        </div>
      )}

      {phase === "denied" && (
        <div
          data-testid="analytics-denied"
          className="glass-panel p-8 rounded-2xl text-center space-y-3 border border-slate-700/50"
        >
          <ShieldAlert
            className="w-10 h-10 mx-auto"
            style={{ color: "var(--accent-cyan)" }}
          />
          <h2 className="text-base font-bold text-heading uppercase tracking-wider">
            Analytics are not available to this viewer
          </h2>
          <p
            className="text-xs max-w-md mx-auto"
            style={{ color: "var(--text-muted)" }}
          >
            {denial}
          </p>
          <Link
            href="/?signin=1"
            className="text-xs font-bold underline"
            style={{ color: "var(--accent-cyan)" }}
          >
            Sign in with an account that holds analytics.read
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div
          data-testid="analytics-error"
          className="glass-panel p-8 rounded-2xl text-center space-y-3 border border-slate-700/50"
        >
          <AlertTriangle
            className="w-10 h-10 mx-auto"
            style={{ color: "var(--accent-rose)" }}
          />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {failure}
          </p>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-xl glass-panel text-heading text-xs font-bold"
          >
            Retry
          </button>
        </div>
      )}

      {phase === "ready" && summary && (
        <>
          {summary.state === "EMPTY" && (
            <div
              data-testid="analytics-empty"
              className="glass-panel p-4 rounded-2xl border text-xs"
              style={{
                borderColor: "var(--card-border)",
                color: "var(--text-muted)",
              }}
            >
              No observation exists in {shortInstant(summary.range.from)} to{" "}
              {shortInstant(summary.range.to)}. Every value is null, not zero: a
              zero would claim measured inactivity.
            </div>
          )}

          {summary.state === "STALE" && (
            <div
              data-testid="analytics-stale"
              className="glass-panel p-4 rounded-2xl border text-xs flex items-start gap-2"
              style={{
                borderColor: "var(--card-border)",
                color: "var(--text-muted)",
              }}
            >
              <Clock
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--accent-cyan)" }}
              />
              <span>
                Newest observation: {shortInstant(summary.lastEventAt)}. The
                window ends after {summary.staleAfterMinutes} minutes, so these
                values can be out of date.
              </span>
            </div>
          )}

          <div
            data-testid="analytics-summary"
            data-state={summary.state}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {summary.metrics.map((metric) => (
              <div
                key={metric.code}
                data-testid={`analytics-metric-${metric.code}`}
                className="glass-panel p-5 rounded-2xl border border-slate-700/50 space-y-1"
              >
                <span
                  className="text-[11px] uppercase font-mono font-bold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {metric.label}
                </span>
                <div
                  className="text-3xl font-bold font-display text-heading"
                  data-testid={`analytics-value-${metric.code}`}
                >
                  {formatKpiValue(metric)}
                </div>
                <span
                  className="text-[10px] font-mono block"
                  style={{ color: "var(--text-muted)" }}
                >
                  {metric.sample} sample{metric.sample === 1 ? "" : "s"} · v
                  {metric.definitionVersion}
                </span>
              </div>
            ))}
          </div>

          <div className="glass-panel p-5 rounded-2xl border border-slate-700/50 space-y-3">
            <h2
              className="text-xs font-mono font-bold uppercase tracking-widest"
              style={{ color: "var(--accent-cyan)" }}
            >
              KPI definitions
            </h2>
            <div data-testid="analytics-definitions" className="space-y-3">
              {summary.metrics.map((metric) => (
                <div
                  key={metric.code}
                  className="border-b pb-2 last:border-0"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-heading">
                      {metric.label}
                    </span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(59,130,246,0.15)",
                        color: "var(--accent-cyan)",
                      }}
                    >
                      {metric.code} · v{metric.definitionVersion}
                    </span>
                  </div>
                  <p
                    className="text-[11px] mt-1"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {metric.formula}
                  </p>
                </div>
              ))}
            </div>
            <p
              className="text-[10px] font-mono"
              style={{ color: "var(--text-muted)" }}
            >
              Range {shortInstant(summary.range.from)} →{" "}
              {shortInstant(summary.range.to)} · generated{" "}
              {shortInstant(summary.generatedAt)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
