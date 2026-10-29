import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import {
  EMBEDDING_PROVIDER,
  LocalDeterministicEmbeddingProvider,
} from './embedding.provider.js';
import { INGESTION_QUEUE, INGESTION_RUNNER } from './ingestion-queue.js';
import { createIngestionQueue } from './bullmq-ingestion.queue.js';
import type { IngestionRunner } from './ingestion-types.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service.js';
import { KnowledgeService } from './knowledge.service.js';
import { SourceContentLoader } from './source-content.loader.js';

/**
 * Knowledge source ingestion and retrieval (T3.02-T3.04, F-07).
 * The module mirrors TicketsModule: TenantsModule supplies the scope
 * check, PermissionsModule and AuthModule supply the guard chain,
 * AuditModule records source events (AC-F11-1). T3.03 adds the ingestion
 * pipeline behind the queue/embedding/loader ports; D-17 now selects the
 * queue implementation at boot (BullMQ when REDIS_URL is set, in-process
 * otherwise) while the embedding provider stays local until D-07, and
 * T3.04 adds permission-aware retrieval for the orchestrator.
 * `knowledge.module.spec.ts` compiles this graph, because a missing
 * import only fails when the application boots.
 */
@Module({
  imports: [TenantsModule, PermissionsModule, AuditModule, AuthModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeIngestionService,
    KnowledgeRetrievalService,
    SourceContentLoader,
    LocalDeterministicEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDER,
      useExisting: LocalDeterministicEmbeddingProvider,
    },
    { provide: INGESTION_RUNNER, useExisting: KnowledgeIngestionService },
    {
      // D-17: REDIS_URL selects the durable BullMQ queue; without it the
      // in-process adapter keeps CI and tests Redis-free.
      provide: INGESTION_QUEUE,
      useFactory: (runner: IngestionRunner) =>
        createIngestionQueue(runner, process.env.REDIS_URL?.trim() || null),
      inject: [INGESTION_RUNNER],
    },
  ],
  exports: [
    KnowledgeService,
    KnowledgeRetrievalService,
    KnowledgeIngestionService,
    INGESTION_QUEUE,
  ],
})
export class KnowledgeModule {}
