/**
 * Step-up grants (T6.08, D-58; INV-02).
 *
 * A grant is a random bearer value returned once. Only its SHA-256 digest is
 * stored. It is bound to the subject, Supabase session, tenant and action,
 * expires within ten minutes and is consumed by the first successful check.
 */

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import type { AuthAssurance } from './auth-assurance.js';
import { StepUpService } from './step-up.service.js';
import type { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

interface GrantRow {
  id: string;
  subject: string;
  sessionId: string;
  tenantId: string | null;
  action: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const identity: AuthenticatedIdentity = {
  provider: 'supabase',
  subject: 'sub-1',
  email: 'alex@example.test',
};

function assurance(overrides: Partial<AuthAssurance> = {}): AuthAssurance {
  return {
    aal: 'aal1',
    amr: ['password'],
    sessionId: 'session-1',
    issuedAt: Math.floor(Date.now() / 1_000),
    ...overrides,
  };
}

function fakePrisma() {
  const rows: GrantRow[] = [];
  const stepUpGrant = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<GrantRow, 'id' | 'usedAt' | 'revokedAt' | 'createdAt'>;
      }) => {
        const row: GrantRow = {
          ...data,
          id: `grant-${rows.length + 1}`,
          usedAt: null,
          revokedAt: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { tokenHash: string } }) =>
        rows.find((row) => row.tokenHash === where.tokenHash) ?? null,
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const row of rows) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    ),
  };
  return {
    prisma: { stepUpGrant } as unknown as PrismaService,
    rows,
    stepUpGrant,
  };
}

function matches(row: GrantRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === null) {
      return (row as unknown as Record<string, unknown>)[key] === null;
    }
    if (typeof expected === 'object' && expected !== null && 'gt' in expected) {
      return (
        ((row as unknown as Record<string, Date>)[key] as Date).getTime() >
        (expected as { gt: Date }).gt.getTime()
      );
    }
    return (row as unknown as Record<string, unknown>)[key] === expected;
  });
}

describe('StepUpService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let verifier: { verifyPassword: ReturnType<typeof vi.fn> };
  let service: StepUpService;

  beforeEach(() => {
    prisma = fakePrisma();
    verifier = { verifyPassword: vi.fn().mockResolvedValue(true) };
    service = new StepUpService(
      prisma.prisma,
      verifier as unknown as SupabaseTokenVerifier,
    );
  });

  it('stores only a digest and returns the raw grant once', async () => {
    const result = await service.issue(identity, assurance(), {
      action: 'session.revoke',
      password: 'correct-horse-battery-staple-42',
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].tokenHash).toHaveLength(64);
    expect(prisma.rows[0].tokenHash).not.toBe(result.token);
    expect(JSON.stringify(prisma.rows)).not.toContain(result.token);
    expect(prisma.rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(prisma.rows[0].expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 10 * 60 * 1_000,
    );
  });

  it('rejects a wrong current password without writing a grant', async () => {
    verifier.verifyPassword.mockResolvedValue(false);

    await expect(
      service.issue(identity, assurance(), {
        action: 'session.revoke',
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({ response: { code: 'CURRENT_PASSWORD_INVALID' } });
    expect(prisma.stepUpGrant.create).not.toHaveBeenCalled();
  });

  it('requires aal2 before issuing an MFA-protected action grant', async () => {
    await expect(
      service.issue(identity, assurance({ aal: 'aal1' }), {
        action: 'role.change',
        password: 'correct-horse-battery-staple-42',
      }),
    ).rejects.toMatchObject({ response: { code: 'MFA_REQUIRED' } });
    expect(verifier.verifyPassword).not.toHaveBeenCalled();
  });

  it('uses a grant once and refuses the replay', async () => {
    const grant = await service.issue(identity, assurance(), {
      action: 'session.revoke',
      password: 'correct-horse-battery-staple-42',
    });

    await expect(
      service.verify(
        identity,
        assurance(),
        'session.revoke',
        null,
        grant.token,
      ),
    ).resolves.toBe(true);
    await expect(
      service.verify(
        identity,
        assurance(),
        'session.revoke',
        null,
        grant.token,
      ),
    ).resolves.toBe(false);
  });

  it('refuses a grant used for another action, tenant or session', async () => {
    const grant = await service.issue(identity, assurance(), {
      action: 'session.revoke',
      tenantId: '11111111-1111-4111-8111-111111111111',
      password: 'correct-horse-battery-staple-42',
    });

    await expect(
      service.verify(identity, assurance(), 'role.change', null, grant.token),
    ).resolves.toBe(false);
    await expect(
      service.verify(
        identity,
        assurance(),
        'session.revoke',
        null,
        grant.token,
      ),
    ).resolves.toBe(false);
    await expect(
      service.verify(
        identity,
        assurance({ sessionId: 'session-2' }),
        'session.revoke',
        '11111111-1111-4111-8111-111111111111',
        grant.token,
      ),
    ).resolves.toBe(false);
  });

  it('refuses an expired grant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T00:00:00.000Z'));
    const grant = await service.issue(identity, assurance(), {
      action: 'session.revoke',
      password: 'correct-horse-battery-staple-42',
    });

    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(
      service.verify(
        identity,
        assurance(),
        'session.revoke',
        null,
        grant.token,
      ),
    ).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('refuses a revoked grant and revokes every grant for a subject', async () => {
    const grant = await service.issue(identity, assurance(), {
      action: 'session.revoke',
      password: 'correct-horse-battery-staple-42',
    });
    await service.revokeForSubject(identity.subject);

    expect(prisma.rows[0].revokedAt).toBeInstanceOf(Date);
    await expect(
      service.verify(
        identity,
        assurance(),
        'session.revoke',
        null,
        grant.token,
      ),
    ).resolves.toBe(false);
  });

  it('refuses an unknown action', async () => {
    await expect(
      service.issue(identity, assurance(), {
        action: 'made.up',
        password: 'correct-horse-battery-staple-42',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
