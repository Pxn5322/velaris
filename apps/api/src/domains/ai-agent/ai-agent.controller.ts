/**
 * Guarded agent lifecycle routes (T4.06, API-10..API-12).
 *
 * Replaces the earlier unauthenticated scaffold: every route now runs
 * SupabaseAuthGuard, then PermissionsGuard with an explicit permission,
 * then a tenant scope check against the caller's own membership. The role
 * used for the service call is the one the guard resolved from
 * membership_roles, never a client claim.
 *
 * - POST   /ai/agents                                create agent + v1 draft
 * - GET    /ai/agents                                tenant agent list
 * - GET    /ai/agents/:agentId                       agent, versions, evidence
 * - POST   /ai/agents/:agentId/versions              append draft version
 * - POST   /ai/agents/:agentId/versions/:id/evaluations  run one dataset
 * - POST   /ai/agents/:agentId/versions/:id/publish      publish through gate
 * - POST   /ai/agents/:agentId/rollback                  activate a version
 *
 * Each successful mutation writes one audit event (AC-F08-3); a denial is
 * audited as `permission.denied` by PermissionsGuard.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AiAgentService, type AgentActor } from './ai-agent.service.js';
import {
  CreateAgentDto,
  CreateAgentVersionDto,
  RollbackAgentDto,
  RunAgentEvaluationDto,
} from './dto/agent-lifecycle.dto.js';

/** Express request carrying the identity and guard-resolved role. */
type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  role?: string | null;
};

@Controller('ai/agents')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class AiAgentController {
  constructor(
    private readonly agents: AiAgentService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.AI_AGENT_CONFIGURE)
  async list(@Query('tenantId') tenantId: string, @Req() req: AuthedRequest) {
    const actor = await this.resolveActor(req, tenantId);
    return this.agents.list(actor);
  }

  @Get(':agentId')
  @RequirePermission(PERMISSIONS.AI_AGENT_CONFIGURE)
  async detail(
    @Query('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req: AuthedRequest,
  ) {
    const actor = await this.resolveActor(req, tenantId);
    return this.agents.detail(actor, agentId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.AI_AGENT_CONFIGURE)
  async create(
    @Query('tenantId') tenantId: string,
    @Req() req: AuthedRequest,
    @Body() body: CreateAgentDto,
  ) {
    const actor = await this.resolveActor(req, tenantId);
    const created = await this.agents.create(actor, actor.membershipId, body);
    await this.audit.record({
      action: 'ai.agent.created',
      resourceType: 'ai_agent',
      resourceId: created.agentId,
      tenantId: actor.tenantId,
      actorId: actor.userId,
      metadata: { versionId: created.versionId, version: created.version },
    });
    return created;
  }

  @Post(':agentId/versions')
  @RequirePermission(PERMISSIONS.AI_AGENT_CONFIGURE)
  async createVersion(
    @Query('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req: AuthedRequest,
    @Body() body: CreateAgentVersionDto,
  ) {
    const actor = await this.resolveActor(req, tenantId);
    const created = await this.agents.createVersion(actor, agentId, body);
    await this.audit.record({
      action: 'ai.agent.version_created',
      resourceType: 'ai_agent_version',
      resourceId: created.versionId,
      tenantId: actor.tenantId,
      actorId: actor.userId,
      metadata: { agentId: created.agentId, version: created.version },
    });
    return created;
  }

  @Post(':agentId/versions/:versionId/evaluations')
  @RequirePermission(PERMISSIONS.AI_AGENT_CONFIGURE)
  async evaluate(
    @Query('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() req: AuthedRequest,
    @Body() body: RunAgentEvaluationDto,
  ) {
    const actor = await this.resolveActor(req, tenantId);
    const run = await this.agents.evaluate(actor, agentId, versionId, body);
    await this.audit.record({
      action: 'ai.agent.evaluated',
      resourceType: 'evaluation_run',
      resourceId: run.runId,
      tenantId: actor.tenantId,
      actorId: actor.userId,
      metadata: {
        agentId,
        versionId,
        datasetVersion: body.datasetVersion,
        status: run.status,
      },
    });
    return run;
  }

  @Post(':agentId/versions/:versionId/publish')
  @RequirePermission(PERMISSIONS.AI_AGENT_PUBLISH)
  async publish(
    @Query('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() req: AuthedRequest,
  ) {
    const actor = await this.resolveActor(req, tenantId);
    const published = await this.agents.publish(actor, agentId, versionId);
    await this.audit.record({
      action: 'ai.agent.published',
      resourceType: 'ai_agent_version',
      resourceId: versionId,
      tenantId: actor.tenantId,
      actorId: actor.userId,
      metadata: { agentId, version: published.version },
    });
    return published;
  }

  @Post(':agentId/rollback')
  @RequirePermission(PERMISSIONS.AI_AGENT_PUBLISH)
  async rollback(
    @Query('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req: AuthedRequest,
    @Body() body: RollbackAgentDto,
  ) {
    const actor = await this.resolveActor(req, tenantId);
    const rolledBack = await this.agents.rollback(
      actor,
      agentId,
      body?.versionId,
    );
    await this.audit.record({
      action: 'ai.agent.rolled_back',
      resourceType: 'ai_agent',
      resourceId: agentId,
      tenantId: actor.tenantId,
      actorId: actor.userId,
      metadata: {
        activeVersionId: rolledBack.activeVersionId,
        activeVersion: rolledBack.activeVersion,
      },
    });
    return rolledBack;
  }

  /**
   * Resolve the actor from server state: identity subject from the guard,
   * role from the guard's membership lookup, and membershipId from the
   * tenant scope check. A tenant the caller does not belong to is refused
   * before any agent read (AC-F04-3).
   */
  private async resolveActor(
    req: AuthedRequest,
    tenantId: string,
  ): Promise<AgentActor & { membershipId: string }> {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }
    const user = req.user as AuthenticatedIdentity | undefined;
    const membership = await this.tenants.requireTenantAccess(
      user?.subject ?? '',
      tenantId,
    );
    return {
      tenantId,
      userId: user?.subject ?? '',
      role: req.role ?? null,
      membershipId: membership.membershipId,
    };
  }
}
