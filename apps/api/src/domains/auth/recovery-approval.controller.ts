/**
 * Privileged recovery approval routes (T6.09; D-62 contract, D-66 policy).
 *
 * Guard chain: SupabaseAuthGuard, then StepUpGuard where a one-time grant is
 * required. `create` consumes a `recovery.request` grant and `execute`
 * consumes a `recovery.execute` grant, so neither privileged step can repeat
 * a consumed grant. The service rechecks `aal2` for every operation and owns
 * the state machine, so a route that is reached by another caller still
 * denies.
 *
 * The routes store and enforce approvals only. They perform no provider reset,
 * send no notification and grant no permission code. The production policy
 * mapping resolves only R-enterprise-admin (D-68), so a real request cannot
 * reach its full approver quota until D-62 seeds the other duties.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import { RequireStepUp } from './require-step-up.decorator.js';
import {
  RecoveryApprovalService,
  type CompleteRecoveryApprovalInput,
  type ConsumeRecoveryApprovalInput,
  type CreateRecoveryApprovalInput,
  type DecideRecoveryApprovalInput,
  type ListRecoveryApprovalQuery,
  type RecoveryApprovalView,
} from './recovery-approval.service.js';
import { StepUpGuard } from './step-up.guard.js';
import { STEP_UP_ACTIONS } from './step-up.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';

type RecoveryRequest = Request & {
  user?: AuthenticatedIdentity;
  authAssurance?: AuthAssurance;
};

@Controller('auth/recovery/requests')
@UseGuards(SupabaseAuthGuard)
export class RecoveryApprovalController {
  constructor(private readonly approvals: RecoveryApprovalService) {}

  /** Create one approval request for a privileged recovery path. */
  @Post()
  @UseGuards(StepUpGuard)
  @RequireStepUp(STEP_UP_ACTIONS.RECOVERY_REQUEST)
  async create(
    @Req() request: RecoveryRequest,
    @Body() body: CreateRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView> {
    const { identity, assurance } = readContext(request);
    return this.approvals.create(identity, assurance, body ?? {});
  }

  /** Requests that the caller created; never another requester's records. */
  @Get()
  async listMine(
    @Req() request: RecoveryRequest,
    @Query() query: ListRecoveryApprovalQuery,
  ): Promise<{ items: RecoveryApprovalView[] }> {
    const { identity } = readContext(request);
    return this.approvals.listMine(identity, query ?? {});
  }

  /** One request, for its requester, its target or an eligible approver. */
  @Get(':approvalId')
  async get(
    @Req() request: RecoveryRequest,
    @Param('approvalId') approvalId: string,
  ): Promise<RecoveryApprovalView> {
    const { identity } = readContext(request);
    return this.approvals.get(identity, approvalId);
  }

  /** Record one approval or denial. Needs `aal2`, not a step-up grant. */
  @Post(':approvalId/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Req() request: RecoveryRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: DecideRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView> {
    const { identity, assurance } = readContext(request);
    return this.approvals.decide(identity, assurance, approvalId, body ?? {});
  }

  /** Open the single execution window for an approved request. */
  @Post(':approvalId/execute')
  @HttpCode(HttpStatus.OK)
  @UseGuards(StepUpGuard)
  @RequireStepUp(STEP_UP_ACTIONS.RECOVERY_EXECUTE)
  async execute(
    @Req() request: RecoveryRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: ConsumeRecoveryApprovalInput,
  ) {
    const { identity, assurance } = readContext(request);
    return this.approvals.consume(identity, assurance, approvalId, body ?? {});
  }

  /** Report the result of the execution opened by `execute`. */
  @Post(':approvalId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Req() request: RecoveryRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: CompleteRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView> {
    const { identity, assurance } = readContext(request);
    return this.approvals.complete(identity, assurance, approvalId, body ?? {});
  }

  /** Cancel a pending or approved request before it is consumed. */
  @Post(':approvalId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() request: RecoveryRequest,
    @Param('approvalId') approvalId: string,
  ): Promise<RecoveryApprovalView> {
    const { identity, assurance } = readContext(request);
    return this.approvals.cancel(identity, assurance, approvalId);
  }
}

function readContext(request: RecoveryRequest): {
  identity: AuthenticatedIdentity;
  assurance: AuthAssurance | undefined;
} {
  if (!request.user) {
    throw new UnauthorizedException();
  }
  return { identity: request.user, assurance: request.authAssurance };
}
