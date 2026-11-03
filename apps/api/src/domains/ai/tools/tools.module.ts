import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module.js';
import { AuditService } from '../../audit/audit.service.js';
import { PermissionsModule } from '../../permissions/permissions.module.js';
import { ToolProposalGuard } from '../guardrails/tool-proposal.guard.js';
import { ToolApprovalService } from './tool-approval.service.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { ToolRegistry } from './tool-registry.js';
import { TOOL_APPROVAL_GATE } from './tool.types.js';

/** DI token for the audit port; AuditService is the real sink. */
export const TOOL_AUDIT_SINK = 'TOOL_AUDIT_SINK';

/**
 * Tool authorization module (T4.04; F-10). Wires the deterministic gate:
 * the registry holds handlers, the guardrail validates untrusted arguments,
 * the approval service persists human decisions, and AuditService records
 * every executed and denied attempt.
 */
@Module({
  imports: [PermissionsModule, AuditModule],
  providers: [
    ToolRegistry,
    ToolProposalGuard,
    ToolApprovalService,
    { provide: TOOL_APPROVAL_GATE, useExisting: ToolApprovalService },
    { provide: TOOL_AUDIT_SINK, useExisting: AuditService },
    ToolExecutionService,
  ],
  exports: [ToolExecutionService, ToolRegistry, ToolApprovalService],
})
export class ToolsModule {}
