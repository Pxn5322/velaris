/**
 * Adversarial regression datasets (T4.07; F-09, F-10; AC-F09-3, AC-F10-3;
 * TH-03, TH-04).
 *
 * The datasets are only evidence when two things hold: the reference answers
 * pass every case, and a hostile answer fails the case it targets. The second
 * half matters most, because a dataset that a wrong answer can satisfy is not
 * a regression test.
 */

import { describe, expect, it } from 'vitest';
import {
  ADVERSARIAL_DATASETS,
  ADVERSARIAL_REFERENCE_ANSWERS,
  ADVERSARIAL_UNSAFE_ANSWERS,
  getDataset,
  REQUIRED_DATASET_VERSIONS,
  scoreCase,
  scoreDataset,
  type AgentAnswer,
  type EvalDataset,
} from 'ai-evals';

/** Answers for the cases of one dataset only. */
function referenceAnswers(dataset: EvalDataset): ReadonlyMap<string, AgentAnswer> {
  return new Map(
    dataset.cases.map((testCase) => {
      const answer = ADVERSARIAL_REFERENCE_ANSWERS[testCase.id];
      expect(answer, `missing reference answer for ${testCase.id}`).toBeDefined();
      return [testCase.id, answer!] as const;
    }),
  );
}

describe('adversarial regression datasets', () => {
  it('ships an injection set and a cross-tenant and escalation set', () => {
    const versions = ADVERSARIAL_DATASETS.map((dataset) => dataset.version);

    expect(versions).toEqual([
      'adversarial-injection@1.0.0',
      'adversarial-boundary@1.0.0',
    ]);
    for (const version of versions) {
      expect(getDataset(version)?.version).toBe(version);
    }
  });

  it('requires every adversarial dataset before a publish (AC-F09-3, AC-F10-3)', () => {
    for (const dataset of ADVERSARIAL_DATASETS) {
      expect(REQUIRED_DATASET_VERSIONS).toContain(dataset.version);
    }
  });

  it('scores every case PASSED with the reference answers (TST-TH-04)', () => {
    for (const dataset of ADVERSARIAL_DATASETS) {
      const summary = scoreDataset(dataset, referenceAnswers(dataset));

      expect(summary.failed, `${dataset.version} failed cases`).toBe(0);
      expect(summary.status).toBe('PASSED');
      expect(summary.passRate).toBe(1);
    }
  });

  it('fails the targeted case for every hostile answer', () => {
    for (const dataset of ADVERSARIAL_DATASETS) {
      for (const testCase of dataset.cases) {
        const fixture = ADVERSARIAL_UNSAFE_ANSWERS[testCase.id];
        expect(
          fixture,
          `missing hostile answer for ${testCase.id}`,
        ).toBeDefined();

        const result = scoreCase(testCase, fixture!.answer);
        const findings = result.findings.join(' ').toLowerCase();

        expect(result.passed, `${testCase.id} passed a hostile answer`).toBe(
          false,
        );
        expect(findings).toContain(fixture!.expectedFinding.toLowerCase());
      }
    }
  });

  it('fails every adversarial case when the runner returns no answer', () => {
    for (const dataset of ADVERSARIAL_DATASETS) {
      const summary = scoreDataset(dataset, new Map());

      expect(summary.status).toBe('FAILED');
      expect(summary.passed).toBe(0);
      expect(summary.criticalFailed).toBeGreaterThan(0);
    }
  });

  it('keeps the injection set focused on hostile instructions', () => {
    const dataset = getDataset('adversarial-injection@1.0.0');

    for (const testCase of dataset!.cases) {
      expect(testCase.expectation.mustEscalate).toBe(true);
      expect(testCase.expectation.mustNotContain?.length).toBeGreaterThan(0);
    }
  });
});
