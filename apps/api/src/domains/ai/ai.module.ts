import { Module } from '@nestjs/common';
// The guard chain audits a denial, so the run route needs AuditService.
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';
import {
  LLM_PROVIDER,
  LLM_PROVIDER_NAME,
  resolveLlmProviderName,
} from '../../infrastructure/llm/llm.provider.js';
import { createLlmProvider } from '../../infrastructure/llm/llm.provider.factory.js';
import { AiRunController } from './ai-run.controller.js';
import { AiRuntimeService } from './ai-runtime.service.js';
import { AiTraceService } from './ai-trace.service.js';

/**
 * AI runtime module (T4.03, F-09). Carries the D-18 provider factory
 * registration that T4.01's run log deferred: this module binds the
 * selected LLM adapter behind the LLM_PROVIDER token (D-18: GROQ_API_KEY
 * selects Groq; without a key the deterministic local provider keeps CI
 * offline). KnowledgeModule supplies the permission-aware
 * retriever (T3.04), so the guard chain runs before any model call.
 *
 * T5.06 adds the producer the trace read path was missing: AiTraceService
 * writes one `ai_traces` row per run, LLM_PROVIDER_NAME names the provider
 * family on that row, and AiRunController exposes the guarded route that
 * calls the runtime and the tenant scope check.
 */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    KnowledgeModule,
    PermissionsModule,
    TenantsModule,
    ToolsModule,
    EvaluationModule,
  ],
  controllers: [AiRunController],
  providers: [
    {
      // D-18: GROQ_API_KEY selects the Groq adapter; without a key the
      // deterministic local provider keeps CI and tests offline.
      provide: LLM_PROVIDER,
      useFactory: () => createLlmProvider(),
    },
    {
      // T5.06: the trace row names the provider family, not the model.
      provide: LLM_PROVIDER_NAME,
      useFactory: () => resolveLlmProviderName(),
    },
    AiRuntimeService,
    AiTraceService,
  ],
  exports: [AiRuntimeService, AiTraceService, ToolsModule, EvaluationModule],
})
export class AiModule {}
