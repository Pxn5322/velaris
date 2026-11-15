/**
 * Platform AI model gateway configuration (AI Governance).
 *
 * The admin prototype lists the default production model and provider
 * credentials. This service makes that panel real: providers can be created,
 * renamed, paused, made the default and deleted. Credentials are never stored
 * or returned; `apiKeyRef` names the deployment environment variable that
 * holds the secret (D-30 pattern used by integration endpoints).
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreateModelProviderDto,
  UpdateModelProviderDto,
} from './dto/governance.dto.js';

const PROVIDER_STATUS = ['ACTIVE', 'PAUSED'] as const;
const NAME_MAX = 80;
const PROVIDER_MAX = 40;
const MODEL_MAX = 128;
const API_KEY_REF = /^[A-Z][A-Z0-9_]{0,63}$/;
const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export interface ModelProviderView {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKeyRef: string;
  isDefault: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AiProvidersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  list(): Promise<ModelProviderView[]> {
    return this.prisma.aiModelProvider.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async create(input: CreateModelProviderDto): Promise<ModelProviderView> {
    const data = {
      name: normalizeName(input.name),
      provider: normalizeProvider(input.provider),
      model: normalizeModel(input.model),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKeyRef: normalizeApiKeyRef(input.apiKeyRef),
      isDefault: input.isDefault === true,
      status: normalizeStatus(input.status ?? 'ACTIVE'),
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.aiModelProvider.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.aiModelProvider.create({ data });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A provider named ${data.name} already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateModelProviderDto,
  ): Promise<ModelProviderView> {
    const existing = await this.prisma.aiModelProvider.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Model provider with ID ${id} not found`);
    }

    const data: {
      name?: string;
      provider?: string;
      model?: string;
      baseUrl?: string | null;
      apiKeyRef?: string;
      isDefault?: boolean;
      status?: 'ACTIVE' | 'PAUSED';
    } = {};
    if (input.name !== undefined) data.name = normalizeName(input.name);
    if (input.provider !== undefined) {
      data.provider = normalizeProvider(input.provider);
    }
    if (input.model !== undefined) data.model = normalizeModel(input.model);
    if (input.baseUrl !== undefined) {
      data.baseUrl = normalizeBaseUrl(input.baseUrl);
    }
    if (input.apiKeyRef !== undefined) {
      data.apiKeyRef = normalizeApiKeyRef(input.apiKeyRef);
    }
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    if (input.status !== undefined) data.status = normalizeStatus(input.status);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No provider field was supplied');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.aiModelProvider.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.aiModelProvider.update({ where: { id }, data });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('That provider name is already in use');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.prisma.aiModelProvider.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Model provider with ID ${id} not found`);
    }
    await this.prisma.aiModelProvider.delete({ where: { id } });
    return { id, deleted: true };
  }
}

function normalizeName(value: unknown): string {
  const name =
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > NAME_MAX) {
    throw new BadRequestException(
      `name must be between 2 and ${NAME_MAX} characters`,
    );
  }
  return name;
}

function normalizeProvider(value: unknown): string {
  const provider = typeof value === 'string' ? value.trim() : '';
  if (
    provider.length < 2 ||
    provider.length > PROVIDER_MAX ||
    !PROVIDER_NAME.test(provider)
  ) {
    throw new BadRequestException(
      'provider must look like openai or azure-openai',
    );
  }
  return provider.toLowerCase();
}

function normalizeModel(value: unknown): string {
  const model = typeof value === 'string' ? value.trim() : '';
  if (model.length < 1 || model.length > MODEL_MAX) {
    throw new BadRequestException(
      `model must be between 1 and ${MODEL_MAX} characters`,
    );
  }
  return model;
}

function normalizeBaseUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('baseUrl must be an http(s) URL');
  }
  const url = value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new BadRequestException('baseUrl must be an http(s) URL');
  }
  return url;
}

function normalizeApiKeyRef(value: unknown): string {
  const ref = typeof value === 'string' ? value.trim() : '';
  if (!API_KEY_REF.test(ref)) {
    throw new BadRequestException(
      'apiKeyRef must be an uppercase environment variable name, for example OPENAI_API_KEY',
    );
  }
  return ref;
}

function normalizeStatus(value: unknown): 'ACTIVE' | 'PAUSED' {
  if (!PROVIDER_STATUS.includes(value as (typeof PROVIDER_STATUS)[number])) {
    throw new BadRequestException(
      `status must be one of ${PROVIDER_STATUS.join(', ')}`,
    );
  }
  return value as 'ACTIVE' | 'PAUSED';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
