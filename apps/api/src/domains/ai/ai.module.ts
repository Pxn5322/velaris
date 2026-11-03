import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';
import { LLM_PROVIDER } from '../../infrastructure/llm/llm.provider.js';
import { createLlmProvider } from '../../infrastructure/llm/llm.provider.factory.js';
import { AiRuntimeService } from './ai-runtime.service.js';

/**
 * AI runtime module (T4.03, F-09). Carries the D-18 provider factory
 * registration that T4.01's run log deferred: this module binds the
 * selected LLM adapter behind the LLM_PROVIDER token (D-18: GROQ_API_KEY
 * selects Groq; without a key the deterministic local provider keeps CI
 * offline). KnowledgeModule supplies the permission-aware
 * retriever (T3.04), so the guard chain runs before any model call.
 */
@Module({
  imports: [KnowledgeModule, ToolsModule, EvaluationModule],
  providers: [
    {
      // D-18: GROQ_API_KEY selects the Groq adapter; without a key the
      // deterministic local provider keeps CI and tests offline.
      provide: LLM_PROVIDER,
      useFactory: () => createLlmProvider(),
    },
    AiRuntimeService,
  ],
  exports: [AiRuntimeService, ToolsModule, EvaluationModule],
})
export class AiModule {}
