import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * Knowledge source ingestion (T3.02, F-07). Replaces the prototype stub,
 * which exposed unguarded in-memory routes. The module mirrors
 * TicketsModule: TenantsModule supplies the scope check, PermissionsModule
 * and AuthModule supply the guard chain, AuditModule records source
 * creation and retry events (AC-F11-1). `knowledge.module.spec.ts`
 * compiles this graph, because a missing import only fails when the
 * application boots.
 */
@Module({
  imports: [TenantsModule, PermissionsModule, AuditModule, AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
