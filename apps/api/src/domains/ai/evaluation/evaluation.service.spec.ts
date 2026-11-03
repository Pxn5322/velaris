/**
 * T4.05 acceptance evidence: AC-F08-1 (a passing required suite is the
 * evidence a publish needs) and AC-F08-2 (a failed case is recorded with
 * actionable findings, never smoothed into a pass).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EvaluationService,
  type EvaluationSubject,
} from './evaluation.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const agentVersionId = '22222222-2222-4222-8222-222222222222';

const admin = { tenantId, userId: 'user-a', role: 'R-tenant-admin' };

/** Answers every case as the ideal agent would. */
function compliantSubject(): EvaluationSubject {
  return {
    answer: async ({ testCase }) => ({
      text: `reset help for ${testCase.id}`,
      intent: testCase.expectation.intent,
      citedSourceIds: testCase.expectation.requiresCitation
        ? ['doc-1']
        : undefined,
      escalated: testCase.expectation.mustEscalate,
      toolCalls: [],
    }),
  };
}

function harness(
  options: {
    version?: { id: string; configJson: unknown } | null;
    subject?: EvaluationSubject | null;
    onUpdate?: (data: Record<string, unknown>) => void;
  } = {},
) {
  const version =
    options.version === undefined
      ? { id: agentVersionId, configJson: { temperature: 0 } }
      : options.version;

  const findFirst = vi.fn().mockResolvedValue(version);
  const create = vi.fn().mockResolvedValue({ id: 'run-1' });
  const update = vi.fn(async (args: { data: Record<string, unknown> }) => {
    options.onUpdate?.(args.data);
    return args;
  });

  const prisma = {
    aiAgentVersion: { findFirst },
    evaluationRun: { create, update },
  };

  const subject =
    options.subject === undefined ? compliantSubject() : options.subject;

  const service = new EvaluationService(
    prisma as never,
    { assertPermission: vi.fn() } as never,
    subject ?? undefined,
  );

  return { service, findFirst, create, update };
}

const input = {
  agentVersionId,
  datasetVersion: 'support-triage@1.0.0',
  provider: 'local',
  model: 'deterministic',
  actor: admin,
};

describe('EvaluationService', () => {
  it('scores a compliant agent as PASSED and persists the summary', async () => {
    let stored: Record<string, unknown> = {};
    const { service, update } = harness({
      onUpdate: (data) => {
        stored = data;
      },
    });

    const result = await service.run(input);

    expect(result.status).toBe('PASSED');
    expect(result.summary).toMatchObject({
      total: 3,
      passed: 3,
      failed: 0,
      criticalFailed: 0,
      passRate: 1,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(stored.status).toBe('PASSED');
    expect(stored.failureReasonsJson).toEqual([]);
    expect(stored.completedAt).toBeInstanceOf(Date);
  });

  it('records a failed case with findings and a FAILED status', async () => {
    let stored: Record<string, unknown> = {};
    const failing: EvaluationSubject = {
      answer: async ({ testCase }) => ({
        text: 'here is the number',
        intent: testCase.expectation.intent,
        citedSourceIds: ['doc-1'],
        escalated: false,
        toolCalls: ['payment.read'],
      }),
    };
    const { service } = harness({
      subject: failing,
      onUpdate: (data) => {
        stored = data;
      },
    });

    const result = await service.run(input);

    expect(result.status).toBe('FAILED');
    expect(result.summary.criticalFailed).toBe(1);
    const failures = stored.failureReasonsJson as {
      caseId: string;
      severity: string;
      findings: string[];
    }[];
    const critical = failures.find(
      (f) => f.caseId === 'triage-unknown-account',
    );
    expect(critical?.severity).toBe('CRITICAL');
    expect(critical?.findings.join(' ')).toContain('payment.read');
    expect(critical?.findings.join(' ')).toContain('escalating');
  });

  it('fails a case the runner never answered instead of skipping it', async () => {
    let stored: Record<string, unknown> = {};
    const throwing: EvaluationSubject = {
      answer: async () => {
        throw new Error('provider exploded');
      },
    };
    const { service } = harness({
      subject: throwing,
      onUpdate: (data) => {
        stored = data;
      },
    });

    const result = await service.run(input);

    expect(result.status).toBe('FAILED');
    expect(result.summary.passed).toBe(0);
    const failures = stored.failureReasonsJson as { findings: string[] }[];
    expect(failures[0]?.findings.join(' ')).toContain('no answer');
    // The provider message must not leak into stored evidence.
    expect(JSON.stringify(stored)).not.toContain('provider exploded');
  });

  it('fails the case when the runner throws a non-Error value', async () => {
    const throwing: EvaluationSubject = {
      answer: async () => {
        throw 'runner offline';
      },
    };
    const { service } = harness({ subject: throwing });

    const result = await service.run(input);

    expect(result.status).toBe('FAILED');
    expect(result.summary.passed).toBe(0);
  });

  it('rejects an unknown dataset version', async () => {
    const { service } = harness();

    await expect(
      service.run({ ...input, datasetVersion: 'support-triage@0.0.1' }),
    ).rejects.toThrow(/Unknown evaluation dataset version/);
  });

  it('answers 503 when no runner is configured instead of faking a run', async () => {
    const { service } = harness({ subject: null });

    await expect(service.run(input)).rejects.toThrow(
      /Evaluation runner is not configured/,
    );
  });

  it('does not read a version from another tenant', async () => {
    const { service, create } = harness({ version: null });

    await expect(service.run(input)).rejects.toThrow(/Agent version not found/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a role without ai.agent.configure before any read', async () => {
    const findFirst = vi.fn();
    const authorization = {
      assertPermission: vi.fn(() => {
        throw new Error('Missing permission: ai.agent.configure');
      }),
    };
    const guarded = new EvaluationService(
      { aiAgentVersion: { findFirst } } as never,
      authorization as never,
      compliantSubject(),
    );

    await expect(
      guarded.run({ ...input, actor: { ...admin, role: 'R-agent' } }),
    ).rejects.toThrow(/ai.agent.configure/);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('scopes the run to the caller tenant', async () => {
    const { service, findFirst } = harness();

    await service.run(input);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: agentVersionId, tenantId },
      }),
    );
  });
});
