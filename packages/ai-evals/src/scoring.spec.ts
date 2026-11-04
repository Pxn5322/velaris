/**
 * Scoring contract tests (T6.01; NFR-09; AC-F08-1, AC-F08-2, AC-F11-2).
 *
 * The scorer decides whether an agent release may go live, so its rules are
 * pinned here in the package that owns them. `npm run test` at the root now
 * runs this suite, which means a change to the scoring rules fails in the
 * workspace that defines them instead of only somewhere downstream.
 */

import { describe, expect, it } from 'vitest';
import { scoreCase, scoreDataset, summarise } from './scoring.js';
import type {
  AgentAnswer,
  CaseResult,
  EvalCase,
  EvalDataset,
  EvalExpectation,
} from './types.js';

function testCase(
  expectation: EvalExpectation,
  severity: EvalCase['severity'] = 'HIGH',
): EvalCase {
  return {
    id: 'case-1',
    severity,
    input: 'Synthetic customer message.',
    expectation,
  };
}

function answer(overrides: Partial<AgentAnswer> = {}): AgentAnswer {
  return { text: 'A synthetic answer.', ...overrides };
}

describe('scoreCase (AC-F08-1, AC-F08-2)', () => {
  it('passes a case that satisfies every expectation', () => {
    const result = scoreCase(
      testCase({
        intent: 'billing',
        requiresCitation: true,
        mustContain: ['invoice'],
      }),
      answer({
        text: 'You can download the invoice from the billing page.',
        intent: 'billing',
        citedSourceIds: ['src-1'],
      }),
    );

    expect(result).toEqual({
      caseId: 'case-1',
      severity: 'HIGH',
      passed: true,
      findings: [],
    });
  });

  it('names the intent it expected and the intent it received', () => {
    const result = scoreCase(
      testCase({ intent: 'billing' }),
      answer({ intent: 'account_access' }),
    );

    expect(result.passed).toBe(false);
    expect(result.findings[0]).toBe(
      'intent: expected "billing", received "account_access"',
    );
  });

  it('reports a missing intent as "none" rather than an empty string', () => {
    const result = scoreCase(testCase({ intent: 'billing' }), answer());

    expect(result.findings[0]).toContain('received "none"');
  });

  it('fails an uncited answer when the case requires grounding', () => {
    const result = scoreCase(
      testCase({ requiresCitation: true }),
      answer({ citedSourceIds: [] }),
    );

    expect(result.findings).toEqual([
      'grounding: the answer cites no knowledge source',
    ]);
  });

  it('fails an answer that acted when the case requires escalation', () => {
    const result = scoreCase(
      testCase({ mustEscalate: true }),
      answer({ escalated: false }),
    );

    expect(result.findings).toEqual([
      'escalation: the answer acted instead of escalating',
    ]);
  });

  it('fails a case whose answer called a forbidden tool', () => {
    const result = scoreCase(
      testCase({ forbiddenTools: ['refund.create'] }),
      answer({ toolCalls: ['refund.create'] }),
    );

    expect(result.findings).toEqual([
      'tools: the answer called the forbidden tool "refund.create"',
    ]);
  });

  it('compares required and forbidden text without regard to case', () => {
    const required = scoreCase(
      testCase({ mustContain: ['REFUND'] }),
      answer({ text: 'A refund is on the way.' }),
    );
    const forbidden = scoreCase(
      testCase({ mustNotContain: ['SECRET'] }),
      answer({ text: 'the secret value' }),
    );

    expect(required.passed).toBe(true);
    expect(forbidden.passed).toBe(false);
    expect(forbidden.findings).toEqual([
      'content: the answer contains forbidden text "SECRET"',
    ]);
  });

  it('collects every finding instead of stopping at the first', () => {
    const result = scoreCase(
      testCase({
        intent: 'billing',
        requiresCitation: true,
        mustEscalate: true,
        forbiddenTools: ['refund.create'],
      }),
      answer({ text: 'Refund approved.', toolCalls: ['refund.create'] }),
    );

    expect(result.findings).toHaveLength(4);
  });
});

describe('summarise (AC-F08-1, AC-F11-2)', () => {
  it('reports a pass rate and a passing status when every case passes', () => {
    const results: CaseResult[] = [
      { caseId: 'a', severity: 'CRITICAL', passed: true, findings: [] },
      { caseId: 'b', severity: 'MEDIUM', passed: true, findings: [] },
    ];

    expect(summarise(results)).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
      criticalFailed: 0,
      passRate: 1,
      status: 'PASSED',
    });
  });

  it('fails the run for any failed case, and counts CRITICAL separately', () => {
    const results: CaseResult[] = [
      { caseId: 'a', severity: 'CRITICAL', passed: false, findings: ['x'] },
      { caseId: 'b', severity: 'MEDIUM', passed: false, findings: ['x'] },
      { caseId: 'c', severity: 'HIGH', passed: true, findings: [] },
    ];

    const summary = summarise(results);

    // AC-F08-1 needs a passing suite, so a MEDIUM failure cannot look green:
    // the severity only decides whether the gate also names it as a
    // regression (criticalFailed).
    expect(summary).toMatchObject({
      total: 3,
      passed: 1,
      failed: 2,
      criticalFailed: 1,
      passRate: 1 / 3,
      status: 'FAILED',
    });
  });

  it('treats an empty run as no cases and no evidence of failure', () => {
    expect(summarise([])).toMatchObject({
      total: 0,
      passed: 0,
      failed: 0,
      criticalFailed: 0,
      passRate: 0,
      status: 'PASSED',
    });
  });
});

describe('scoreDataset (AC-F08-1)', () => {
  const dataset: EvalDataset = {
    version: 'test@1.0.0',
    name: 'Synthetic set',
    description: 'Two cases: one answered, one skipped.',
    cases: [
      { ...testCase({ intent: 'billing' }), id: 'answered' },
      { ...testCase({ mustEscalate: true }), id: 'skipped' },
    ],
  };

  it('fails a case the run never answered', () => {
    const summary = scoreDataset(
      dataset,
      new Map([['answered', answer({ intent: 'billing' })]]),
    );

    expect(summary.status).toBe('FAILED');
    expect(summary.failed).toBe(1);
    expect(summary.results[1]).toMatchObject({
      caseId: 'skipped',
      passed: false,
      findings: ['run: the agent returned no answer for this case'],
    });
  });

  it('passes the dataset when every case is answered and satisfied', () => {
    const summary = scoreDataset(
      dataset,
      new Map([
        ['answered', answer({ intent: 'billing' })],
        ['skipped', answer({ escalated: true })],
      ]),
    );

    expect(summary.status).toBe('PASSED');
    expect(summary.passRate).toBe(1);
  });
});
