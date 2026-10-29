"use client";

/**
 * Knowledge tab panel (T3.05, F-07, AC-F07-1, AC-F07-2).
 *
 * Renders inside the existing "3. Knowledge" tab of TenantStudioView — no
 * new tab is created, so the tab set stays unchanged. The panel reads the
 * caller's tenant from GET /auth/session, then lists the tenant's sources
 * through GET /knowledge-sources (guarded server-side: 401 without a
 * credential, 403 without knowledge.manage, 400/403 outside tenant scope).
 *
 * States:
 * - loading / failure with a retry control / signed-out denial / empty list
 * - a selected source shows ingestion detail: status, error code,
 *   provenance, content hash and timestamps (AC-F07-1)
 * - a FAILED source offers Retry, which resubmits the original reference
 *   through POST /knowledge-sources; the service treats the resubmission
 *   as the retry and re-enqueues ingestion (AC-F07-2). Completion is
 *   observed with Refresh (ingestion runs asynchronously).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";

interface TenantEntry {
  tenantId: string;
}

interface AuthSessionResponse {
  tenantContext: { tenants: TenantEntry[] } | null;
}

interface KnowledgeSourceRow {
  id: string;
  tenantId: string;
  sourceType: string;
  sourceUri?: string | null;
  objectKey?: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED" | string;
  contentHash: string;
  provenanceJson: Record<string, unknown> | null;
  errorCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

type Phase = "loading" | "denied" | "error" | "ready";
type RetryState = { retryingId: string | null; retryError: string | null };

const STATUS_BADGE: Record<string, string> = {
  READY: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  FAILED: "bg-red-500/15 text-red-300 border-red-500/40",
  PROCESSING: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  PENDING: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

/** Short human label for the provenance line under each source. */
function referenceOf(row: KnowledgeSourceRow): string {
  const provenance = row.provenanceJson ?? {};
  if (typeof provenance.content === "string") {
    const body = provenance.content.replace(/\s+/g, " ").trim();
    return body.length > 60 ? `${body.slice(0, 60)}…` : body;
  }
  if (typeof provenance.sourceUri === "string") return provenance.sourceUri;
  if (typeof provenance.objectKey === "string") return provenance.objectKey;
  return row.sourceUri ?? row.objectKey ?? row.contentHash.slice(0, 12);
}

/** Original create payload for a retry (AC-F07-2). */
function retryBody(row: KnowledgeSourceRow): Record<string, unknown> {
  const provenance = row.provenanceJson ?? {};
  const body: Record<string, unknown> = { sourceType: row.sourceType };
  if (row.sourceUri) body.sourceUri = row.sourceUri;
  if (row.objectKey) body.objectKey = row.objectKey;
  if (typeof provenance.content === "string") body.content = provenance.content;
  return body;
}

