/**
 * Guarded conversation routes (T2.03, AC-F05-1/AC-F05-3, TH-05).
 *
 * API-13 (T6.05): a customer-authored message answers through the F-09
 * runtime, and the answer arrives as a SYSTEM message plus an `ai` summary in
 * the response. The runtime runs only for a customer author: an agent reply is
 * a human decision and must never be rewritten by the model.
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
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Logger } from '@nestjs/common';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CustomerScopeService } from '../customers/customer-scope.service.js';
import {
  AiRuntimeService,
  safeErrorDetail,
  type AiOutcome,
  type AiReason,
  type AiRuntimeResult,
} from '../ai/ai-runtime.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { ConversationsService } from './conversations.service.js';

/**
 * What the caller is told about the AI part of an API-13 message (F-09).
 * `reply` is the persisted answer; `handoff` says why a human is needed. No
 * escalation excerpt is returned here: the customer authored that content, and
 * the handoff context belongs to the agent who picks the conversation up.
 */
export interface AiReplySummary {
  outcome: AiOutcome;
  reason: AiReason;
  reply: { id: string; body: string; citationCount: number } | null;
  handoff: { reason: AiReason; retrievedCount: number } | null;
}

/** Express request with the identity and the guard-resolved role. */
type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  role?: CanonicalRole | null;
};

@Controller('conversations')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly scope: CustomerScopeService,
    private readonly ai: AiRuntimeService,
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
    // Per-customer scope (T2.04): an R-customer sees only their own rows.
    const scope = await this.resolveScope(request, tenantId);
    if (scope.kind === 'none') {
      return [];
    }
    const rows = await this.conversations.listConversations(tenantId);
    return scope.kind === 'customer'
      ? rows.filter((row) => row.customerId === scope.customerId)
      : rows;
  }

  @Get(':conversationId')
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findOne(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    const conversation = await this.conversations.findOne(
      conversationId,
      tenantId,
    );
    // Per-customer scope (T2.04): a foreign conversation reads as 404,
    // matching the tenant-scope miss, so existence never leaks.
    const scope = await this.resolveScope(request, tenantId);
    if (
      scope.kind === 'none' ||
      (scope.kind === 'customer' &&
        conversation.customerId !== scope.customerId)
    ) {
      throw new NotFoundException(
        'Conversation with ID ' + conversationId + ' not found',
      );
    }
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
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
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
  @RequirePermission(PERMISSIONS.MESSAGE_CREATE)
  async sendMessage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    await this.requireTenantScope(request, tenantId);

    // Per-customer scope (T2.04, defense in depth): today the TICKET_WRITE
    // guard already refuses R-customer here; the ownership check keeps a
    // future reply-right role from posting into a foreign conversation.
    const scope = await this.resolveScope(request, tenantId);
    const conversation = await this.conversations.findOne(
      conversationId,
      tenantId,
    );
    if (
      scope.kind === 'none' ||
      (scope.kind === 'customer' &&
        conversation.customerId !== scope.customerId)
    ) {
      throw new NotFoundException(
        'Conversation with ID ' + conversationId + ' not found',
      );
    }

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

    // API-13: only a customer message asks the runtime for an answer.
    if (authorType !== 'CUSTOMER') {
      return message;
    }
    return {
      ...message,
      ai: await this.answerAsCustomerMessage(
        tenantId,
        role,
        conversationId,
        message,
      ),
    };
  }

  /**
   * Answer one customer message through the F-09 runtime (API-13).
   *
   * The message is already stored, so a runtime fault must not turn a stored
   * message into an error: the caller gets a handoff instead. The reply is
   * stored as a SYSTEM message with an idempotency key derived from the
   * customer message, so a retry of the same request cannot post it twice.
   */
  private async answerAsCustomerMessage(
    tenantId: string,
    role: CanonicalRole | null,
    conversationId: string,
    message: { id: string; body: string },
  ): Promise<AiReplySummary> {
    let result: AiRuntimeResult;
    try {
      result = await this.ai.handle({
        tenantId,
        role,
        // The stored message body is the runtime input, so the answer
        // describes the text the customer can see in the timeline.
        message: message.body,
      });
    } catch (error) {
      this.logger.warn(
        `AI run failed for conversation ${conversationId}: ${safeErrorDetail(error)}`,
      );
      return {
        outcome: 'escalate',
        reason: 'provider_unavailable',
        reply: null,
        handoff: { reason: 'provider_unavailable', retrievedCount: 0 },
      };
    }

    if (result.outcome !== 'respond' || !result.text) {
      return {
        outcome: result.outcome,
        reason: result.reason,
        reply: null,
        handoff: result.escalation
          ? {
              reason: result.escalation.reason,
              retrievedCount: result.escalation.retrievedCount,
            }
          : { reason: result.reason, retrievedCount: 0 },
      };
    }

    const reply = await this.conversations.sendMessage(
      tenantId,
      conversationId,
      {
        body: result.text,
        authorType: 'SYSTEM',
        visibility: 'CUSTOMER_VISIBLE',
        idempotencyKey: 'ai-reply:' + message.id,
      },
    );
    return {
      outcome: result.outcome,
      reason: result.reason,
      reply: {
        id: reply.id,
        body: reply.body,
        citationCount: result.citations.length,
      },
      handoff: null,
    };
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

  /** Per-customer data scope from the guard-resolved role and identity. */
  private resolveScope(request: AuthedRequest, tenantId: string) {
    return this.scope.resolve(
      tenantId,
      request.role ?? null,
      request.user?.email,
    );
  }
}
