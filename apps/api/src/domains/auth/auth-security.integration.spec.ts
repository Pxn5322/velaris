/**
 * Auth assurance over HTTP (T6.08; AC-F02-2, AC-F03-1; INV-01..03).
 *
 * The suite runs the real guard chain with a synthetic Prisma store and a
 * stubbed Supabase Auth. It proves:
 * - a flagged account reads only its session state and is refused elsewhere;
 * - a weak or wrong-current password cannot complete the reset;
 * - a successful reset clears the flag and invalidates earlier access tokens;
 * - a step-up grant is required for a sensitive action;
 * - an aal1 token is refused an MFA-protected action.
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ROLE_RESOLVER } from '../permissions/role-resolver.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AuthAccountService } from './auth-account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthSecurityController } from './auth-security.controller.js';
import { PasswordChangeService } from './password-change.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { ProfileService } from './profile.service.js';
import { SignupService } from './signup.service.js';
import { StepUpGuard } from './step-up.guard.js';
import { RequireStepUp } from './require-step-up.decorator.js';
import { STEP_UP_ACTIONS, StepUpService } from './step-up.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';
import { TokenRevocationService } from './token-revocation.service.js';

interface UserRow {
  id: string;
  provider: string;
  externalSubject: string;
  emailNormalized: string;
  displayName: string;
  passwordResetRequired: boolean;
  tokenInvalidBefore: Date | null;
}

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

const CURRENT_PASSWORD = 'Old-passphrase-12';
const NEW_PASSWORD = 'correct-horse-battery-staple-42';

@Controller('harness')
class AssuranceHarnessController {
  @Get('normal')
  @UseGuards(SupabaseAuthGuard)
  normal(): { ok: boolean } {
    return { ok: true };
  }

  @Post('role-change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard, StepUpGuard)
  @RequireStepUp(STEP_UP_ACTIONS.ROLE_CHANGE)
  roleChange(): { ok: boolean } {
    return { ok: true };
  }

  @Post('attachment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard, StepUpGuard)
  @RequireStepUp(STEP_UP_ACTIONS.ATTACHMENT_SEND, { when: 'attachments' })
  attachment(): { ok: boolean } {
    return { ok: true };
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function accessToken(
  options: {
    aal?: 'aal1' | 'aal2';
    sessionId?: string;
    issuedAt?: number;
    expiresInSeconds?: number;
  } = {},
): string {
  const issuedAt = options.issuedAt ?? Math.floor(Date.now() / 1_000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'sub-1',
      email: 'alex@example.test',
      session_id: options.sessionId ?? 'session-1',
      aal: options.aal ?? 'aal1',
      amr: [{ method: 'password', timestamp: issuedAt }],
      iat: issuedAt,
      exp: issuedAt + (options.expiresInSeconds ?? 3_600),
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

function fakePrisma(user: UserRow) {
  const grants: GrantRow[] = [];
  const revoked: { tokenHash: string; sessionId: string | null }[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            provider_externalSubject?: {
              provider: string;
              externalSubject: string;
            };
          };
        }) => {
          const key = where.provider_externalSubject;
          if (!key || key.externalSubject !== user.externalSubject) return null;
          return { ...user };
        },
      ),
      update: vi.fn(async ({ data }: { data: Partial<UserRow> }) => {
        Object.assign(user, data);
        return { ...user };
      }),
    },
    stepUpGrant: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<GrantRow, 'id' | 'usedAt' | 'revokedAt' | 'createdAt'>;
        }) => {
          const row: GrantRow = {
            ...data,
            id: `grant-${grants.length + 1}`,
            usedAt: null,
            revokedAt: null,
            createdAt: new Date(),
          };
          grants.push(row);
          return row;
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          grants.find((row) => row.tokenHash === where.tokenHash) ?? null,
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
          for (const row of grants) {
            if (!matches(row, where)) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
    revokedAccessToken: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(
        async ({
          create,
        }: {
          create: { tokenHash: string; sessionId: string | null };
        }) => {
          revoked.push(create);
          return create;
        },
      ),
    },
  };
  return { prisma: prisma as unknown as PrismaService, grants, revoked };
}

function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function matches(row: GrantRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === null) {
      return (row as unknown as Record<string, unknown>)[key] === null;
    }
    if (typeof expected === 'object' && expected !== null && 'gt' in expected) {
      return (
        (row as unknown as Record<string, Date>)[key].getTime() >
        (expected as { gt: Date }).gt.getTime()
      );
    }
    return (row as unknown as Record<string, unknown>)[key] === expected;
  });
}

describe('auth assurance (integration)', () => {
  let app: INestApplication<App>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let user: UserRow;
  let store: ReturnType<typeof fakePrisma>;

  async function createApp() {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AuthController,
        AuthSecurityController,
        AssuranceHarnessController,
      ],
      providers: [
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        AuthAccountService,
        PasswordPolicyService,
        PasswordChangeService,
        StepUpService,
        StepUpGuard,
        {
          provide: PRISMA_SERVICE,
          useValue: store.prisma,
        },
        { provide: AuditService, useValue: { record: vi.fn() } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
        { provide: SignupService, useValue: { signup: vi.fn() } },
        {
          provide: ProfileService,
          useValue: { findForIdentity: async () => null, update: vi.fn() },
        },
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const method = init?.method ?? 'GET';
        if (url.endsWith('/auth/v1/user') && method === 'GET') {
          return jsonResponse(200, {
            sub: 'sub-1',
            email: 'alex@example.test',
          });
        }
        if (url.endsWith('/auth/v1/user') && method === 'PUT') {
          const body = JSON.parse(requestBody(init)) as {
            password?: string;
            current_password?: string;
          };
          if (body.current_password !== CURRENT_PASSWORD) {
            return jsonResponse(400, { code: 'current_password_invalid' });
          }
          return jsonResponse(200, {});
        }
        if (url.includes('/auth/v1/token?grant_type=password')) {
          const body = JSON.parse(requestBody(init)) as { password?: string };
          return body.password === CURRENT_PASSWORD
            ? jsonResponse(200, { access_token: 'provider-token' })
            : jsonResponse(400, { code: 'invalid_credentials' });
        }
        if (url.includes('/auth/v1/logout?scope=global')) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    user = {
      id: 'user-1',
      provider: 'supabase',
      externalSubject: 'sub-1',
      emailNormalized: 'alex@example.test',
      displayName: 'Alex',
      passwordResetRequired: true,
      tokenInvalidBefore: null,
    };
    store = fakePrisma(user);
    await createApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('lets a flagged account read only its reset state, not workspace context', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${accessToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.passwordResetRequired).toBe(true);
    expect(res.body.tenantContext).toBeNull();
    expect(res.body.role).toBeNull();
  });

  it('refuses a normal route while the reset flag is set', async () => {
    const res = await request(app.getHttpServer())
      .get('/harness/normal')
      .set('Authorization', `Bearer ${accessToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_RESET_REQUIRED');
  });

  it('refuses step-up while the reset flag is set', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ action: 'session.revoke', password: CURRENT_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_RESET_REQUIRED');
  });

  it('rejects a weak reset password before calling Supabase', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/password')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
    expect(fetchMock).toHaveBeenCalledTimes(1); // /auth/v1/user only
  });

  it('rejects a wrong current password before changing the provider password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/password')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ currentPassword: 'wrong-password', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CURRENT_PASSWORD_INVALID');
    const passwordChange = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/auth/v1/user') && init?.method === 'PUT',
    );
    expect(passwordChange).toBeUndefined();
  });

  it('clears the flag and invalidates earlier tokens after a reset', async () => {
    const token = accessToken();
    const res = await request(app.getHttpServer())
      .post('/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(204);
    expect(user.passwordResetRequired).toBe(false);
    expect(user.tokenInvalidBefore).toBeInstanceOf(Date);

    const replay = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${token}`);
    expect(replay.status).toBe(401);
  });

  it('requires a recent step-up grant for session revocation', async () => {
    user.passwordResetRequired = false;
    const token = accessToken();

    const denied = await request(app.getHttpServer())
      .post('/auth/sessions/revoke')
      .set('Authorization', `Bearer ${token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('STEP_UP_REQUIRED');

    const issued = await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'session.revoke', password: CURRENT_PASSWORD });
    expect(issued.status).toBe(200);
    expect(issued.body.token).toEqual(expect.any(String));

    const allowed = await request(app.getHttpServer())
      .post('/auth/sessions/revoke')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', issued.body.token);
    expect(allowed.status).toBe(204);
    expect(user.tokenInvalidBefore).toBeInstanceOf(Date);

    const replay = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${token}`);
    expect(replay.status).toBe(401);
  });

  it('refuses an aal1 token an MFA-protected action', async () => {
    user.passwordResetRequired = false;
    const res = await request(app.getHttpServer())
      .post('/harness/role-change')
      .set('Authorization', `Bearer ${accessToken({ aal: 'aal1' })}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('skips attachment step-up for a message without attachments', async () => {
    user.passwordResetRequired = false;
    const res = await request(app.getHttpServer())
      .post('/harness/attachment')
      .set('Authorization', `Bearer ${accessToken({ aal: 'aal1' })}`)
      .send({ body: 'No files here' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('refuses an attachment message before MFA when the token is aal1', async () => {
    user.passwordResetRequired = false;
    const res = await request(app.getHttpServer())
      .post('/harness/attachment')
      .set('Authorization', `Bearer ${accessToken({ aal: 'aal1' })}`)
      .send({ body: 'See attached', attachments: [{ name: 'a.txt' }] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('allows an aal2 token with a fresh step-up grant', async () => {
    user.passwordResetRequired = false;
    const token = accessToken({ aal: 'aal2' });

    const issued = await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'role.change', password: CURRENT_PASSWORD });
    expect(issued.status).toBe(200);

    const allowed = await request(app.getHttpServer())
      .post('/harness/role-change')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', issued.body.token);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ ok: true });
  });
});
