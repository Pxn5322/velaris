/**
 * Webhook ingestion and endpoint registration (T5.05; F-13; AC-F13-2, AC-F13-3).
 *
 * The duplicate-delivery test is the acceptance evidence for TH-08: the same
 * `deliveryId` twice with the same body performs one side effect, and the same
 * id with a different body is refused with 409 instead of overwriting history.
 */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  IntegrationsService,
  type WebhookSecretResolver,
} from './integrations.service.js';
import { computeSignature, hashPayload } from './webhook-signature.js';

const ENDPOINT_ROW = {
  id: 'endpoint-1',
  tenantId: 'tenant-a',
  provider: 'stripe',
  displayName: 'Billing',
  secretRef: 'WEBHOOK_SECRET_STRIPE_TEST',
  status: 'ACTIVE',
  createdAt: new Date('2026-11-01T09:00:00.000Z'),
};

const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });

function prismaFake() {
  return {
    integrationEndpoint: {
      findUnique: vi.fn().mockResolvedValue(ENDPOINT_ROW),
      create: vi
        .fn()
        .mockImplementation(async ({ data }: { data: object }) => ({
          ...ENDPOINT_ROW,
          ...data,
        })),
      findMany: vi.fn().mockResolvedValue([ENDPOINT_ROW]),
    },
    webhookDelivery: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(async ({ data }: { data: object }) => ({
          id: 'delivery-row-1',
          receivedAt: new Date('2026-11-03T10:00:00.000Z'),
          ...data,
        })),
    },
  };
}

function signed(secret = 'whsec_test') {
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  return { timestamp, signature: computeSignature(secret, timestamp, BODY) };
}

function build() {
  const prisma = prismaFake();
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const resolver: WebhookSecretResolver = {
    resolve: (ref) =>
      ref === ENDPOINT_ROW.secretRef ? 'whsec_test' : undefined,
  };
  const service = new IntegrationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    resolver,
  );
  return { service, prisma, audit, resolver };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IntegrationsService.receiveDelivery', () => {
  it('records one delivery and one audit row for a new event', async () => {
    const { service, prisma, audit } = build();

    const result = await service.receiveDelivery({
      provider: 'stripe',
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      rawBody: BODY,
      ...signed(),
    });

    expect(result).toMatchObject({
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      duplicate: false,
    });
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.received',
        tenantId: 'tenant-a',
        resourceType: 'webhook_endpoint',
        resourceId: 'endpoint-1',
      }),
    );
  });

  it('performs one side effect when the same delivery arrives twice (TH-08)', async () => {
    const { service, prisma, audit } = build();
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'delivery-row-1',
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      payloadHash: hashPayload(BODY),
      receivedAt: new Date('2026-11-03T10:00:00.000Z'),
    });

    const result = await service.receiveDelivery({
      provider: 'stripe',
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      rawBody: BODY,
      ...signed(),
    });

    // A resent event with the identical body is the same event.
    expect(result.duplicate).toBe(true);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses a reused delivery id with a different payload (AC-F13-2)', async () => {
    const { service, prisma, audit } = build();
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'delivery-row-1',
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      payloadHash: 'a-different-hash',
      receivedAt: new Date('2026-11-03T10:00:00.000Z'),
    });

    await expect(
      service.receiveDelivery({
        provider: 'stripe',
        endpointId: 'endpoint-1',
        deliveryId: 'evt_1',
        rawBody: BODY,
        ...signed(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate as a duplicate after the unique clash', async () => {
    const { service, prisma, audit } = build();
    prisma.webhookDelivery.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.webhookDelivery.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'delivery-row-1',
        deliveryId: 'evt_1',
        payloadHash: hashPayload(BODY),
        receivedAt: new Date('2026-11-03T10:00:00.000Z'),
      });

    const result = await service.receiveDelivery({
      provider: 'stripe',
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      rawBody: BODY,
      ...signed(),
    });

    expect(result.duplicate).toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('hides an unknown endpoint and a provider mismatch behind 404', async () => {
    const unknown = build();
    unknown.prisma.integrationEndpoint.findUnique.mockResolvedValue(null);
    await expect(
      unknown.service.receiveDelivery({
        provider: 'stripe',
        endpointId: 'endpoint-x',
        deliveryId: 'evt_1',
        rawBody: BODY,
        ...signed(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const mismatch = build();
    await expect(
      mismatch.service.receiveDelivery({
        provider: 'github',
        endpointId: 'endpoint-1',
        deliveryId: 'evt_1',
        rawBody: BODY,
        ...signed(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a paused endpoint even when the signature is valid', async () => {
    const { service, prisma, audit } = build();
    prisma.integrationEndpoint.findUnique.mockResolvedValue({
      ...ENDPOINT_ROW,
      status: 'PAUSED',
    });

    await expect(
      service.receiveDelivery({
        provider: 'stripe',
        endpointId: 'endpoint-1',
        deliveryId: 'evt_1',
        rawBody: BODY,
        ...signed(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a missing signing secret instead of accepting the delivery', async () => {
    const { service, prisma, audit } = build();
    prisma.integrationEndpoint.findUnique.mockResolvedValue({
      ...ENDPOINT_ROW,
      secretRef: 'WEBHOOK_SECRET_NOT_SET',
    });

    await expect(
      service.receiveDelivery({
        provider: 'stripe',
        endpointId: 'endpoint-1',
        deliveryId: 'evt_1',
        rawBody: BODY,
        ...signed(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService endpoints', () => {
  it('stores an environment variable name as the secret reference only', async () => {
    const { service, prisma } = build();

    const created = await service.registerEndpoint('tenant-a', {
      provider: 'stripe',
      displayName: 'Billing',
      secretRef: 'WEBHOOK_SECRET_STRIPE_TEST',
    });

    expect(created).toMatchObject({
      provider: 'stripe',
      secretRef: 'WEBHOOK_SECRET_STRIPE_TEST',
      status: 'ACTIVE',
    });
    const data = prisma.integrationEndpoint.create.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(
      ['displayName', 'provider', 'secretRef', 'tenantId'].sort(),
    );
  });

  it('rejects a secret reference that is not an environment variable name', async () => {
    const { service, prisma } = build();

    await expect(
      service.registerEndpoint('tenant-a', {
        provider: 'stripe',
        displayName: 'Billing',
        secretRef: 'not a name',
      }),
    ).rejects.toThrow(/secretRef/);
    expect(prisma.integrationEndpoint.create).not.toHaveBeenCalled();
  });
});
