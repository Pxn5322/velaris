/**
 * Customer/agent sign-in session for apps/web (T2.04, F-02).
 *
 * Talks to Supabase Auth (D-03) directly through its REST API, so the app
 * needs no SDK dependency: POST /auth/v1/token?grant_type=password with the
 * public project URL and publishable key. Both are NEXT_PUBLIC configuration
 * (docs/SETUP_GUIDE.md); the browser only ever holds the public key and the
 * user's own access token.
 *
 * The access token is what apiFetch attaches as a Bearer credential; the API
 * verifies it server-side. Tokens live in localStorage so a refresh survives
 * a reload; they are never sent anywhere except the VELARIS API.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const STORAGE_KEY = "velaris.auth.session.v1";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds; 0 when the provider did not report expiry. */
  expiresAt: number;
  email: string;
}

/** True when the app was built with the public Supabase configuration. */
export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/** Stored session, or null when signed out / expired. */
export function getSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as AuthSession;
    if (
      !session.accessToken ||
      (session.expiresAt > 0 && session.expiresAt <= Date.now() / 1000)
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return getSession()?.accessToken ?? null;
}

export function signOut(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Sign in with email and password against Supabase Auth.
 * Throws Error with a user-readable message on refusal or outage.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<AuthSession> {
  if (!isAuthConfigured()) {
    throw new Error(
      "Sign-in is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then rebuild.",
    );
  }
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY as string,
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body && (body.msg || body.message || body.error_description)) ||
      (response.status === 400 || response.status === 401
        ? "Invalid email or password."
        : "Sign-in is unavailable right now. Try again shortly.");
    throw new Error(message);
  }
  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    user?: { email?: string };
  };
  const session: AuthSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ?? 0,
    email: data.user?.email ?? email,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  return session;
}
