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

export interface SessionIdentity {
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface SessionProfile {
  role: UserRole | null;
  identity: SessionIdentity | null;
}

/** Human label for the navigation identity block. */
export function roleLabelFor(role: UserRole | null): string {
  if (role === "ENTERPRISE") return "Super Admin";
  if (role === "ADMIN") return "Tenant Admin";
  if (role === "AGENT") return "Support Agent";
  if (role === "USER") return "Customer";
  return "Signed out";
}

/**
 * Readable label from the stored display name. The API stores an email as
 * the display name for invited members, so an email local part becomes
 * "Acme Admin" instead of the raw address.
 */
export function displayNameForIdentity(
  identity: SessionIdentity | null,
): string {
  const raw = identity?.displayName?.trim() || identity?.email?.trim() || "";
  if (!raw) return "Account";
  if (!raw.includes("@")) return raw;
  return raw
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function mapUiRole(
  canonical: string | null | undefined,
): UserRole | null {
  if (!canonical) return null;
  return UI_ROLE_BY_CANONICAL[canonical] ?? null;
}

/**
 * Headings and data scope for the administration view.
 *
 * R-enterprise-admin (ENTERPRISE) administers the platform.
 * R-tenant-admin (ADMIN) administers one tenant. A tenant administrator
 * must not read platform-wide figures, so that role gets tenant wording
 * and no platform-wide panel. Unknown or signed-out roles fall back to the
 * narrower tenant labels (deny by default).
 */
export function adminScopeForRole(role: UserRole | null): {
  eyebrow: string;
  title: string;
  roleLabel: string;
  navLabel: string;
  platformWide: boolean;
} {
  if (role === "ENTERPRISE") {
    return {
      eyebrow: "Enterprise Platform Administration",
      title: "Global Control Center",
      roleLabel: "Platform Admin",
      navLabel: "Platform Admin",
      platformWide: true,
    };
  }
  return {
    eyebrow: "Workspace Administration",
    title: "Tenant Control Center",
    roleLabel: "Tenant Admin",
    navLabel: "Administration",
    platformWide: false,
  };
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
export async function fetchSessionProfile(): Promise<SessionProfile> {
  try {
    const session = await apiFetch<{
      role: string | null;
      identity?: {
        email?: string;
        displayName?: string;
        avatarUrl?: string | null;
      };
      tenantContext?: { displayName?: string } | null;
    }>("/auth/session");
    const email = session.identity?.email ?? null;
    return {
      role: mapUiRole(session.role),
      identity: {
        displayName:
          session.identity?.displayName ??
          session.tenantContext?.displayName ??
          email,
        email,
        avatarUrl: session.identity?.avatarUrl ?? null,
      },
    };
  } catch {
    return { role: null, identity: null };
  }
}

/**
 * Reads the server-resolved role for the current session. Returns null
 * when signed out, when the API is unreachable, or when the session has
 * no mapped UI role (deny by default).
 */
export async function fetchSessionRole(): Promise<UserRole | null> {
  const profile = await fetchSessionProfile();
  return profile.role;
}
