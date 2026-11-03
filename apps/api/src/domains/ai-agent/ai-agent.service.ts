/**
 * Agent lifecycle service (T4.06, F-08, AC-F08-1..AC-F08-3).
 *
 * This service owns the draft/version/publish/rollback lifecycle over the
 * T4.02 tables. It replaces the earlier in-memory scaffold: that scaffold
 * was reachable without a credential and kept agents in process memory, so
 * two workers could disagree about a published version.
 *
 * Rules enforced here, not in the browser:
 * - the tenant comes from the caller's query and an ACTIVE membership is
 *   checked by the controller; every query is also tenant-scoped;
 * - configuration and evaluation require `ai.agent.configure`;
 * - publish and rollback require `ai.agent.publish` (the PRD names this
 *   capability `ai.agent.deploy`; D-22 records the naming decision);
 * - only a PUBLISHED version can become the active version through
 *   rollback, and a published row itself never changes (migration 0005);
 * - publishing goes through AgentPublishService, so a failed or missing
 *   evaluation blocks it with findings instead of trusting the request.
 *
 * Every successful mutation is audited by the controller (AC-F08-3).
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import { AgentPublishService } from '../ai/evaluation/agent-publish.service.js';
import { EvaluationService } from '../ai/evaluation/evaluation.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import type {
  AgentConfig,
  CreateAgentDto,
  RunAgentEvaluationDto,
} from './dto/agent-lifecycle.dto.js';

/** Caller identity resolved by the server, never by the request body. */
export interface AgentActor {
  tenantId: string;
  userId: string;
  role: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  activeVersionId: string | null;
  activeVersion: number | null;
  draftVersion: number | null;
  updatedAt: Date;
}

const NAME_LIMIT = 120;
const PROMPT_LIMIT = 8000;
const MODEL_LIMIT = 64;

