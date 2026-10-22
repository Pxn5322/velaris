import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TicketsModule } from './domains/tickets/tickets.module.js';
import { CustomersModule } from './domains/customers/customers.module.js';
import { AgentsModule } from './domains/agents/agents.module.js';
import { AiAgentModule } from './domains/ai-agent/ai-agent.module.js';
import { AnalyticsModule } from './domains/analytics/analytics.module.js';
import { KnowledgeModule } from './domains/knowledge/knowledge.module.js';
import { WorkflowsModule } from './domains/workflows/workflows.module.js';
import { GuardrailsModule } from './domains/guardrails/guardrails.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    TicketsModule,
    CustomersModule,
    AgentsModule,
    AiAgentModule,
    AnalyticsModule,
    KnowledgeModule,
    WorkflowsModule,
    GuardrailsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
