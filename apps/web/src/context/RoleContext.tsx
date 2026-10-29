"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { getSession } from "@/lib/auth/session";
import { fetchSessionRole, viewForRole } from "@/lib/auth/uiRole";

export type UserRole = "ENTERPRISE" | "ADMIN" | "AGENT" | "USER";
export type ThemeMode = "dark" | "light";

interface RoleContextType {
  /** Server-resolved role; null while signed out or when unmapped. */
  role: UserRole | null;
  setRole: (role: UserRole | null) => void;
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

  // Hydrate the role from the server on load: the signed-in caller's
  // canonical role comes from GET /auth/session (membership_roles), never
  // from a client-side picker. Signed-out visitors stay null.
  useEffect(() => {
    if (!getSession()) return;
    let cancelled = false;
    void fetchSessionRole().then((mapped) => {
      if (cancelled) return;
      setRoleState(mapped);
      if (mapped) setActiveView(viewForRole(mapped));
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
