import { describe, it, expect, beforeEach } from 'vitest';
import { AgentsService } from './agents.service.js';
import { tenantA, tenantB, findTenantEscapes } from 'test-utils';

describe('AgentsService tenant isolation', () => {
  let service: AgentsService;

  beforeEach(() => {
    service = new AgentsService();
  });

  it('findAll returns only tenant A agents (AC-F04-1)', () => {
    // Service starts empty and has no create; seed via the private store to
    // model a repository read against known fixture rows.
    (service as unknown as { agents: unknown[] }).agents = [
      {
        id: 'a1',
        tenantId: tenantA.id,
        name: 'Agent A',
        email: 'a@example.com',
        role: 'AGENT',
        status: 'ONLINE',
      },
      {
        id: 'b1',
        tenantId: tenantB.id,
        name: 'Agent B',
        email: 'b@example.com',
        role: 'AGENT',
        status: 'OFFLINE',
      },
    ];
    const result = service.findAll(tenantA.id);
    expect(result).toHaveLength(1);
    expect(result[0].tenantId).toBe(tenantA.id);
  });

  it('findAll for tenant A returns no tenant B agent (AC-F04-3)', () => {
    (service as unknown as { agents: unknown[] }).agents = [
      {
        id: 'a1',
        tenantId: tenantA.id,
        name: 'Agent A',
        email: 'a@example.com',
        role: 'AGENT',
        status: 'ONLINE',
      },
      {
        id: 'b1',
        tenantId: tenantB.id,
        name: 'Agent B',
        email: 'b@example.com',
        role: 'AGENT',
        status: 'OFFLINE',
      },
    ];
    const escapes = findTenantEscapes(service.findAll(tenantA.id), tenantA.id);
    expect(escapes).toHaveLength(0);
  });

  it('findAll with no scope returns every agent', () => {
    (service as unknown as { agents: unknown[] }).agents = [
      {
        id: 'a1',
        tenantId: tenantA.id,
        name: 'Agent A',
        email: 'a@example.com',
        role: 'AGENT',
        status: 'ONLINE',
      },
      {
        id: 'b1',
        tenantId: tenantB.id,
        name: 'Agent B',
        email: 'b@example.com',
        role: 'AGENT',
        status: 'OFFLINE',
      },
    ];
    expect(service.findAll()).toHaveLength(2);
  });
});
