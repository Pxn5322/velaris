/**
 * Sign-out revocation (D-51).
 *
 * Runs the real HTTP path with a fake Prisma store and a stubbed Supabase
 * Auth. The first session read fills the verifier cache; sign-out must then
 * deny the same token even though the cached identity is still fresh, and
 * must also deny a different access token from the same Supabase session.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ROLE_RESOLVER } from '../permissions/role-resolver.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AuthController } from './auth.controller.js';
import { SignupService } from './signup.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';
import { TokenRevocationService } from './token-revocation.service.js';

interface RevokedRow {
  tokenHash: string;
  sessionId: string | null;
  expiresAt: Date;
  revokedAt: Date;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function accessToken(sessionId: string, expiresInSeconds = 3_600): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'sub-signout',
      session_id: sessionId,
      exp: Math.floor(Date.now() / 1_000) + expiresInSeconds,
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

function revokedStore() {
  const rows: RevokedRow[] = [];
  const store = {
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { tokenHash: string };
        create: Omit<RevokedRow, 'revokedAt'>;
        update: Pick<RevokedRow, 'sessionId' | 'expiresAt'>;
      }) => {
        const existing = rows.find((row) => row.tokenHash === where.tokenHash);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create, revokedAt: new Date() };
        rows.push(row);
        return row;
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: {
          expiresAt: { gt: Date };
          OR: { tokenHash?: string; sessionId?: string }[];
        };
      }) =>
        rows.find(
          (row) =>
            row.expiresAt > where.expiresAt.gt &&
            where.OR.some(
              (clause) =>
                (clause.tokenHash !== undefined &&
                  clause.tokenHash === row.tokenHash) ||
                (clause.sessionId !== undefined &&
                  clause.sessionId === row.sessionId),
            ),
        ) ?? null,
    ),
    rows,
  };
  return store;
}

describe('POST /auth/signout (integration)', () => {
  let app: INestApplication<App>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let revoked: ReturnType<typeof revokedStore>;

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    revoked = revokedStore();

    const prisma = {
      revokedAccessToken: revoked,
    } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        TokenRevocationService,
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: vi.fn() } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
        { provide: SignupService, useValue: { signup: vi.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('denies the same access token immediately after sign-out', async () => {
    const token = accessToken('session-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sub: 'sub-signout' }));

    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await request(app.getHttpServer())
      .post('/auth/signout')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://project.supabase.co/auth/v1/logout?scope=local',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'sb_publishable_test',
          Authorization: `Bearer ${token}`,
        }),
      }),
    );
    expect(revoked.rows).toHaveLength(1);
    expect(revoked.rows[0].sessionId).toBe('session-1');

    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('denies another access token minted for the same Supabase session', async () => {
    const first = accessToken('session-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sub: 'sub-signout' }));
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${first}`)
      .expect(200);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await request(app.getHttpServer())
      .post('/auth/signout')
      .set('Authorization', `Bearer ${first}`)
      .expect(204);

    const second = accessToken('session-1');
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${second}`)
      .expect(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects sign-out without a bearer token', async () => {
    await request(app.getHttpServer()).post('/auth/signout').expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
