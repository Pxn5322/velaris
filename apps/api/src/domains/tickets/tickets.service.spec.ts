import { describe, it, expect, beforeEach } from 'vitest';
import { TicketsService } from './tickets.service.js';
import {
  tenantA,
  tenantB,
  tenantAFixture,
  tenantBFixture,
  scopeByTenant,
  findTenantEscapes,
  customerVisibleMessages,
  ticketsForTenant,
} from 'test-utils';

describe('TicketsService tenant isolation', () => {
  let service: TicketsService;

  beforeEach(() => {
    service = new TicketsService();
  });

  const seed = () => {
    service.create({
      title: tenantAFixture.ticket.title,
      description: 'Tenant A ticket',
      customerEmail: tenantAFixture.ticket.customerEmail,
      priority: tenantAFixture.ticket.priority,
      tenantId: tenantA.id,
    });
    service.create({
      title: tenantBFixture.ticket.title,
      description: 'Tenant B ticket',
      customerEmail: tenantBFixture.ticket.customerEmail,
      priority: tenantBFixture.ticket.priority,
      tenantId: tenantB.id,
    });
  };

  it('creates a ticket with OPEN status and default priority', () => {
    const ticket = service.create({
      title: 'Test',
      description: 'desc',
      customerEmail: 'a@example.com',
      tenantId: tenantA.id,
    });
    expect(ticket.status).toBe('OPEN');
    expect(ticket.priority).toBe('MEDIUM');
    expect(ticket.tenantId).toBe(tenantA.id);
  });

  it('findAll returns only tenant A tickets for tenant A (AC-F04-1)', () => {
    seed();
    const result = service.findAll(tenantA.id);
    expect(result).toHaveLength(1);
    expect(result[0].tenantId).toBe(tenantA.id);
  });

  it('findAll for tenant A returns no tenant B ticket (AC-F04-3)', () => {
    seed();
    const result = service.findAll(tenantA.id);
    const escapes = findTenantEscapes(result, tenantA.id);
    expect(escapes).toHaveLength(0);
  });

  it('scopeByTenant helper agrees with service findAll', () => {
    seed();
    const all = service.findAll();
    const scoped = scopeByTenant(all, tenantA.id);
    expect(scoped).toEqual(service.findAll(tenantA.id));
  });

  it('findOne hides a tenant B ticket from a tenant A scope (TH-01)', () => {
    const bTicket = service.create({
      title: tenantBFixture.ticket.title,
      description: 'b',
      customerEmail: 'b@example.com',
      tenantId: tenantB.id,
    });
    expect(() => service.findOne(bTicket.id, tenantA.id)).toThrow();
  });

  it('remove blocks tenant A from deleting a tenant B ticket', () => {
    const bTicket = service.create({
      title: tenantBFixture.ticket.title,
      description: 'b',
      customerEmail: 'b@example.com',
      tenantId: tenantB.id,
    });
    expect(() => service.remove(bTicket.id, tenantA.id)).toThrow();
    expect(service.findOne(bTicket.id, tenantB.id)).toBeDefined();
  });

  it('ticketsForTenant helper matches fixture ownership', () => {
    const result = ticketsForTenant(
      [tenantAFixture.ticket, tenantBFixture.ticket],
      tenantA.id,
    );
    expect(result).toHaveLength(1);
    expect(result[0].tenantId).toBe(tenantA.id);
  });

  it('update changes ticket fields and bumps updatedAt', () => {
    const ticket = service.create({
      title: 'Orig',
      description: 'd',
      customerEmail: 'a@example.com',
      tenantId: tenantA.id,
    });
    const updated = service.update(
      ticket.id,
      { status: 'RESOLVED', priority: 'URGENT' },
      tenantA.id,
    );
    expect(updated.status).toBe('RESOLVED');
    expect(updated.priority).toBe('URGENT');
  });

  it('update throws for an unknown ticket id', () => {
    expect(() => service.update('missing', { title: 'x' }, tenantA.id)).toThrow();
  });

  it('remove deletes a ticket in the correct tenant scope', () => {
    const ticket = service.create({
      title: 'Del',
      description: 'd',
      customerEmail: 'a@example.com',
      tenantId: tenantA.id,
    });
    expect(service.remove(ticket.id, tenantA.id)).toEqual({ success: true });
    expect(() => service.findOne(ticket.id, tenantA.id)).toThrow();
  });

  it('remove throws for an unknown ticket id', () => {
    expect(() => service.remove('missing', tenantA.id)).toThrow();
  });

  it('internal note is excluded from customer-visible messages (TH-05)', () => {
    const visible = customerVisibleMessages(tenantAFixture.messages);
    expect(visible).toHaveLength(1);
    expect(visible[0].visibility).toBe('customerVisible');
    expect(
      visible.some((m) => m.id === tenantAFixture.messages[1].id),
    ).toBe(false);
  });
});
