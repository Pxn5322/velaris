"use client";

/**
 * Agent lifecycle panels (T4.06, F-08, AC-F08-1..AC-F08-3).
 *
 * Renders inside the existing studio tabs:
 * - "8. Evaluation" hosts configuration, the evaluation run and publish.
 * - "9. Versions" hosts the version history and rollback.
 *
 * Every call goes to the guarded API (`/ai/agents`); the browser never
 * decides who may configure or publish, and a 403 is shown as a denial.
 * A publish refusal arrives as 422 with `findings`, which are rendered
 * verbatim so the operator sees every blocking reason at once (AC-F08-2).
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";

interface TenantEntry {
  tenantId: string;
}

interface AuthSessionResponse {
  tenantContext: { tenants: TenantEntry[] } | null;
}

interface AgentRow {
  id: string;
  name: string;
  description: string;
  status: string;
  activeVersionId: string | null;
  activeVersion: number | null;
  draftVersion: number | null;
  updatedAt: string;
}

interface EvaluationRunRow {
  id: string;
  datasetVersion: string;
  status: string;
  aggregateJson: unknown;
  failureReasonsJson: unknown;
  createdAt: string;
}

interface VersionRow {
  id: string;
  version: number;
  status: string;
  configJson: unknown;
  createdAt: string;
  publishedAt: string | null;
  evaluationRuns: EvaluationRunRow[];
}

interface AgentDetail {
  id: string;
  name: string;
  activeVersion: { id: string; version: number } | null;
  versions: VersionRow[];
}

interface Finding {
  code: string;
  datasetVersion?: string;
  toolName?: string;
  caseId?: string;
  message: string;
}

type Phase = "loading" | "denied" | "error" | "ready";

const DATASETS = ["support-triage@1.0.0", "safety-refusal@1.0.0"];
const DEFAULT_MODEL = "llama-3.3-70b";

const STATUS_BADGE: Record<string, string> = {
  PUBLISHED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  DRAFT: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  PASSED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  FAILED: "bg-red-500/15 text-red-300 border-red-500/40",
};

/** Safe text of an unknown error; never renders an internal stack. */
function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed";
}

/** Findings array from a 422 publish refusal. */
function findingsOf(error: unknown): Finding[] {
  if (!(error instanceof ApiError)) return [];
  const findings = (error.body as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return [];
  return findings.filter((row): row is Finding => {
    if (typeof row !== "object" || row === null) return false;
    return typeof (row as Finding).message === "string";
  });
}

function summaryOf(run: EvaluationRunRow | undefined): string {
  if (!run) return "No evaluation yet";
  const aggregate = run.aggregateJson as {
    total?: number;
    passed?: number;
    failed?: number;
  } | null;
  if (!aggregate || typeof aggregate.total !== "number") return run.status;
  return `${run.status} · ${aggregate.passed ?? 0}/${aggregate.total} cases passed`;
}

/** Shared data loader for both panels. */
function useAgentLifecycle() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (targetAgentId?: string | null) => {
    try {
      const session = await apiFetch<AuthSessionResponse>("/auth/session");
      setPhase("loading");
      setError(null);
      const tenant = session.tenantContext?.tenants[0]?.tenantId ?? null;
      if (!tenant) {
        setPhase("denied");
        return;
      }
      setTenantId(tenant);
      const rows = await apiFetch<AgentRow[]>(`/ai/agents?tenantId=${tenant}`);
      setAgents(rows);
      const selected =
        (targetAgentId && rows.some((row) => row.id === targetAgentId)
          ? targetAgentId
          : rows[0]?.id) ?? null;
      setAgentId(selected);
      if (selected) {
        setDetail(
          await apiFetch<AgentDetail>(
            `/ai/agents/${selected}?tenantId=${tenant}`,
          ),
        );
      } else {
        setDetail(null);
      }
      setPhase("ready");
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        (requestError.status === 401 || requestError.status === 403)
      ) {
        setPhase("denied");
        return;
      }
      setError(messageOf(requestError));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // Scheduled kick: a sync setState in the effect body would cascade a
    // render (react-hooks/set-state-in-effect), same as the knowledge panel.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const select = useCallback(
    async (nextAgentId: string) => {
      setAgentId(nextAgentId);
      setNotice(null);
      if (!tenantId) return;
      try {
        setDetail(
          await apiFetch<AgentDetail>(
            `/ai/agents/${nextAgentId}?tenantId=${tenantId}`,
          ),
        );
      } catch (requestError) {
        setError(messageOf(requestError));
      }
    },
    [tenantId],
  );

  return {
    phase,
    tenantId,
    agents,
    agentId,
    detail,
    error,
    busy,
    notice,
    setBusy,
    setNotice,
    setError,
    load,
    select,
  };
}

