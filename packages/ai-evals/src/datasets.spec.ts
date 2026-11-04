/**
 * Dataset registry and adversarial fixture tests (T6.01; NFR-09; AC-F08-1,
 * AC-F09-3, AC-F10-3; TST-TH-04).
 *
 * The publish gate reads recorded runs for every required dataset version, so
 * the registry itself is release evidence: a required version that does not
 * resolve, a duplicated case id or a dataset without a CRITICAL case would
 * weaken the gate silently. The adversarial fixtures prove the scorer rejects
 * the hostile answers it ships, so the datasets cannot be tightened without a
 * matching regression.
 */

import { describe, expect, it } from 'vitest';
import { ADVERSARIAL_DATASETS } from './adversarial.js';
import {
  ADVERSARIAL_REFERENCE_ANSWERS,
  ADVERSARIAL_UNSAFE_ANSWERS,
} from './fixtures.js';
import {
  ADVERSARIAL_DATASET_VERSIONS,
  REQUIRED_DATASET_VERSIONS,
  getDataset,
  listDatasets,
} from './datasets.js';
import { scoreCase } from './scoring.js';

describe('dataset registry (AC-F08-1)', () => {
  it('resolves every required version, so the publish gate can demand it', () => {
    for (const version of REQUIRED_DATASET_VERSIONS) {
      const dataset = getDataset(version);
      expect(dataset?.version).toBe(version);
      expect(dataset?.cases.length).toBeGreaterThan(0);
    }
  });

  it('lists the adversarial datasets inside the required suite', () => {
    for (const version of ADVERSARIAL_DATASET_VERSIONS) {
      expect(REQUIRED_DATASET_VERSIONS).toContain(version);
    }
    expect(ADVERSARIAL_DATASET_VERSIONS.length).toBe(ADVERSARIAL_DATASETS.length);
  });

  it('keeps dataset versions unique', () => {
    const versions = listDatasets().map((dataset) => dataset.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('keeps case ids unique inside each dataset', () => {
    for (const dataset of listDatasets()) {
      const ids = dataset.cases.map((testCase) => testCase.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every dataset at least one CRITICAL case', () => {
    for (const dataset of listDatasets()) {
      expect(
        dataset.cases.some((testCase) => testCase.severity === 'CRITICAL'),
        `${dataset.version} has no CRITICAL case`,
      ).toBe(true);
    }
  });

  it('returns undefined for an unknown version instead of a fallback set', () => {
    expect(getDataset('support-triage@9.9.9')).toBeUndefined();
  });
});

describe('adversarial fixtures (TST-TH-04)', () => {
  it('gives every adversarial case a reference answer and a hostile answer', () => {
    const caseIds = ADVERSARIAL_DATASETS.flatMap((dataset) =>
      dataset.cases.map((testCase) => testCase.id),
    );

    expect(caseIds.length).toBeGreaterThan(0);
    for (const caseId of caseIds) {
      expect(ADVERSARIAL_REFERENCE_ANSWERS[caseId], caseId).toBeDefined();
      expect(ADVERSARIAL_UNSAFE_ANSWERS[caseId], caseId).toBeDefined();
      expect(Object.keys(ADVERSARIAL_REFERENCE_ANSWERS)).toContain(caseId);
    }
    expect(Object.keys(ADVERSARIAL_UNSAFE_ANSWERS).sort()).toEqual(
      [...caseIds].sort(),
    );
  });

  it('passes every adversarial case with its reference answer', () => {
    for (const dataset of ADVERSARIAL_DATASETS) {
      for (const testCase of dataset.cases) {
        const result = scoreCase(testCase, ADVERSARIAL_REFERENCE_ANSWERS[testCase.id]);
        expect(result.findings, testCase.id).toEqual([]);
        expect(result.passed, testCase.id).toBe(true);
      }
    }
  });

  it('fails the targeted case for every hostile answer', () => {
    for (const dataset of ADVERSARIAL_DATASETS) {
      for (const testCase of dataset.cases) {
        const fixture = ADVERSARIAL_UNSAFE_ANSWERS[testCase.id];
        const result = scoreCase(testCase, fixture.answer);

        expect(result.passed, testCase.id).toBe(false);
        expect(
          result.findings.join(' | '),
          `${testCase.id} must be caught by a finding naming ${fixture.expectedFinding}`,
        ).toContain(fixture.expectedFinding);
      }
    }
  });
});
