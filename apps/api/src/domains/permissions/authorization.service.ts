/**
 * Authorization policy for T1.03 (AC-F02-3, AC-F03-3, AC-F04-2).
 *
 * Services and guards call this class instead of reading role names, so
 * one place holds the deny-by-default rules:
 * - assertPermission refuses a principal without the permission (403).
 * - requireActiveTenant refuses a new business operation while the
 *   tenant is not ACTIVE (403; rejected-state choice recorded as
 *   Proposed D-11 in the run log).
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PermissionCode } from './permission.codes.js';
import { permissionsForRole } from './role-permissions.js';

@Injectable()
export class AuthorizationService {
  /** Granted permission set for a role; empty for unknown or absent roles. */
  permissionsFor(role: string | null | undefined): readonly PermissionCode[] {
    return permissionsForRole(role);
  }

  /** Throw 403 unless the role holds every listed permission. */
  assertPermission(
    role: string | null | undefined,
    ...codes: PermissionCode[]
  ): void {
    const granted = this.permissionsFor(role);
    const missing = codes.filter((code) => !granted.includes(code));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
  }

  /** Reject a new business operation on a tenant that is not ACTIVE. */
  requireActiveTenant(tenant: { id: string; status: string }): void {
    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('Tenant is not active');
    }
  }
}