@Injectable()
export class AiAgentService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly evaluations: EvaluationService,
    private readonly publishGate: AgentPublishService,
  ) {}

  /** Tenant agents newest first, with the active and latest version number. */
  async list(actor: AgentActor): Promise<AgentSummary[]> {
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_CONFIGURE,
    );
    const agents = await this.prisma.aiAgent.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { updatedAt: 'desc' },
      include: {
        activeVersion: { select: { version: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true },
        },
      },
    });
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      status: agent.status,
      activeVersionId: agent.activeVersionId,
      activeVersion: agent.activeVersion?.version ?? null,
      draftVersion: agent.versions[0]?.version ?? null,
      updatedAt: agent.updatedAt,
    }));
  }

  /** One agent with its versions, grants and recent evaluation evidence. */
  async detail(actor: AgentActor, agentId: string) {
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_CONFIGURE,
    );
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, tenantId: actor.tenantId },
      include: {
        activeVersion: { select: { id: true, version: true } },
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            configJson: true,
            createdAt: true,
            publishedAt: true,
            toolGrants: {
              select: {
                tool: {
                  select: {
                    id: true,
                    name: true,
                    riskLevel: true,
                    enabled: true,
                  },
                },
              },
            },
            evaluationRuns: {
              orderBy: { createdAt: 'desc' },
              take: 3,
              select: {
                id: true,
                datasetVersion: true,
                status: true,
                aggregateJson: true,
                failureReasonsJson: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
    });
    if (!agent) {
      throw new NotFoundException('AI agent not found');
    }
    return agent;
  }

  /** Create an agent and its first DRAFT version in one transaction. */
  async create(
    actor: AgentActor,
    ownerMembershipId: string,
    body: CreateAgentDto,
  ) {
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_CONFIGURE,
    );
    const name = this.requireText(body?.name, 'name', NAME_LIMIT);
    const config = this.requireConfig(body?.config);
    const description = this.optionalText(body?.description, 500);

    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.aiAgent.create({
        data: {
          tenantId: actor.tenantId,
          name,
          description,
          ownerMembershipId,
          status: 'DRAFT',
        },
      });
      const version = await tx.aiAgentVersion.create({
        data: {
          tenantId: actor.tenantId,
          agentId: agent.id,
          version: 1,
          configJson: config as unknown as Prisma.InputJsonValue,
          createdBy: actor.userId,
          status: 'DRAFT',
        },
      });
      return {
        agentId: agent.id,
        versionId: version.id,
        version: version.version,
      };
    });
  }

  /** Append a new DRAFT version; earlier versions are never rewritten. */
  async createVersion(
    actor: AgentActor,
    agentId: string,
    body: { config?: unknown },
  ) {
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_CONFIGURE,
    );
    const config = this.requireConfig(body?.config);
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, tenantId: actor.tenantId },
      select: { id: true },
    });
    if (!agent) {
      throw new NotFoundException('AI agent not found');
    }
    const latest = await this.prisma.aiAgentVersion.aggregate({
      where: { agentId: agent.id, tenantId: actor.tenantId },
      _max: { version: true },
    });
    const version = await this.prisma.aiAgentVersion.create({
      data: {
        tenantId: actor.tenantId,
        agentId: agent.id,
        version: (latest._max.version ?? 0) + 1,
        configJson: config as unknown as Prisma.InputJsonValue,
        createdBy: actor.userId,
        status: 'DRAFT',
      },
    });
    return {
      agentId: agent.id,
      versionId: version.id,
      version: version.version,
    };
  }

  /** Score one draft version against one immutable dataset version. */
  async evaluate(
    actor: AgentActor,
    agentId: string,
    versionId: string,
    body: RunAgentEvaluationDto,
  ) {
    await this.requireVersion(actor, agentId, versionId);
    const datasetVersion = this.requireText(
      body?.datasetVersion,
      'datasetVersion',
      120,
    );
    const provider = this.requireText(body?.provider, 'provider', MODEL_LIMIT);
    const model = this.requireText(body?.model, 'model', MODEL_LIMIT);
    return this.evaluations.run({
      agentVersionId: versionId,
      datasetVersion,
      provider,
      model,
      actor: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        role: actor.role,
      },
    });
  }

  /**
   * Publish through the gate. The gate throws 422 with every finding when
   * the evidence is missing or failing (AC-F08-2), so this method never
   * decides on its own that a version is releasable.
   */
  async publish(actor: AgentActor, agentId: string, versionId: string) {
    await this.requireVersion(actor, agentId, versionId);
    return this.publishGate.publish({
      agentVersionId: versionId,
      actor: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        role: actor.role,
      },
    });
  }

  /**
   * Point the agent back at an earlier PUBLISHED version. The version rows
   * are immutable, so a rollback changes only which one is active.
   */
  async rollback(actor: AgentActor, agentId: string, versionId: string) {
    this.authorization.assertPermission(
      actor.role,
      PERMISSIONS.AI_AGENT_PUBLISH,
    );
    if (!versionId) {
      throw new BadRequestException('versionId is required');
    }
    const version = await this.prisma.aiAgentVersion.findFirst({
      where: { id: versionId, agentId, tenantId: actor.tenantId },
      select: { id: true, version: true, status: true },
    });
    if (!version) {
      throw new NotFoundException('Agent version not found');
    }
    if (version.status !== 'PUBLISHED') {
      throw new BadRequestException(
        'Only a published version can become active',
      );
    }
    await this.prisma.aiAgent.update({
      where: { id: agentId },
      data: { activeVersionId: version.id },
    });
    return {
      agentId,
      activeVersionId: version.id,
      activeVersion: version.version,
    };
  }

  /** Tenant-scoped lookup that proves the version belongs to the agent. */
  private async requireVersion(
    actor: AgentActor,
    agentId: string,
    versionId: string,
  ) {
    const version = await this.prisma.aiAgentVersion.findFirst({
      where: { id: versionId, agentId, tenantId: actor.tenantId },
      select: { id: true },
    });
    if (!version) {
      throw new NotFoundException('Agent version not found');
    }
    return version;
  }

  private requireText(value: unknown, field: string, limit: number): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }
    const text = value.trim();
    if (text.length > limit) {
      throw new BadRequestException(`${field} is too long`);
    }
    return text;
  }

  private optionalText(value: unknown, limit: number): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
      throw new BadRequestException('description must be a string');
    }
    const text = value.trim();
    if (text.length > limit) {
      throw new BadRequestException('description is too long');
    }
    return text;
  }

  /**
   * A draft configuration must carry a prompt and a model. The temperature
   * default matches the studio control; tools are optional names that the
   * publish gate later resolves against registered definitions.
   */
  private requireConfig(value: unknown): AgentConfig {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('config is required');
    }
    const raw = value as Record<string, unknown>;
    const systemPrompt = this.requireText(
      raw.systemPrompt,
      'config.systemPrompt',
      PROMPT_LIMIT,
    );
    const model = this.requireText(raw.model, 'config.model', MODEL_LIMIT);
    const config: AgentConfig = { systemPrompt, model };
    if (raw.temperature !== undefined) {
      if (
        typeof raw.temperature !== 'number' ||
        !Number.isFinite(raw.temperature) ||
        raw.temperature < 0 ||
        raw.temperature > 2
      ) {
        throw new BadRequestException(
          'config.temperature must be between 0 and 2',
        );
      }
      config.temperature = raw.temperature;
    }
    if (raw.tools !== undefined) {
      if (
        !Array.isArray(raw.tools) ||
        raw.tools.some((tool) => typeof tool !== 'string' || !tool.trim())
      ) {
        throw new BadRequestException('config.tools must be tool names');
      }
      config.tools = (raw.tools as string[]).map((tool) => tool.trim());
    }
    return config;
  }
}
