/**
 * Assurance claims read from a Supabase access token (T6.08, D-58).
 *
 * Supabase Auth validates the signature and expiry at `/auth/v1/user`. After
 * that check the token payload is authentic, so these claims can drive local
 * authorization. They are never accepted from the userinfo body, and a token
 * without `aal` is treated as `aal1` by the guard.
 */

export type AssuranceLevel = 'aal1' | 'aal2';

export interface AuthAssurance {
  /** Authentication assurance level claim; null when absent or malformed. */
  aal: AssuranceLevel | null;
  /** Authentication methods from `amr`, for example `password` or `totp`. */
  amr: string[];
  /** Supabase session id used to bind a step-up grant to this session. */
  sessionId: string | null;
  /** Token issue time in epoch seconds; used for the global revocation cutoff. */
  issuedAt: number | null;
}

export function readAuthAssurance(token: string): AuthAssurance {
  const parts = token.split('.');
  if (parts.length < 2) {
    return { aal: null, amr: [], sessionId: null, issuedAt: null };
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as {
      aal?: unknown;
      amr?: unknown;
      session_id?: unknown;
      iat?: unknown;
    };
    return {
      aal:
        payload.aal === 'aal1' || payload.aal === 'aal2' ? payload.aal : null,
      amr: readAuthenticationMethods(payload.amr),
      sessionId:
        typeof payload.session_id === 'string' &&
        payload.session_id.length > 0 &&
        payload.session_id.length <= 64
          ? payload.session_id
          : null,
      issuedAt:
        typeof payload.iat === 'number' && Number.isFinite(payload.iat)
          ? payload.iat
          : null,
    };
  } catch {
    return { aal: null, amr: [], sessionId: null, issuedAt: null };
  }
}

function readAuthenticationMethods(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const methods: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) {
      methods.push(entry);
      continue;
    }
    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as { method?: unknown }).method === 'string'
    ) {
      methods.push((entry as { method: string }).method);
    }
  }
  return methods;
}
