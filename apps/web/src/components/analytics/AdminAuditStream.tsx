"use client";

/**
 * Administrator analytics audit stream (F-11, F-12, J-05).
 *
 * The admin-v2.7 analytics tab ends with a live audit and security event
 * stream. The panel reads the caller's tenant from GET /auth/session, then
 * reads the newest page of GET /audit/events. The API is the authority:
 * `audit.read` and tenant scope are checked server-side, so the panel only
 * renders rows the caller may read.
 *
 * The page limit is 8, and the panel refreshes every 30 seconds while the tab
 * is visible. The feed keeps loading, denied, error, empty and ready states
 * explicit. A failed read never shows sample rows.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert, Terminal } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";
import { shortInstant } from "@/lib/audit/describe";

const FEED_LIMIT = 8;
const REFRESH_INTERVAL_MS = 30_000;

interface TenantEntry {
  tenantId: string;
  name: string;
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

interface AuditPage {
  items: AuditEventRow[];
  limit: number;
  hasMore: boolean;
}

type Phase = "loading" | "denied" | "error" | "ready";

export function AdminAuditStream() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [denial, setDenial] = useState("");
  const [failure, setFailure] = useState("");
  const [tenant, setTenant] = useState<TenantEntry | null>(null);
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setPhase("loading");
    }
    setFailure("");
    try {
      const session = await apiFetch<AuthSessionResponse>("/auth/session");
      const active = session.tenantContext?.tenants?.[0];
      if (!active) {
        setDenial("This account has no active tenant membership.");
        setPhase("denied");
        return;
      }
      setTenant(active);
      const page = await apiFetch<AuditPage>(
        `/audit/events?tenantId=${encodeURIComponent(active.tenantId)}&limit=${FEED_LIMIT}`,
      );
      setEvents(page.items);
      setHasMore(page.hasMore);
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDenial("Your session has expired. Sign in again.");
        setPhase("denied");
      } else if (error instanceof ApiError && error.status === 403) {
        setDenial("Your role cannot read audit events for this tenant.");
        setPhase("denied");
      } else {
        setFailure(
          error instanceof Error
            ? error.message
            : "Audit events are unavailable.",
        );
        setPhase("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Scheduled kick: a sync setState in the effect body would cascade a
    // render, as in the other governance panels.
    const timer = setTimeout(() => {
      if (!getSession()) {
        setDenial("Sign in to read audit events.");
        setPhase("denied");
        return;
      }
      void load();
    }, 0);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && getSession()) {
        void load(true);
      }
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [load]);

  return (
    <section
      data-testid="admin-audit-stream"
      aria-labelledby="admin-audit-stream-heading"
      aria-busy={phase === "loading" || refreshing}
      className="glass-panel p-5 rounded-2xl space-y-4"
      style={{ borderColor: "var(--card-border)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
        style={{ borderColor: "var(--card-border)" }}
      >
        <h2
          id="admin-audit-stream-heading"
          className="font-display text-base font-bold text-heading flex items-center gap-2"
        >
          <Terminal
            className="w-4 h-4 shrink-0"
            style={{ color: "var(--accent-cyan)" }}
          />
          Real-Time Audit &amp; Security Event Stream
        </h2>
        <div className="flex items-center gap-2">
          <span
            data-testid="admin-audit-stream-tenant"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full ${
                phase === "ready" ? "bg-emerald-500" : "bg-slate-500"
              }`}
            />
            {tenant
              ? `${phase === "ready" ? "Live · " : ""}${tenant.name}`
              : "Connecting…"}
          </span>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={phase === "loading" || refreshing}
            data-testid="admin-audit-stream-refresh"
            aria-label="Refresh audit feed"
            className="p-1.5 rounded-lg glass-panel text-heading transition-all hover:border-blue-600 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {phase === "loading" && (
        <p
          role="status"
          data-testid="admin-audit-stream-loading"
          className="h-64 text-xs font-mono flex items-center justify-center"
          style={{ color: "var(--text-muted)" }}
        >
          Loading audit events…
        </p>
      )}

      {phase === "denied" && (
        <div
          role="alert"
          data-testid="admin-audit-stream-denied"
          className="h-64 flex flex-col items-center justify-center gap-2 text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <ShieldAlert
            className="w-8 h-8"
            style={{ color: "var(--accent-rose)" }}
          />
          <p>{denial}</p>
          <Link
            href="/?signin=1"
            className="font-bold underline"
            style={{ color: "var(--accent-cyan)" }}
          >
            Sign in with an account that holds audit.read
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div
          role="alert"
          data-testid="admin-audit-stream-error"
          className="h-64 flex flex-col items-center justify-center gap-3 text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <Terminal
            className="w-8 h-8"
            style={{ color: "var(--accent-rose)" }}
          />
          <p>{failure}</p>
          <button
            type="button"
            onClick={() => void load()}
            data-testid="admin-audit-stream-retry"
            className="px-3 py-1.5 rounded-xl glass-panel text-xs font-bold text-heading"
          >
            Retry
          </button>
        </div>
      )}

      {phase === "ready" && events.length === 0 && (
        <p
          data-testid="admin-audit-stream-empty"
          className="h-64 text-xs font-mono flex items-center justify-center text-center px-6"
          style={{ color: "var(--text-muted)" }}
        >
          No audit events are recorded for this tenant yet.
        </p>
      )}

      {phase === "ready" && events.length > 0 && (
        <>
          <div
            data-testid="admin-audit-stream-feed"
            className="space-y-2 h-64 overflow-y-auto font-mono text-xs pr-2"
            aria-live="polite"
          >
            {events.map((event) => (
              <div
                key={event.id}
                data-testid="admin-audit-event"
                className="p-3 rounded-xl border space-y-1"
                style={{ borderColor: "var(--card-border)" }}
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
                <p className="text-[11px] text-heading break-words">
                  {event.resourceType}
                  {event.resourceId ? ` · ${event.resourceId}` : ""}
                  {` · actor ${event.actorId ?? "none recorded"}`}
                </p>
                <p
                  className="text-[10px] font-mono break-all"
                  style={{ color: "var(--text-muted)" }}
                >
                  request {event.requestId ?? "none recorded"}
                </p>
              </div>
            ))}
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[10px] font-mono"
            style={{
              borderColor: "var(--card-border)",
              color: "var(--text-muted)",
            }}
          >
            <span>
              {hasMore
                ? `Newest ${FEED_LIMIT} events; older events exist.`
                : `Showing ${events.length} event${events.length === 1 ? "" : "s"}.`}
            </span>
            <Link
              href="/audit"
              className="font-bold underline"
              style={{ color: "var(--accent-cyan)" }}
            >
              Open full audit trail
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
