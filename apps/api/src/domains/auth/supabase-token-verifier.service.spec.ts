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

/** A syntactically valid JWT whose payload carries only an expiry claim. */
function tokenWithExp(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
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
    vi.useRealTimers();
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

  it('accepts the live GoTrue userinfo shape (id, no sub)', async () => {
    // Observed against the live project on 2026-10-26: /auth/v1/user returns
    // the user UUID in `id` and carries no `sub` field.
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: '98fb960c-a994-4cf1-9e40-23fda909d536',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'agent1@velaris.test',
      }),
    );

    await expect(verifier.verify('live-token')).resolves.toEqual({
      provider: 'supabase',
      subject: '98fb960c-a994-4cf1-9e40-23fda909d536',
      email: 'agent1@velaris.test',
    });
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

  it('reuses a successful verification for the same token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { sub: 'sub-123' }));

    await verifier.verify('same-token');
    await verifier.verify('same-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache an invalid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'invalid JWT' }));

    await verifier.verify('bad-token');
    await verifier.verify('bad-token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes a cached identity after the bounded TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T00:00:00.000Z'));
    const shortLived = new SupabaseTokenVerifier(1_000);
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { sub: 'sub-ttl' })),
    );

    await shortLived.verify('ttl-token');
    await shortLived.verify('ttl-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await shortLived.verify('ttl-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache beyond the token expiry claim', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-10T00:00:00.000Z');
    vi.setSystemTime(now);
    const expiring = new SupabaseTokenVerifier(60_000);
    const token = tokenWithExp(Math.floor(now.getTime() / 1_000) + 2);
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { sub: 'sub-exp' })),
    );

    await expiring.verify(token);
    await expiring.verify(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_001);
    await expiring.verify(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when the cache reaches its bound', async () => {
    const bounded = new SupabaseTokenVerifier(60_000, 2);
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { sub: 'sub-bound' })),
    );

    await bounded.verify('token-a');
    await bounded.verify('token-b');
    await bounded.verify('token-c');
    await bounded.verify('token-a');

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent verifications of the same token', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = verifier.verify('concurrent-token');
    const second = verifier.verify('concurrent-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(jsonResponse(200, { sub: 'sub-concurrent' }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { provider: 'supabase', subject: 'sub-concurrent', email: undefined },
      { provider: 'supabase', subject: 'sub-concurrent', email: undefined },
    ]);
  });
});
