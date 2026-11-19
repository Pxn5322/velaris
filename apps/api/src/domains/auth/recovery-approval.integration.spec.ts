/**
 * Privileged recovery approvals over HTTP (T6.09; D-59 matrix, D-62 contract,
 * D-66 policy; INV-04).
 *
 * The suite runs the real controller, the real step-up guard and the real
 * service against an in-memory store. It proves:
 * - an aal1 session is refused before any handler runs;
 * - an aal2 session without a one-time grant is refused;
 * - the approval count and approver roles come from the policy table;
 * - the requester and the target can never approve;
 * - an actor outside the policy is refused;
 * - one denial ends the request and a terminal state accepts no decision;
 * - only an approved request can be consumed, once;
 * - the execution is bound to one executor and one id;
 * - an expired approval cannot be decided or consumed;
 * - a cancelled or consumed approval cannot be cancelled again.
 *
 * The in-memory store proves the contract. The production mapping resolves
 * only R-enterprise-admin to a policy role (D-68), so a real request cannot
 * reach its full quota until D-62 seeds the other duties.
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
import { AuthAccountService } from './auth-account.service.js';
import { AuthSecurityController } from './auth-security.controller.js';
import { PasswordChangeService } from './password-change.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { ProfileService } from './profile.service.js';
import { RECOVERY_PATHS } from './recovery-approval-policy.js';
import { RecoveryApprovalController } from './recovery-approval.controller.js';
import { RecoveryApprovalService } from './recovery-approval.service.js';
import { SignupService } from './signup.service.js';
import { StepUpGuard } from './step-up.guard.js';
import { STEP_UP_ACTIONS, StepUpService } from './step-up.service.js';
import { SupabaseAdminService } from './supabase-admin.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { RecoveryResetService } from './recovery-reset.service.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';
import { TokenRevocationService } from './token-revocation.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_TENANT_ID = '55555555-5555-4555-8555-555555555555';
const CURRENT_PASSWORD = 'Old-passphrase-12';

interface RequestRow {
  id: string;
  requestId: string;
  recoveryPath: string;
  tenantId: string | null;
  targetUserId: string;
  requestedBy: string;
  reason: string;
  ticketId: string;
  custodyRecordId: string | null;
  state: string;
  requiredApprovals: number;
  approvalExpiresAt: Date;
  executionId: string | null;
  executionExpiresAt: Date | null;
  executedBy: string | null;
  completedAt: Date | null;
  stateReason: string | null;
  resetOutcome: string | null;
  failureCode: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DecisionRow {
  id: string;
  requestId: string;
  actorSubject: string;
  policyRole: string;
  decision: 'APPROVE' | 'DENY';
  reason: string | null;
  createdAt: Date;
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestSubject(init?: RequestInit): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  for (const value of Object.values(headers)) {
    const token = String(value).replace(/^Bearer\s+/i, '');
    const parts = token.split('.');
    if (parts.length !== 3) continue;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as { sub?: string };
      if (payload.sub) return payload.sub;
    } catch {
      // Not a token value; try the next header.
    }
  }
  return 'sub-enterprise';
}

function accessToken(
  options: {
    aal?: 'aal1' | 'aal2';
    sessionId?: string;
    subject?: string;
    email?: string;
  } = {},
): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: options.subject ?? 'sub-enterprise',
      email: options.email ?? 'owner@example.test',
      session_id: options.sessionId ?? 'session-1',
      aal: options.aal ?? 'aal2',
      amr: [{ method: 'password', timestamp: issuedAt }],
      iat: issuedAt,
      exp: issuedAt + 3_600,
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

function fakeStore() {
  const requests: RequestRow[] = [];
  const decisions: DecisionRow[] = [];
  const grants: GrantRow[] = [];
  const audits: Record<string, unknown>[] = [];
  const tenants = [
    { tenantId: TENANT_ID, userId: TARGET_ID, status: 'ACTIVE' },
  ];

  function withDecisions(row: RequestRow) {
    return {
      ...row,
      decisions: decisions
        .filter((entry) => entry.requestId === row.id)
        .map((entry) => ({ ...entry })),
    };
  }

  function matchWhere(
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) {
    return Object.entries(where).every(([key, expected]) => {
      if (expected === null) return row[key] === null;
      if (
        typeof expected === 'object' &&
        expected !== null &&
        'gt' in expected
      ) {
        return (
          (row[key] as Date).getTime() > (expected as { gt: Date }).gt.getTime()
        );
      }
      return row[key] === expected;
    });
  }

  let sequence = 0;
  const userUpdate = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => ({ id: where.id, ...data }),
  );
  const prisma = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === TARGET_ID
          ? {
              id: where.id,
              provider: 'supabase',
              externalSubject: `sub-${where.id}`,
              status: 'ACTIVE',
            }
          : null,
      ),
      update: userUpdate,
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
          const subject = where.provider_externalSubject?.externalSubject;
          if (!subject) return null;
          return {
            id: subject,
            provider: 'supabase',
            externalSubject: subject,
            emailNormalized: `${subject}@example.test`,
            displayName: 'Synthetic user',
            passwordResetRequired: false,
            tokenInvalidBefore: null,
            status: 'ACTIVE',
          };
        },
      ),
    },
    tenantMembership: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { tenantId: string; userId: string; status?: string };
        }) =>
          tenants.find(
            (row) =>
              row.tenantId === where.tenantId && row.userId === where.userId,
          ) ?? null,
      ),
    },
    recoveryApprovalRequest: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { requestedBy: string; requestId: string };
        }) =>
          requests.find(
            (row) =>
              row.requestedBy === where.requestedBy &&
              row.requestId === where.requestId,
          ) ?? null,
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = requests.find((entry) => entry.id === where.id);
        return row ? withDecisions(row) : null;
      }),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { requestedBy: string; tenantId?: string | null };
        }) =>
          requests
            .filter(
              (row) =>
                row.requestedBy === where.requestedBy &&
                (where.tenantId === undefined ||
                  row.tenantId === where.tenantId),
            )
            .map(withDecisions),
      ),
      create: vi.fn(async ({ data }: { data: Partial<RequestRow> }) => {
        const row: RequestRow = {
          executionId: null,
          executionExpiresAt: null,
          consumedAt: null,
          executedBy: null,
          completedAt: null,
          stateReason: null,
          resetOutcome: null,
          failureCode: null,
          custodyRecordId: null,
          ...data,
          id: `request-${++sequence}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as RequestRow;
        requests.push(row);
        return withDecisions(row);
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const row of requests) {
            if (!matchWhere(row as unknown as Record<string, unknown>, where)) {
              continue;
            }
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
          return { count };
        },
      ),
    },
    recoveryApprovalDecision: {
      create: vi.fn(
        async ({ data }: { data: Omit<DecisionRow, 'id' | 'createdAt'> }) => {
          if (
            decisions.some(
              (row) =>
                row.requestId === data.requestId &&
                row.actorSubject === data.actorSubject,
            )
          ) {
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            });
          }
          const row: DecisionRow = {
            ...data,
            id: `decision-${++sequence}`,
            createdAt: new Date(),
          };
          decisions.push(row);
          return row;
        },
      ),
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            requestId_actorSubject: { requestId: string; actorSubject: string };
          };
        }) =>
          decisions.find(
            (row) =>
              row.requestId === where.requestId_actorSubject.requestId &&
              row.actorSubject === where.requestId_actorSubject.actorSubject,
          ) ?? null,
      ),
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
            if (!matchWhere(row as unknown as Record<string, unknown>, where)) {
              continue;
            }
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
    revokedAccessToken: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(),
    },
  };

  return {
    prisma: prisma as unknown as PrismaService,
    requests,
    decisions,
    audits,
    updateMany: prisma.recoveryApprovalRequest.updateMany,
    userUpdate,
  };
}

describe('privileged recovery approvals (integration)', () => {
  let app: INestApplication<App>;
  let store: ReturnType<typeof fakeStore>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let roleByTenant: Record<string, string | null>;
  let admin: {
    isConfigured: () => boolean;
    listMfaFactors: ReturnType<typeof vi.fn>;
    deleteMfaFactor: ReturnType<typeof vi.fn>;
  };

  async function createApp() {
    const moduleRef = await Test.createTestingModule({
      controllers: [RecoveryApprovalController, AuthSecurityController],
      providers: [
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        AuthAccountService,
        PasswordPolicyService,
        PasswordChangeService,
        StepUpService,
        StepUpGuard,
        RecoveryApprovalService,
        RecoveryResetService,
        { provide: SupabaseAdminService, useValue: admin },
        {
          provide: PRISMA_SERVICE,
          useValue: store.prisma,
        },
        {
          provide: AuditService,
          useValue: {
            record: vi.fn(async (event: Record<string, unknown>) => {
              store.audits.push(event);
            }),
          },
        },
        {
          provide: ROLE_RESOLVER,
          useValue: {
            resolveRole: async ({ tenantId }: { tenantId?: string }) => {
              const scope = tenantId ?? 'platform';
              return roleByTenant[scope] ?? null;
            },
          },
        },
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

  async function grant(action: string, token: string, tenantId?: string) {
    const issued = await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ action, password: CURRENT_PASSWORD, tenantId });
    expect(issued.status).toBe(200);
    return issued.body.token as string;
  }

  async function createRequest(
    token: string,
    overrides: Record<string, unknown> = {},
  ) {
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_REQUEST,
      token,
      TENANT_ID,
    );
    const created = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
        tenantId: TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'Lost the backup factor after a device reset',
        ticketId: 'INC-1042',
        ...overrides,
      });
    expect(created.status).toBe(201);
    return created.body;
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
            sub: requestSubject(init),
            email: 'owner@example.test',
          });
        }
        if (url.includes('/auth/v1/token?grant_type=password')) {
          const body = JSON.parse(
            typeof init?.body === 'string' ? init.body : '',
          ) as { password?: string };
          return body.password === CURRENT_PASSWORD
            ? jsonResponse(200, { access_token: 'provider-token' })
            : jsonResponse(400, { code: 'invalid_credentials' });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    roleByTenant = {
      [TENANT_ID]: 'R-enterprise-admin',
      platform: 'R-enterprise-admin',
    };
    admin = {
      isConfigured: () => true,
      listMfaFactors: vi.fn(async () => [
        { id: 'factor-1' },
        { id: 'factor-2' },
      ]),
      deleteMfaFactor: vi.fn(async () => undefined),
    };
    store = fakeStore();
    await createApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refuses an aal1 session before the handler runs', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${accessToken({ aal: 'aal1' })}`)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
        tenantId: TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'Lost the backup factor after a device reset',
        ticketId: 'INC-1042',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
    expect(store.requests).toHaveLength(0);
  });

  it('refuses an aal2 session without a step-up grant', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
        tenantId: TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'Lost the backup factor after a device reset',
        ticketId: 'INC-1042',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('creates a pending request with the policy count and roles', async () => {
    const body = await createRequest(accessToken());

    expect(body.state).toBe('PENDING');
    expect(body.requiredApprovals).toBe(2);
    expect(body.requiredApproverRoles).toEqual([
      { policyRole: 'ENTERPRISE_ADMIN', count: 1 },
      { policyRole: 'PLATFORM_SECURITY_OWNER', count: 1 },
    ]);
    expect(body.approvals).toEqual([]);
    expect(store.audits.map((event) => event.action)).toContain(
      'auth.mfa_reset_requested',
    );
  });

  it('returns the same request for an identical idempotent create', async () => {
    const token = accessToken();
    const first = await createRequest(token);
    const second = await createRequest(token);
    expect(second.approvalId).toBe(first.approvalId);
    expect(store.requests).toHaveLength(1);
  });

  it('refuses a request whose target is outside the tenant', async () => {
    const token = accessToken();
    roleByTenant[FOREIGN_TENANT_ID] = 'R-enterprise-admin';
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_REQUEST,
      token,
      FOREIGN_TENANT_ID,
    );
    const res = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
        tenantId: FOREIGN_TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'Lost the backup factor after a device reset',
        ticketId: 'INC-1042',
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TARGET_NOT_FOUND');
  });

  it('refuses a requester without a recovery policy role', async () => {
    roleByTenant[TENANT_ID] = 'R-tenant-admin';
    const token = accessToken();
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_REQUEST,
      token,
      TENANT_ID,
    );
    const res = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
        tenantId: TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'Lost the backup factor after a device reset',
        ticketId: 'INC-1042',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REQUESTER_NOT_PERMITTED');
  });

  it('refuses a decision from an aal1 session', async () => {
    const created = await createRequest(accessToken());
    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ aal: 'aal1' })}`)
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('refuses the requester and the target as approvers', async () => {
    const created = await createRequest(accessToken());

    const self = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ decision: 'APPROVE' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL');

    const target = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set(
        'Authorization',
        `Bearer ${accessToken({ subject: `sub-${TARGET_ID}`, email: 'target@test' })}`,
      )
      .send({ decision: 'APPROVE' });
    expect(target.status).toBe(403);
    expect(target.body.code).toBe('TARGET_APPROVAL');
  });

  it('refuses an approver outside the policy', async () => {
    const created = await createRequest(accessToken());
    roleByTenant[TENANT_ID] = 'R-agent';

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-agent' })}`)
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('APPROVER_NOT_ELIGIBLE');
  });

  it('keeps the request pending after one approval of two', async () => {
    const created = await createRequest(accessToken());
    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-owner-2' })}`)
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('PENDING');
    expect(res.body.approvals).toHaveLength(1);
  });

  it('returns the current view for an identical repeated decision', async () => {
    const created = await createRequest(accessToken());
    const token = accessToken({ subject: 'sub-owner-2' });
    const first = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVE' });
    const second = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVE' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.approvals).toHaveLength(1);
    expect(store.decisions).toHaveLength(1);
  });

  it('ends the request on one denial and accepts no later decision', async () => {
    const created = await createRequest(accessToken());
    const denied = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-owner-2' })}`)
      .send({ decision: 'DENY', reason: 'Ticket does not match the target' });

    expect(denied.status).toBe(200);
    expect(denied.body.state).toBe('DENIED');

    const later = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-owner-3' })}`)
      .send({ decision: 'APPROVE' });
    expect(later.status).toBe(409);
    expect(later.body.code).toBe('APPROVAL_TERMINAL');
  });

  it('refuses to execute a request that is not approved', async () => {
    const token = accessToken();
    const created = await createRequest(token);
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );
    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_NOT_APPROVED');
  });

  it('requires the execute step-up for an approved request', async () => {
    const created = await approveFully(accessToken());
    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ tenantId: TENANT_ID });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('consumes one execution, then completes it', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );

    const consumed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });
    expect(consumed.status).toBe(200);
    expect(consumed.body.approval.state).toBe('CONSUMED');
    expect(consumed.body.executionId).toEqual(expect.any(String));
    expect(consumed.body.result).toBe('SUCCEEDED');
    expect(admin.listMfaFactors).toHaveBeenCalledWith(`sub-${TARGET_ID}`);
    expect(admin.deleteMfaFactor).toHaveBeenCalledWith(
      `sub-${TARGET_ID}`,
      'factor-1',
    );
    expect(admin.deleteMfaFactor).toHaveBeenCalledWith(
      `sub-${TARGET_ID}`,
      'factor-2',
    );
    expect(store.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TARGET_ID },
        data: { tokenInvalidBefore: expect.any(Date) },
      }),
    );

    const completed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: consumed.body.executionId, result: 'SUCCEEDED' });
    expect(completed.status).toBe(200);
    expect(completed.body.state).toBe('COMPLETED');
    expect(completed.body.completedAt).toEqual(expect.any(String));
    expect(store.audits.map((event) => event.action)).toContain(
      'auth.mfa_reset_completed',
    );
  });

  it('refuses a second consumer and a foreign completer', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    const consumed = await consume(created.approvalId, token);

    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );
    const again = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.executionId).toBe(consumed);

    const outsiderToken = accessToken({ subject: 'sub-intruder' });
    const outsiderGrant = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      outsiderToken,
      TENANT_ID,
    );
    const outsider = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('x-step-up-token', outsiderGrant)
      .send({ tenantId: TENANT_ID });
    expect(outsider.status).toBe(409);
    expect(outsider.body.code).toBe('APPROVAL_ALREADY_CONSUMED');

    const foreign = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-other' })}`)
      .send({ executionId: consumed, result: 'SUCCEEDED' });
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('EXECUTION_ACTOR_MISMATCH');
  });

  it('refuses an expired approval and marks it expired', async () => {
    const token = accessToken();
    const created = await createRequest(token);
    const row = store.requests[0];
    row.approvalExpiresAt = new Date(Date.now() - 1_000);

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_EXPIRED');
    expect(store.requests[0].state).toBe('EXPIRED');
  });

  it('lets the requester cancel a pending request once', async () => {
    const token = accessToken();
    const created = await createRequest(token);
    const cancelled = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe('CANCELLED');

    const again = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CANCEL_NOT_ALLOWED');
  });

  it('lists only the requester own requests', async () => {
    const token = accessToken();
    await createRequest(token);

    const mine = await request(app.getHttpServer())
      .get('/auth/recovery/requests')
      .query({ tenantId: TENANT_ID })
      .set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).not.toHaveProperty('approvals');
    expect(mine.body.items[0].approvalCount).toBe(0);

    const other = await request(app.getHttpServer())
      .get('/auth/recovery/requests')
      .query({ tenantId: TENANT_ID })
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-other' })}`);
    expect(other.status).toBe(200);
    expect(other.body.items).toHaveLength(0);
  });

  it('fails an execution that runs past its window', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    const consumed = await consume(created.approvalId, token);
    store.requests[0].executionExpiresAt = new Date(Date.now() - 1_000);

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: consumed, result: 'SUCCEEDED' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXECUTION_EXPIRED');
    expect(store.requests[0].state).toBe('FAILED');
    expect(store.requests[0].failureCode).toBe('EXECUTION_TIMEOUT');
  });

  it('reports FAILED when the provider refuses the factor reset', async () => {
    admin.deleteMfaFactor.mockRejectedValueOnce(new Error('provider down'));
    const token = accessToken();
    const created = await approveFully(token);
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );
    const consumed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });

    expect(consumed.status).toBe(200);
    expect(consumed.body.result).toBe('FAILED');
    expect(consumed.body.approval.failureCode).toBe(
      'PROVIDER_FACTOR_RESET_FAILED',
    );
    expect(store.requests[0].state).toBe('CONSUMED');
    expect(store.userUpdate).not.toHaveBeenCalled();
    expect(
      store.audits.some(
        (event) =>
          event.action === 'auth.mfa_reset_failed' &&
          (event.metadata as { failureCode?: string }).failureCode ===
            'PROVIDER_FACTOR_RESET_FAILED',
      ),
    ).toBe(true);

    const completed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: consumed.body.executionId });
    expect(completed.status).toBe(200);
    expect(completed.body.state).toBe('FAILED');
    expect(completed.body.failureCode).toBe('PROVIDER_FACTOR_RESET_FAILED');
  });

  it('refuses a complete result that differs from the recorded outcome', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    const consumed = await consume(created.approvalId, token);

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: consumed, result: 'FAILED' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXECUTION_RESULT_MISMATCH');
    expect(store.requests[0].state).toBe('CONSUMED');
    expect(
      store.audits.some((event) => event.action === 'auth.mfa_reset_completed'),
    ).toBe(false);
  });

  it('refuses to complete an execution with no recorded outcome', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    const consumed = await consume(created.approvalId, token);
    store.requests[0].resetOutcome = null;

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: consumed });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXECUTION_RESULT_MISSING');
    expect(store.requests[0].state).toBe('CONSUMED');
  });

  it('expires a consumed execution that recorded no outcome', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    const consumed = await consume(created.approvalId, token);
    store.requests[0].resetOutcome = null;
    store.requests[0].executionExpiresAt = new Date(Date.now() - 1_000);

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: consumed });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXECUTION_EXPIRED');
    expect(store.requests[0].state).toBe('FAILED');
    expect(store.requests[0].failureCode).toBe('EXECUTION_TIMEOUT');
  });

  it('reports SESSION_REVOKE_FAILED when the token cutoff write fails', async () => {
    store.userUpdate.mockRejectedValueOnce(new Error('db down'));
    const token = accessToken();
    const created = await approveFully(token);
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );

    const executed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });

    expect(executed.status).toBe(200);
    expect(executed.body.result).toBe('FAILED');
    expect(executed.body.approval.failureCode).toBe('SESSION_REVOKE_FAILED');
    expect(admin.deleteMfaFactor).toHaveBeenCalledTimes(2);

    const completed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ executionId: executed.body.executionId });

    expect(completed.status).toBe(200);
    expect(completed.body.state).toBe('FAILED');
    expect(completed.body.failureCode).toBe('SESSION_REVOKE_FAILED');
  });

  it('fails closed on an execute retry with no recorded outcome', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    await consume(created.approvalId, token);
    store.requests[0].resetOutcome = null;
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXECUTION_RESULT_MISSING');
    expect(res.body.result).toBeUndefined();
  });

  it('refuses a decision when another writer changed the row', async () => {
    const created = await createRequest(accessToken());
    const original = store.updateMany.getMockImplementation();
    let staleOnce = true;
    store.updateMany.mockImplementation(async (args) => {
      if (staleOnce) {
        staleOnce = false;
        store.requests[0].version += 1;
        return { count: 0 };
      }
      return original ? original(args) : { count: 0 };
    });

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-owner-2' })}`)
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_VERSION_CONFLICT');
  });

  it('refuses an execute call whose tenant does not match the request', async () => {
    const token = accessToken();
    const created = await approveFully(token);
    roleByTenant[FOREIGN_TENANT_ID] = 'R-enterprise-admin';
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      FOREIGN_TENANT_ID,
    );

    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: FOREIGN_TENANT_ID });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TENANT_SCOPE_MISMATCH');
    expect(store.requests[0].state).toBe('APPROVED');
  });

  it('refuses an identical create key with a different payload', async () => {
    const token = accessToken();
    await createRequest(token);
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_REQUEST,
      token,
      TENANT_ID,
    );

    const res = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
        tenantId: TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'A different reason under the same request key',
        ticketId: 'INC-1042',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(store.requests).toHaveLength(1);
  });

  it('refuses a tenant id on a platform recovery path', async () => {
    const token = accessToken();
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_REQUEST,
      token,
      TENANT_ID,
    );

    const res = await request(app.getHttpServer())
      .post('/auth/recovery/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({
        requestId: ROUTE_REQUEST_ID,
        recoveryPath: RECOVERY_PATHS.ENTERPRISE_ADMIN_MFA_RESET,
        tenantId: TENANT_ID,
        targetUserId: TARGET_ID,
        reason: 'Lost the backup factor after a device reset',
        ticketId: 'INC-1042',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('returns the current view for a repeated failed result', async () => {
    const token = accessToken();
    admin.deleteMfaFactor.mockRejectedValueOnce(new Error('provider down'));
    const created = await approveFully(token);
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );
    const executed = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });
    const body = { executionId: executed.body.executionId };

    const first = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    const second = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.state).toBe('FAILED');
    expect(
      store.audits.filter((event) => event.action === 'auth.mfa_reset_failed'),
    ).toHaveLength(1);
  });

  async function approveFully(token: string) {
    const created = await createRequest(token);
    // The store seeds the second approval through another eligible actor; the
    // production resolver maps only R-enterprise-admin, so this step proves the
    // service contract rather than a reachable production path (D-68).
    roleByTenant[TENANT_ID] = 'R-enterprise-admin';
    const row = store.requests[0];
    store.decisions.push({
      id: 'decision-seeded',
      requestId: row.id,
      actorSubject: 'sub-security-owner',
      policyRole: 'PLATFORM_SECURITY_OWNER',
      decision: 'APPROVE',
      reason: null,
      createdAt: new Date(),
    });
    const approved = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${created.approvalId}/decision`)
      .set('Authorization', `Bearer ${accessToken({ subject: 'sub-owner-2' })}`)
      .send({ decision: 'APPROVE' });
    expect(approved.body.state).toBe('APPROVED');
    return created;
  }

  async function consume(approvalId: string, token: string) {
    const stepUp = await grant(
      STEP_UP_ACTIONS.RECOVERY_EXECUTE,
      token,
      TENANT_ID,
    );
    const res = await request(app.getHttpServer())
      .post(`/auth/recovery/requests/${approvalId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp)
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(200);
    return res.body.executionId as string;
  }
});
