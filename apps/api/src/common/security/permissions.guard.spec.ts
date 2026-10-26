/**
 * Deny-by-default permission guard (T1.03).
 *
 * The guard runs after SupabaseAuthGuard and answers AC-F02-3 over the
 * real Nest guard chain: an authenticated principal without the required
 * permission receives 403, and so does a route that declares no
 * permission at all. Role data does not exist in the schema yet
 * (membership_roles arrives with the roles tables), so the default
 * RoleResolver returns null and every permission-gated route denies
 * until role storage lands. Tests inject a resolver.
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../domains/permissions/permission.codes.js';
import type {
  RoleResolver,
} from '../../domains/permissions/role-resolver.js';
import { AuthorizationService } from '../../domains/permissions/authorization.service.js';
import { RequirePermission } from './require-permission.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';

type Handler = (...args: unknown[]) => unknown;

function contextFor(
  handler: Handler,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function resolverReturning(role: string | null): RoleResolver {
  return { resolveRole: vi.fn().mockResolvedValue(role) };
}

describe('PermissionsGuard', () => {
  const reflector = new Reflector();

  it('allows a principal whose role holds the permission', async () => {
    class C {
      @RequirePermission(PERMISSIONS.TICKET_READ)
      handle(): string {
        return 'ok';
      }
    }
    const guard = new PermissionsGuard(
      new AuthorizationService(),
      reflector,
      resolverReturning('R-agent'),
    );

    const allowed = await guard.canActivate(
      contextFor(C.prototype.handle, {
        user: { provider: 'supabase', subject: 'sub-123' },
        query: { tenantId: 'tenant-a' },
      }),
    );

    expect(allowed).toBe(true);
  });

  it('denies with 403 when the authenticated role lacks the permission (AC-F02-3)', async () => {
    class C {
      @RequirePermission(PERMISSIONS.AUDIT_READ)
      handle(): string {
        return 'ok';
      }
    }
    const guard = new PermissionsGuard(
      new AuthorizationService(),
      reflector,
      resolverReturning('R-agent'),
    );

    await expect(
      guard.canActivate(
        contextFor(C.prototype.handle, {
          user: { provider: 'supabase', subject: 'sub-123' },
          query: { tenantId: 'tenant-a' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies R-tenant-admin on a platform governance route (AC-F03-3)', async () => {
    class C {
      @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
      handle(): string {
        return 'ok';
      }
    }
    const guard = new PermissionsGuard(
      new AuthorizationService(),
      reflector,
      resolverReturning('R-tenant-admin'),
    );

    await expect(
      guard.canActivate(
        contextFor(C.prototype.handle, {
          user: { provider: 'supabase', subject: 'sub-123' },
          query: { tenantId: 'tenant-a' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when no role can be resolved (deny-by-default)', async () => {
    class C {
      @RequirePermission(PERMISSIONS.TICKET_READ)
      handle(): string {
        return 'ok';
      }
    }
    const guard = new PermissionsGuard(
      new AuthorizationService(),
      reflector,
      resolverReturning(null),
    );

    await expect(
      guard.canActivate(
        contextFor(C.prototype.handle, {
          user: { provider: 'supabase', subject: 'sub-123' },
          query: { tenantId: 'tenant-a' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a guarded route that declares no permission', async () => {
    class C {
      handle(): string {
        return 'ok';
      }
    }
    const guard = new PermissionsGuard(
      new AuthorizationService(),
      reflector,
      resolverReturning('R-enterprise-admin'),
    );

    await expect(
      guard.canActivate(contextFor(C.prototype.handle, { user: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with 401 when no identity was attached by the auth guard', async () => {
    class C {
      @RequirePermission(PERMISSIONS.TICKET_READ)
      handle(): string {
        return 'ok';
      }
    }
    const guard = new PermissionsGuard(
      new AuthorizationService(),
      reflector,
      resolverReturning('R-agent'),
    );

    await expect(
      guard.canActivate(contextFor(C.prototype.handle, { query: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
