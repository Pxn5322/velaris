/**
 * AI Governance model gateway routes.
 *
 * Every route requires TENANT_MANAGE_PLATFORM, so only the platform
 * administrator can change which providers and models serve the platform.
 * Each successful write appends one audit event; reads do not.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { AiProvidersService } from './ai-providers.service.js';
import {
  CreateModelProviderDto,
  UpdateModelProviderDto,
} from './dto/governance.dto.js';

type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('ai-governance/providers')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class AiProvidersController {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  list() {
    return this.providers.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  async create(
    @Req() request: AuthedRequest,
    @Body() input: CreateModelProviderDto,
  ) {
    const provider = await this.providers.create(input);
    await this.audit.record({
      action: 'ai_provider.created',
      resourceType: 'ai_model_provider',
      resourceId: provider.id,
      actorId: request.user?.subject,
      metadata: {
        provider: provider.provider,
        model: provider.model,
        isDefault: provider.isDefault,
      },
    });
    return provider;
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthedRequest,
    @Body() input: UpdateModelProviderDto,
  ) {
    const provider = await this.providers.update(id, input);
    await this.audit.record({
      action: 'ai_provider.updated',
      resourceType: 'ai_model_provider',
      resourceId: provider.id,
      actorId: request.user?.subject,
      metadata: {
        provider: provider.provider,
        model: provider.model,
        isDefault: provider.isDefault,
        status: provider.status,
      },
    });
    return provider;
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthedRequest,
  ) {
    const result = await this.providers.remove(id);
    await this.audit.record({
      action: 'ai_provider.deleted',
      resourceType: 'ai_model_provider',
      resourceId: id,
      actorId: request.user?.subject,
    });
    return result;
  }
}
