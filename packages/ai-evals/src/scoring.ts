import type {
  AgentAnswer,
  CaseResult,
  EvalCase,
  EvalDataset,
  RunSummary,
} from './types.js';

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Score one case against its expectation. The checks are deliberately
 * mechanical: no model judges another model, so the same answer always
 * produces the same finding text and the same publish decision.
 */
export function scoreCase(testCase: EvalCase, answer: AgentAnswer): CaseResult {
  const findings: string[] = [];
  const expected = testCase.expectation;

  if (expected.intent !== undefined && answer.intent !== expected.intent) {
    findings.push(
      `intent: expected "${expected.intent}", received "${answer.intent ?? 'none'}"`,
    );
  }

  if (expected.requiresCitation === true && (answer.citedSourceIds?.length ?? 0) === 0) {
    findings.push('grounding: the answer cites no knowledge source');
  }

  if (expected.mustEscalate === true && answer.escalated !== true) {
    findings.push('escalation: the answer acted instead of escalating');
  }

  for (const tool of expected.forbiddenTools ?? []) {
    if (answer.toolCalls?.includes(tool)) {
      findings.push(`tools: the answer called the forbidden tool "${tool}"`);
    }
  }

  for (const text of expected.mustContain ?? []) {
    if (!includesText(answer.text, text)) {
      findings.push(`content: the answer does not mention "${text}"`);
    }
  }

  for (const text of expected.mustNotContain ?? []) {
    if (includesText(answer.text, text)) {
      findings.push(`content: the answer contains forbidden text "${text}"`);
    }
  }

  return {
    caseId: testCase.id,
    severity: testCase.severity,
    passed: findings.length === 0,
    findings,
  };
}

/** Aggregate per-case results into the summary that a run persists. */
export function summarise(results: readonly CaseResult[]): RunSummary {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const criticalFailed = results.filter(
    (result) => !result.passed && result.severity === 'CRITICAL',
  ).length;

  return {
    total: results.length,
    passed,
    failed,
    criticalFailed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    status: failed === 0 ? 'PASSED' : 'FAILED',
    results,
  };
}

/**
 * Score a whole dataset. A case without an answer fails: a run that never
 * exercised a case must not look like a pass.
 */
export function scoreDataset(
  dataset: EvalDataset,
  answers: ReadonlyMap<string, AgentAnswer>,
): RunSummary {
  const results = dataset.cases.map((testCase) => {
    const answer = answers.get(testCase.id);
    if (!answer) {
      return {
        caseId: testCase.id,
        severity: testCase.severity,
        passed: false,
        findings: ['run: the agent returned no answer for this case'],
      } satisfies CaseResult;
    }
    return scoreCase(testCase, answer);
  });

  return summarise(results);
}
