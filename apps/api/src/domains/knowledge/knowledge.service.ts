/**
 * Knowledge source reference validation and ingestion status (T3.02,
 * AC-F07-1, AC-F07-2).
 *
 * Two responsibilities, both proven by knowledge.service.spec.ts:
 *
 * 1. Validation before any write. A source type outside F-07's allowed
 *    set, a reference that does not match its type, or oversized inline
 *    content is refused with 400/413 (API-08 documents 400, 413), so a
 *    malformed or unsupported source never reaches the database and can
 *    never start ingestion.
 *
 * 2. Ingestion status bookkeeping. A valid reference creates a PENDING
 *    row whose provenance records where the content came from and whose
 *    content hash keys idempotency. Resubmitting identical content:
 *    - returns the existing row when it already ingested (no duplicate),
 *    - resets a FAILED row to PENDING and clears its error code, which is
 *      the retry path AC-F07-2 requires.
 *    A lost create race (unique violation on tenant/type/hash) reports
 *    the existing row instead of surfacing a 500, so a partial failure is
 *    visible through the status endpoint rather than masked.
 *
 * The pipeline that moves PENDING to READY/FAILED lives in T3.03; this
 * task owns the reference contract and the status record it writes.
 */

import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { KnowledgeSource } from '@prisma/client';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import {
  SUPPORTED_SOURCE_TYPES,
  type CreateKnowledgeSourceDto,
  type KnowledgeSourceTypeValue,
} from './dto/create-knowledge-source.dto.js';

/** Inline content limit: refuse oversized bodies with 413 (API-08). */
const MAX_INLINE_CONTENT_BYTES = 64 * 1024;

/** Result of a create: a source row plus whether it retried a failure. */
export interface CreateKnowledgeSourceResult {
  source: KnowledgeSource;
  retried: boolean;
}

@Injectable()
export class KnowledgeService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /**
   * Validate the reference and record the source (AC-F07-1), or resubmit
   * identical content (AC-F07-2 retry). Nothing is written before every
   * validation check has passed.
   */
  async create(
    tenantId: string,
    input: CreateKnowledgeSourceDto,
    actorId: string,
  ): Promise<CreateKnowledgeSourceResult> {
    requireText(tenantId, 'tenantId');
    const sourceType = requireSourceType(input.sourceType);
    this.validateReference(sourceType, input);
    const contentHash = resolveContentHash(sourceType, input);

    const existing = await this.prisma.knowledgeSource.findFirst({
      where: { tenantId, sourceType, contentHash, deletedAt: null },
    });
    if (existing) {
      if (existing.status === 'FAILED') {
        // AC-F07-2: resubmission is the retry; the source starts over.
        const source = await this.prisma.knowledgeSource.update({
          where: { id: existing.id },
          data: { status: 'PENDING', errorCode: null },
        });
        return { source, retried: true };
      }
      // Identical content already recorded: idempotent, no duplicate row.
      return { source: existing, retried: false };
    }

    try {
      const source = await this.prisma.knowledgeSource.create({
        data: {
          tenantId,
          sourceType,
          contentHash,
          status: 'PENDING',
          provenanceJson: provenanceOf(input),
          createdBy: actorId,
        },
      });
      return { source, retried: false };
    } catch (error) {
      // A concurrent identical submit may have won the unique constraint;
      // report that row instead of failing the request (partial failure).
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.knowledgeSource.findFirst({
          where: { tenantId, sourceType, contentHash, deletedAt: null },
        });
        if (winner) {
          return { source: winner, retried: false };
        }
      }
      throw error;
    }
  }

  /**
   * Tenant-scoped source list for the knowledge tab (T3.05). Newest
   * first; soft-deleted rows never appear, and the tenant filter keeps
   * foreign rows out of the payload.
   */
  async list(tenantId: string): Promise<KnowledgeSource[]> {
    requireText(tenantId, 'tenantId');
    return this.prisma.knowledgeSource.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Read one source's ingestion status (API-09: status, errors and
   * provenance). Scoped to the tenant: a foreign or soft-deleted id is
   * reported as not found, so no identifier leaks across tenants.
   */
  async findOne(id: string, tenantId: string): Promise<KnowledgeSource> {
    requireText(id, 'id');
    requireText(tenantId, 'tenantId');
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!source) {
      throw new NotFoundException(`Knowledge source with ID ${id} not found`);
    }
    return source;
  }

  /** Reference rules per source type; every failure is 400 or 413. */
  private validateReference(
    sourceType: KnowledgeSourceTypeValue,
    input: CreateKnowledgeSourceDto,
  ): void {
    const sourceUri = optionalText(input.sourceUri);
    const objectKey = optionalText(input.objectKey);
    const content = optionalText(input.content);

    switch (sourceType) {
      case 'WEBSITE': {
        if (!sourceUri || !isHttpUrl(sourceUri)) {
          throw new BadRequestException(
            'sourceUri must be an http(s) URL for WEBSITE sources',
          );
        }
        return;
      }
      case 'PDF': {
        if (!objectKey) {
          throw new BadRequestException(
            'objectKey is required for PDF sources',
          );
        }
        return;
      }
      case 'MARKDOWN':
      case 'FAQ':
      case 'MANUAL': {
        if (!content) {
          throw new BadRequestException(
            `content is required for ${sourceType} sources`,
          );
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_INLINE_CONTENT_BYTES) {
          throw new PayloadTooLargeException(
            `inline content exceeds ${MAX_INLINE_CONTENT_BYTES} bytes`,
          );
        }
        return;
      }
      case 'HISTORY': {
        if (!sourceUri && !objectKey) {
          throw new BadRequestException(
            'sourceUri or objectKey is required for HISTORY sources',
          );
        }
        return;
      }
    }
  }
}

