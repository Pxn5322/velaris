/**
 * T4.05 acceptance evidence: AC-F08-1 (a clean gate publishes an immutable
 * active version), AC-F08-2 (a failed evaluation or invalid tool schema
 * blocks publication with actionable findings) and AC-F11-2 (a critical
 * evaluation regression makes the release check fail visibly).
 */

import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_DATASET_VERSIONS } from 'ai-evals';
import {
  AgentPublishService,
  type PublishFinding,
} from './agent-publish.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const agentId = '33333333-3333-4333-8333-333333333333';
const agentVersionId = '22222222-2222-4222-8222-222222222222';

const admin = { tenantId, userId: 'user-a', role: 'R-tenant-admin' };

/** A run record that passes, for every dataset the gate requires. */
const PASSING_RUNS: Record<
  string,
  { status: string; failureReasonsJson: unknown }
> = {
  'support-triage@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
  'safety-refusal@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
  'adversarial-injection@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
  'adversarial-boundary@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
};

const validSchema = {
  type: 'object',
  properties: { ticketId: { type: 'string' } },
  required: ['ticketId'],
  additionalProperties: false,
};

function harness(
  options: {
    version?: Record<string, unknown> | null;
    runs?: Record<
      string,
      { status: string; failureReasonsJson: unknown } | null
    >;
  } = {},
) {
  const version =
    options.version === undefined
      ? {
          id: agentVersionId,
          version: 2,
          status: 'DRAFT',
          agentId,
          toolGrants: [
            {
              tool: {
                name: 'ticket.update',
                inputSchemaJson: validSchema,
              },
            },
          ],
        }
      : options.version;

  // The adversarial sets are part of the suite since T4.07, so a scenario
  // must state the runs it supplies for all four versions.
  const runs = options.runs ?? PASSING_RUNS;

  const versionFindFirst = vi.fn().mockResolvedValue(version);
  const runFindFirst = vi.fn(
    async (args: { where: { datasetVersion: string } }) =>
      runs[args.where.datasetVersion] ?? null,
  );
  const versionUpdate = vi.fn().mockResolvedValue({});
  const agentUpdate = vi.fn().mockResolvedValue({});
  const transaction = vi.fn(async (ops: unknown[]) => ops);

  const prisma = {
    aiAgentVersion: { findFirst: versionFindFirst, update: versionUpdate },
    evaluationRun: { findFirst: runFindFirst },
    aiAgent: { update: agentUpdate },
    $transaction: transaction,
  };

  const authorization = {
    assertPermission: vi.fn((role: string | null, ...codes: string[]) => {
      const granted =
        role === 'R-enterprise-admin' || role === 'R-tenant-admin'
          ? ['ai.agent.publish', 'ai.agent.configure']
          : [];
      const missing = codes.filter((code) => !granted.includes(code));
      if (missing.length > 0) {
        throw new Error(`Missing permission: ${missing.join(', ')}`);
      }
    }),
  };

  const service = new AgentPublishService(
    prisma as never,
    authorization as never,
  );

  return {
    service,
    versionFindFirst,
    runFindFirst,
    versionUpdate,
    agentUpdate,
    transaction,
  };
}

/** Reads the findings array out of a rejected 422 response. */
async function findingsOf(
  promise: Promise<unknown>,
): Promise<PublishFinding[]> {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    const findings = (response as { findings?: PublishFinding[] })?.findings;
    if (!findings) throw error;
    return findings;
  }
  throw new Error('expected the gate to block publication');
}

