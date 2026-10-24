import { describe, it, expect, beforeEach } from 'vitest';
import { AiAgentService } from './ai-agent.service.js';
import { tenantA, tenantB, findTenantEscapes } from 'test-utils';

describe('AiAgentService', () => {
  let service: AiAgentService;

  beforeEach(() => {
    service = new AiAgentService();
  });

  it('creates an agent with default threshold and ACTIVE status', () => {
    const agent = service.create({
      name: 'Support Bot',
      systemPrompt: 'Answer with citations.',
      tenantId: tenantA.id,
    });
    expect(agent.groundingThreshold).toBe(0.75);
    expect(agent.status).toBe('ACTIVE');
    expect(agent.tenantId).toBe(tenantA.id);
  });

  it('create honors an explicit groundingThreshold', () => {
    const agent = service.create({
      name: 'Strict Bot',
      systemPrompt: 'p',
      groundingThreshold: 0.9,
      tenantId: tenantA.id,
    });
    expect(agent.groundingThreshold).toBe(0.9);
  });

  it('findAll returns only tenant A agents (AC-F04-1)', () => {
    service.create({ name: 'A Bot', systemPrompt: 'p', tenantId: tenantA.id });
    service.create({ name: 'B Bot', systemPrompt: 'p', tenantId: tenantB.id });
    const result = service.findAll(tenantA.id);
    expect(result).toHaveLength(1);
    expect(result[0].tenantId).toBe(tenantA.id);
  });

  it('findAll for tenant A returns no tenant B agent (AC-F04-3)', () => {
    service.create({ name: 'A Bot', systemPrompt: 'p', tenantId: tenantA.id });
    service.create({ name: 'B Bot', systemPrompt: 'p', tenantId: tenantB.id });
    const escapes = findTenantEscapes(service.findAll(tenantA.id), tenantA.id);
    expect(escapes).toHaveLength(0);
  });

  it('findOne returns a created agent by id', () => {
    const created = service.create({ name: 'A Bot', systemPrompt: 'p', tenantId: tenantA.id });
    expect(service.findOne(created.id).id).toBe(created.id);
  });

  it('findOne throws NotFoundException for an unknown id', () => {
    expect(() => service.findOne('missing')).toThrow();
  });
});
