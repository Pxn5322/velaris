/**
 * Server-side Supabase Auth administration (F-01 tenant registration and
 * the tenant user-management routes).
 *
 * Calls the GoTrue admin API with SUPABASE_SERVICE_ROLE_KEY, a server-only
 * secret (docs/SETUP_GUIDE.md). The key never reaches the browser, and no
 * route exposes this service directly: SignupService and the governance
 * user routes call it after their own validation.
 *
 * Contract:
 * - not configured (missing SUPABASE_URL or service key) -> 503, so a
 *   deployment without the secret fails loudly instead of half-working
 * - identity provider confirms the account exists -> 409 Conflict
 * - identity provider outage or refusal -> 502, never a silent success
 */

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

function providerFailure(code: string): HttpException {
  return new HttpException(
    { code, message: 'The identity provider refused the request' },
    HttpStatus.BAD_GATEWAY,
  );
}

export interface CreatedUser {
  id: string;
  email: string;
}

@Injectable()
export class SupabaseAdminService {
  /** True when the server holds the configuration the admin API needs. */
  isConfigured(): boolean {
    return Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  /** Raise 503 when the deployment cannot administer identities. */
  requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Account registration is not configured on this deployment',
      );
    }
  }

  /**
   * Create a confirmed auth account. Confirmed on purpose: the workspace
   * owner signs in immediately after registration from the landing page.
   */
  async createUser(email: string, password: string): Promise<CreatedUser> {
    this.requireConfigured();
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/admin/users`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
      },
    );

    if (response.ok) {
      const body = (await response.json()) as { id?: string; email?: string };
      if (!body.id) {
        throw new HttpException(
          'Identity provider returned no account id',
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { id: body.id, email: body.email ?? email };
    }

    const text = await response.text().catch(() => '');
    const lowered = text.toLowerCase();
    if (
      response.status === 409 ||
      response.status === 422 ||
      lowered.includes('already') ||
      lowered.includes('exists') ||
      lowered.includes('registered')
    ) {
      throw new ConflictException('An account with this email already exists');
    }
    throw new HttpException(
      'Identity provider rejected the request',
      HttpStatus.BAD_GATEWAY,
    );
  }

  /**
   * Send a Supabase Auth invitation. GoTrue creates the pending account and
   * emails a link back to /auth/callback with type=invite. The caller writes
   * the application user row after this succeeds.
   */
  async inviteUser(email: string): Promise<CreatedUser> {
    this.requireConfigured();
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
    // GoTrue reads redirect_to from the query string for /invite (the same
    // contract as /recover). A body field is ignored, which silently sends
    // the email link to the Site URL root instead of /auth/callback.
    const inviteUrl = new URL(`${process.env.SUPABASE_URL}/auth/v1/invite`);
    if (baseUrl) {
      inviteUrl.searchParams.set('redirect_to', `${baseUrl}/auth/callback`);
    }
    const response = await fetch(inviteUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      const body = (await response.json()) as { id?: string; email?: string };
      if (!body.id) {
        throw new HttpException(
          'Identity provider returned no account id',
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { id: body.id, email: body.email ?? email };
    }

    const text = await response.text().catch(() => '');
    const lowered = text.toLowerCase();
    if (
      response.status === 409 ||
      response.status === 422 ||
      lowered.includes('already') ||
      lowered.includes('exists') ||
      lowered.includes('registered')
    ) {
      throw new ConflictException('An account with this email already exists');
    }
    throw new HttpException(
      'Identity provider rejected the invitation',
      HttpStatus.BAD_GATEWAY,
    );
  }

  /**
   * Best-effort lookup of an existing auth account by email.
   *
   * GoTrue exposes no supported get-by-email call, so this uses the
   * `filter` query parameter of the admin list endpoint and then matches
   * the email exactly in the answer. A refusal or an unexpected payload
   * reads as "not found": the caller falls back to account creation, so
   * an unsupported parameter can never attach the wrong identity.
   */
  async findUserByEmail(
    email: string,
  ): Promise<{ id: string; email: string } | null> {
    if (!this.isConfigured()) {
      return null;
    }
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as {
        users?: { id?: string; email?: string }[];
      };
      // A match is found by exact email comparison, so a hit provably
      // carries that email; the answer reports the queried (normalised)
      // address and callers only use the id.
      const match = (body.users ?? []).find(
        (user) => (user.email ?? '').toLowerCase() === email,
      );
      return match?.id ? { id: match.id, email } : null;
    } catch {
      // Lookup is opportunistic; absence is a normal outcome.
      return null;
    }
  }

  /**
   * List every MFA factor of one account. The recovery reset removes them all
   * before the target can set a new factor (D-59). A refusal is a provider
   * fault, never an empty list, so a reset cannot look successful by accident.
   */
  async listMfaFactors(userId: string): Promise<{ id: string }[]> {
    this.requireConfigured();
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}/factors`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!response.ok) {
      throw providerFailure('PROVIDER_FACTOR_LIST_FAILED');
    }
    const body = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) {
      throw providerFailure('PROVIDER_FACTOR_LIST_FAILED');
    }
    return body
      .filter(
        (factor): factor is { id: string } =>
          typeof (factor as { id?: unknown })?.id === 'string',
      )
      .map((factor) => ({ id: factor.id }));
  }

  /**
   * Remove one MFA factor. A verified factor also revokes the user's provider
   * sessions (GoTrue behaviour), which the reset relies on. A missing factor is
   * already gone, so 404 counts as success.
   */
  async deleteMfaFactor(userId: string, factorId: string): Promise<void> {
    this.requireConfigured();
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}/factors/${encodeURIComponent(factorId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw providerFailure('PROVIDER_FACTOR_DELETE_FAILED');
    }
  }

  /**
   * Best-effort rollback hook: when the database write fails after the
   * auth account was created, the caller removes the orphan account. A
   * failure here must not mask the original error.
   */
  async removeUser(userId: string): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }
    try {
      await fetch(
        `${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
    } catch {
      // Rollback is opportunistic; the original error still propagates.
    }
  }
}