/** Reject a missing or empty required field before any write. */
function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
}

/** Trimmed value or undefined when the field is absent/blank. */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Narrow the source type to the F-07 set (400 otherwise, AC-F07-2). */
function requireSourceType(value: unknown): KnowledgeSourceTypeValue {
  if (
    typeof value !== 'string' ||
    !(SUPPORTED_SOURCE_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException(
      `unsupported source type: ${
        typeof value === 'string' ? value : String(value)
      }`,
    );
  }
  return value as KnowledgeSourceTypeValue;
}

/** Only http(s) URLs are crawlable references. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Idempotency key: caller-supplied digest when present, otherwise a
 * digest over type plus reference, so resubmitting the same reference
 * resolves to the same row.
 */
function resolveContentHash(
  sourceType: KnowledgeSourceTypeValue,
  input: CreateKnowledgeSourceDto,
): string {
  const supplied = optionalText(input.contentHash);
  if (supplied) {
    return supplied;
  }
  const canonical = [
    sourceType,
    optionalText(input.sourceUri) ?? '',
    optionalText(input.objectKey) ?? '',
    optionalText(input.content) ?? '',
  ].join('\n');
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Provenance records where the source content came from (AC-F07-1).
 * Inline sources keep their payload here as well: the schema has no
 * separate content column (DATABASE.md §3), so this is where the
 * T3.03 pipeline reads the text it parses (Proposed D-xx, run log).
 */
function provenanceOf(input: CreateKnowledgeSourceDto): Record<string, string> {
  const provenance: Record<string, string> = {};
  const sourceUri = optionalText(input.sourceUri);
  const objectKey = optionalText(input.objectKey);
  const content = optionalText(input.content);
  if (sourceUri) {
    provenance.sourceUri = sourceUri;
  }
  if (objectKey) {
    provenance.objectKey = objectKey;
  }
  if (content) {
    provenance.content = content;
  }
  return provenance;
}

/** Prisma unique-constraint violation (duplicate tenant/type/hash). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
