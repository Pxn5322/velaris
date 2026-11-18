/**
 * Supabase Auth MFA REST helpers (T6.08).
 *
 * The web app has no Supabase SDK. These calls use the same public project URL
 * and publishable key as password sign-in, and the caller's own access token.
 * A successful verification returns replacement tokens with an `aal2` claim;
 * the session store is updated before the next API call.
 */

import {
  getAuthProviderConfig,
  getSession,
  updateSessionTokens,
} from "@/lib/auth/session";

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
}

export interface TotpEnrollment {
  factorId: string;
  qrCode: string | null;
  secret: string;
  uri: string | null;
}

/** Stable display name for a verified TOTP factor. */
export function totpFactorLabel(factor: TotpFactor, index: number): string {
  const name = factor.friendlyName?.trim();
  if (name && !name.toLowerCase().startsWith("velaris")) {
    return name;
  }
  return index === 0 ? "Primary authenticator" : "Backup authenticator";
}

interface ProviderFactor {
  id?: unknown;
  friendly_name?: unknown;
  factor_type?: unknown;
  type?: unknown;
  status?: unknown;
}

function providerConfig(): { url: string; key: string; token: string } {
  const config = getAuthProviderConfig();
  const session = getSession();
  if (!config) {
    throw new Error("Multi-factor authentication is not configured.");
  }
  if (!session) {
    throw new Error("Sign in again to complete this action.");
  }
  return { ...config, token: session.accessToken };
}

async function providerError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    msg?: string;
    message?: string;
    error_description?: string;
    error_code?: string;
  } | null;
  const detail =
    body?.msg || body?.message || body?.error_description || body?.error_code;
  if (response.status === 401 || response.status === 403) {
    return new Error("Your session has expired. Sign in again.");
  }
  if (response.status === 422 || body?.error_code?.includes("invalid")) {
    return new Error("That code is not valid. Check the code and try again.");
  }
  return new Error(detail || "The authenticator request failed.");
}

async function providerFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const { url, key, token } = providerConfig();
  return fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
  });
}

/** Verified TOTP factors for the signed-in account. */
export async function listTotpFactors(): Promise<TotpFactor[]> {
  const response = await providerFetch("/user", { method: "GET" });
  if (!response.ok) {
    throw await providerError(response);
  }
  const body = (await response.json()) as { factors?: ProviderFactor[] };
  return (body.factors ?? [])
    .filter(
      (factor) =>
        (factor.factor_type ?? factor.type) === "totp" &&
        factor.status === "verified" &&
        typeof factor.id === "string",
    )
    .map((factor) => ({
      id: factor.id as string,
      friendlyName:
        typeof factor.friendly_name === "string" ? factor.friendly_name : null,
    }));
}

/** Start TOTP enrollment; the factor stays unverified until the code is checked. */
export async function enrollTotp(
  friendlyName = "VELARIS",
): Promise<TotpEnrollment> {
  const response = await providerFetch("/factors", {
    method: "POST",
    body: JSON.stringify({
      factor_type: "totp",
      friendly_name: friendlyName,
    }),
  });
  if (!response.ok) {
    throw await providerError(response);
  }
  const body = (await response.json()) as {
    id?: unknown;
    totp?: { qr_code?: unknown; secret?: unknown; uri?: unknown };
  };
  if (typeof body.id !== "string" || typeof body.totp?.secret !== "string") {
    throw new Error("The authenticator setup response was incomplete.");
  }
  return {
    factorId: body.id,
    qrCode: typeof body.totp.qr_code === "string" ? body.totp.qr_code : null,
    secret: body.totp.secret,
    uri: typeof body.totp.uri === "string" ? body.totp.uri : null,
  };
}

/** Verify a TOTP code and replace the stored session with the `aal2` tokens. */
export async function verifyTotp(
  factorId: string,
  code: string,
): Promise<void> {
  const challengeResponse = await providerFetch(
    `/factors/${encodeURIComponent(factorId)}/challenge`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
  if (!challengeResponse.ok) {
    throw await providerError(challengeResponse);
  }
  const challenge = (await challengeResponse.json()) as { id?: unknown };
  if (typeof challenge.id !== "string") {
    throw new Error("The authenticator challenge response was incomplete.");
  }

  const verifyResponse = await providerFetch(
    `/factors/${encodeURIComponent(factorId)}/verify`,
    {
      method: "POST",
      body: JSON.stringify({ challenge_id: challenge.id, code }),
    },
  );
  if (!verifyResponse.ok) {
    throw await providerError(verifyResponse);
  }
  const tokens = (await verifyResponse.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    expires_at?: unknown;
    user?: { email?: string };
  };
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string"
  ) {
    throw new Error("The verified session tokens were missing.");
  }
  updateSessionTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in:
      typeof tokens.expires_in === "number" ? tokens.expires_in : undefined,
    expires_at:
      typeof tokens.expires_at === "number" ? tokens.expires_at : undefined,
    user: tokens.user,
  });
}

/** Remove an unverified factor when the user cancels enrollment. */
export async function removeTotpFactor(factorId: string): Promise<void> {
  await providerFetch(`/factors/${encodeURIComponent(factorId)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}
