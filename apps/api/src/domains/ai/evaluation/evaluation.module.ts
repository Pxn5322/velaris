import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../permissions/permissions.module.js';
import { AgentPublishService } from './agent-publish.service.js';
import { EvaluationService } from './evaluation.service.js';

/**
 * Evaluation and publication module (T4.05; F-08, F-11).
 *
 * The agent-under-test port (EVALUATION_SUBJECT) has no default provider on
 * purpose: a deployment without a runner answers 503 instead of scoring a
 * run with a stub, so a publish can never rest on fabricated evidence.
 */
@Module({
  imports: [PermissionsModule],
  providers: [EvaluationService, AgentPublishService],
  exports: [EvaluationService, AgentPublishService],
})
export class EvaluationModule {}
