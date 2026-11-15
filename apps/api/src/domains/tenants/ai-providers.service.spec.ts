/**
 * AI Governance provider CRUD (platform AI model gateway).
 * The Prisma client is an in-memory fake; no database or network is used.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AiProvidersService } from './ai-providers.service.js';

type ProviderRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKeyRef: string;
  isDefault: boolean;
  status: 'ACTIVE' | 'PAUSED';
  createdAt: Date;
  updatedAt: Date;
};

function fakePrisma() {
  const store: ProviderRow[] = [];
  let counter = 0;
  const api = {
    findMany: vi.fn(async () => [...store]),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        store.find((row) => row.id === where.id) ?? null,
    ),
    updateMany: vi.fn(async ({ where }: { where: { isDefault?: boolean } }) => {
      const rows = store.filter(
        (row) =>
          where.isDefault === undefined || row.isDefault === where.isDefault,
      );
      for (const row of rows) row.isDefault = false;
      return { count: rows.length };
    }),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<ProviderRow, 'id' | 'createdAt' | 'updatedAt'>;
      }) => {
        const row: ProviderRow = {
          ...data,
          id: `provider-${++counter}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.push(row);
        return row;
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<ProviderRow>;
      }) => {
        const row = store.find((item) => item.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = store.findIndex((row) => row.id === where.id);
      return store.splice(index, 1)[0];
    }),
  };
  return {
    aiModelProvider: api,
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({ aiModelProvider: api }),
    ),
    _store: store,
  };
}

describe('AiProvidersService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: AiProvidersService;

  beforeEach(() => {
    prisma = fakePrisma();
    service = new AiProvidersService(prisma as unknown as PrismaService);
  });

  it('creates a normalized provider and makes it the only default', async () => {
    await service.create({
      name: 'OpenAI primary',
      provider: 'OpenAI',
      model: 'gpt-4o',
      apiKeyRef: 'OPENAI_API_KEY',
      isDefault: true,
    });
    const second = await service.create({
      name: 'OpenAI backup',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKeyRef: 'OPENAI_BACKUP_KEY',
      isDefault: true,
    });

    expect(second.provider).toBe('openai');
    expect(prisma._store.filter((row) => row.isDefault)).toHaveLength(1);
    expect(prisma._store.find((row) => row.id === second.id)?.isDefault).toBe(
      true,
    );
  });

  it('rejects an invalid environment-variable reference or URL', async () => {
    await expect(
      service.create({
        name: 'Bad key',
        provider: 'openai',
        model: 'gpt-4o',
        apiKeyRef: 'sk-secret-value',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        name: 'Bad URL',
        provider: 'openai',
        model: 'gpt-4o',
        apiKeyRef: 'OPENAI_API_KEY',
        baseUrl: 'ftp://example.test',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates fields and switches the default atomically', async () => {
    const first = await service.create({
      name: 'Primary',
      provider: 'openai',
      model: 'gpt-4o',
      apiKeyRef: 'OPENAI_API_KEY',
      isDefault: true,
    });
    const second = await service.create({
      name: 'Backup',
      provider: 'anthropic',
      model: 'claude-sonnet',
      apiKeyRef: 'ANTHROPIC_API_KEY',
    });

    const updated = await service.update(second.id, {
      model: 'claude-opus',
      isDefault: true,
    });

    expect(updated.model).toBe('claude-opus');
    expect(updated.isDefault).toBe(true);
    expect(prisma._store.find((row) => row.id === first.id)?.isDefault).toBe(
      false,
    );
  });

  it('maps a duplicate name to 409 and an unknown id to 404', async () => {
    prisma.aiModelProvider.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    await expect(
      service.create({
        name: 'Duplicate',
        provider: 'openai',
        model: 'gpt-4o',
        apiKeyRef: 'OPENAI_API_KEY',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.update('missing', { model: 'gpt-4o' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes a provider', async () => {
    const created = await service.create({
      name: 'Temporary',
      provider: 'openai',
      model: 'gpt-4o',
      apiKeyRef: 'OPENAI_API_KEY',
    });
    await expect(service.remove(created.id)).resolves.toEqual({
      id: created.id,
      deleted: true,
    });
    expect(prisma._store).toHaveLength(0);
  });
});
