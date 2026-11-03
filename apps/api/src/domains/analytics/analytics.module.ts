/**
 * Tenant analytics (T5.03, F-12). Replaces the placeholder in-memory
 * summary. The module mirrors KnowledgeModule: TenantsModule supplies the
 * scope check, and PermissionsModule plus AuthModule supply the guard chain.
 */

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [TenantsModule, PermissionsModule, AuditModule, AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