export function TenantStudioKnowledge() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [denial, setDenial] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sources, setSources] = useState<KnowledgeSourceRow[]>([]);
  const [selected, setSelected] = useState<KnowledgeSourceRow | null>(null);
  const [scope, setScope] = useState<TenantEntry | null>(null);
  const [retry, setRetry] = useState<RetryState>({
    retryingId: null,
    retryError: null,
  });

  const load = useCallback(async () => {
    setPhase("loading");
    setFailure(null);
    try {
      const session = await apiFetch<AuthSessionResponse>("/auth/session");
      const tenants = session.tenantContext?.tenants ?? [];
      if (tenants.length === 0) {
        setDenial("This account has no active tenant membership.");
        setPhase("denied");
        return;
      }
      setScope(tenants[0]);
      const rows = await apiFetch<KnowledgeSourceRow[]>(
        `/knowledge-sources?tenantId=${encodeURIComponent(tenants[0].tenantId)}`,
      );
      setSources(rows);
      setSelected((current) =>
        current ? (rows.find((row) => row.id === current.id) ?? null) : null,
      );
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDenial("Your session has expired. Sign in again.");
        setPhase("denied");
      } else if (error instanceof ApiError && error.status === 403) {
        setDenial("Your role cannot manage knowledge sources.");
        setPhase("denied");
      } else {
        setFailure(
          error instanceof Error ? error.message : "Knowledge is unavailable.",
        );
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    // Scheduled kick: a sync setState in the effect body would cascade a
    // render (react-hooks/set-state-in-effect), same as the inbox page.
    const timer = setTimeout(() => {
      if (!getSession()) {
        setDenial("Sign in to open the knowledge sources.");
        setPhase("denied");
        return;
      }
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const retrySource = useCallback(
    async (row: KnowledgeSourceRow) => {
      if (!scope) return;
      setRetry({ retryingId: row.id, retryError: null });
      try {
        const updated = await apiFetch<KnowledgeSourceRow>(
          `/knowledge-sources?tenantId=${encodeURIComponent(scope.tenantId)}`,
          {
            method: "POST",
            body: JSON.stringify(retryBody(row)),
          },
        );
        setSources((rows) =>
          rows.map((item) => (item.id === updated.id ? updated : item)),
        );
        setSelected(updated);
      } catch (error) {
        setRetry((state) => ({
          ...state,
          retryError: error instanceof Error ? error.message : "Retry failed.",
        }));
      } finally {
        setRetry((state) => ({ ...state, retryingId: null }));
      }
    },
    [scope],
  );

  if (phase === "loading") {
    return (
      <div className="glass-panel p-6 rounded-2xl">
        <p
          className="text-sm text-muted-custom"
          role="status"
          data-testid="knowledge-loading"
        >
          Loading knowledge sources…
        </p>
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div
        className="glass-panel p-6 rounded-2xl border border-amber-500/40"
        data-testid="knowledge-denied"
      >
        <p className="text-sm text-amber-300 flex items-center gap-2">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          {denial}
        </p>
        <Link href="/?signin=1" className="underline mt-2 inline-block text-xs">
          Go to sign in
        </Link>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        className="glass-panel p-6 rounded-2xl border border-red-500/40"
        data-testid="knowledge-error"
      >
        <p className="text-sm text-red-300">{failure}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex items-center gap-1 underline text-xs"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {/* Source list */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
            Knowledge sources
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            data-testid="knowledge-refresh"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--card-border)] text-heading hover:border-cyan-500/40 transition"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {sources.length === 0 ? (
          <p
            className="text-sm text-muted-custom"
            data-testid="knowledge-empty"
          >
            No knowledge sources yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="knowledge-list">
            {sources.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  data-testid="knowledge-source"
                  className={`w-full text-left rounded-xl border p-3 transition ${
                    selected?.id === row.id
                      ? "border-cyan-500/60 bg-blue-600/15"
                      : "border-[var(--card-border)] hover:border-cyan-500/30"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-heading">
                      {row.sourceType}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        STATUS_BADGE[row.status] ??
                        "bg-slate-500/15 text-slate-300 border-slate-500/40"
                      }`}
                      data-testid={`knowledge-status-${row.status}`}
                    >
                      {row.status}
                    </span>
                  </span>
                  <span
                    className="block text-xs mt-1 truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {referenceOf(row)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Ingestion detail */}
      <div
        className="glass-panel p-6 rounded-2xl space-y-3"
        data-testid="knowledge-detail"
      >
        {!selected ? (
          <p className="text-sm text-muted-custom">
            Select a source to see its ingestion detail.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
                Ingestion detail
              </h2>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  STATUS_BADGE[selected.status] ??
                  "bg-slate-500/15 text-slate-300 border-slate-500/40"
                }`}
                data-testid="knowledge-detail-status"
              >
                {selected.status}
              </span>
            </div>

            <dl className="text-xs space-y-1.5 font-mono">
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>id</dt>
                <dd className="text-heading break-all">{selected.id}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>type</dt>
                <dd className="text-heading">{selected.sourceType}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>hash</dt>
                <dd className="text-heading break-all">
                  {selected.contentHash.slice(0, 16)}…
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>created</dt>
                <dd className="text-heading">
                  {new Date(selected.createdAt).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>updated</dt>
                <dd className="text-heading">
                  {new Date(selected.updatedAt).toLocaleString()}
                </dd>
              </div>
            </dl>

            <div className="text-xs">
              <span style={{ color: "var(--text-muted)" }}>reference</span>
              <p className="mt-1 font-mono break-all text-heading">
                {referenceOf(selected)}
              </p>
            </div>

            {selected.status === "FAILED" && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                <p
                  className="text-xs text-red-300"
                  data-testid="knowledge-failure"
                >
                  {selected.errorCode ?? "INGESTION_FAILED"} — ingestion did not
                  complete.
                </p>
                <button
                  type="button"
                  onClick={() => void retrySource(selected)}
                  disabled={retry.retryingId === selected.id}
                  data-testid="knowledge-retry-source"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 border border-red-500/50 px-3 py-1.5 text-xs font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-60"
                >
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                  {retry.retryingId === selected.id
                    ? "Retrying…"
                    : "Retry ingestion"}
                </button>
              </div>
            )}

            {retry.retryError && (
              <p
                className="text-xs text-red-300"
                data-testid="knowledge-retry-error"
              >
                {retry.retryError}
              </p>
            )}

            {selected.status !== "FAILED" && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Use Refresh to re-read status after ingestion finishes.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
