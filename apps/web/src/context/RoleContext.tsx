"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type UserRole = "ENTERPRISE" | "ADMIN" | "AGENT" | "USER";
export type ThemeMode = "dark" | "light";

interface RoleContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  activeView: string;
  setActiveView: (view: string) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  tenantId: string;
  setTenantId: (id: string) => void;
}

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<UserRole>("ADMIN");
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

  const setRole = (newRole: UserRole) => {
    setRoleState(newRole);
    if (newRole === "ENTERPRISE" || newRole === "ADMIN") {
      setActiveView("admin");
    } else if (newRole === "AGENT") {
      setActiveView("agent");
    } else if (newRole === "USER") {
      setActiveView("portal");
    }
  };

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