type Lifecycle = ReturnType<typeof useAgentLifecycle>;

function PanelFrame({
  lifecycle,
  children,
}: {
  lifecycle: Lifecycle;
  children: ReactNode;
}) {
  const { phase, error, load } = lifecycle;
  if (phase === "loading") {
    return (
      <p className="text-sm text-muted-custom" data-testid="agents-loading">
        Loading agents…
      </p>
    );
  }
  if (phase === "denied") {
    return (
      <div
        className="glass-panel p-6 rounded-2xl flex items-start gap-3"
        data-testid="agents-denied"
      >
        <AlertTriangle
          aria-hidden="true"
          className="h-4 w-4 text-amber-300 shrink-0"
        />
        <p className="text-sm text-muted-custom">
          Agent deployment is not available to this role.
        </p>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div
        className="glass-panel p-6 rounded-2xl space-y-3"
        data-testid="agents-error"
      >
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--card-border)] text-heading hover:border-cyan-500/40 transition"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function AgentPicker({ lifecycle }: { lifecycle: Lifecycle }) {
  const { agents, agentId, select } = lifecycle;
  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-custom" data-testid="agents-empty">
        No agents yet. Create one below.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2" data-testid="agent-list">
      {agents.map((agent) => (
        <li key={agent.id}>
          <button
            type="button"
            onClick={() => void select(agent.id)}
            data-testid="agent-select"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
              agentId === agent.id
                ? "border-cyan-500/60 bg-blue-600/15 text-heading"
                : "border-[var(--card-border)] text-muted-custom hover:border-cyan-500/30"
            }`}
          >
            {agent.name}
            {agent.activeVersion
              ? ` · v${agent.activeVersion} live`
              : " · not published"}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Create an agent (v1 draft) or append a new draft version. */
function DraftForm({ lifecycle }: { lifecycle: Lifecycle }) {
  const {
    tenantId,
    agentId,
    detail,
    busy,
    setBusy,
    setError,
    setNotice,
    load,
  } = lifecycle;
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("You are a support agent.");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState("0.2");

  const createAgent = async () => {
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ agentId: string }>(
        `/ai/agents?tenantId=${tenantId}`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            config: {
              systemPrompt,
              model,
              temperature: Number(temperature),
            },
          }),
        },
      );
      setNotice("Draft v1 created.");
      await load(created.agentId);
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setBusy(false);
    }
  };

  const addVersion = async () => {
    if (!tenantId || !agentId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ version: number }>(
        `/ai/agents/${agentId}/versions?tenantId=${tenantId}`,
        {
          method: "POST",
          body: JSON.stringify({
            config: { systemPrompt, model, temperature: Number(temperature) },
          }),
        },
      );
      setNotice(`Draft v${created.version} created.`);
      await load(agentId);
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="glass-panel p-6 rounded-2xl space-y-3"
      data-testid="draft-form"
    >
      <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
        {agentId ? "New draft version" : "Create agent"}
      </h2>
      {!agentId && (
        <label className="block text-xs text-muted-custom">
          Agent name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="agent-name"
            className="mt-1 w-full rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm text-heading"
          />
        </label>
      )}
      <label className="block text-xs text-muted-custom">
        System prompt
        <textarea
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          data-testid="agent-prompt"
          rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm text-heading"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted-custom">
          Model
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            data-testid="agent-model"
            className="mt-1 w-full rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm text-heading"
          />
        </label>
        <label className="block text-xs text-muted-custom">
          Temperature
          <input
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm text-heading"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || (!agentId && name.trim().length === 0)}
        onClick={() => void (agentId ? addVersion() : createAgent())}
        data-testid="draft-submit"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-cyan-500/40 text-heading hover:bg-blue-600/15 transition disabled:opacity-50"
      >
        {agentId ? "Save as new draft" : "Create draft agent"}
      </button>
      {detail?.versions[0] && (
        <p className="text-xs text-muted-custom">
          Editing creates a new immutable version from these fields. The latest
          draft is v{detail.versions[0].version}.
        </p>
      )}
    </div>
  );
}

/** Tab 8: configure a draft, evaluate it and publish through the gate. */
export function TenantStudioEvaluation() {
  const lifecycle = useAgentLifecycle();
  const {
    tenantId,
    detail,
    busy,
    error,
    setBusy,
    setError,
    notice,
    setNotice,
    load,
  } = lifecycle;
  const [datasetVersion, setDatasetVersion] = useState(DATASETS[0]);
  const [findings, setFindings] = useState<Finding[]>([]);

  const draft = detail?.versions.find((version) => version.status === "DRAFT");
  const latestRun = draft?.evaluationRuns[0];
  const config = (draft?.configJson ?? {}) as { model?: string };

  const runEvaluation = async () => {
    if (!tenantId || !detail || !draft) return;
    setBusy(true);
    setError(null);
    setFindings([]);
    setNotice(null);
    try {
      const run = await apiFetch<{ status: string }>(
        `/ai/agents/${detail.id}/versions/${draft.id}/evaluations?tenantId=${tenantId}`,
        {
          method: "POST",
          body: JSON.stringify({
            datasetVersion,
            provider: "groq",
            model: config.model ?? DEFAULT_MODEL,
          }),
        },
      );
      setNotice(`Evaluation finished: ${run.status}.`);
      await load(detail.id);
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!tenantId || !detail || !draft) return;
    setBusy(true);
    setError(null);
    setFindings([]);
    setNotice(null);
    try {
      await apiFetch<{ version: number }>(
        `/ai/agents/${detail.id}/versions/${draft.id}/publish?tenantId=${tenantId}`,
        { method: "POST" },
      );
      setNotice(`Published v${draft.version}.`);
      await load(detail.id);
    } catch (requestError) {
      const blocking = findingsOf(requestError);
      if (blocking.length > 0) {
        setFindings(blocking);
      } else {
        setError(messageOf(requestError));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelFrame lifecycle={lifecycle}>
      <div className="space-y-4">
        <div className="glass-panel p-6 rounded-2xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
              Agent
            </h2>
            <span
              className="text-xs text-muted-custom"
              data-testid="active-version"
            >
              {detail?.activeVersion
                ? `Live: v${detail.activeVersion.version}`
                : "Nothing published"}
            </span>
          </div>
          <AgentPicker lifecycle={lifecycle} />
        </div>

        <DraftForm lifecycle={lifecycle} />

        <div
          className="glass-panel p-6 rounded-2xl space-y-3"
          data-testid="evaluation-panel"
        >
          <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
            Evaluate latest draft
          </h2>
          <p className="text-xs text-muted-custom">
            {draft
              ? `Draft v${draft.version} · ${summaryOf(latestRun)}`
              : "No draft version is available."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-muted-custom">
              Dataset
              <select
                value={datasetVersion}
                onChange={(event) => setDatasetVersion(event.target.value)}
                data-testid="dataset-select"
                className="ml-2 rounded-lg border border-[var(--card-border)] bg-transparent px-2 py-1.5 text-xs text-heading"
              >
                {DATASETS.map((dataset) => (
                  <option key={dataset} value={dataset}>
                    {dataset}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !draft}
              onClick={() => void runEvaluation()}
              data-testid="run-evaluation"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--card-border)] text-heading hover:border-cyan-500/40 transition disabled:opacity-50"
            >
              <Play aria-hidden="true" className="h-3.5 w-3.5" /> Run evaluation
            </button>
            <button
              type="button"
              disabled={busy || !draft}
              onClick={() => void publish()}
              data-testid="publish-version"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-500/40 text-heading hover:bg-emerald-500/10 transition disabled:opacity-50"
            >
              <Rocket aria-hidden="true" className="h-3.5 w-3.5" /> Publish
              draft
            </button>
          </div>

          {latestRun && (
            <div
              className="text-xs text-muted-custom"
              data-testid="evaluation-result"
            >
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  STATUS_BADGE[latestRun.status] ??
                  "bg-slate-500/15 text-slate-300 border-slate-500/40"
                }`}
              >
                {latestRun.status}
              </span>
              <span className="ml-2">{latestRun.datasetVersion}</span>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-300" data-testid="agents-error">
              {error}
            </p>
          )}

          {notice && (
            <p
              className="text-xs text-emerald-300 inline-flex items-center gap-1.5"
              data-testid="agents-notice"
            >
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
              {notice}
            </p>
          )}

          {findings.length > 0 && (
            <ul
              className="text-xs text-amber-200 space-y-1"
              data-testid="publish-findings"
            >
              {findings.map((finding, index) => (
                <li key={`${finding.code}-${index}`}>
                  <span className="font-bold">{finding.code}</span>:{" "}
                  {finding.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PanelFrame>
  );
}

/** Tab 9: version history and rollback to an earlier published version. */
export function TenantStudioVersions() {
  const lifecycle = useAgentLifecycle();
  const {
    tenantId,
    detail,
    busy,
    error,
    setBusy,
    setError,
    notice,
    setNotice,
    load,
  } = lifecycle;
  const [rolledBack, setRolledBack] = useState<string | null>(null);

  const rollback = async (versionId: string) => {
    if (!tenantId || !detail) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setRolledBack(null);
    try {
      const result = await apiFetch<{ activeVersion: number }>(
        `/ai/agents/${detail.id}/rollback?tenantId=${tenantId}`,
        { method: "POST", body: JSON.stringify({ versionId }) },
      );
      setRolledBack(`Rolled back to v${result.activeVersion}.`);
      await load(detail.id);
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelFrame lifecycle={lifecycle}>
      <div className="space-y-4">
        <div className="glass-panel p-6 rounded-2xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
              Versions
            </h2>
            <span className="text-xs text-muted-custom">
              {detail?.activeVersion
                ? `Live: v${detail.activeVersion.version}`
                : "Nothing published"}
            </span>
          </div>
          <AgentPicker lifecycle={lifecycle} />

          {error && (
            <p className="text-xs text-red-300" data-testid="agents-error">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-xs text-emerald-300" data-testid="agents-notice">
              {notice}
            </p>
          )}
          {rolledBack && (
            <p
              className="text-xs text-emerald-300"
              data-testid="rollback-result"
            >
              {rolledBack}
            </p>
          )}

          {!detail || detail.versions.length === 0 ? (
            <p className="text-sm text-muted-custom">No versions yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="version-list">
              {detail.versions.map((version) => (
                <li
                  key={version.id}
                  data-testid="version-row"
                  className="rounded-xl border border-[var(--card-border)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-heading">
                      v{version.version}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        STATUS_BADGE[version.status] ??
                        "bg-slate-500/15 text-slate-300 border-slate-500/40"
                      }`}
                    >
                      {version.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-custom mt-1">
                    {version.evaluationRuns[0]
                      ? summaryOf(version.evaluationRuns[0])
                      : "No evaluation yet"}
                    {version.publishedAt
                      ? ` · published ${new Date(version.publishedAt).toLocaleString()}`
                      : ""}
                  </p>
                  {version.status === "PUBLISHED" &&
                    version.id !== detail.activeVersion?.id && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void rollback(version.id)}
                        data-testid="rollback-version"
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--card-border)] text-heading hover:border-cyan-500/40 transition disabled:opacity-50"
                      >
                        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                        Roll back to v{version.version}
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PanelFrame>
  );
}
