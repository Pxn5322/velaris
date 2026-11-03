/**
 * Publish gate (T4.05; F-08, F-11; AC-F08-1, AC-F08-2, AC-F11-2).
 *
 * Publication is a decision, not a status write. The gate collects every
 * reason a draft cannot go live, then refuses with the whole list, so the
 * person fixing the agent sees all findings in one response:
 *
 * - required evidence: each dataset in the required suite needs a recorded
 *   run for THIS version (a run for another version is not evidence)
 * - pass requirement: every required run must be PASSED (AC-F08-1)
 * - critical regression: a failed CRITICAL case blocks even when the
 *   overall score looks acceptable (AC-F11-2)
 * - tool schema: every granted tool must have a compilable input schema,
 *   because a broken schema would fail only at run time (AC-F08-2)
 *
 * A clean gate is the only path that writes: the version becomes PUBLISHED
 * with its timestamp and the agent points at it as the active version, in
 * one transaction. Published rows are immutable in the database itself
 * (migration 0005 trigger), so a second publish cannot rewrite history.
 */

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Ajv } from 'ajv';
import { REQUIRED_DATASET_VERSIONS } from 'ai-evals';
import { AuthorizationService } from '../../permissions/authorization.service.js';
import { PERMISSIONS } from '../../permissions/permission.codes.js';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../../infrastructure/prisma/prisma.service.js';

/** One blocking reason, shaped for a UI to render as an actionable finding. */
export interface PublishFinding {
  code:
    | 'missing_evaluation'
    | 'evaluation_failed'
    | 'critical_regression'
    | 'invalid_tool_schema';
  datasetVersion?: string;
  toolName?: string;
  caseId?: string;
  message: string;
}

export interface PublishActor {
  tenantId: string;
  userId: string;
  role: string | null;
}

export interface PublishResult {
  agentId: string;
  agentVersionId: string;
  version: number;
  publishedAt: Date;
}

/** A stored failure reason, as EvaluationService writes it. */
interface StoredFailure {
  caseId?: string;
  severity?: string;
}

const schemaValidator = new Ajv({ strict: false, allErrors: true });

@Injectable()
export class AgentPublishService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Publish one draft version. Throws 422 with `findings` when the gate
   * fails, so the caller can show every reason at once (AC-F08-2).
   */
  async publish(input: {
    agentVersionId: string;
    actor: PublishActor;
  }): Promise<PublishResult> {
    const { actor } = input;
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_PUBLISH,
    );

    const version = await this.prisma.aiAgentVersion.findFirst({
      where: { id: input.agentVersionId, tenantId: actor.tenantId },
      select: {
        id: true,
        version: true,
        status: true,
        agentId: true,
        toolGrants: {
          select: { tool: { select: { name: true, inputSchemaJson: true } } },
        },
      },
    });
    if (!version) {
      throw new NotFoundException('Agent version not found');
    }
    if (version.status === 'PUBLISHED') {
      throw new ConflictException('Agent version is already published');
    }

    const findings: PublishFinding[] = [
      ...(await this.evaluationFindings(actor.tenantId, version.id)),
      ...this.toolSchemaFindings(version.toolGrants),
    ];
    if (findings.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Publication is blocked by failed release checks',
        findings,
      });
    }

    const publishedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.aiAgentVersion.update({
        where: { id: version.id },
        data: { status: 'PUBLISHED', publishedAt },
      }),
      this.prisma.aiAgent.update({
        where: { id: version.agentId },
        data: { activeVersionId: version.id },
      }),
    ]);

    return {
      agentId: version.agentId,
      agentVersionId: version.id,
      version: version.version,
      publishedAt,
    };
  }

  /** Required-suite evidence for exactly this version. */
  private async evaluationFindings(
    tenantId: string,
    agentVersionId: string,
  ): Promise<PublishFinding[]> {
    const findings: PublishFinding[] = [];

    for (const datasetVersion of REQUIRED_DATASET_VERSIONS) {
      const run = await this.prisma.evaluationRun.findFirst({
        where: { tenantId, agentVersionId, datasetVersion },
        orderBy: { createdAt: 'desc' },
        select: { status: true, failureReasonsJson: true },
      });

      if (!run) {
        findings.push({
          code: 'missing_evaluation',
          datasetVersion,
          message: `No evaluation run is recorded for dataset ${datasetVersion}.`,
        });
        continue;
      }

      if (run.status !== 'PASSED') {
        findings.push({
          code: 'evaluation_failed',
          datasetVersion,
          message: `The latest run of ${datasetVersion} did not pass.`,
        });

        const failures = Array.isArray(run.failureReasonsJson)
          ? (run.failureReasonsJson as StoredFailure[])
          : [];
        for (const failure of failures) {
          if (failure.severity !== 'CRITICAL') continue;
          findings.push({
            code: 'critical_regression',
            datasetVersion,
            caseId: failure.caseId,
            message: `Critical case ${failure.caseId ?? 'unknown'} regressed in ${datasetVersion}.`,
          });
        }
      }
    }

    return findings;
  }

  /** A schema that does not compile would fail only when the tool runs. */
  private toolSchemaFindings(
    grants: readonly {
      tool: { name: string; inputSchemaJson: unknown };
    }[],
  ): PublishFinding[] {
    const findings: PublishFinding[] = [];

    for (const grant of grants) {
      try {
        schemaValidator.compile(
          grant.tool.inputSchemaJson as Parameters<
            typeof schemaValidator.compile
          >[0],
        );
      } catch {
        findings.push({
          code: 'invalid_tool_schema',
          toolName: grant.tool.name,
          message: `Tool "${grant.tool.name}" has an unusable input schema.`,
        });
      }
    }

    return findings;
  }
}
