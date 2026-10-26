/**
 * Supabase access-token verification (T1.02, AC-F02-2).
 *
 * The verifier calls Supabase Auth's userinfo endpoint (D-03). A non-2xx
 * answer means the token is invalid or expired: the verifier returns null
 * and the guard maps that to 401. A transport failure is an outage, not an
 * invalid credential: the verifier raises 503 so clients never read a
 * network fault as "log in again".
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SupabaseTokenVerifier', () => {
  let fetchMock: FetchMock;
  let verifier: SupabaseTokenVerifier;

  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    verifier = new SupabaseTokenVerifier();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns the identity for a valid token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        sub: 'sub-123',
        email: 'user@example.test',
        aud: 'authenticated',
      }),
    );

    const identity = await verifier.verify('valid-token');

    expect(identity).toEqual({
      provider: 'supabase',
      subject: 'sub-123',
      email: 'user@example.test',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/user',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          apikey: 'sb_publishable_test',
          Authorization: 'Bearer valid-token',
        }),
      }),
    );
  });

  it('returns an identity without email when Supabase omits it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { sub: 'sub-456' }));
    // Trailing slash in the configured URL must not produce a double slash.
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co/');

    await expect(verifier.verify('token')).resolves.toEqual({
      provider: 'supabase',
      subject: 'sub-456',
      email: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/user',
      expect.anything(),
    );
  });

  it('returns null when Supabase answers 200 without a usable subject', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { email: 'no-sub@example.test' }),
    );

    await expect(verifier.verify('token')).resolves.toBeNull();
  });

  it('returns null for an invalid or expired token (401 from Supabase)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'invalid JWT' }));

    await expect(verifier.verify('expired-token')).resolves.toBeNull();
  });

  it('returns null for a token belonging to a deleted user (403)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'forbidden' }));

    await expect(verifier.verify('stale-token')).resolves.toBeNull();
  });

  it('raises 503 when Supabase is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(verifier.verify('any-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('raises 503 when the configuration is missing, naming the variable only', async () => {
    vi.stubEnv('SUPABASE_URL', '');

    await expect(verifier.verify('any-token')).rejects.toThrow('SUPABASE_URL');
    await expect(verifier.verify('any-token')).rejects.not.toThrow(
      'sb_publishable',
    );
  });

  it('raises 503 naming SUPABASE_PUBLISHABLE_KEY when the apikey is missing', async () => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');

    await expect(verifier.verify('any-token')).rejects.toThrow(
      'SUPABASE_PUBLISHABLE_KEY',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
