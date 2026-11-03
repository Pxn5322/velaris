/**
 * Deterministic tool-execution contracts (T4.04; F-10, TH-03).
 *
 * A `ToolProposal` is untrusted data: it can come from the LLM. It names a
 * tool and arguments, nothing else. Tenant, user, permission and approval
 * decision come from server state — never from the proposal — so a prompt
 * injection cannot widen scope (SECURITY.md sections 3 and 7).
 */

/** Untrusted proposal from the model or runtime. */
export interface ToolProposal {
  /** Server-resolved tenant context; never supplied by the model. */
  tenantId: string;
  /** Agent version whose grants apply for this run. */
  agentVersionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/** Server-resolved caller identity. */
export interface ToolActor {
  userId: string;
  role: string | null;
}

export type ToolDenialReason =
  | 'unknown_tool'
  | 'tool_disabled'
  | 'not_granted'
  | 'missing_permission'
  | 'invalid_arguments'
  | 'policy_violation';

export type ToolFailureReason = 'timeout' | 'handler_error';

/**
 * Outcome of one execution attempt. A DENIED, PENDING_APPROVAL or FAILED
 * outcome means the handler never produced a side effect.
 */
export type ToolExecutionOutcome =
  | {
      status: 'EXECUTED';
      toolName: string;
      result: unknown;
      durationMs: number;
    }
  | {
      status: 'DENIED';
      toolName: string;
      reason: ToolDenialReason;
      detail: string | null;
    }
  | { status: 'PENDING_APPROVAL'; toolName: string; approvalId: string }
  | { status: 'FAILED'; toolName: string; reason: ToolFailureReason };

/** Execution context handed to a tool handler. */
export interface ToolHandlerContext {
  tenantId: string;
  userId: string;
  toolName: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolHandlerContext,
) => Promise<unknown>;

/** Persistence port for the human approval gate (AC-F10-2). */
export interface ToolApprovalGate {
  /** An approved, unexpired, unconsumed decision for this exact proposal. */
  findUsable(input: {
    tenantId: string;
    toolDefinitionId: string;
    agentVersionId: string;
    proposalHash: string;
  }): Promise<{ id: string } | null>;
  /** Open (or reuse) a pending request so a human can decide. */
  request(input: {
    tenantId: string;
    toolDefinitionId: string;
    agentVersionId: string;
    proposalHash: string;
    proposalJson: Record<string, unknown>;
    requestedBy: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  /** Claim an approved decision exactly once; false when another run won. */
  claim(approvalId: string): Promise<boolean>;
}

/** Minimal audit port so the executor stays testable without a database. */
export interface ToolAuditSink {
  record(event: {
    action: string;
    resourceType: string;
    resourceId?: string;
    tenantId?: string;
    actorId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/** DI token: the approval gate implementation. */
export const TOOL_APPROVAL_GATE = Symbol('TOOL_APPROVAL_GATE');
