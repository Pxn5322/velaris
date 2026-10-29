/**
 * Module-graph regression (T3.02).
 *
 * The unit and HTTP specs build their testing modules by hand, so a missing
 * module import or export (example: KnowledgeModule not importing
 * AuthModule for SupabaseAuthGuard's verifier) only fails when the real
 * application boots. This spec compiles the production KnowledgeModule
 * graph and fails in CI instead. compile() instantiates providers but does
 * not run lifecycle hooks, so no database connection is opened.
 */

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { KnowledgeModule } from './knowledge.module.js';

describe('KnowledgeModule graph', () => {
  it('resolves every dependency of the guarded controller chain', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        TenantsModule,
        PermissionsModule,
        AuditModule,
        AuthModule,
        KnowledgeModule,
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close?.();
  });
});
