/**
 * Audit chain verification (T6.10; D-60).
 *
 * D-60 runs integrity verification on a schedule, or by a manual or CI job
 * until a scheduler exists. `verifyScope` walks one scope in chain order, then
 * compares the last accepted row with the recorded chain head. A head that
 * runs past the rows means the tail was lost; a head that lags the rows means
 * a row was appended without sealing the chain. Rows written before migration
 * 0025 carry no seal and are reported as `unsealed`, never as verified.
 *
 * The walk lives in `audit-chain.ts` over a reader interface, so this service
 * and `scripts/verify-audit-chains.mjs` run the same code: one implementation,
 * one result shape, and the job also covers every scope the reader reports.
 *
 * This module only reads. It has no route: D-60 keeps verification out of the
 * tenant-facing API until the owner approves an operator surface.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import {
  DEFAULT_CHAIN_BATCH,
  type AuditChainReport,
  type AuditChainStore,
  verifyScope,
} from './audit-chain.js';
import { auditChainStore } from './audit-chain-store.js';

@Injectable()
export class AuditIntegrityService {
  private readonly store: AuditChainStore;

  constructor(@Inject(PRISMA_SERVICE) prisma: PrismaService) {
    this.store = auditChainStore(prisma);
  }

  verify(
    scopeKey: string,
    options: { batchSize?: number } = {},
  ): Promise<AuditChainReport> {
    return verifyScope(
      this.store,
      scopeKey,
      options.batchSize ?? DEFAULT_CHAIN_BATCH,
    );
  }
}
