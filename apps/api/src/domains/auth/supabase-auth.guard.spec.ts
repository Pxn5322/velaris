/**
 * Bearer-token guard (T1.02, AC-F02-2).
 *
 * Every rejection raises Nest's UnauthorizedException, so every protected
 * request without valid credentials gets the same 401 body. The verifier
 * is mocked here; its own behaviour is covered by its own spec.
 */

import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import type { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

function contextWith(header: string | undefined) {
  const request: {
    headers: Record<string, string | undefined>;
    user?: unknown;
  } = {
    headers: header === undefined ? {} : { authorization: header },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('SupabaseAuthGuard', () => {
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let guard: SupabaseAuthGuard;

  beforeEach(() => {
    verifier = { verify: vi.fn() };
    guard = new SupabaseAuthGuard(verifier as unknown as SupabaseTokenVerifier);
  });

  it('rejects a request with no Authorization header (401)', async () => {
    const { context } = contextWith(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a Bearer token (401)', async () => {
    const { context } = contextWith('Basic dXNlcjpwYXNz');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token with the same 401 (AC-F02-2)', async () => {
    verifier.verify.mockResolvedValue(null);
    const { context, request } = contextWith('Bearer expired-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifier.verify).toHaveBeenCalledWith('expired-token');
    expect(request.user).toBeUndefined();
  });

  it('passes a valid token and attaches the identity to the request', async () => {
    const identity = {
      provider: 'supabase',
      subject: 'sub-123',
      email: 'a@b.test',
    };
    verifier.verify.mockResolvedValue(identity);
    const { context, request } = contextWith('  Bearer good-token  ');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual(identity);
  });

  it('propagates a verifier outage instead of reading it as 401', async () => {
    verifier.verify.mockRejectedValue(new ServiceUnavailableException());
    const { context } = contextWith('Bearer any');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
