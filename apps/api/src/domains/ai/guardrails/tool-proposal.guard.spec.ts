/**
 * Guardrail unit contract (T4.04, F-10, TH-03/TH-04).
 *
 * The guard runs on untrusted arguments, so each rejection path is asserted
 * separately: wrong shape, model-chosen scope, size abuse, schema mismatch,
 * extra properties and a broken registered schema.
 */

import { describe, expect, it } from 'vitest';
import { ToolProposalGuard } from './tool-proposal.guard.js';

const guard = new ToolProposalGuard();

const schema = {
  type: 'object',
  properties: {
    ticketId: { type: 'string', format: 'uuid' },
    reason: { type: 'string', maxLength: 10 },
  },
  required: ['ticketId'],
  additionalProperties: false,
};

const valid = { ticketId: '77777777-7777-4777-8777-777777777777' };

describe('ToolProposalGuard', () => {
  it('accepts arguments that satisfy the registered schema', () => {
    expect(guard.validate(schema, valid)).toEqual({ ok: true });
  });

  it('rejects a non-object payload', () => {
    const result = guard.validate(schema, ['ticketId']);

    expect(result).toMatchObject({ ok: false, reason: 'invalid_arguments' });
  });

  it('rejects null arguments', () => {
    expect(guard.validate(schema, null)).toMatchObject({
      ok: false,
      reason: 'invalid_arguments',
    });
  });

  it('rejects a model-chosen tenant scope even when the schema allows it', () => {
    const permissive = { type: 'object', additionalProperties: true };

    const result = guard.validate(permissive, {
      ...valid,
      tenantId: '22222222-2222-4222-8222-222222222222',
    });

    expect(result).toMatchObject({ ok: false, reason: 'policy_violation' });
  });

  it('rejects the snake_case scope alias too', () => {
    const result = guard.validate(
      { type: 'object', additionalProperties: true },
      { tenant_id: '22222222-2222-4222-8222-222222222222' },
    );

    expect(result).toMatchObject({ ok: false, reason: 'policy_violation' });
  });

  it('rejects arguments that exceed the size limit', () => {
    const result = guard.validate(schema, {
      ticketId: valid.ticketId,
      reason: 'x'.repeat(40_000),
    });

    expect(result).toMatchObject({ ok: false, reason: 'policy_violation' });
  });

  it('rejects an extra property when the schema forbids them', () => {
    const result = guard.validate(schema, { ...valid, escalated: true });

    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid_arguments',
    });
  });

  it('rejects a value with the wrong type instead of coercing it', () => {
    const result = guard.validate(schema, { ticketId: 7 });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_arguments' });
  });

  it('rejects a value that breaks a declared format', () => {
    const result = guard.validate(schema, { ticketId: 'not-a-uuid' });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_arguments' });
  });

  it('denies when the registered schema itself is unusable', () => {
    const broken = { type: 'object', required: 'ticketId' };

    const result = guard.validate(broken, valid);

    expect(result).toMatchObject({ ok: false, reason: 'invalid_arguments' });
  });

  it('denies when no schema object is registered', () => {
    expect(guard.validate(null, valid)).toMatchObject({
      ok: false,
      reason: 'invalid_arguments',
    });
  });

  it('names the offending field in the detail', () => {
    const result = guard.validate(schema, { ticketId: 'nope' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain('ticketId');
    }
  });
});
