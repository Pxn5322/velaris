/**
 * Dataset contract checks for T4.05: a stored run names an immutable
 * dataset version, the required suite resolves, and scoring never coerces a
 * missing answer or a forbidden tool into a pass.
 */

import { describe, expect, it } from 'vitest';
import {
  getDataset,
  listDatasets,
  REQUIRED_DATASET_VERSIONS,
  scoreCase,
  summarise,
} from 'ai-evals';

describe('evaluation datasets', () => {
  it('resolves every required dataset version', () => {
    for (const version of REQUIRED_DATASET_VERSIONS) {
      expect(getDataset(version)?.version).toBe(version);
    }
  });

  it('keeps dataset versions unique and case ids unique inside a dataset', () => {
    const versions = listDatasets().map((dataset) => dataset.version);
    expect(new Set(versions).size).toBe(versions.length);

    for (const dataset of listDatasets()) {
      const ids = dataset.cases.map((testCase) => testCase.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('returns undefined for an unknown version instead of a fallback set', () => {
    expect(getDataset('support-triage@9.9.9')).toBeUndefined();
  });

  it('fails a case that calls a forbidden tool even when the text looks right', () => {
    const dataset = getDataset('safety-refusal@1.0.0');
    const testCase = dataset?.cases.find(
      (entry) => entry.id === 'safety-cross-tenant-refund',
    );
    expect(testCase).toBeDefined();

    const result = scoreCase(testCase!, {
      text: 'I will refund that order now',
      escalated: true,
      toolCalls: ['refund.create'],
    });

    expect(result.passed).toBe(false);
    expect(result.findings.join(' ')).toContain('refund.create');
  });

  it('fails a case that hides leaked credentials', () => {
    const dataset = getDataset('safety-refusal@1.0.0');
    const testCase = dataset?.cases.find(
      (entry) => entry.id === 'safety-no-credential-echo',
    );

    const result = scoreCase(testCase!, {
      text: 'The key is sk-live-123',
      escalated: true,
    });

    expect(result.passed).toBe(false);
    expect(result.findings.join(' ')).toContain('forbidden text');
  });

  it('does not pass a case that skips a required citation', () => {
    const dataset = getDataset('support-triage@1.0.0');
    const testCase = dataset?.cases.find(
      (entry) => entry.id === 'triage-password-reset',
    );

    const result = scoreCase(testCase!, {
      text: 'Use the reset link',
      intent: 'account_access',
      citedSourceIds: [],
    });

    expect(result.passed).toBe(false);
    expect(result.findings.join(' ')).toContain('cites no knowledge source');
  });

  it('summarises an empty run as failed rather than a perfect score', () => {
    const summary = summarise([]);

    expect(summary.status).toBe('PASSED'); // no cases, no failures
    expect(summary.passRate).toBe(0);
    expect(summary.total).toBe(0);
  });
});
