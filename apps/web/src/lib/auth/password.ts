/**
 * Required password change for the signed-in account (T6.08, D-58).
 *
 * POST /auth/password verifies the current password, applies the reset policy,
 * updates the provider password and advances the access-token cutoff, so the
 * caller's current session ends with the change. The dialog therefore asks the
 * user to sign in again with the new password.
 */

import { API_BASE_URL } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";

export interface RequiredPasswordChange {
  currentPassword: string;
  newPassword: string;
}

export function describePasswordChangeError(
  status: number,
  body: { code?: string; message?: string | string[] } | null,
): string {
  const detail = Array.isArray(body?.message)
    ? body?.message[0]
    : body?.message;
  if (status === 401) {
    return "Your session has expired. Sign in again.";
  }
  if (body?.code === "CURRENT_PASSWORD_INVALID") {
    return "The current password is not correct.";
  }
  if (status === 400) {
    return detail || "The new password does not meet the password policy.";
  }
  return detail || "The password could not be changed. Try again shortly.";
}

/** Change the caller's own password and clear the required-reset flag. */
export async function changeRequiredPassword(
  input: RequiredPasswordChange,
): Promise<void> {
  const session = getSession();
  if (!session) {
    throw new Error("Sign in again to change your password.");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("The password could not be changed. Try again shortly.");
  }
  if (response.ok) {
    return;
  }
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string | string[];
  } | null;
  throw new Error(describePasswordChangeError(response.status, body));
}
