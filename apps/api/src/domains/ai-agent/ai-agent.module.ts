import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { EvaluationModule } from '../ai/evaluation/evaluation.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AiAgentController } from './ai-agent.controller.js';
import { AiAgentService } from './ai-agent.service.js';

/**
 * Agent lifecycle module (T4.06; F-08, API-10..API-12).
 *
 * The module mirrors KnowledgeModule: TenantsModule supplies the scope
 * check, PermissionsModule and AuthModule supply the guard chain, and
 * AuditModule records lifecycle events. EvaluationModule supplies the
 * evaluation runner and the publish gate, so a publish can only happen
 * through the gate that T4.05 built.
 */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    EvaluationModule,
    PermissionsModule,
    TenantsModule,
  ],
  controllers: [AiAgentController],
  providers: [AiAgentService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
