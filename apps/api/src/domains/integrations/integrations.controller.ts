/**
 * Webhook delivery and endpoint registration (T5.05; API-16; F-13).
 *
 * Two kinds of route share this controller, so the guards sit on the methods:
 * - `POST /webhooks/{provider}/{endpointId}` is unauthenticated by design. The
 *   HMAC signature over the raw body authenticates the sender, and the
 *   endpoint row authenticates the tenant. It answers 200 for a new delivery
 *   and for a known duplicate, so a provider that retries never sees a failure
 *   for work already done.
 * - `GET` and `POST /integrations/endpoints` are tenant writes. They run the
 *   usual chain: SupabaseAuthGuard (401), PermissionsGuard with
 *   `integration.manage` (403), then the tenant scope check.
 *
 * Raw bytes are required for the signature, so `configureApp` installs a JSON
 * parser with a `verify` hook. A body above the webhook limit is refused with
 * 413 before any hashing.
 */

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import {
  IntegrationsService,
  type RegisterEndpointInput,
} from './integrations.service.js';
import {
  DELIVERY_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from './webhook-signature.js';

export const MAX_WEBHOOK_BYTES = 1024 * 1024;

type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  rawBody?: Buffer;
};

@Controller()
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly tenants: TenantsService,
  ) {}

  @Post('webhooks/:provider/:endpointId')
  @HttpCode(200)
  async deliver(
    @Param('provider') provider: string,
    @Param('endpointId') endpointId: string,
    @Headers(DELIVERY_HEADER) deliveryId: string | undefined,
    @Headers(TIMESTAMP_HEADER) timestamp: string | undefined,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException('A raw request body is required');
    }
    if (rawBody.length > MAX_WEBHOOK_BYTES) {
      throw new PayloadTooLargeException(
        `A webhook body must be at most ${MAX_WEBHOOK_BYTES} bytes`,
      );
    }
    return this.integrations.receiveDelivery({
      provider,
      endpointId,
      deliveryId,
      rawBody,
      timestamp,
      signature,
    });
  }

  @Get('integrations/endpoints')
  @UseGuards(SupabaseAuthGuard, PermissionsGuard)
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  async list(
    @Query('tenantId') tenantId: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.integrations.listEndpoints(tenantId as string);
  }

  @Post('integrations/endpoints')
  @UseGuards(SupabaseAuthGuard, PermissionsGuard)
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  async register(
    @Body() body: RegisterEndpointInput & { tenantId?: string },
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, body?.tenantId);
    const { tenantId, ...input } = body;
    return this.integrations.registerEndpoint(tenantId as string, input);
  }

  private async requireTenantScope(
    request: AuthedRequest,
    tenantId: string | undefined,
  ): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
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
