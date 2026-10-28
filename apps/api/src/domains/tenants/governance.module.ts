import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { GovernanceController } from './governance.controller.js';
import { GovernanceService } from './governance.service.js';

/**
 * Platform governance module (AC-F03-1). It is separate from
 * TenantsModule on purpose: AuthModule imports TenantsModule to resolve
 * tenant context, so hosting the guarded controller there would create an
 * import cycle. PermissionsModule and AuthModule supply the guard chain,
 * exactly as TicketsModule does. `tenants.module.spec.ts` compiles this
 * graph, because a missing import only fails when the application boots.
 */
@Module({
  imports: [PermissionsModule, AuditModule, AuthModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
})
export class GovernanceModule {}
