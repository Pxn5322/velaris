import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/**
 * Customer records (T2.03). The controller runs the guard chain, so
 * this module needs the auth verifier (AuthModule) and the guard
 * dependencies (PermissionsModule). PrismaModule is global.
 */
@Module({
  imports: [TenantsModule, PermissionsModule, AuditModule, AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
