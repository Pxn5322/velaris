/**
 * API client for apps/web (T2.04).
 *
 * Every request carries the JSON content type; when a Supabase access
 * token is stored in the session (see lib/auth/session.ts) the client
 * also sends it as a Bearer credential, which is what the API's
 * SupabaseAuthGuard verifies. Non-OK responses throw ApiError so the
 * UI can distinguish a denial (401/403) from a failure (5xx/network).
 */

// The API listens on 3000 by default (apps/api/src/main.ts); 3001 is the
// web dev server itself, so the old fallback called the wrong app.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

/** HTTP error carrying the response status for state decisions. */
export class ApiError extends Error {
  readonly status: number;
  /** Safe response body, kept so the UI can show actionable findings. */
  readonly body: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : "/" + endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      ...(await authHeader()),
    },
  });

  if (!response.ok) {
    const errorBody = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    throw new ApiError(
      response.status,
      errorBody.message || `API error ${response.status}`,
      errorBody as Record<string, unknown>,
    );
  }

  return response.json();
}

/**
 * Bearer credential from the stored session. Import lazily and defensively:
 * components that never sign in must not break when no session exists.
 */
async function authHeader(): Promise<Record<string, string>> {
  const { getAccessToken } = await import("@/lib/auth/session");
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
