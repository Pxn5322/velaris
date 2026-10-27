import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthorizationService } from './authorization.service.js';
import { DatabaseRoleResolver } from './database-role-resolver.js';
import { ROLE_RESOLVER } from './role-resolver.js';

/**
 * Permission policy module (T1.03). Exports the policy service and the
 * role resolver that PermissionsGuard injects. The default resolver reads
 * membership_roles from the database; it returns null (deny) when no
 * active, in-scope role exists.
 */
@Module({
  imports: [AuditModule],
  providers: [
    AuthorizationService,
    { provide: ROLE_RESOLVER, useClass: DatabaseRoleResolver },
  ],
  exports: [AuthorizationService, ROLE_RESOLVER],
})
export class PermissionsModule {}
