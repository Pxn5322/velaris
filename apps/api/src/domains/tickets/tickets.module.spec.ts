/**
 * Module-graph regression (live-check follow-up, T1.03/T1.04).
 *
 * The unit and HTTP specs build their testing modules by hand, so a missing
 * module import or export (example: TicketsModule not importing AuthModule
 * for SupabaseAuthGuard's verifier) only fails when the real application
 * boots. This spec compiles the production TicketsModule graph and fails in
 * CI instead. compile() instantiates providers but does not run lifecycle
 * hooks, so no database connection is opened.
 */

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { TicketsModule } from './tickets.module.js';

describe('TicketsModule graph', () => {
  it('resolves every dependency of the guarded controller chain', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        TenantsModule,
        PermissionsModule,
        AuditModule,
        AuthModule,
        TicketsModule,
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close?.();
  });
});
