/**
 * Module-graph regression (AC-F03-1 follow-up to the T1.03 tickets fix).
 *
 * A guard dependency that a module forgets to import only fails when the
 * real application boots, because the hand-written HTTP specs build their
 * own testing module. TicketsModule once shipped without AuthModule and a
 * live boot caught it. This spec compiles the production GovernanceModule
 * graph so the governance controller fails in CI instead. compile()
 * instantiates providers but does not run lifecycle hooks, so no database
 * connection is opened.
 */

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { GovernanceModule } from './governance.module.js';

describe('GovernanceModule graph', () => {
  it('resolves every dependency of the governance controller chain', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuditModule,
        PermissionsModule,
        AuthModule,
        GovernanceModule,
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close?.();
  });
});
