/**
 * Guarded AI run route (T5.06; F-09, F-11).
 *
 * The F-09 runtime had no caller, so a deployment answered no customer
 * message and wrote no `ai_traces` row: the traces view and the AI latency
 * KPI stayed empty. This route is that caller.
 *
 * - POST /ai/runs answers one customer message through the runtime.
 *
 * Guard chain: SupabaseAuthGuard answers 401 without a credential,
 * PermissionsGuard requires `ai.agent.configure` and resolves the role from
 * membership storage, and the tenant scope check refuses a tenant outside the
 * caller's memberships (AC-F04-3). The role reaches retrieval from the guard,
 * never from the body, so a client cannot widen its own knowledge access
 * (AC-F09-3).
 *
 * `ai.agent.configure` is deliberate: this route is the configuration-time
 * preview of an agent, which is also how it earns a grounded answer from real
 * knowledge. The customer-facing conversation route (API-13) arrives with the
 * conversation work; it needs its own scope decision (D-31).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import {
  PERMISSIONS,
  type CanonicalRole,
} from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AiRuntimeService } from './ai-runtime.service.js';
import { AiRunDto } from './dto/ai-run.dto.js';

type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  role?: CanonicalRole | null;
};

@Controller('ai/runs')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class AiRunController {
  constructor(
    private readonly runtime: AiRuntimeService,
    private readonly tenants: TenantsService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.AI_AGENT_CONFIGURE)
  async run(
    @Query('tenantId') tenantId: string,
    @Req() req: AuthedRequest,
    @Body() body: AiRunDto,
  ) {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }
    if (typeof body?.message !== 'string') {
      throw new BadRequestException('message must be a string');
    }
    if (
      body.requestHuman !== undefined &&
      typeof body.requestHuman !== 'boolean'
    ) {
      throw new BadRequestException('requestHuman must be a boolean');
    }

    const identity = req.user as AuthenticatedIdentity;
    const context = await this.tenants.resolveContext(
      identity.provider,
      identity.subject,
    );
    if (!context) {
      throw new ForbiddenException('No tenant context for this identity');
    }
    await this.tenants.requireTenantAccess(context.userId, tenantId);

    return this.runtime.handle({
      tenantId,
      role: req.role ?? null,
      message: body.message,
      requestHuman: body.requestHuman,
    });
  }
}
