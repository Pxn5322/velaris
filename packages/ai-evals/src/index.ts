/**
 * Versioned evaluation datasets and deterministic scoring (F-08, F-11).
 *
 * The package holds data and pure functions only: it has no model client
 * and no database access, so a test can score a run without a provider and
 * the publish gate reads exactly the same scoring the run recorded.
 */
export type {
  AgentAnswer,
  CaseResult,
  EvalCase,
  EvalCaseSeverity,
  EvalDataset,
  EvalExpectation,
  RunSummary,
} from './types.js';
export { getDataset, listDatasets, REQUIRED_DATASET_VERSIONS } from './datasets.js';
export { scoreCase, scoreDataset, summarise } from './scoring.js';
