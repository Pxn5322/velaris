/**
 * One-time step-up grants (T6.08, D-58; INV-02).
 *
 * A grant is bound to the verified subject, Supabase session, tenant and
 * action. Only a SHA-256 digest is stored. The first successful verification
 * consumes the row, so a replay or a grant used for another action fails.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

export const STEP_UP_ACTIONS = {
  SESSION_REVOKE: 'session.revoke',
  ROLE_CHANGE: 'role.change',
  MEMBERSHIP_CHANGE: 'membership.change',
  TENANT_CHANGE: 'tenant.change',
  PROVIDER_CHANGE: 'provider.change',
  RETENTION_CHANGE: 'retention.change',
  ATTACHMENT_SEND: 'attachment.send',
} as const;

export type StepUpAction =
  (typeof STEP_UP_ACTIONS)[keyof typeof STEP_UP_ACTIONS];

const ACTION_POLICY: Record<StepUpAction, { mfa: boolean }> = {
  [STEP_UP_ACTIONS.SESSION_REVOKE]: { mfa: false },
  [STEP_UP_ACTIONS.ROLE_CHANGE]: { mfa: true },
  [STEP_UP_ACTIONS.MEMBERSHIP_CHANGE]: { mfa: true },
  [STEP_UP_ACTIONS.TENANT_CHANGE]: { mfa: true },
  [STEP_UP_ACTIONS.PROVIDER_CHANGE]: { mfa: true },
  [STEP_UP_ACTIONS.RETENTION_CHANGE]: { mfa: true },
  [STEP_UP_ACTIONS.ATTACHMENT_SEND]: { mfa: true },
};

export const STEP_UP_TTL_MS = 10 * 60 * 1_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StepUpInput {
  action?: unknown;
  tenantId?: unknown;
  password?: unknown;
}

export interface IssuedStepUp {
  token: string;
  action: StepUpAction;
  tenantId: string | null;
  expiresAt: Date;
}

@Injectable()
export class StepUpService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly verifier: SupabaseTokenVerifier,
  ) {}

  /** True when the action requires an `aal2` token before a grant is issued. */
  requiresMfa(action: string): boolean {
    return ACTION_POLICY[action as StepUpAction]?.mfa ?? true;
  }

  /**
   * Re-authenticate with the current password and issue a grant. The raw token
   * leaves the server once; the database receives only its digest.
   */
  async issue(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance,
    input: StepUpInput,
  ): Promise<IssuedStepUp> {
    const action = this.readAction(input.action);
    const tenantId = readTenantId(input.tenantId);
    if (this.requiresMfa(action) && assurance.aal !== 'aal2') {
      throw mfaRequired();
    }
    if (!assurance.sessionId) {
      throw new BadRequestException({
        code: 'SESSION_REQUIRED',
        message: 'A verified session is required for step-up',
      });
    }
    if (!identity.email) {
      throw new BadRequestException({
        code: 'EMAIL_REQUIRED',
        message: 'The account has no email address for step-up',
      });
    }
    if (typeof input.password !== 'string' || input.password.length === 0) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_REQUIRED',
        message: 'The current password is required',
      });
    }
    if (!(await this.verifier.verifyPassword(identity.email, input.password))) {
      throw currentPasswordInvalid();
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS);
    await this.prisma.stepUpGrant.create({
      data: {
        subject: identity.subject,
        sessionId: assurance.sessionId,
        tenantId,
        action,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });
    return { token, action, tenantId, expiresAt };
  }

  /** Consume a grant when every binding matches and it has not expired. */
  async verify(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance,
    action: string,
    tenantId: string | null,
    token: string | undefined,
  ): Promise<boolean> {
    if (!token || !isKnownAction(action) || !assurance.sessionId) {
      return false;
    }
    const tokenHash = hashToken(token);
    const grant = await this.prisma.stepUpGrant.findUnique({
      where: { tokenHash },
      select: {
        tokenHash: true,
        subject: true,
        sessionId: true,
        tenantId: true,
        action: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    });
    if (!grant) {
      return false;
    }
    if (
      grant.subject !== identity.subject ||
      grant.sessionId !== assurance.sessionId ||
      grant.action !== action ||
      (grant.tenantId ?? null) !== (tenantId ?? null) ||
      grant.usedAt !== null ||
      grant.revokedAt !== null ||
      grant.expiresAt.getTime() <= Date.now()
    ) {
      return false;
    }

    const consumed = await this.prisma.stepUpGrant.updateMany({
      where: {
        tokenHash,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    return consumed.count === 1;
  }

  /** Revoke every grant for a subject after sign-out-all or a password change. */
  async revokeForSubject(subject: string): Promise<void> {
    await this.prisma.stepUpGrant.updateMany({
      where: { subject, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke grants bound to one Supabase session. */
  async revokeForSession(sessionId: string): Promise<void> {
    await this.prisma.stepUpGrant.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private readAction(value: unknown): StepUpAction {
    if (typeof value !== 'string' || !isKnownAction(value)) {
      throw new BadRequestException({
        code: 'STEP_UP_ACTION_INVALID',
        message: 'The step-up action is not supported',
      });
    }
    return value;
  }
}

export function mfaRequired(): ForbiddenException {
  return new ForbiddenException({
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required for this action',
  });
}

export function stepUpRequired(): ForbiddenException {
  return new ForbiddenException({
    code: 'STEP_UP_REQUIRED',
    message: 'A recent step-up is required for this action',
  });
}

export function currentPasswordInvalid(): ForbiddenException {
  return new ForbiddenException({
    code: 'CURRENT_PASSWORD_INVALID',
    message: 'The current password is not valid',
  });
}

function isKnownAction(value: string): value is StepUpAction {
  return Object.prototype.hasOwnProperty.call(ACTION_POLICY, value);
}

function readTenantId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException({
      code: 'TENANT_ID_INVALID',
      message: 'tenantId must be a UUID',
    });
  }
  return value;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
