/**
 * Permission codes and canonical roles (T1.03, F-02/F-03/F-04).
 *
 * Permission codes are stable, version-controlled authorization
 * capabilities (docs/DATABASE.md section 5: E-permission). Canonical
 * roles come from docs/PRD.md section 2. The policy maps roles to
 * codes; nothing grants access by role name alone (docs/SECURITY.md
 * section 3).
 */

export const PERMISSIONS = {
  /** Platform-wide tenant governance: only R-enterprise-admin (AC-F03-3). */
  TENANT_MANAGE_PLATFORM: 'tenant.manage.platform',
  USER_CREATE: 'user.create',
  USER_DISABLE: 'user.disable',
  ROLE_MANAGE: 'role.manage',
  TICKET_READ: 'ticket.read',
  TICKET_WRITE: 'ticket.write',
  /**
   * Open a support ticket for the caller's own customer record (T2.04
   * follow-up). Separate from `ticket.write`: it can only create a new row
   * whose customer and tenant the server derives from the verified identity,
   * so it never grants a change to another customer's ticket.
   */
  TICKET_REQUEST: 'ticket.request',
  /**
   * Post a message into a conversation the caller may see (API-13, T6.05).
   * Agents hold it through their ticket permissions; R-customer holds it for
   * its own customer-visible conversation only, and the ownership check in
   * the controller enforces that boundary.
   */
  MESSAGE_CREATE: 'message.create',
  NOTE_INTERNAL_READ: 'note.internal.read',
  NOTE_INTERNAL_WRITE: 'note.internal.write',
  KNOWLEDGE_MANAGE: 'knowledge.manage',
  /**
   * Configure the tenant's retention windows (T6.06, F-14, AC-F14-2).
   * R-tenant-admin only: retention shortens or lengthens how long tenant data
   * stays available, so it is a governance capability, not a support one.
   */
  RETENTION_MANAGE: 'retention.manage',
  AI_AGENT_CONFIGURE: 'ai.agent.configure',
  AI_AGENT_PUBLISH: 'ai.agent.publish',
  /** Decide a consequential AI tool approval (T4.04, F-10; D-20). */
  AI_TOOL_APPROVE: 'ai.tool.approve',
  AUDIT_READ: 'audit.read',
  /**
   * Export a signed audit artifact (D-60). Separate from `audit.read`, so a
   * reader does not gain bulk export.
   */
  AUDIT_EXPORT: 'audit.export',
  /**
   * Request or execute an approved MFA reset for another account (D-59). The
   * recovery matrix still limits the target and the approvers.
   */
  USER_MFA_RESET: 'user.mfa.reset',
  /** Run access-review campaigns and apply their decisions (D-62). */
  ACCESS_REVIEW_MANAGE: 'access.review.manage',
  /** Approve another principal's high-risk role change (D-62). */
  ROLE_CHANGE_APPROVE: 'role.change.approve',
  ANALYTICS_READ: 'analytics.read',
  /** Register webhook endpoints for the own tenant (T5.05, D-30). */
  INTEGRATION_MANAGE: 'integration.manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const CANONICAL_ROLES = [
  'R-enterprise-admin',
  'R-tenant-admin',
  'R-agent',
  'R-customer',
  'R-developer',
  'R-anonymous',
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];
