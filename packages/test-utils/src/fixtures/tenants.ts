/**
 * Synthetic tenant fixtures for VELARIS tests (TESTING.md §6).
 *
 * Two isolated tenants (A and B) let data-access tests prove isolation:
 * a query scoped to tenant A must never return a tenant B record.
 * All data is synthetic. No secrets, no real customer content.
 */

/** A tenant in the isolation matrix. Tenant A and B never share an ID. */
export interface TenantFixture {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
}

/** A membership row that binds a principal to one tenant and one role. */
export interface MembershipFixture {
  userId: string;
  tenantId: string;
  role: 'R-tenant-admin' | 'R-agent' | 'R-customer';
}

/** A support ticket scoped to exactly one tenant. */
export interface TicketFixture {
  id: string;
  tenantId: string;
  title: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  customerEmail: string;
  assignedAgentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One message on a ticket timeline.
 *
 * The two variants prove the serialization boundary (TH-05):
 * `customerVisible` reaches the customer portal; `internalNote` must not.
 */
export interface MessageFixture {
  id: string;
  ticketId: string;
  tenantId: string;
  authorId: string;
  body: string;
  visibility: 'customerVisible' | 'internalNote';
  createdAt: Date;
}

/** Tenant A: an active tenant with an admin, an agent and a customer. */
export const tenantA: TenantFixture = {
  id: 'tenant-a',
  name: 'Acme Support Co',
  status: 'ACTIVE',
};

/** Tenant B: a distinct active tenant used only as the negative case. */
export const tenantB: TenantFixture = {
  id: 'tenant-b',
  name: 'Globex Service Ltd',
  status: 'ACTIVE',
};

/** A disabled tenant. It must not start new business operations (AC-F04-2). */
export const disabledTenant: TenantFixture = {
  id: 'tenant-disabled',
  name: 'Initech Suspended',
  status: 'DISABLED',
};

export const tenantAAdmin: MembershipFixture = {
  userId: 'user-a-admin',
  tenantId: tenantA.id,
  role: 'R-tenant-admin',
};

export const tenantAAgent: MembershipFixture = {
  userId: 'user-a-agent',
  tenantId: tenantA.id,
  role: 'R-agent',
};

export const tenantACustomer: MembershipFixture = {
  userId: 'user-a-customer',
  tenantId: tenantA.id,
  role: 'R-customer',
};

export const tenantBAdmin: MembershipFixture = {
  userId: 'user-b-admin',
  tenantId: tenantB.id,
  role: 'R-tenant-admin',
};

export const tenantBAgent: MembershipFixture = {
  userId: 'user-b-agent',
  tenantId: tenantB.id,
  role: 'R-agent',
};

/** A ticket owned by tenant A. Tenant B tests must never return it. */
export const tenantATicket: TicketFixture = {
  id: 'ticket-a-001',
  tenantId: tenantA.id,
  title: 'Cannot reset workspace password',
  status: 'OPEN',
  priority: 'HIGH',
  customerEmail: 'customer-a@example.com',
  assignedAgentId: tenantAAgent.userId,
  createdAt: new Date('2026-01-05T09:00:00Z'),
  updatedAt: new Date('2026-01-05T09:00:00Z'),
};

/** A ticket owned by tenant B, the negative isolation case for tenant A. */
export const tenantBTicket: TicketFixture = {
  id: 'ticket-b-001',
  tenantId: tenantB.id,
  title: 'Invoice discrepancy on last billing cycle',
  status: 'IN_PROGRESS',
  priority: 'MEDIUM',
  customerEmail: 'customer-b@example.com',
  assignedAgentId: tenantBAgent.userId,
  createdAt: new Date('2026-01-06T10:00:00Z'),
  updatedAt: new Date('2026-01-06T11:00:00Z'),
};

/**
 * A customer-visible reply on the tenant A ticket.
 * The customer portal may serialize this message.
 */
export const customerVisibleMessage: MessageFixture = {
  id: 'msg-a-001-public',
  ticketId: tenantATicket.id,
  tenantId: tenantA.id,
  authorId: tenantAAgent.userId,
  body: 'We have reset your password. Please sign in again.',
  visibility: 'customerVisible',
  createdAt: new Date('2026-01-05T09:15:00Z'),
};

/**
 * An internal note on the same ticket.
 * It must never reach the customer portal or any customer-facing response (TH-05).
 */
export const internalNoteMessage: MessageFixture = {
  id: 'msg-a-002-internal',
  ticketId: tenantATicket.id,
  tenantId: tenantA.id,
  authorId: tenantAAgent.userId,
  body: 'Customer has failed login 5 times. Possible account lockout; verify identity before reset.',
  visibility: 'internalNote',
  createdAt: new Date('2026-01-05T09:14:00Z'),
};

/** The full tenant A timeline: one public message and one internal note. */
export const tenantATicketMessages: MessageFixture[] = [
  customerVisibleMessage,
  internalNoteMessage,
];

/** The full tenant A fixture set, for suites that seed every table at once. */
export const tenantAFixture = {
  tenant: tenantA,
  admin: tenantAAdmin,
  agent: tenantAAgent,
  customer: tenantACustomer,
  ticket: tenantATicket,
  messages: tenantATicketMessages,
};

/** The full tenant B fixture set, the isolation negative case. */
export const tenantBFixture = {
  tenant: tenantB,
  admin: tenantBAdmin,
  agent: tenantBAgent,
  ticket: tenantBTicket,
};