describe('AgentPublishService', () => {
  it('publishes a version whose required suite passed', async () => {
    const { service, versionUpdate, agentUpdate, transaction } = harness();

    const result = await service.publish({ agentVersionId, actor: admin });

    expect(result).toMatchObject({ agentId, agentVersionId, version: 2 });
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(versionUpdate).toHaveBeenCalledWith({
      where: { id: agentVersionId },
      data: { status: 'PUBLISHED', publishedAt: result.publishedAt },
    });
    expect(agentUpdate).toHaveBeenCalledWith({
      where: { id: agentId },
      data: { activeVersionId: agentVersionId },
    });
  });

  it('blocks with one missing_evaluation finding per required dataset', async () => {
    const { service, versionUpdate, transaction } = harness({ runs: {} });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings).toHaveLength(REQUIRED_DATASET_VERSIONS.length);
    for (const version of REQUIRED_DATASET_VERSIONS) {
      expect(
        findings.some((finding) => finding.message.includes(version)),
      ).toBe(true);
    }
    expect(
      findings.every((finding) => finding.code === 'missing_evaluation'),
    ).toBe(true);
    expect(versionUpdate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('blocks a failed suite and names the critical regression', async () => {
    const { service, versionUpdate } = harness({
      runs: {
        'support-triage@1.0.0': {
          status: 'FAILED',
          failureReasonsJson: [
            {
              caseId: 'triage-unknown-account',
              severity: 'CRITICAL',
              findings: ['escalation: the answer acted instead of escalating'],
            },
            {
              caseId: 'triage-billing-question',
              severity: 'MEDIUM',
              findings: ['content: the answer does not mention "invoice"'],
            },
          ],
        },
        'safety-refusal@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
        'adversarial-injection@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
        'adversarial-boundary@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
      },
    });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'evaluation_failed',
      'critical_regression',
    ]);
    expect(findings[1]).toMatchObject({
      caseId: 'triage-unknown-account',
      datasetVersion: 'support-triage@1.0.0',
    });
    expect(findings[1]?.message).toContain('triage-unknown-account');
    expect(versionUpdate).not.toHaveBeenCalled();
  });

  it('reports a non-critical failure without inventing a regression', async () => {
    const { service } = harness({
      runs: {
        'support-triage@1.0.0': {
          status: 'FAILED',
          failureReasonsJson: [
            {
              caseId: 'triage-billing-question',
              severity: 'MEDIUM',
              findings: ['content: missing "invoice"'],
            },
          ],
        },
        'safety-refusal@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
        'adversarial-injection@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
        'adversarial-boundary@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
      },
    });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'evaluation_failed',
    ]);
  });

  it('treats unreadable stored failures as a plain evaluation failure', async () => {
    const { service } = harness({
      runs: {
        'support-triage@1.0.0': { status: 'FAILED', failureReasonsJson: null },
        'safety-refusal@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
        'adversarial-injection@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
        'adversarial-boundary@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
      },
    });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'evaluation_failed',
    ]);
  });

  it('names a critical regression that stored no case id', async () => {
    const { service } = harness({
      runs: {
        'support-triage@1.0.0': {
          status: 'FAILED',
          failureReasonsJson: [{ severity: 'CRITICAL', findings: [] }],
        },
        'safety-refusal@1.0.0': { status: 'PASSED', failureReasonsJson: [] },
        'adversarial-injection@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
        'adversarial-boundary@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
      },
    });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'evaluation_failed',
      'critical_regression',
    ]);
    expect(findings[1]?.message).toContain('unknown');
  });

  it('blocks a granted tool with a schema that cannot compile', async () => {
    const { service, versionUpdate } = harness({
      version: {
        id: agentVersionId,
        version: 3,
        status: 'DRAFT',
        agentId,
        toolGrants: [
          { tool: { name: 'ticket.update', inputSchemaJson: { type: 42 } } },
        ],
      },
    });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'invalid_tool_schema',
        toolName: 'ticket.update',
      }),
    ]);
    expect(findings[0]?.message).toContain('ticket.update');
    expect(versionUpdate).not.toHaveBeenCalled();
  });

  it('collects every blocking reason in one response', async () => {
    const { service } = harness({
      version: {
        id: agentVersionId,
        version: 4,
        status: 'DRAFT',
        agentId,
        toolGrants: [
          { tool: { name: 'refund.create', inputSchemaJson: 'nope' } },
        ],
      },
      runs: {
        'support-triage@1.0.0': {
          status: 'FAILED',
          failureReasonsJson: [
            {
              caseId: 'triage-unknown-account',
              severity: 'CRITICAL',
              findings: [],
            },
          ],
        },
        'adversarial-injection@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
        'adversarial-boundary@1.0.0': {
          status: 'PASSED',
          failureReasonsJson: [],
        },
      },
    });

    const findings = await findingsOf(
      service.publish({ agentVersionId, actor: admin }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'evaluation_failed',
      'critical_regression',
      'missing_evaluation',
      'invalid_tool_schema',
    ]);
  });

  it('refuses a version that is already published', async () => {
    const { service, versionUpdate } = harness({
      version: {
        id: agentVersionId,
        version: 1,
        status: 'PUBLISHED',
        agentId,
        toolGrants: [],
      },
    });

    await expect(
      service.publish({ agentVersionId, actor: admin }),
    ).rejects.toThrow(/already published/);
    expect(versionUpdate).not.toHaveBeenCalled();
  });

  it('refuses a role without ai.agent.publish before any read', async () => {
    const { service, versionFindFirst } = harness();

    await expect(
      service.publish({
        agentVersionId,
        actor: { ...admin, role: 'R-agent' },
      }),
    ).rejects.toThrow(/ai.agent.publish/);
    expect(versionFindFirst).not.toHaveBeenCalled();
  });

  it('does not publish a version from another tenant', async () => {
    const { service, transaction } = harness({ version: null });

    await expect(
      service.publish({ agentVersionId, actor: admin }),
    ).rejects.toThrow(/Agent version not found/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reads evidence for this version only', async () => {
    const { service, runFindFirst } = harness();

    await service.publish({ agentVersionId, actor: admin });

    expect(runFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId, agentVersionId }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});
