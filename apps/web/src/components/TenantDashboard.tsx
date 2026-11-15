"use client";

/**
 * Tenant Dashboards tab, following the admin-v2.7 tenant overview.
 *
 * Reads the tenant from GET /auth/session and the current-month counts from
 * GET /analytics/tenant-dashboard. This is deliberately separate from the
 * platform KPI summary: the tenant view answers "how much are we using and
 * what is in the queue", not "how are the platform KPIs scoring".
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Building2,
  Coins,
  RefreshCw,
  TicketCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface TenantDashboardSummary {
  tenantId: string;
  generatedAt: string;
  month: { from: string; to: string };
  totalMonthlyTokens: number;
  activeAgents: number;
  tickets: {
    total: number;
    open: number;
    pendingCustomer: number;
    inProgress: number;
    resolved: number;
    closed: number;
  };
}

type Phase = "loading" | "error" | "ready";

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatMonth(from: string): string {
  return new Date(from).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

const TICKET_STATUSES = [
  { key: "pendingCustomer", label: "PENDING CUSTOMER" },
  { key: "inProgress", label: "IN PROGRESS" },
  { key: "resolved", label: "RESOLVED" },
  { key: "closed", label: "CLOSED" },
] as const;

export function TenantDashboard() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<TenantDashboardSummary | null>(null);
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
        await apiFetch<TenantDashboardSummary>(
          `/analytics/tenant-dashboard?tenantId=${encodeURIComponent(tenant.tenantId)}`,
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
          <div className="grid grid-cols-1 gap-3 font-mono text-xs sm:gap-4 lg:grid-cols-3">
            <article
              className="glass-panel rounded-2xl border border-[var(--card-border)] p-4"
              style={{ borderLeft: "4px solid var(--accent-rose)" }}
              data-testid="tenant-dashboard-tokens"
            >
              <span className="flex items-center gap-1.5 font-bold text-muted-custom">
                <Coins className="h-3.5 w-3.5" /> TOTAL MONTHLY TOKENS
              </span>
              <div
                className="mt-1.5 font-display text-2xl font-bold text-heading sm:text-3xl"
                title={formatCount(summary.totalMonthlyTokens)}
              >
                {COMPACT.format(summary.totalMonthlyTokens)}
              </div>
              <span className="mt-1 block text-[10px] text-muted-custom">
                {formatMonth(summary.month.from)} · input + output
              </span>
            </article>

            <article
              className="glass-panel rounded-2xl border border-[var(--card-border)] p-4"
              style={{ borderLeft: "4px solid var(--accent-cyan)" }}
              data-testid="tenant-dashboard-agents"
            >
              <span className="flex items-center gap-1.5 font-bold text-muted-custom">
                <Bot className="h-3.5 w-3.5" /> ACTIVE AGENTS
              </span>
              <div className="mt-1.5 font-display text-2xl font-bold text-heading sm:text-3xl">
                {formatCount(summary.activeAgents)} Configured
              </div>
              <span className="mt-1 block text-[10px] text-muted-custom">
                Status ACTIVE in this workspace
              </span>
            </article>

            <article
              className="glass-panel rounded-2xl border border-[var(--card-border)] p-4"
              data-testid="tenant-dashboard-tickets"
            >
              <span className="flex items-center justify-between gap-2 font-bold text-muted-custom">
                <span className="flex items-center gap-1.5">
                  <TicketCheck className="h-3.5 w-3.5" /> TOTAL TICKETS
                </span>
                <span className="font-display text-xl font-bold text-heading">
                  {formatCount(summary.tickets.total)}
                </span>
              </span>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                {TICKET_STATUSES.map((status) => (
                  <div
                    key={status.key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-[var(--pill-bg)] px-2 py-1"
                    data-testid={`tenant-dashboard-status-${status.key}`}
                  >
                    <span className="text-[9px] font-bold text-muted-custom">
                      {status.label}
                    </span>
                    <span className="font-bold text-heading">
                      {formatCount(summary.tickets[status.key])}
                    </span>
                  </div>
                ))}
              </div>
              {summary.tickets.open > 0 && (
                <span
                  className="mt-2 block text-[10px] text-muted-custom"
                  data-testid="tenant-dashboard-open-note"
                >
                  Total also includes {formatCount(summary.tickets.open)} open
                  ticket{summary.tickets.open === 1 ? "" : "s"}.
                </span>
              )}
            </article>
          </div>

          <p className="flex items-center gap-1.5 text-[10px] font-mono text-muted-custom">
            <RefreshCw className="h-3 w-3" /> Live, tenant-scoped counts for the
            current calendar month. Generated{" "}
            {new Date(summary.generatedAt).toLocaleString("en-US")}.
          </p>
        </>
      )}
    </section>
  );
}
