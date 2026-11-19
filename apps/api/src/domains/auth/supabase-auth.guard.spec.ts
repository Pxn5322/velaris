/**
 * Bearer-token guard (T1.02, AC-F02-2).
 *
 * Every rejection raises Nest's UnauthorizedException, so every protected
 * request without valid credentials gets the same 401 body. The verifier
 * is mocked here; its own behaviour is covered by its own spec.
 */

import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reflector } from '@nestjs/core';
import type { AuthAccountService } from './auth-account.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import type { SupabaseAdminService } from './supabase-admin.service.js';
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
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('SupabaseAuthGuard', () => {
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let accounts: {
    findState: ReturnType<typeof vi.fn>;
    clearFactorReset: ReturnType<typeof vi.fn>;
  };
  let admin: { listMfaFactors: ReturnType<typeof vi.fn> };
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let guard: SupabaseAuthGuard;

  beforeEach(() => {
    verifier = { verify: vi.fn() };
    accounts = {
      findState: vi.fn().mockResolvedValue({
        userId: 'user-1',
        passwordResetRequired: false,
        mfaResetRequired: false,
        tokenInvalidBefore: null,
      }),
      clearFactorReset: vi.fn().mockResolvedValue(undefined),
    };
    admin = { listMfaFactors: vi.fn().mockResolvedValue([]) };
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    guard = new SupabaseAuthGuard(
      verifier as unknown as SupabaseTokenVerifier,
      accounts as unknown as AuthAccountService,
      null,
      admin as unknown as SupabaseAdminService,
      reflector as unknown as Reflector,
    );
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

  it('fails closed when the verified identity has no application account', async () => {
    verifier.verify.mockResolvedValue({
      provider: 'supabase',
      subject: 'unknown-sub',
    });
    accounts.findState.mockResolvedValue(null);
    const { context, request } = contextWith('Bearer verified-token');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_NOT_PROVISIONED' },
    });
    expect(request.user).toBeUndefined();
  });

  it('propagates an account-state lookup failure instead of granting access', async () => {
    verifier.verify.mockResolvedValue({
      provider: 'supabase',
      subject: 'sub-123',
    });
    accounts.findState.mockRejectedValue(
      new ServiceUnavailableException('account store unavailable'),
    );
    const { context } = contextWith('Bearer verified-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('refuses a flagged account on a route without the reset exemption', async () => {
    verifier.verify.mockResolvedValue({
      provider: 'supabase',
      subject: 'sub-123',
    });
    accounts.findState.mockResolvedValue({
      userId: 'user-1',
      passwordResetRequired: true,
      mfaResetRequired: false,
      tokenInvalidBefore: null,
    });
    const { context } = contextWith('Bearer verified-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('factor reset (T6.09, AC-F02-4)', () => {
    function resetAccount(mfaResetRequired = true) {
      verifier.verify.mockResolvedValue({
        provider: 'supabase',
        subject: 'sub-123',
      });
      accounts.findState.mockResolvedValue({
        userId: 'user-1',
        passwordResetRequired: false,
        mfaResetRequired,
        tokenInvalidBefore: null,
      });
    }

    it('refuses every protected route until a new factor is verified', async () => {
      resetAccount();
      admin.listMfaFactors.mockResolvedValue([]);
      const { context, request } = contextWith('Bearer verified-token');

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        response: { code: 'MFA_RESET_REQUIRED' },
      });
      expect(admin.listMfaFactors).toHaveBeenCalledWith('sub-123');
      expect(accounts.clearFactorReset).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });

    it('admits the account once a verified factor exists and clears the flag', async () => {
      resetAccount();
      admin.listMfaFactors.mockResolvedValue([
        { id: 'factor-new', verified: true },
      ]);
      const { context } = contextWith('Bearer verified-token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(accounts.clearFactorReset).toHaveBeenCalledWith('user-1');
    });

    it('keeps the denial for an unverified factor', async () => {
      resetAccount();
      admin.listMfaFactors.mockResolvedValue([
        { id: 'factor-new', verified: false },
      ]);
      const { context } = contextWith('Bearer verified-token');

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        response: { code: 'MFA_RESET_REQUIRED' },
      });
      expect(accounts.clearFactorReset).not.toHaveBeenCalled();
    });

    it('fails closed when the provider cannot list the factors', async () => {
      resetAccount();
      admin.listMfaFactors.mockRejectedValue(new Error('provider down'));
      const { context } = contextWith('Bearer verified-token');

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        response: { code: 'MFA_RESET_REQUIRED' },
      });
      expect(accounts.clearFactorReset).not.toHaveBeenCalled();
    });

    it('keeps the session and sign-out routes reachable while flagged', async () => {
      resetAccount();
      reflector.getAllAndOverride.mockReturnValue(true);
      const { context } = contextWith('Bearer verified-token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(admin.listMfaFactors).not.toHaveBeenCalled();
    });

    it('ignores the flag when the account has no factor reset', async () => {
      resetAccount(false);
      const { context } = contextWith('Bearer verified-token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(admin.listMfaFactors).not.toHaveBeenCalled();
    });
  });
});
