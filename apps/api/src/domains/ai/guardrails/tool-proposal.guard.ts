/**
 * Guardrails for an untrusted tool proposal (T4.04; F-10, TH-03, TH-04).
 *
 * Two deterministic layers run before any handler:
 *
 * 1. Policy. The model may not choose tenant scope, and arguments are
 *    bounded in size. A reserved scope key (`tenantId`, `tenant_id`) is a
 *    policy violation regardless of what the registered schema allows,
 *    because scope comes from server context only (SECURITY.md section 7).
 * 2. Schema. Arguments must satisfy the registered JSON Schema of the tool
 *    definition, compiled with `additionalProperties` honored exactly as
 *    written. A schema that fails to compile denies the call: a broken
 *    definition must never become an open door.
 *
 * The guard never mutates or coerces arguments. Coercion would let a model
 * turn "42" into a tenant id or an enum member.
 */

import { Injectable } from '@nestjs/common';
// Named import: ajv's declaration file exports the class by name, and the
// package has no ESM build, so the default import resolves to the namespace
// under moduleResolution nodenext.
import { Ajv, type ValidateFunction } from 'ajv';

export type GuardrailResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid_arguments' | 'policy_violation';
      detail: string;
    };

/** Argument names the model may never set: scope is server-resolved. */
const RESERVED_SCOPE_KEYS = ['tenantId', 'tenant_id'] as const;

/** Upper bound on serialized arguments (bytes-equivalent, characters). */
const MAX_ARGUMENT_LENGTH = 32_768;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ToolProposalGuard {
  private readonly ajv: Ajv;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor() {
    // strict:false keeps annotation keywords harmless; formats are declared
    // here because ajv-formats is not a dependency of this workspace.
    this.ajv = new Ajv({ allErrors: true, strict: false });
    this.ajv.addFormat('uuid', UUID_PATTERN);
    this.ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }

  /** Validate untrusted arguments against the tool's registered schema. */
  validate(inputSchemaJson: unknown, args: unknown): GuardrailResult {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return {
        ok: false,
        reason: 'invalid_arguments',
        detail: 'arguments must be an object',
      };
    }

    const record = args as Record<string, unknown>;

    const reserved = RESERVED_SCOPE_KEYS.filter((key) =>
      Object.hasOwn(record, key),
    );
    if (reserved.length > 0) {
      return {
        ok: false,
        reason: 'policy_violation',
        detail: `arguments may not set scope: ${reserved.join(', ')}`,
      };
    }

    const serialized = JSON.stringify(record);
    if (serialized.length > MAX_ARGUMENT_LENGTH) {
      return {
        ok: false,
        reason: 'policy_violation',
        detail: 'arguments exceed the size limit',
      };
    }

    const validator = this.validatorFor(inputSchemaJson);
    if (!validator) {
      return {
        ok: false,
        reason: 'invalid_arguments',
        detail: 'the registered input schema is not a usable JSON Schema',
      };
    }
    if (!validator(record)) {
      return {
        ok: false,
        reason: 'invalid_arguments',
        detail: this.describe(validator),
      };
    }
    return { ok: true };
  }

  /** Compile once per schema; an uncompilable schema denies the call. */
  private validatorFor(schema: unknown): ValidateFunction | null {
    if (schema === null || typeof schema !== 'object') {
      return null;
    }
    const key = JSON.stringify(schema);
    const cached = this.compiled.get(key);
    if (cached) {
      return cached;
    }
    try {
      const validator = this.ajv.compile(schema);
      this.compiled.set(key, validator);
      return validator;
    } catch {
      return null;
    }
  }

  private describe(validator: ValidateFunction): string {
    const errors = validator.errors ?? [];
    const first = errors[0];
    if (!first) {
      return 'arguments do not match the registered input schema';
    }
    return `${first.instancePath || '/'} ${first.message ?? 'is invalid'}`;
  }
}
