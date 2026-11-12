/**
 * Server-side Supabase Auth administration (F-01 tenant registration and
 * the tenant user-management routes).
 *
 * This is the only place the service-role key is used, so every branch is
 * pinned here: configured/not-configured, the 409-family detection that
 * maps a GoTrue refusal to Conflict, the 502 for any other refusal, the
 * opportunistic email lookup that must never attach the wrong identity,
 * and the best-effort rollback delete that must never mask an error.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAdminService } from './supabase-admin.service.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SupabaseAdminService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let admin: SupabaseAdminService;

  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    admin = new SupabaseAdminService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('configuration', () => {
    it('isConfigured is false without the service-role key', () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
      expect(admin.isConfigured()).toBe(false);
    });

    it('requireConfigured raises 503 without SUPABASE_URL', () => {
      vi.stubEnv('SUPABASE_URL', '');
      expect(() => admin.requireConfigured()).toThrow(
        'Account registration is not configured on this deployment',
      );
    });
  });

  describe('createUser', () => {
    it('creates a confirmed account and returns its id', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { id: 'auth-1', email: 'owner@acme.test' }),
      );

      const created = await admin.createUser('owner@acme.test', 'a-password');

      expect(created).toEqual({ id: 'auth-1', email: 'owner@acme.test' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://project.supabase.co/auth/v1/admin/users');
      expect(init.method).toBe('POST');
      expect(String((init.headers as Record<string, string>).apikey)).toBe(
        'sb_secret_test',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        email: 'owner@acme.test',
        password: 'a-password',
        email_confirm: true,
      });
    });

    it('falls back to the requested email when GoTrue omits it', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'auth-1' }));

      const created = await admin.createUser('owner@acme.test', 'a-password');

      expect(created).toEqual({ id: 'auth-1', email: 'owner@acme.test' });
    });

    it('answers 502 when GoTrue returns no account id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await expect(
        admin.createUser('x@acme.test', 'a-password'),
      ).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
    });

    it('maps a 409 refusal to Conflict', async () => {
      fetchMock.mockResolvedValue(jsonResponse(409, { msg: 'conflict' }));

      await expect(admin.createUser('x@acme.test', 'p')).rejects.toThrow(
        'An account with this email already exists',
      );
    });

    it('maps a 422 refusal to Conflict', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(422, { msg: 'should be a valid email' }),
      );

      await expect(admin.createUser('x@acme.test', 'p')).rejects.toThrow(
        'An account with this email already exists',
      );
    });

    it.each(['already registered', 'user exists', 'email registered'])(
      'maps a %s refusal body to Conflict regardless of status',
      async (msg) => {
        fetchMock.mockResolvedValue(jsonResponse(500, { msg }));

        await expect(admin.createUser('x@acme.test', 'p')).rejects.toThrow(
          'An account with this email already exists',
        );
      },
    );

    it('answers 502 for any other refusal', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, { msg: 'internal' }));

      await expect(admin.createUser('x@acme.test', 'p')).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
    });

    it('answers 502 when the refusal body cannot be read', async () => {
      // A body stream that fails: text() rejects, the catch swallows it and
      // the refusal still maps to 502.
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        text: vi.fn().mockRejectedValue(new Error('stream destroyed')),
      });

      await expect(admin.createUser('x@acme.test', 'p')).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
    });
  });

  describe('inviteUser', () => {
    it('sends redirect_to as a query parameter and only email in the body', async () => {
      vi.stubEnv('APP_BASE_URL', 'https://app.example.com/');
      fetchMock.mockResolvedValue(
        jsonResponse(200, { id: 'auth-2', email: 'invitee@acme.test' }),
      );

      const invited = await admin.inviteUser('invitee@acme.test');

      expect(invited).toEqual({ id: 'auth-2', email: 'invitee@acme.test' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(`${parsed.origin}${parsed.pathname}`).toBe(
        'https://project.supabase.co/auth/v1/invite',
      );
      expect(parsed.searchParams.get('redirect_to')).toBe(
        'https://app.example.com/auth/callback',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        email: 'invitee@acme.test',
      });
    });

    it('omits redirect_to when APP_BASE_URL is not set', async () => {
      vi.stubEnv('APP_BASE_URL', '');
      fetchMock.mockResolvedValue(jsonResponse(200, { id: 'auth-2' }));

      await admin.inviteUser('invitee@acme.test');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).search).toBe('');
    });

    it('answers 502 when GoTrue returns no account id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await expect(admin.inviteUser('invitee@acme.test')).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
    });

    it('maps a 422 refusal to Conflict', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(422, { msg: 'should be a valid email' }),
      );

      await expect(admin.inviteUser('invitee@acme.test')).rejects.toThrow(
        'An account with this email already exists',
      );
    });
  });

  describe('findUserByEmail', () => {
    it('returns null when the deployment is not configured', async () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns the exact-email match from the admin list', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          users: [
            { id: 'a', email: 'other@acme.test' },
            { id: 'b', email: 'X@Acme.Test' },
          ],
        }),
      );

      expect(await admin.findUserByEmail('x@acme.test')).toEqual({
        id: 'b',
        email: 'x@acme.test',
      });
    });

    it('returns null when no row matches the email exactly', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { users: [{ id: 'a', email: 'other@acme.test' }] }),
      );

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
    });

    it('skips a row that has no email field', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { users: [{ id: 'a' }, { id: 'b', email: '' }] }),
      );

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
    });

    it('ignores a matching row that carries no account id', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { users: [{ email: 'x@acme.test' }] }),
      );

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
    });

    it('returns null when the list payload has no users array', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
    });

    it('returns null when the admin list refuses', async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { msg: 'denied' }));

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
    });

    it('returns null on a transport failure (opportunistic lookup)', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      expect(await admin.findUserByEmail('x@acme.test')).toBeNull();
    });
  });

  describe('removeUser', () => {
    it('is a no-op when the deployment is not configured', async () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

      await expect(admin.removeUser('auth-1')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the admin DELETE for the account', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await admin.removeUser('auth-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://project.supabase.co/auth/v1/admin/users/auth-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('swallows a rollback failure so the original error still wins', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(admin.removeUser('auth-1')).resolves.toBeUndefined();
    });

    it('percent-encodes the account id in the path', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await admin.removeUser('id with slash/1');

      expect(String(fetchMock.mock.calls[0][0])).toContain(
        'id%20with%20slash%2F1',
      );
    });
  });

  it('rejects a createUser promise with the HttpException shape Nest maps', async () => {
    // Guards the contract above: the thrown value must be an HttpException
    // (not a plain Error) so the HTTP layer renders the right status.
    fetchMock.mockResolvedValue(jsonResponse(502, {}));
    const rejection = admin
      .createUser('x@acme.test', 'p')
      .catch((e: unknown) => e);
    const error = (await rejection) as HttpException;
    expect(error).toBeInstanceOf(HttpException);
  });
});
