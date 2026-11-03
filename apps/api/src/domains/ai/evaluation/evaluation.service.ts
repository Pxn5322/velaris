/**
 * Versioned evaluation runs (T4.05; F-08; AC-F08-1, AC-F08-2).
 *
 * A run scores one immutable agent version against one immutable dataset
 * version with the deterministic scoring in `ai-evals`. The service stores
 * only what the publish gate later reads: the status, the score summary and
 * the per-case findings. No model judges a model, and a case the runner
 * never answered is a failure, not a pass.
 *
 * The agent under test arrives through the EVALUATION_SUBJECT port, so the
 * scoring path is testable without a provider and the graph task can wire
 * the real subject without touching this file.
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  getDataset,
  scoreDataset,
  type AgentAnswer,
  type EvalCase,
  type RunSummary,
} from 'ai-evals';
import { AuthorizationService } from '../../permissions/authorization.service.js';
import { PERMISSIONS } from '../../permissions/permission.codes.js';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../../infrastructure/prisma/prisma.service.js';

/** DI token for the agent under test. */
export const EVALUATION_SUBJECT = 'EVALUATION_SUBJECT';

/** Caller identity resolved by the server, never by the request body. */
export interface EvaluationActor {
  tenantId: string;
  userId: string;
  role: string | null;
}

/** The agent under test: answers one case from one version's configuration. */
export interface EvaluationSubject {
  answer(input: {
    config: unknown;
    agentVersionId: string;
    testCase: EvalCase;
  }): Promise<AgentAnswer>;
}

export interface RunEvaluationInput {
  agentVersionId: string;
  datasetVersion: string;
  provider: string;
  model: string;
  actor: EvaluationActor;
}

export interface EvaluationRunResult {
  runId: string;
  status: RunSummary['status'];
  summary: Omit<RunSummary, 'results'>;
}

/** One persisted failure, in the shape the publish gate reads. */
interface FailureReason {
  caseId: string;
  severity: string;
  findings: readonly string[];
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    @Optional()
    @Inject(EVALUATION_SUBJECT)
    private readonly subject?: EvaluationSubject,
  ) {}

  /**
   * Score one dataset version against one agent version and persist the
   * result. A caller needs `ai.agent.configure`: running an evaluation
   * changes the evidence a publish will rely on.
   */
  async run(input: RunEvaluationInput): Promise<EvaluationRunResult> {
    const { actor } = input;
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_CONFIGURE,
    );

    const dataset = getDataset(input.datasetVersion);
    if (!dataset) {
      throw new BadRequestException(
        `Unknown evaluation dataset version: ${input.datasetVersion}`,
      );
    }
    if (!this.subject) {
      throw new ServiceUnavailableException(
        'Evaluation runner is not configured for this deployment',
      );
    }
    const subject = this.subject;

    const version = await this.prisma.aiAgentVersion.findFirst({
      where: { id: input.agentVersionId, tenantId: actor.tenantId },
      select: { id: true, configJson: true },
    });
    if (!version) {
      throw new NotFoundException('Agent version not found');
    }

    const run = await this.prisma.evaluationRun.create({
      data: {
        tenantId: actor.tenantId,
        agentVersionId: version.id,
        datasetVersion: dataset.version,
        provider: input.provider,
        model: input.model,
        status: 'RUNNING',
      },
      select: { id: true },
    });

    const answers = new Map<string, AgentAnswer>();
    for (const testCase of dataset.cases) {
      try {
        answers.set(
          testCase.id,
          await subject.answer({
            config: version.configJson,
            agentVersionId: version.id,
            testCase,
          }),
        );
      } catch (error) {
        // A runner failure fails the case. The message stays out of the
        // stored findings because downstream errors can carry secrets
        // (SECURITY.md section 7).
        this.logger.error(
          `Evaluation case ${testCase.id} failed: ${
            error instanceof Error ? error.name : 'unknown error'
          }`,
        );
      }
    }

    const summary = scoreDataset(dataset, answers);
    const failures: FailureReason[] = summary.results
      .filter((result) => !result.passed)
      .map((result) => ({
        caseId: result.caseId,
        severity: result.severity,
        findings: result.findings,
      }));

    await this.prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        status: summary.status,
        aggregateJson: {
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          criticalFailed: summary.criticalFailed,
          passRate: summary.passRate,
          cases: summary.results.map((result) => ({
            caseId: result.caseId,
            severity: result.severity,
            passed: result.passed,
          })),
        },
        failureReasonsJson: failures as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return {
      runId: run.id,
      status: summary.status,
      summary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        criticalFailed: summary.criticalFailed,
        passRate: summary.passRate,
        status: summary.status,
      },
    };
  }
}
