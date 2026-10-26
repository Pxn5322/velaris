/**
 * RequirePermission decorator (T1.03, AC-F02-3).
 *
 * Marks a handler with the permission codes the caller must hold.
 * PermissionsGuard reads the metadata and denies when it is missing, so
 * a guarded route without this decorator grants nothing.
 */

import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../../domains/permissions/permission.codes.js';

export const PERMISSION_DECORATOR_KEY = 'velaris.requiredPermissions';

export const RequirePermission = (...codes: PermissionCode[]) =>
  SetMetadata(PERMISSION_DECORATOR_KEY, codes);
