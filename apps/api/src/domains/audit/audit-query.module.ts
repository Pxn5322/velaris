import { Module } from '@nestjs/common';
import { AuditModule } from './audit.module.js';
import { AuditQueryController } from './audit-query.controller.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';

/**
 * Governance read module (T5.04). Separate from AuditModule to avoid a
 * module cycle: PermissionsModule imports AuditModule for the guard's own
 * audit writes, so this module imports both instead (PermissionsGuard needs
 * AuditService in this context as well as the policy services).
 */
@Module({
  imports: [AuditModule, PermissionsModule, AuthModule, TenantsModule],
  controllers: [AuditQueryController],
  providers: [AuditQueryService],
})
export class AuditQueryModule {}
