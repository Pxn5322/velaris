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
import type { AuditService } from '../../domains/audit/audit.service.js';
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

/** Audit sink used by every guard instance in this spec. */
const audit = { record: vi.fn().mockResolvedValue(undefined) };

function makeGuard(resolver: RoleResolver): PermissionsGuard {
  return new PermissionsGuard(
    new AuthorizationService(),
    new Reflector(),
    resolver,
    audit as unknown as AuditService,
  );
}

describe('PermissionsGuard', () => {

  it('allows a principal whose role holds the permission', async () => {
    class C {
      @RequirePermission(PERMISSIONS.TICKET_READ)
      handle(this: void): string {
        return 'ok';
      }
    }
    const guard = makeGuard(resolverReturning('R-agent'));

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
      handle(this: void): string {
        return 'ok';
      }
    }
    const guard = makeGuard(resolverReturning('R-agent'));

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
      handle(this: void): string {
        return 'ok';
      }
    }
    const guard = makeGuard(resolverReturning('R-tenant-admin'));

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
      handle(this: void): string {
        return 'ok';
      }
    }
    const guard = makeGuard(resolverReturning(null));

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
      handle(this: void): string {
        return 'ok';
      }
    }
    const guard = makeGuard(resolverReturning('R-enterprise-admin'));

    await expect(
      guard.canActivate(contextFor(C.prototype.handle, { user: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with 401 when no identity was attached by the auth guard', async () => {
    class C {
      @RequirePermission(PERMISSIONS.TICKET_READ)
      handle(this: void): string {
        return 'ok';
      }
    }
    const guard = makeGuard(resolverReturning('R-agent'));

    await expect(
      guard.canActivate(contextFor(C.prototype.handle, { query: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('writes a permission.denied audit row before refusing (T1.04)', async () => {
    class C {
      @RequirePermission(PERMISSIONS.AUDIT_READ)
      handle(this: void): string {
        return 'ok';
      }
    }
    audit.record.mockClear();
    const guard = makeGuard(resolverReturning('R-agent'));

    await expect(
      guard.canActivate(
        contextFor(C.prototype.handle, {
          user: { provider: 'supabase', subject: 'sub-123' },
          query: { tenantId: 'tenant-a' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'permission.denied',
        resourceType: 'permission',
        resourceId: PERMISSIONS.AUDIT_READ,
        tenantId: 'tenant-a',
        actorId: 'sub-123',
        metadata: expect.objectContaining({ role: 'R-agent' }),
      }),
    );
  });

  it('still refuses with 403 when the audit write fails (live-check regression)', async () => {
    // Observed live on 2026-10-26: a guessed tenant ID made the
    // permission.denied insert fail on the audit_events foreign key, and the
    // audit error replaced the 403 with a 500. The authorization decision
    // must win over audit persistence.
    class C {
      @RequirePermission(PERMISSIONS.AUDIT_READ)
      handle(this: void): string {
        return 'ok';
      }
    }
    audit.record.mockRejectedValueOnce(new Error('fk violation'));
    const guard = makeGuard(resolverReturning('R-agent'));

    await expect(
      guard.canActivate(
        contextFor(C.prototype.handle, {
          user: { provider: 'supabase', subject: 'sub-123' },
          query: { tenantId: 'no-such-tenant' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
