import { describe, it, expect, beforeEach } from 'vitest';
import { CustomersService } from './customers.service.js';
import { tenantA, tenantB, findTenantEscapes } from 'test-utils';

describe('CustomersService tenant isolation', () => {
  let service: CustomersService;

  beforeEach(() => {
    service = new CustomersService();
  });

  const seed = () => {
    service.create({
      name: 'Alice A',
      email: 'alice-a@example.com',
      tenantId: tenantA.id,
    });
    service.create({
      name: 'Bob B',
      email: 'bob-b@example.com',
      tenantId: tenantB.id,
    });
  };

  it('creates a customer with defaults when fields are missing', () => {
    const customer = service.create({});
    expect(customer.tenantId).toBe('default');
    expect(customer.name).toBe('Anonymous');
    expect(customer.email).toBe('');
  });

  it('findAll returns only tenant A customers (AC-F04-1)', () => {
    seed();
    const result = service.findAll(tenantA.id);
    expect(result).toHaveLength(1);
    expect(result[0].tenantId).toBe(tenantA.id);
  });

  it('findAll for tenant A returns no tenant B customer (AC-F04-3)', () => {
    seed();
    const escapes = findTenantEscapes(service.findAll(tenantA.id), tenantA.id);
    expect(escapes).toHaveLength(0);
  });

  it('findAll with no scope returns every customer', () => {
    seed();
    expect(service.findAll()).toHaveLength(2);
  });
});
