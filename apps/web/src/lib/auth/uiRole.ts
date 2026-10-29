/**
 * Canonical role -> UI role mapping (phase 2, role-aware navigation).
 *
 * The API resolves the signed-in caller's highest-privilege canonical role
 * server-side from membership_roles and returns it on GET /auth/session.
 * The UI never invents or client-side-picks a role: the nav renders
 * exactly what the server resolved, and null (signed out / unmapped)
 * shows no role-gated links.
 */

import { apiFetch } from "@/lib/api/client";
import type { UserRole } from "@/context/RoleContext";

const UI_ROLE_BY_CANONICAL: Record<string, UserRole> = {
  "R-enterprise-admin": "ENTERPRISE",
  "R-tenant-admin": "ADMIN",
  "R-agent": "AGENT",
  "R-customer": "USER",
};

export function mapUiRole(
  canonical: string | null | undefined,
): UserRole | null {
  if (!canonical) return null;
  return UI_ROLE_BY_CANONICAL[canonical] ?? null;
}

/** Default app view for each UI role (kept in one place for nav + auth). */
export function viewForRole(role: UserRole): string {
  if (role === "AGENT") return "agent";
  if (role === "USER") return "portal";
  return "admin";
}

/** Route for each UI role after sign-in. */
export function routeForRole(role: UserRole): string {
  if (role === "AGENT") return "/workspace";
  if (role === "USER") return "/portal";
  return "/admin";
}

/**
 * Reads the server-resolved role for the current session. Returns null
 * when signed out, when the API is unreachable, or when the session has
 * no mapped UI role (deny by default).
 */
export async function fetchSessionRole(): Promise<UserRole | null> {
  try {
    const session = await apiFetch<{ role: string | null }>("/auth/session");
    return mapUiRole(session.role);
  } catch {
    return null;
  }
}
