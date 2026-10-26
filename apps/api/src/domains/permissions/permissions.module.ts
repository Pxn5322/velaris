import { Module } from '@nestjs/common';
import {
  AuthorizationService,
} from './authorization.service.js';
import {
  DenyRoleResolver,
  ROLE_RESOLVER,
} from './role-resolver.js';

/**
 * Permission policy module (T1.03). Exports the policy service and the
 * deny-all role resolver token that PermissionsGuard injects. Domain
 * modules import this module to use the guard on their routes.
 */
@Module({
  providers: [
    AuthorizationService,
    { provide: ROLE_RESOLVER, useClass: DenyRoleResolver },
  ],
  exports: [AuthorizationService, ROLE_RESOLVER],
})
export class PermissionsModule {}
