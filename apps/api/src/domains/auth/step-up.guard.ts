/**
 * Require a recent step-up for one sensitive action (T6.08, D-58).
 *
 * The guard runs after SupabaseAuthGuard. It reads the action from metadata,
 * checks `aal2` when the action policy requires multi-factor authentication,
 * then consumes the one-time grant from `x-step-up-token`.
 */

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import {
  STEP_UP_DECORATOR_KEY,
  type StepUpRequirement,
} from './require-step-up.decorator.js';
import {
  StepUpService,
  mfaRequired,
  stepUpRequired,
} from './step-up.service.js';

type GuardedRequest = {
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: { tenantId?: unknown } | undefined;
  user?: AuthenticatedIdentity;
  authAssurance?: AuthAssurance;
  stepUp?: { action: string; tenantId: string | null };
};

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly stepUps: StepUpService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const requirement = this.reflector.getAllAndOverride<
      StepUpRequirement | string | undefined
    >(STEP_UP_DECORATOR_KEY, [context.getHandler(), context.getClass()]);
    const action =
      typeof requirement === 'string' ? requirement : requirement?.action;
    if (!action) {
      throw new ForbiddenException('Route declares no step-up action');
    }
    if (!request.user || !request.authAssurance) {
      throw new UnauthorizedException();
    }
    if (
      typeof requirement !== 'string' &&
      requirement?.when === 'attachments' &&
      !hasAttachments(request.body)
    ) {
      return true;
    }
    if (
      this.stepUps.requiresMfa(action) &&
      request.authAssurance.aal !== 'aal2'
    ) {
      throw mfaRequired();
    }

    const tenantId = readTenantId(request);
    const header = request.headers['x-step-up-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (
      !(await this.stepUps.verify(
        request.user,
        request.authAssurance,
        action,
        tenantId,
        token,
      ))
    ) {
      throw stepUpRequired();
    }
    request.stepUp = { action, tenantId };
    return true;
  }
}

function hasAttachments(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const attachments = (body as { attachments?: unknown }).attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

function readTenantId(request: GuardedRequest): string | null {
  for (const candidate of [
    request.params?.tenantId,
    request.query?.tenantId,
    request.body?.tenantId,
  ]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}
