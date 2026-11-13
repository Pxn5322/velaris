"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { getSession, signOut as revokeSession } from "@/lib/auth/session";
import {
  fetchSessionProfile,
  viewForRole,
  type SessionIdentity,
} from "@/lib/auth/uiRole";

export type UserRole = "ENTERPRISE" | "ADMIN" | "AGENT" | "USER";
export type ThemeMode = "dark" | "light";

interface RoleContextType {
  /** Server-resolved role; null while signed out or when unmapped. */
  role: UserRole | null;
  setRole: (role: UserRole | null) => void;
  /** True until the server role is known; guards must wait for it. */
  roleLoading: boolean;
  /** Name, email and optional picture for the navigation identity block. */
  identity: SessionIdentity | null;
  /** Apply the identity returned by the same session read as the role. */
  setIdentity: (identity: SessionIdentity | null) => void;
  /** Revoke the server session and clear the local identity. */
  endSession: () => Promise<void>;
  activeView: string;
  setActiveView: (view: string) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  tenantId: string;
  setTenantId: (id: string) => void;
}

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<UserRole | null>(null);
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [roleLoading, setRoleLoading] = useState<boolean>(true);
  const [activeView, setActiveView] = useState<string>("admin");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [tenantId, setTenantId] = useState<string>("tenant_acme_corp");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.classList.remove("bg-slate-950", "text-slate-100");
    if (theme === "dark") {
      document.body.classList.add("bg-slate-950", "text-slate-100");
    }
  }, [theme]);

  const setRole = (newRole: UserRole | null) => {
    setRoleState(newRole);
    if (newRole) setActiveView(viewForRole(newRole));
  };

  const endSession = async () => {
    await revokeSession();
    setRoleState(null);
    setIdentity(null);
    setActiveView("admin");
  };

  // Hydrate the role from the server on load: the signed-in caller's
  // canonical role comes from GET /auth/session (membership_roles), never
  // from a client-side picker. Signed-out visitors stay null.
  useEffect(() => {
    if (!getSession()) {
      // Signed-out visitors have no server role to wait for. Defer the state
      // change so the effect body does not cascade a render.
      const timer = setTimeout(() => setRoleLoading(false), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void fetchSessionProfile().then((profile) => {
      if (cancelled) return;
      setRoleState(profile.role);
      setIdentity(profile.identity);
      if (profile.role) setActiveView(viewForRole(profile.role));
      setRoleLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  return (
    <RoleContext.Provider
      value={{
        role,
        setRole,
        roleLoading,
        identity,
        setIdentity,
        endSession,
        activeView,
        setActiveView,
        theme,
        toggleTheme,
        tenantId,
        setTenantId,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return context;
}
