"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Users,
  Lock,
  Cpu,
  Settings,
  Activity,
  LogOut,
} from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { adminScopeForRole } from "@/lib/auth/uiRole";
import { RetentionSettings } from "@/components/RetentionSettings";
import { TenantUsersPanel } from "@/components/TenantUsersPanel";
import { AdminAuditStream } from "@/components/analytics/AdminAuditStream";

export function AdminView() {
  const [activeTab, setActiveTab] = useState<
    "analytics" | "users" | "roles" | "ai-gov" | "settings"
  >("analytics");
  const { role, theme, endSession } = useRole();
  const router = useRouter();
  const isLight = theme === "light";
  const scope = adminScopeForRole(role);

  const handleSignOut = async () => {
    await endSession();
    router.replace("/?signin=1");
  };

  return (
    <div className="flex-1 py-4 md:py-8 overflow-y-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span
            className="text-xs font-mono uppercase tracking-widest font-bold"
            style={{ color: "var(--accent-cyan)" }}
          >
            {scope.eyebrow}
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-heading">
            {scope.title}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap lg:hidden">
          <span
            className="px-3 py-1 rounded-full text-xs font-bold w-fit"
            style={{
              background: isLight
                ? "rgba(37,99,235,0.1)"
                : "rgba(59,130,246,0.1)",
              color: "var(--accent-cyan)",
              border: "1px solid var(--card-border)",
            }}
          >
            Role: {scope.roleLabel}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            data-testid="admin-sign-out"
            className="px-3 py-1.5 rounded-xl glass-panel text-xs font-mono font-bold text-heading inline-flex items-center gap-1.5 hover:border-rose-500/50 hover:text-rose-400 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>

      <div className="glass-panel p-1.5 rounded-xl grid grid-cols-2 sm:flex sm:overflow-x-auto no-scrollbar gap-1 border border-slate-700/50">
        {(
          [
            { id: "analytics", label: "Platform Analytics", icon: Activity },
            { id: "users", label: "User Directory", icon: Users },
            { id: "roles", label: "Roles & RBAC", icon: Lock },
            { id: "ai-gov", label: "AI Governance", icon: Cpu },
            { id: "settings", label: "System Settings", icon: Settings },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const acls = isActive
            ? `${isLight ? "bg-blue-600/10 text-blue-700 border-blue-600" : "bg-blue-600/40 text-cyan-300 border-cyan-500/40"} shadow-sm`
            : `${isLight ? "text-slate-600 hover:text-slate-900 hover:bg-slate-200" : "text-muted-custom hover:text-heading hover:bg-slate-800/40"}`;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                "px-3 py-2 text-xs font-semibold rounded-lg flex items-center justify-center sm:justify-start gap-1.5 whitespace-nowrap transition-all border " +
                (tab.id === "settings" ? "col-span-2 sm:col-span-1 " : "") +
                acls
              }
            >
              <Icon
                className="w-3.5 h-3.5"
                style={{ color: isActive ? "inherit" : "var(--accent-cyan)" }}
              />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analytics" && !scope.platformWide && (
        <div className="glass-panel p-8 rounded-2xl text-center space-y-3 border border-slate-700/50">
          <Shield
            className="w-10 h-10 mx-auto"
            style={{ color: "var(--accent-cyan)" }}
          />
          <h3 className="text-base font-bold text-heading uppercase tracking-wider">
            Platform analytics are not available to this role
          </h3>
          <p
            className="text-xs max-w-md mx-auto"
            style={{ color: "var(--text-muted)" }}
          >
            Platform-wide figures cover every tenant, so only the enterprise
            administrator reads them. Tenant-scoped analytics arrive with the
            analytics task.
          </p>
        </div>
      )}

      {activeTab === "analytics" && scope.platformWide && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-slate-700/50">
              <span
                className="text-[10px] sm:text-xs uppercase font-mono font-bold"
                style={{ color: "var(--text-muted)" }}
              >
                Total Active Tenants
              </span>
              <div className="text-2xl sm:text-3xl font-bold font-display text-heading mt-1.5 sm:mt-2">
                42
              </div>
              <span
                className="text-[10px] sm:text-xs mt-1 block font-bold"
                style={{ color: "var(--accent-emerald)" }}
              >
                ↑ +4 this month
              </span>
            </div>
            <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-slate-700/50">
              <span
                className="text-[10px] sm:text-xs uppercase font-mono font-bold"
                style={{ color: "var(--text-muted)" }}
              >
                Total AI Operations
              </span>
              <div className="text-2xl sm:text-3xl font-bold font-display text-heading mt-1.5 sm:mt-2">
                1,420,890
              </div>
              <span
                className="text-[10px] sm:text-xs mt-1 block font-bold"
                style={{ color: "var(--accent-emerald)" }}
              >
                99.98% SLA target
              </span>
            </div>
            <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-slate-700/50">
              <span
                className="text-[10px] sm:text-xs uppercase font-mono font-bold"
                style={{ color: "var(--text-muted)" }}
              >
                Average Deflection Rate
              </span>
              <div
                className="text-2xl sm:text-3xl font-bold font-display mt-1.5 sm:mt-2"
                style={{ color: "var(--accent-cyan)" }}
              >
                64.2%
              </div>
              <span
                className="text-[10px] sm:text-xs mt-1 block"
                style={{ color: "var(--text-muted)" }}
              >
                Across all tenants
              </span>
            </div>
            <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-slate-700/50">
              <span
                className="text-[10px] sm:text-xs uppercase font-mono font-bold"
                style={{ color: "var(--text-muted)" }}
              >
                Security Violations
              </span>
              <div
                className="text-2xl sm:text-3xl font-bold font-display mt-1.5 sm:mt-2"
                style={{ color: "var(--accent-rose)" }}
              >
                0
              </div>
              <span
                className="text-[10px] sm:text-xs mt-1 block font-bold"
                style={{ color: "var(--accent-emerald)" }}
              >
                100% Isolated
              </span>
            </div>
          </div>
          <AdminAuditStream />
        </>
      )}

      {activeTab === "users" && <TenantUsersPanel />}

      {activeTab === "settings" && <RetentionSettings />}

      {activeTab !== "analytics" &&
        activeTab !== "users" &&
        activeTab !== "settings" && (
          <div className="glass-panel p-8 rounded-2xl text-center space-y-3 border border-slate-700/50">
            <Shield
              className="w-10 h-10 mx-auto"
              style={{ color: "var(--accent-cyan)" }}
            />
            <h3 className="text-base font-bold text-heading uppercase tracking-wider">
              {activeTab} Module
            </h3>
            <p
              className="text-xs max-w-md mx-auto"
              style={{ color: "var(--text-muted)" }}
            >
              Configuration and policy definitions active under enterprise
              isolation rules.
            </p>
          </div>
        )}
    </div>
  );
}
