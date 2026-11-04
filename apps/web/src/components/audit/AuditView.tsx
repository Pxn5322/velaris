"use client";

/**
 * Audit trail and AI trace view (T5.04; F-11; AC-F11-3).
 *
 * Reads the caller's tenant from GET /auth/session, then GET /audit/events and
 * GET /audit/traces. Both routes require `audit.read`, so R-agent and
 * R-customer are denied by the API before a row is read and the view shows a
 * denial instead of empty tables. A foreign tenant is denied the same way.
 *
 * States: loading, denied, error with Retry, empty per tab, and ready. Each
 * audit row shows the request id, so a governance action can be followed into
 * the AI trace with the same correlation id (F-13 intent).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";

interface TenantEntry {
  tenantId: string;
}

interface AuthSessionResponse {
  tenantContext: { tenants: TenantEntry[] } | null;
}

interface AuditEventRow {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  createdAt: string;
}

interface AiTraceRow {
  id: string;
  correlationId: string;
  provider: string;
  model: string | null;
  outcome: string;
  latencyMs: number;
  createdAt: string;
  expiresAt: string;
}

interface Page<T> {
  items: T[];
  limit: number;
  hasMore: boolean;
}

type Phase = "loading" | "denied" | "error" | "ready";
type Tab = "events" | "traces";

const PAGE_SIZE = 25;

function shortInstant(value: string): string {
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function AuditView() {
  const [tab, setTab] = useState<Tab>("events");
  const [phase, setPhase] = useState<Phase>("loading");
  const [denial, setDenial] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [events, setEvents] = useState<Page<AuditEventRow> | null>(null);
  const [traces, setTraces] = useState<Page<AiTraceRow> | null>(null);

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
      const tenant = encodeURIComponent(tenants[0].tenantId);
      const [eventPage, tracePage] = await Promise.all([
        apiFetch<Page<AuditEventRow>>(
          `/audit/events?tenantId=${tenant}&limit=${PAGE_SIZE}`,
        ),
        apiFetch<Page<AiTraceRow>>(
          `/audit/traces?tenantId=${tenant}&limit=${PAGE_SIZE}`,
        ),
      ]);
      setEvents(eventPage);
      setTraces(tracePage);
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDenial("Your session has expired. Sign in again.");
        setPhase("denied");
      } else if (error instanceof ApiError && error.status === 403) {
        setDenial(
          "Your role cannot read audit records or AI traces, or the tenant is outside your membership.",
        );
        setPhase("denied");
      } else {
        setFailure(
          error instanceof Error
            ? error.message
            : "Audit records are unavailable.",
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
        setDenial("Sign in to read the audit trail and AI traces.");
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
            <ClipboardList className="w-3.5 h-3.5" /> AI GOVERNANCE
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-heading">
            Audit Trail &amp; AI Traces
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
          data-testid="audit-loading"
          className="glass-panel p-8 rounded-2xl text-center text-xs font-mono"
          style={{ color: "var(--text-muted)" }}
        >
          Loading governance records…
        </div>
      )}

      {phase === "denied" && (
        <div
          data-testid="audit-denied"
          className="glass-panel p-8 rounded-2xl text-center space-y-3 border border-slate-700/50"
        >
          <ShieldAlert
            className="w-10 h-10 mx-auto"
            style={{ color: "var(--accent-cyan)" }}
          />
          <h2 className="text-base font-bold text-heading uppercase tracking-wider">
            Audit records are not available to this viewer
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
            Sign in with an account that holds audit.read
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div
          data-testid="audit-error"
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

      {phase === "ready" && (
        <>
          <div className="glass-panel p-1.5 rounded-xl flex gap-1 border border-slate-700/50 w-fit">
            {(
              [
                { id: "events", label: "Audit trail", icon: ClipboardList },
                { id: "traces", label: "AI traces", icon: Waypoints },
              ] as const
            ).map((entry) => {
              const Icon = entry.icon;
              const isActive = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  data-testid={`audit-tab-${entry.id}`}
                  onClick={() => setTab(entry.id)}
                  className={
                    "px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all border " +
                    (isActive
                      ? "bg-blue-600/30 text-cyan-300 border-cyan-500/40"
                      : "text-muted-custom hover:text-heading border-transparent")
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                  {entry.label}
                </button>
              );
            })}
          </div>

          {tab === "events" && (
            <div className="glass-panel p-5 rounded-2xl border border-slate-700/50 space-y-3">
              {!events || events.items.length === 0 ? (
                <p
                  data-testid="audit-empty-events"
                  className="text-xs font-mono text-center py-6"
                  style={{ color: "var(--text-muted)" }}
                >
                  No audit event exists for this tenant yet.
                </p>
              ) : (
                <div data-testid="audit-events-list" className="space-y-2">
                  {events.items.map((event) => (
                    <div
                      key={event.id}
                      data-testid="audit-event"
                      className="p-3 rounded-xl border border-slate-700/40 space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className="text-xs font-mono font-bold"
                          style={{ color: "var(--accent-cyan)" }}
                        >
                          {event.action}
                        </span>
                        <span
                          className="text-[10px] font-mono"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {shortInstant(event.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-heading">
                        {event.resourceType}
                        {event.resourceId ? ` · ${event.resourceId}` : ""}
                        {event.actorId ? ` · actor ${event.actorId}` : ""}
                      </p>
                      <p
                        data-testid="audit-event-request"
                        className="text-[10px] font-mono"
                        style={{ color: "var(--text-muted)" }}
                      >
                        request {event.requestId ?? "none recorded"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {events?.hasMore && (
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  Showing the newest {events.limit} rows; older rows exist.
                </p>
              )}
            </div>
          )}

          {tab === "traces" && (
            <div className="glass-panel p-5 rounded-2xl border border-slate-700/50 space-y-3">
              {!traces || traces.items.length === 0 ? (
                <p
                  data-testid="audit-empty-traces"
                  className="text-xs font-mono text-center py-6"
                  style={{ color: "var(--text-muted)" }}
                >
                  No AI trace is inside its retention window for this tenant.
                </p>
              ) : (
                <div data-testid="audit-traces-list" className="space-y-2">
                  {traces.items.map((trace) => (
                    <div
                      key={trace.id}
                      data-testid="audit-trace"
                      className="p-3 rounded-xl border border-slate-700/40 space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className="text-xs font-mono font-bold"
                          style={{ color: "var(--accent-cyan)" }}
                        >
                          {trace.provider}
                          {trace.model ? ` · ${trace.model}` : ""}
                        </span>
                        <span
                          className="text-[10px] font-mono"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {shortInstant(trace.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-heading">
                        {trace.outcome} · {trace.latencyMs} ms
                      </p>
                      <p
                        className="text-[10px] font-mono"
                        style={{ color: "var(--text-muted)" }}
                      >
                        correlation {trace.correlationId}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {traces?.hasMore && (
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  Showing the newest {traces.limit} traces; older traces exist.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
