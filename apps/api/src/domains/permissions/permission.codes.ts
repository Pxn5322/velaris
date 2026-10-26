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
  NOTE_INTERNAL_READ: 'note.internal.read',
  NOTE_INTERNAL_WRITE: 'note.internal.write',
  KNOWLEDGE_MANAGE: 'knowledge.manage',
  AI_AGENT_CONFIGURE: 'ai.agent.configure',
  AI_AGENT_PUBLISH: 'ai.agent.publish',
  AUDIT_READ: 'audit.read',
  ANALYTICS_READ: 'analytics.read',
} as const;

export type PermissionCode =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const CANONICAL_ROLES = [
  'R-enterprise-admin',
  'R-tenant-admin',
  'R-agent',
  'R-customer',
  'R-developer',
  'R-anonymous',
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];
