"use client";

/**
 * Tenant retention settings (T6.06; F-14; AC-F14-2).
 *
 * Renders inside the existing "System Settings" tab of AdminView, so no new
 * route or tab is added. The panel reads the caller's tenant from
 * GET /auth/session, then reads GET /settings/retention and writes
 * PUT /settings/retention. The API is the authority: 401 means the session
 * expired, 403 means the role does not hold `retention.manage`, and 400
 * carries the field message for an invalid window.
 *
 * The panel validates the same 1..3650 whole-day contract before the call,
 * so a typo never reaches the API. A saved window shows the audit
 * confirmation, because every accepted write records one
 * `retention.policy_changed` event with the actor, category and window. The
 * panel also reads the ten newest such events and links to /audit#retention,
 * which opens the audit trail already filtered to retention changes.
 *
 * States: loading, signed-out or denied, failure with retry, and ready.
 * KNOWLEDGE and MEMORY report "Not set" until an administrator stores a
 * window; TRACES shows the seeded 30-day default as "Default".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { retentionDetail, shortInstant } from "@/lib/audit/describe";
import { getSession } from "@/lib/auth/session";

type Category = "KNOWLEDGE" | "TRACES" | "MEMORY";

interface RetentionPolicyView {
  category: Category;
  retentionDays: number | null;
  configured: boolean;
}

interface RetentionListResponse {
  tenantId: string;
  policies: RetentionPolicyView[];
}

interface SessionResponse {
  tenantContext: { tenants: Array<{ tenantId: string; name: string }> } | null;
}

interface AuditEventRow {
  id: string;
  actorId: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditEventRow[];
}

const CATEGORY_COPY: Record<Category, { label: string; description: string }> =
  {
    KNOWLEDGE: {
      label: "Knowledge sources",
      description:
        "Uploaded documents, sites and FAQs stop being available to retrieval after this window.",
    },
    TRACES: {
      label: "AI traces",
      description:
        "One operational record per AI run: outcome, latency and model. It never contains message text.",
    },
    MEMORY: {
      label: "Customer memory",
      description:
        "Facts an agent remembers about a customer. Memory is disabled in this release, so this window is stored but not yet applied.",
    },
  };

const MIN_DAYS = 1;
const MAX_DAYS = 3650;

/** Parse a whole-day window, or return null when the input is invalid. */
function parseWindow(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= MIN_DAYS && days <= MAX_DAYS ? days : null;
}

type Phase = "loading" | "denied" | "error" | "ready";

