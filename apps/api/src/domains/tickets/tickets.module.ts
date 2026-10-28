import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/**
 * TenantsModule supplies the scope check; PermissionsModule supplies the
 * guard dependencies; CustomersModule supplies the per-customer scope
 * resolver used by the controller (T2.04).
 */
@Module({
  imports: [
    TenantsModule,
    PermissionsModule,
    AuditModule,
    AuthModule,
    CustomersModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
