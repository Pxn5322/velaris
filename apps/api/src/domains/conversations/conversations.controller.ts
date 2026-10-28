/**
 * Guarded conversation routes (T2.03, AC-F05-1/AC-F05-3, TH-05).
 *
 * Guard chain: SupabaseAuthGuard, then PermissionsGuard, then the same
 * tenant scope check the tickets controller uses. The visibility
 * boundary is decided here, server-side, never in the client:
 * - the timeline includes INTERNAL rows only when the caller's resolved
 *   role holds note.internal.read (TH-05)
 * - an INTERNAL note body requires note.internal.write (TH-05); the
 *   policy invariant in conversations.controller.spec.ts pins that
 *   every ticket.write role holds it, so real roles never hit that
 *   refusal by accident
 * - authorType CUSTOMER is derived from the caller's role, never from
 *   the request body
 *
 * Each successful change appends one audit event (T1.04 pattern).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { ConversationsService } from './conversations.service.js';

/** Express request with the identity and the guard-resolved role. */
type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  role?: CanonicalRole | null;
};

@Controller('conversations')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async create(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() createConversationDto: CreateConversationDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    const conversation = await this.conversations.createConversation(
      tenantId,
      createConversationDto.customerId,
      createConversationDto.channel,
    );
    await this.audit.record({
      action: 'conversation.created',
      resourceType: 'conversation',
      resourceId: conversation.id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { channel: conversation.channel },
    });
    return conversation;
  }

  @Get()
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findAll(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.conversations.listConversations(tenantId);
  }

  @Get(':conversationId')
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findOne(
    @Param('conversationId') conversationId: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    const conversation = await this.conversations.findOne(
      conversationId,
      tenantId,
    );
    // TH-05: the role decides serialization, inside this response only.
    const includeInternal = this.authorization
      .permissionsFor(request.role)
      .includes(PERMISSIONS.NOTE_INTERNAL_READ);
    const messages = await this.conversations.getTimeline(
      conversationId,
      tenantId,
      includeInternal,
    );
    return { ...conversation, messages };
  }

  @Patch(':conversationId')
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async updateStatus(
    @Param('conversationId') conversationId: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() updateConversationDto: UpdateConversationDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    const updated = await this.conversations.updateStatus(
      conversationId,
      tenantId,
      updateConversationDto,
    );
    await this.audit.record({
      action: 'conversation.updated',
      resourceType: 'conversation',
      resourceId: conversationId,
      tenantId,
      actorId: request.user?.subject,
      metadata: { status: updated.status },
    });
    return updated;
  }

  @Post(':conversationId/messages')
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    await this.requireTenantScope(request, tenantId);

    const role = request.role ?? null;
    // TH-05 second boundary: an INTERNAL note needs note.internal.write.
    if (sendMessageDto.visibility === 'INTERNAL') {
      this.authorization.assertPermission(
        role,
        PERMISSIONS.NOTE_INTERNAL_WRITE,
      );
    }
    // authorType follows the caller's role, never a client-supplied value.
    const authorType = role === 'R-customer' ? 'CUSTOMER' : 'AGENT';

    const message = await this.conversations.sendMessage(
      tenantId,
      conversationId,
      {
        body: sendMessageDto.body,
        authorType,
        visibility: sendMessageDto.visibility,
        idempotencyKey: sendMessageDto.idempotencyKey,
      },
    );
    await this.audit.record({
      action: 'message.created',
      resourceType: 'message',
      resourceId: message.id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { conversationId, visibility: message.visibility },
    });
    return message;
  }

  /**
   * Deny by default: no tenant scope means no data. The scope must be a
   * tenant the caller holds an ACTIVE membership in (AC-F04-3).
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
