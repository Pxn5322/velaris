import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';

/**
 * Tenancy module (T1.02). Governance lives in GovernanceModule: AuthModule
 * imports this module to resolve tenant context, so hosting the governance
 * controller here would create an import cycle.
 */
@Module({
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
