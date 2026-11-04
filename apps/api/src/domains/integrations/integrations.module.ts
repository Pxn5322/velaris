import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { IntegrationsController } from './integrations.controller.js';
import {
  environmentSecretResolver,
  IntegrationsService,
  WEBHOOK_SECRET_RESOLVER,
} from './integrations.service.js';

/**
 * Webhook ingestion and endpoint registration (T5.05).
 *
 * PermissionsModule imports AuditModule for the guard's own audit writes, so
 * this module imports both and never the reverse. The secret resolver is a
 * provider, not a hard reference to `process.env`, so a deployment can replace
 * it with a vault lookup without touching the service.
 */
@Module({
  imports: [AuditModule, PermissionsModule, AuthModule, TenantsModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    { provide: WEBHOOK_SECRET_RESOLVER, useValue: environmentSecretResolver },
  ],
})
export class IntegrationsModule {}
