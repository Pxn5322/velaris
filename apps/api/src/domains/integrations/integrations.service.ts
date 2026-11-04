/**
 * Webhook endpoints and idempotent delivery ingestion (T5.05; F-13).
 *
 * Design notes (D-30):
 * - The tenant comes from the endpoint row, never from the body. A sender
 *   cannot choose a tenant, and an unknown or paused endpoint is refused
 *   before a row is written.
 * - The signing secret never enters the database. The endpoint stores the
 *   name of an environment variable (`secretRef`), and the resolver reads the
 *   value at delivery time, so the audit trail and a database dump hold no
 *   secret material.
 * - One delivery performs one side effect. A repeat of the same
 *   `(endpointId, deliveryId)` with the same body returns `duplicate: true`
 *   and writes nothing; the same id with a different body is a 409, because
 *   silently overwriting history would hide a replay (TH-08, AC-F13-2).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPayload, verifyWebhookSignature } from './webhook-signature.js';

/** Environment variable names only; a value is never stored. */
const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_TEXT = 120;
const MAX_DELIVERY_ID = 128;

export interface WebhookSecretResolver {
  /** Read the secret named by `secretRef`; undefined when it is not set. */
  resolve(secretRef: string): string | undefined;
}

export const WEBHOOK_SECRET_RESOLVER = Symbol('WEBHOOK_SECRET_RESOLVER');

export const environmentSecretResolver: WebhookSecretResolver = {
  resolve: (secretRef) =>
    SECRET_REF_PATTERN.test(secretRef) ? process.env[secretRef] : undefined,
};

export interface WebhookEndpointView {
  id: string;
  tenantId: string;
  provider: string;
  displayName: string;
  secretRef: string;
  status: string;
  createdAt: string;
}

export interface RegisterEndpointInput {
  provider: string;
  displayName: string;
  secretRef: string;
}

export interface ReceiveDeliveryInput {
  provider: string;
  endpointId: string;
  deliveryId: string | undefined;
  rawBody: string | Buffer;
  timestamp: string | undefined;
  signature: string | undefined;
  nowSeconds?: number;
}

export interface DeliveryResult {
  endpointId: string;
  tenantId: string;
  provider: string;
  deliveryId: string;
  duplicate: boolean;
  receivedAt: string;
}

type EndpointRow = {
  id: string;
  tenantId: string;
  provider: string;
  displayName: string;
  secretRef: string;
  status: string;
  createdAt: Date;
};

function requireText(value: string | undefined, field: string, max = MAX_TEXT) {
  const text = (value ?? '').trim();
  if (text.length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  if (text.length > max) {
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  }
  return text;
}

function toView(row: EndpointRow): WebhookEndpointView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    displayName: row.displayName,
    secretRef: row.secretRef,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class IntegrationsService {
  private readonly secrets: WebhookSecretResolver;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(WEBHOOK_SECRET_RESOLVER)
    resolver?: WebhookSecretResolver,
  ) {
    this.secrets = resolver ?? environmentSecretResolver;
  }

  async registerEndpoint(
    tenantId: string,
    input: RegisterEndpointInput,
  ): Promise<WebhookEndpointView> {
    const provider = requireText(input.provider, 'provider', 40).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(provider)) {
      throw new BadRequestException(
        'provider must be a lowercase provider slug',
      );
    }
    const displayName = requireText(input.displayName, 'displayName');
    const secretRef = requireText(input.secretRef, 'secretRef', 64);
    if (!SECRET_REF_PATTERN.test(secretRef)) {
      throw new BadRequestException(
        'secretRef must name an environment variable, for example WEBHOOK_SECRET_STRIPE',
      );
    }

    const row = (await this.prisma.integrationEndpoint.create({
      data: { tenantId, provider, displayName, secretRef },
    })) as EndpointRow;
    return toView(row);
  }

  async listEndpoints(tenantId: string): Promise<WebhookEndpointView[]> {
    const rows = (await this.prisma.integrationEndpoint.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })) as EndpointRow[];
    return rows.map(toView);
  }

  /**
   * Verify a delivery and record it once. The endpoint decides the tenant;
   * the body decides nothing about scope.
   */
  async receiveDelivery(input: ReceiveDeliveryInput): Promise<DeliveryResult> {
    const endpoint = (await this.prisma.integrationEndpoint.findUnique({
      where: { id: input.endpointId },
    })) as EndpointRow | null;
    // An endpoint of another provider is reported as unknown, so a guessed id
    // does not confirm that an endpoint exists (AC-F13-3).
    if (!endpoint || endpoint.provider !== input.provider) {
      throw new NotFoundException('Unknown webhook endpoint');
    }

    const secret = this.secrets.resolve(endpoint.secretRef);
    if (!secret) {
      throw new ServiceUnavailableException(
        'The signing secret for this endpoint is not configured',
      );
    }

    const verdict = verifyWebhookSignature({
      secret,
      timestamp: input.timestamp,
      signature: input.signature,
      rawBody: input.rawBody,
      nowSeconds: input.nowSeconds,
    });
    if (verdict !== 'ok') {
      // One generic 401 for a missing, stale or wrong signature: the sender
      // learns that the delivery was refused, not which part to fix.
      throw new UnauthorizedException('Webhook signature verification failed');
    }

    const deliveryId = requireText(
      input.deliveryId,
      'x-velaris-delivery-id',
      MAX_DELIVERY_ID,
    );

    if (endpoint.status !== 'ACTIVE') {
      throw new ForbiddenException('Webhook endpoint is paused');
    }

    const payloadHash = hashPayload(input.rawBody);
    const existing = await this.prisma.webhookDelivery.findUnique({
      where: {
        endpointId_deliveryId: { endpointId: endpoint.id, deliveryId },
      },
    });
    if (existing) {
      return this.duplicateOrConflict(
        existing,
        payloadHash,
        endpoint,
        deliveryId,
      );
    }

    let row: { id: string; receivedAt: Date };
    try {
      row = (await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          tenantId: endpoint.tenantId,
          provider: endpoint.provider,
          deliveryId,
          payloadHash,
          status: 'PROCESSED',
        },
      })) as { id: string; receivedAt: Date };
    } catch (error) {
      // A concurrent retry can pass the read above and lose the insert race;
      // the unique constraint decides, and the loser re-reads the winner.
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.webhookDelivery.findUnique({
          where: {
            endpointId_deliveryId: { endpointId: endpoint.id, deliveryId },
          },
        });
        if (winner) {
          return this.duplicateOrConflict(
            winner,
            payloadHash,
            endpoint,
            deliveryId,
          );
        }
      }
      throw error;
    }

    await this.audit.record({
      action: 'webhook.received',
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      tenantId: endpoint.tenantId,
      metadata: {
        provider: endpoint.provider,
        deliveryId,
        payloadHash,
      },
    });

    return {
      endpointId: endpoint.id,
      tenantId: endpoint.tenantId,
      provider: endpoint.provider,
      deliveryId,
      duplicate: false,
      receivedAt: row.receivedAt.toISOString(),
    };
  }

  private duplicateOrConflict(
    existing: { payloadHash: string; receivedAt: Date },
    payloadHash: string,
    endpoint: EndpointRow,
    deliveryId: string,
  ): DeliveryResult {
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException(
        'This delivery id was already used with a different payload',
      );
    }
    return {
      endpointId: endpoint.id,
      tenantId: endpoint.tenantId,
      provider: endpoint.provider,
      deliveryId,
      duplicate: true,
      receivedAt: existing.receivedAt.toISOString(),
    };
  }
}
