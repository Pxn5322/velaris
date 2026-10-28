/**
 * Deny-by-default permission guard (T1.03, AC-F02-3, AC-F03-3, TH-02).
 *
 * Order of checks:
 * 1. No authenticated identity -> 401 (SupabaseAuthGuard normally runs
 *    first and already answers this).
 * 2. No declared permission on the route -> 403: a guarded route that
 *    forgets @RequirePermission grants nothing.
 * 3. Resolve the caller's role for the target tenant server-side, then
 *    403 unless the role holds every declared permission.
 *
 * The role comes from RoleResolver, never from a client-supplied claim.
 * The default resolver returns null until membership_roles storage
 * exists, so every permission-gated route denies in production today.
 */

import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedIdentity } from '../../domains/auth/auth.interface.js';
import { AuditService } from '../../domains/audit/audit.service.js';
import { AuthorizationService } from '../../domains/permissions/authorization.service.js';
import type {
  CanonicalRole,
  PermissionCode,
} from '../../domains/permissions/permission.codes.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../../domains/permissions/role-resolver.js';
import { PERMISSION_DECORATOR_KEY } from './require-permission.decorator.js';

type GuardedRequest = {
  user?: AuthenticatedIdentity;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  /** Set after a successful check so serializers can read the role (TH-05). */
  role?: CanonicalRole | null;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly reflector: Reflector,
    @Inject(ROLE_RESOLVER) private readonly roles: RoleResolver,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    if (!request.user) {
      throw new UnauthorizedException();
    }

    const codes = this.reflector.getAllAndOverride<
      PermissionCode[] | undefined
    >(PERMISSION_DECORATOR_KEY, [context.getHandler(), context.getClass()]);
    if (!codes || codes.length === 0) {
      throw new ForbiddenException('Route declares no permission');
    }

    const tenantId = this.readTenantId(request);
    const role = await this.roles.resolveRole({
      identity: request.user,
      tenantId,
    });
    try {
      this.authorization.assertPermission(role, ...codes);
    } catch (error) {
      // T1.04: an authorization refusal is security-sensitive history.
      // A guessed tenant ID can reference no tenant row, so the audit insert
      // can fail on its foreign key; the authorization decision must win.
      try {
        await this.audit.record({
          action: 'permission.denied',
          resourceType: 'permission',
          resourceId: codes.join(','),
          tenantId,
          actorId: request.user.subject,
          metadata: { role: role ?? 'none', reason: 'missing_permission' },
        });
      } catch (auditError) {
        // Never mask the denial; surface the loss in the server log only.
        console.error(
          '[audit] permission.denied not persisted:',
          auditError instanceof Error ? auditError.message : auditError,
        );
      }
      throw error;
    }
    // Attach the server-resolved role: serializers use it to decide what
    // may appear in a response body (example: internal notes, TH-05).
    request.role = role;
    return true;
  }

  /**
   * Tenant the request targets. Provisional source (query/params) until
   * a request-scoped tenant context exists; the value only selects which
   * membership to read, so a forged value cannot grant a role.
   */
  private readTenantId(request: GuardedRequest): string | undefined {
    const fromQuery = request.query?.tenantId;
    const fromParams = request.params?.tenantId;
    const value = fromQuery ?? fromParams;
    return typeof value === 'string' ? value : undefined;
  }
}
