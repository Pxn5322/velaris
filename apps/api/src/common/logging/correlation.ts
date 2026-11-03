/**
 * Request correlation context (T5.01; F-11, F-13; AC-F11-1, AC-F13-1).
 *
 * One identifier follows a unit of work: the HTTP request that starts it, the
 * queue job that continues it, the audit rows and AI trace metadata that
 * record it. Node's AsyncLocalStorage carries the value without threading a
 * parameter through every service.
 *
 * A client may propose the identifier in `x-request-id`, because a gateway or
 * a support engineer already has one. The value is untrusted: it is accepted
 * only when it is short and made of safe characters, so it cannot forge a
 * log line or split a header (SECURITY.md section 7). Otherwise the API
 * generates a UUID.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Header that carries the identifier in both directions. */
export const CORRELATION_ID_HEADER = 'x-request-id';

/** Longest accepted client value; longer values are replaced. */
export const MAX_CORRELATION_ID_LENGTH = 128;

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]+$/;

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Return the client value when it is safe, otherwise undefined. Whitespace,
 * control characters and overlong values are rejected, not repaired.
 */
export function normalizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > MAX_CORRELATION_ID_LENGTH) {
    return undefined;
  }
  return SAFE_CORRELATION_ID.test(candidate) ? candidate : undefined;
}

/** Safe client value when present, otherwise a new UUID. */
export function resolveCorrelationId(value: unknown): string {
  return normalizeCorrelationId(value) ?? randomUUID();
}

/** Run a unit of work inside a correlation context. */
export function runWithCorrelationId<T>(
  correlationId: string,
  callback: () => T,
): T {
  return storage.run(
    { correlationId: resolveCorrelationId(correlationId) },
    callback,
  );
}

/** Identifier of the current unit of work, or undefined outside one. */
export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