export function RetentionSettings() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [denial, setDenial] = useState("");
  const [failure, setFailure] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [policies, setPolicies] = useState<RetentionPolicyView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Category | null>(null);
  const [saved, setSaved] = useState<Category | null>(null);
  const [recentChanges, setRecentChanges] = useState<AuditEventRow[]>([]);

  /**
   * The ten newest retention changes, if the caller may read the audit trail.
   * `audit.read` is a separate permission from `retention.manage`; when it is
   * denied or the read fails, the panel stays usable and hides the history.
   */
  const loadRecentChanges = useCallback(async (activeTenantId: string) => {
    try {
      const page = await apiFetch<AuditPage>(
        `/audit/events?tenantId=${encodeURIComponent(activeTenantId)}&limit=10&action=retention.policy_changed`,
      );
      setRecentChanges(page.items);
    } catch {
      setRecentChanges([]);
    }
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setFailure("");
    try {
      const session = await apiFetch<SessionResponse>("/auth/session");
      const tenants = session.tenantContext?.tenants ?? [];
      if (tenants.length === 0) {
        setDenial("This account has no active tenant membership.");
        setPhase("denied");
        return;
      }
      const active = tenants[0].tenantId;
      const body = await apiFetch<RetentionListResponse>(
        `/settings/retention?tenantId=${encodeURIComponent(active)}`,
      );
      setTenantId(active);
      setPolicies(body.policies);
      setDrafts(
        Object.fromEntries(
          body.policies.map((policy) => [
            policy.category,
            policy.retentionDays === null ? "" : String(policy.retentionDays),
          ]),
        ),
      );
      setErrors({});
      setSaved(null);
      setPhase("ready");
      void loadRecentChanges(active);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDenial("Your session has expired. Sign in again.");
        setPhase("denied");
      } else if (error instanceof ApiError && error.status === 403) {
        setDenial("Your role cannot configure retention windows.");
        setPhase("denied");
      } else {
        setFailure(
          error instanceof Error
            ? error.message
            : "Retention settings are unavailable.",
        );
        setPhase("error");
      }
    }
  }, [loadRecentChanges]);

  useEffect(() => {
    // Scheduled kick: a sync setState in the effect body would cascade a
    // render, so the signed-out check and the load run on the next tick.
    const timer = setTimeout(() => {
      if (!getSession()) {
        setDenial("Sign in to configure retention windows.");
        setPhase("denied");
        return;
      }
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const save = useCallback(
    async (category: Category) => {
      if (!tenantId) return;
      const days = parseWindow(drafts[category] ?? "");
      if (days === null) {
        setErrors((current) => ({
          ...current,
          [category]: `Enter a whole number of days between ${MIN_DAYS} and ${MAX_DAYS}.`,
        }));
        return;
      }
      setSaving(category);
      setSaved(null);
      setErrors((current) => ({ ...current, [category]: "" }));
      try {
        const updated = await apiFetch<RetentionPolicyView>(
          "/settings/retention",
          {
            method: "PUT",
            body: JSON.stringify({ tenantId, category, retentionDays: days }),
          },
        );
        setPolicies((rows) =>
          rows.map((row) => (row.category === category ? updated : row)),
        );
        setDrafts((current) => ({
          ...current,
          [category]: String(updated.retentionDays ?? days),
        }));
        setSaved(category);
        void loadRecentChanges(tenantId);
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          setDenial(
            "Your role cannot configure retention windows. Nothing was changed.",
          );
          setPhase("denied");
          return;
        }
        setErrors((current) => ({
          ...current,
          [category]:
            error instanceof Error
              ? error.message
              : "The window could not be saved.",
        }));
      } finally {
        setSaving(null);
      }
    },
    [drafts, tenantId, loadRecentChanges],
  );

  return (
    <section
      className="glass-panel p-6 rounded-2xl space-y-5 border border-slate-700/50"
      aria-labelledby="retention-heading"
    >
      <div className="space-y-1">
        <h2
          id="retention-heading"
          className="text-base font-bold text-heading uppercase tracking-wider"
        >
          Data retention
        </h2>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Set how many days each record stays available. An expired record is
          unavailable immediately, even before the cleanup sweep runs.
        </p>
      </div>

      {phase === "loading" && (
        <p
          role="status"
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Loading retention settings…
        </p>
      )}

      {phase === "denied" && (
        <div
          role="alert"
          data-testid="retention-denied"
          className="flex items-start gap-2 text-xs text-red-400"
        >
          <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{denial}</span>
        </div>
      )}

      {phase === "error" && (
        <div role="alert" className="space-y-2 text-xs text-red-400">
          <p>{failure}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          {recentChanges.length > 0 && (
            <div
              data-testid="retention-history"
              className="space-y-2 rounded-xl border border-slate-700/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="text-[10px] font-mono uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  Recent changes
                </span>
                <Link
                  href="/audit#retention"
                  className="text-[11px] font-bold underline"
                  style={{ color: "var(--accent-cyan)" }}
                >
                  View full audit trail
                </Link>
              </div>
              <ul className="space-y-1">
                {recentChanges.map((change) => (
                  <li
                    key={change.id}
                    data-testid="retention-change"
                    className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-heading">
                      {retentionDetail(change)}
                    </span>
                    <span
                      className="font-mono"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {shortInstant(change.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {recentChanges.length === 10 && (
                <p
                  className="text-[10px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Showing the newest 10 changes. The audit trail has the full
                  history.
                </p>
              )}
            </div>
          )}
          <ul className="space-y-4">
            {policies.map((policy) => {
              const copy = CATEGORY_COPY[policy.category];
              const inputId = `retention-${policy.category.toLowerCase()}`;
              const errorId = `${inputId}-error`;
              const error = errors[policy.category];
              const isSaving = saving === policy.category;
              return (
                <li
                  key={policy.category}
                  className="border-t border-slate-700/40 pt-4 first:border-t-0 first:pt-0 space-y-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label
                      htmlFor={inputId}
                      className="text-xs font-bold text-heading"
                    >
                      {copy.label}
                    </label>
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-slate-600"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {policy.configured ? "Configured" : "Default"}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {copy.description}
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <label
                        htmlFor={inputId}
                        className="block text-[10px] uppercase font-mono font-bold"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Days
                      </label>
                      <input
                        id={inputId}
                        type="number"
                        inputMode="numeric"
                        min={MIN_DAYS}
                        max={MAX_DAYS}
                        step={1}
                        value={drafts[policy.category] ?? ""}
                        placeholder={policy.configured ? undefined : "Not set"}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [policy.category]: event.target.value,
                          }))
                        }
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className="w-32 rounded-xl px-3 py-2 text-xs text-heading bg-slate-900/80 border border-slate-700/60"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void save(policy.category)}
                      disabled={isSaving}
                      aria-busy={isSaving}
                      className="px-3 py-2 rounded-xl text-xs font-bold border border-cyan-500/40 text-cyan-300 disabled:opacity-60"
                    >
                      {isSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {error && (
                    <p
                      id={errorId}
                      role="alert"
                      className="text-xs text-red-400"
                    >
                      {error}
                    </p>
                  )}
                  {saved === policy.category && (
                    <p role="status" className="text-xs text-emerald-300">
                      {copy.label} window saved. This change is recorded in the
                      audit log as retention.policy_changed.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Each save records one audit event with your identity, the category
            and the new window. A shorter window takes effect at the next
            cleanup sweep.
          </p>
        </>
      )}
    </section>
  );
}
