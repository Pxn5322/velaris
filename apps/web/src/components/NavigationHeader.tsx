"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Shield,
  Layers,
  Bot,
  BarChart3,
  UserCheck,
  LifeBuoy,
  Sun,
  Moon,
  Menu,
  X,
} from "lucide-react";
import { useRole, UserRole } from "@/context/RoleContext";

export function NavigationHeader() {
  const { role, setRole, activeView, setActiveView, theme, toggleTheme } =
    useRole();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    setIsMobileMenuOpen(false);
    if (newRole === "ENTERPRISE" || newRole === "ADMIN") {
      router.push("/admin");
    } else if (newRole === "AGENT") {
      router.push("/workspace");
    } else if (newRole === "USER") {
      router.push("/portal");
    }
  };

  const navLinks = [
    {
      roleMatch: ["ENTERPRISE", "ADMIN"],
      href: "/admin",
      viewId: "admin",
      label: "Platform Admin",
      icon: Shield,
    },
    {
      roleMatch: ["ENTERPRISE", "ADMIN"],
      href: "/studio",
      viewId: "studio",
      label: "AI Studio",
      icon: Bot,
    },
    {
      roleMatch: ["ENTERPRISE", "ADMIN"],
      href: "/analytics",
      viewId: "analytics",
      label: "Analytics",
      icon: BarChart3,
    },
    {
      roleMatch: ["AGENT"],
      href: "/workspace",
      viewId: "agent",
      label: "Agent Workspace",
      icon: Layers,
    },
    {
      roleMatch: ["USER"],
      href: "/portal",
      viewId: "portal",
      label: "Customer Portal",
      icon: LifeBuoy,
    },
  ];

  const visibleLinks = navLinks.filter((link) => link.roleMatch.includes(role));
  const isLight = theme === "light";

  return (
    <header className="fixed top-0 left-0 w-full z-50 px-3 sm:px-6 py-3 transition-all duration-300">
      <div className="max-w-7xl mx-auto flex items-center justify-between glass-panel rounded-2xl px-3 sm:px-5 py-2.5 shadow-xl">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 sm:w-9 sm:h-9 relative flex items-center justify-center group-hover:scale-105 transition-transform">
            <Image
              src="/logo.svg"
              alt="VELARIS"
              width={34}
              height={34}
              className="object-contain"
              priority
            />
          </div>
          <span className="font-display font-bold text-base sm:text-xl tracking-tight text-heading">
            VELARIS
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1.5 p-1 glass-panel rounded-xl text-xs font-mono">
          {visibleLinks.map((link) => {
            const Icon = link.icon;
            const isActive = activeView === link.viewId;
            const cls = isActive
              ? `bg-blue-600/30 ${isLight ? "text-blue-700 border-blue-600" : "text-cyan-300 border-cyan-500/40"} shadow-sm`
              : `${isLight ? "text-slate-600 hover:text-slate-900 hover:bg-slate-200" : "text-muted-custom hover:text-heading hover:bg-slate-800/40"}`;
            return (
              <Link
                key={link.viewId}
                href={link.href}
                onClick={() => setActiveView(link.viewId)}
                className={
                  "px-3.5 py-1.5 rounded-lg flex items-center gap-2 font-semibold transition-all " +
                  cls
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={`hidden lg:flex items-center gap-2 pl-3 pr-2 py-1 rounded-xl glass-panel ${isLight ? "bg-white/80" : "bg-slate-900/80"}`}
          >
            <UserCheck
              className="w-3.5 h-3.5"
              style={{ color: "var(--accent-cyan)" }}
            />
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as UserRole)}
              className="bg-transparent border-none text-xs text-heading font-bold focus:outline-none cursor-pointer"
            >
              <option value="ADMIN">Role: ADMIN</option>
              <option value="ENTERPRISE">Role: ENTERPRISE</option>
              <option value="AGENT">Role: AGENT</option>
              <option value="USER">Role: USER</option>
            </select>
          </div>

          <button
            onClick={toggleTheme}
            className="p-2 sm:p-2.5 rounded-xl glass-panel hover:border-blue-500 transition-all text-heading"
            aria-label="Toggle Theme"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-600" />
            )}
          </button>

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 sm:p-2.5 rounded-xl glass-panel text-heading hover:border-blue-500 transition-colors"
            aria-label="Toggle Navigation"
          >
            {isMobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div
          className="lg:hidden max-w-7xl mx-auto mt-2 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-2xl animate-fadeIn"
          style={{
            background: isLight
              ? "rgba(255,255,255,0.98)"
              : "rgba(11,15,23,0.97)",
            backdropFilter: "blur(20px)",
            border: `1px solid ${isLight ? "rgba(15,23,42,0.15)" : "rgba(255,255,255,0.12)"}`,
          }}
        >
          <div className="space-y-2">
            <span
              className="text-[10px] font-mono font-bold"
              style={{ color: "var(--accent-cyan)" }}
            >
              Active Role Access
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              {["ADMIN", "ENTERPRISE", "AGENT", "USER"].map((r) => (
                <button
                  key={r}
                  onClick={() => handleRoleChange(r as UserRole)}
                  className={`p-2.5 rounded-xl text-xs font-bold text-center transition border ${
                    role === r
                      ? `border-current bg-blue-600/20 ${isLight ? "text-blue-700 border-blue-600" : "text-cyan-300 border-cyan-500"}`
                      : `${isLight ? "text-slate-600 border-slate-300 bg-white" : "text-muted-custom border-slate-700/40 glass-panel"}`
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div
            className="space-y-2 pt-2 border-t"
            style={{ borderColor: "var(--card-border)" }}
          >
            <span
              className="text-[10px] font-mono font-bold"
              style={{ color: "var(--accent-cyan)" }}
            >
              Workspace Views
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {visibleLinks.map((link) => {
                const Icon = link.icon;
                const isActive = activeView === link.viewId;
                return (
                  <Link
                    key={link.viewId}
                    href={link.href}
                    onClick={() => {
                      setActiveView(link.viewId);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`p-3 rounded-xl glass-panel flex items-center gap-2.5 font-semibold text-left transition border ${
                      isActive
                        ? `${isLight ? "border-blue-600 bg-blue-50 text-blue-700" : "border-cyan-500 bg-blue-600/20 text-cyan-300"}`
                        : `${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-100" : "border-slate-700/40 text-muted-custom hover:text-heading"}`
                    }`}
                  >
                    <Icon
                      className="w-4 h-4"
                      style={{ color: "var(--accent-cyan)" }}
                    />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
