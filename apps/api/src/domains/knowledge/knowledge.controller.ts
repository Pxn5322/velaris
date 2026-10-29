/**
 * Guarded knowledge source routes (T3.02, API-08, API-09).
 *
 * Every route runs SupabaseAuthGuard first (401 without a credential),
 * then PermissionsGuard (403 without knowledge.manage, which only
 * R-tenant-admin holds), then a tenant scope check against the caller's
 * own memberships: tenantId is a required query parameter, and
 * TenantsService.requireTenantAccess refuses any tenant the caller has no
 * ACTIVE membership in (AC-F04-3). No tenant scope means no data.
 *
 * POST /knowledge-sources (API-08) validates the source reference and
 * records the source with PENDING status; GET /knowledge-sources/:id
 * (API-09) reports status, errors and provenance. Each successful create
 * or retry appends one audit event before it answers (AC-F11-1).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CreateKnowledgeSourceDto } from './dto/create-knowledge-source.dto.js';
import { INGESTION_QUEUE, type IngestionQueue } from './ingestion-queue.js';
import { KnowledgeService } from './knowledge.service.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('knowledge-sources')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    @Inject(INGESTION_QUEUE) private readonly queue: IngestionQueue,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.KNOWLEDGE_MANAGE)
  async create(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() createSourceDto: CreateKnowledgeSourceDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    const actorId = (request.user as AuthenticatedIdentity).subject;
    const { source, retried } = await this.knowledge.create(
      tenantId,
      createSourceDto,
      actorId,
    );
    await this.audit.record({
      action: retried ? 'knowledge.source_retried' : 'knowledge.source_created',
      resourceType: 'knowledge_source',
      resourceId: source.id,
      tenantId,
      actorId,
      metadata: { sourceType: source.sourceType, status: source.status },
    });
    // T3.03: every accepted source (new or retried) enters the ingestion
    // queue with the job metadata contract (ARCHITECTURE.md §4).
    this.queue.enqueue({
      schemaVersion: 1,
      jobId: randomUUID(),
      idempotencyKey: `ingest:${source.id}`,
      correlationId: randomUUID(),
      tenantId,
      sourceId: source.id,
      actorId,
      enqueuedAt: new Date().toISOString(),
    });
    return source;
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.KNOWLEDGE_MANAGE)
  async findOne(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.knowledge.findOne(id, tenantId);
  }

  /**
   * Deny by default: no tenant scope means no data. The scope must be a
   * tenant the caller holds an ACTIVE membership in; a guessed ID from
   * another tenant raises 403 through requireTenantAccess.
   */
  private async requireTenantScope(
    request: AuthedRequest,
    tenantId: string,
  ): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('tenantId query parameter is required');
    }
    const identity = request.user as AuthenticatedIdentity;
    const context = await this.tenants.resolveContext(
      identity.provider,
      identity.subject,
    );
    if (!context) {
      throw new ForbiddenException('No tenant context for this identity');
    }
    await this.tenants.requireTenantAccess(context.userId, tenantId);
  }
}
