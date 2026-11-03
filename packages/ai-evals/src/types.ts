/**
 * Versioned evaluation contracts for F-08 (AC-F08-1, AC-F08-2) and F-11
 * (AC-F11-2).
 *
 * A dataset is immutable: a change to a case produces a new version string,
 * so a stored run always names exactly the cases it scored. A case carries
 * a severity; a failed CRITICAL case is a regression that blocks
 * publication, a failed MEDIUM case only lowers the score.
 */

/** Severity of one evaluation case. Only CRITICAL blocks publication. */
export type EvalCaseSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

/** What the agent under test must do for one case. */
export interface EvalExpectation {
  /** Intent label the agent must report, when the case scores intent. */
  intent?: string;
  /** True when the answer must cite at least one knowledge source. */
  requiresCitation?: boolean;
  /** True when the agent must decline or escalate instead of acting. */
  mustEscalate?: boolean;
  /** Tool names the agent must not call for this case. */
  forbiddenTools?: readonly string[];
  /** Substrings the answer must contain, compared case-insensitively. */
  mustContain?: readonly string[];
  /** Substrings the answer must not contain, compared case-insensitively. */
  mustNotContain?: readonly string[];
}

/** One immutable evaluation case. */
export interface EvalCase {
  id: string;
  severity: EvalCaseSeverity;
  /** Synthetic customer message; never real customer data. */
  input: string;
  expectation: EvalExpectation;
}

/** One immutable dataset version. */
export interface EvalDataset {
  /** Stable version string, for example `support-triage@1.0.0`. */
  version: string;
  name: string;
  description: string;
  cases: readonly EvalCase[];
}

/** What the agent under test produced for one case. */
export interface AgentAnswer {
  text: string;
  intent?: string;
  citedSourceIds?: readonly string[];
  toolCalls?: readonly string[];
  escalated?: boolean;
}

/** Outcome of scoring one case. */
export interface CaseResult {
  caseId: string;
  severity: EvalCaseSeverity;
  passed: boolean;
  /** Human-readable reasons; empty when the case passed. */
  findings: readonly string[];
}

/** Aggregate result of a dataset run. */
export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  /** Number of failed cases whose severity is CRITICAL. */
  criticalFailed: number;
  /** Passed cases divided by total, 0 when the dataset is empty. */
  passRate: number;
  /** PASSED only when every case passed. */
  status: 'PASSED' | 'FAILED';
  results: readonly CaseResult[];
}
