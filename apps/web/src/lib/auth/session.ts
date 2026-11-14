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

import { API_BASE_URL } from "@/lib/api/client";

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

/** Persist a session received from a Supabase email link or password sign-in. */
export function storeSession(session: AuthSession): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

/**
 * Revoke the current Supabase session at the API before clearing local state.
 * The API records the access token in a durable denylist and calls Supabase
 * logout, so a copied token stops working immediately. A network failure must
 * not trap the user in the browser, so local state is still cleared.
 */
export async function signOut(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const session = getSession();
  try {
    if (session) {
      await fetch(`${API_BASE_URL}/auth/signout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    }
  } catch {
    // The local session is still cleared; the API denial is retried by the
    // next sign-out if the server was unreachable.
  } finally {
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
  storeSession(session);
  return session;
}

/**
 * Ask Supabase Auth to send a recovery link. The response is deliberately
 * identical for existing and unknown addresses, so the caller never learns
 * whether an account exists.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!isAuthConfigured()) {
    throw new Error("Password recovery is not configured on this deployment.");
  }
  const redirectTo =
    typeof window === "undefined"
      ? "/auth/callback"
      : `${window.location.origin}/auth/callback`;
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY as string,
      },
      body: JSON.stringify({ email }),
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Too many reset emails. Wait a few minutes and try again."
        : "The reset email could not be sent. Try again shortly.",
    );
  }
}

export interface ProfileUpdate {
  displayName?: string;
  /** Data URL from the photo picker, or null to remove it. */
  avatarDataUrl?: string | null;
}

export interface SavedProfile {
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Save the caller's own display name or uploaded photo. The API verifies the
 * bearer token and derives the user from the verified subject, so this call
 * cannot update another account.
 */
export async function updateProfile(
  input: ProfileUpdate,
): Promise<SavedProfile> {
  const session = getSession();
  if (!session) {
    throw new Error("Sign in again to update your profile.");
  }
  const response = await fetch(`${API_BASE_URL}/auth/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const detail = Array.isArray(body?.message)
      ? body?.message[0]
      : body?.message;
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Your session has expired. Sign in again."
        : detail || "Your profile could not be saved. Try again.",
    );
  }
  return (await response.json()) as SavedProfile;
}

/** Set a new password for the session delivered by a recovery link. */
export async function updatePassword(password: string): Promise<void> {
  const session = getSession();
  if (!session || !isAuthConfigured()) {
    throw new Error("The recovery link is missing or has expired.");
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY as string,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The recovery link has expired. Request a new one."
        : "The password could not be updated. Try again.",
    );
  }
}
