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
  ClipboardList,
  Inbox,
  LifeBuoy,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRole } from "@/context/RoleContext";
import {
  adminScopeForRole,
  displayNameForIdentity,
  roleLabelFor,
  type SessionIdentity,
} from "@/lib/auth/uiRole";
import { ProfileSettingsDialog } from "@/components/ProfileSettingsDialog";

/** Two-letter avatar fallback for the signed-in caller. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "VA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function IdentityAvatar({
  identity,
  name,
  testIdPrefix = "nav-avatar",
}: {
  identity: SessionIdentity | null;
  name: string;
  testIdPrefix?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const avatarUrl = identity?.avatarUrl ?? null;

  return (
    <div
      className="relative shrink-0"
      data-testid={testIdPrefix}
      aria-hidden="true"
    >
      {avatarUrl && avatarUrl !== failedUrl ? (
        // The URL comes from the identity provider and the API accepts only
        // https. A plain img keeps the avatar host independent from the Next
        // image allowlist; a load failure falls back to initials.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          data-testid={`${testIdPrefix}-image`}
          referrerPolicy="no-referrer"
          className="w-8 h-8 rounded-lg object-cover ring-1 ring-blue-500/50"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        <span
          data-testid={`${testIdPrefix}-initials`}
          className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-[11px] font-mono font-bold flex items-center justify-center ring-1 ring-blue-500/50"
        >
          {initialsFor(name)}
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-600 border-2 border-slate-900 rounded-full" />
    </div>
  );
}

export function NavigationHeader() {
  const {
    role,
    activeView,
    setActiveView,
    theme,
    toggleTheme,
    identity,
    endSession,
  } = useRole();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const router = useRouter();
  const adminLabel = adminScopeForRole(role).navLabel;
  const identityName = displayNameForIdentity(identity);

  const handleSignOut = async () => {
    setIsMobileMenuOpen(false);
    setIsProfileOpen(false);
    await endSession();
    router.replace("/?signin=1");
  };

  const openSignIn = () => {
    setIsMobileMenuOpen(false);
    setIsProfileOpen(false);
    router.push("/?signin=1");
  };

  const openProfile = () => {
    setIsMobileMenuOpen(false);
    setIsProfileOpen(true);
  };

  const navLinks = [
    {
      roleMatch: ["ENTERPRISE", "ADMIN"],
      href: "/admin",
      viewId: "admin",
      label: adminLabel,
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
      roleMatch: ["ENTERPRISE", "ADMIN"],
      href: "/audit",
      viewId: "audit",
      label: "Audit",
      icon: ClipboardList,
    },
    {
      roleMatch: ["AGENT"],
      href: "/workspace",
      viewId: "agent",
      label: "Agent Workspace",
      icon: Layers,
    },
    {
      roleMatch: ["AGENT", "ADMIN", "ENTERPRISE"],
      href: "/inbox",
      viewId: "inbox",
      label: "Support Inbox",
      icon: Inbox,
    },
    {
      roleMatch: ["USER"],
      href: "/portal",
      viewId: "portal",
      label: "Customer Portal",
      icon: LifeBuoy,
    },
  ];

  // Role-gated: links render only for the server-resolved role; a signed-
  // out (null) visitor sees no workspace links, only the sign-in entry.
  const visibleLinks = role
    ? navLinks.filter((link) => link.roleMatch.includes(role))
    : [];
  const isLight = theme === "light";

  return (
    <header className="fixed top-0 left-0 w-full z-50 px-2 sm:px-6 py-3 transition-all duration-300">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 glass-panel rounded-2xl px-2 sm:px-5 py-2.5 shadow-xl">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 group">
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
          <span className="hidden sm:inline font-display font-bold text-base sm:text-xl tracking-tight text-heading">
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

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          {role && (
            <div
              data-testid="nav-identity-mobile"
              className={`flex lg:hidden min-w-0 items-center gap-1.5 rounded-xl glass-panel py-1 pl-1.5 pr-1 ${isLight ? "bg-white/80" : "bg-slate-900/80"}`}
            >
              <IdentityAvatar
                identity={identity}
                name={identityName}
                testIdPrefix="nav-avatar-mobile"
              />
              <div className="flex min-w-0 max-w-[4.5rem] flex-col text-left">
                <span
                  data-testid="nav-identity-mobile-name"
                  className="truncate text-[11px] font-semibold leading-tight text-heading"
                  title={identity?.email ?? identityName}
                >
                  {identityName}
                </span>
                <span
                  data-testid="nav-role-mobile"
                  className="truncate text-[9px] font-mono font-bold leading-tight"
                  style={{ color: "var(--accent-cyan)" }}
                >
                  {roleLabelFor(role)}
                </span>
              </div>
            </div>
          )}

          {role ? (
            <div
              data-testid="nav-identity"
              className={`hidden lg:flex items-center gap-2.5 pl-3 pr-2.5 py-1 rounded-xl glass-panel ${isLight ? "bg-white/80" : "bg-slate-900/80"}`}
            >
              <IdentityAvatar identity={identity} name={identityName} />
              <div className="flex flex-col text-left max-w-[9.5rem]">
                <span
                  className="text-xs font-semibold text-heading leading-tight truncate"
                  title={identity?.email ?? identityName}
                >
                  {identityName}
                </span>
                <span
                  data-testid="nav-role"
                  data-role={role}
                  className="text-[10px] font-mono font-bold leading-tight inline-flex items-center gap-1"
                  style={{ color: "var(--accent-cyan)" }}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {roleLabelFor(role)}
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={openSignIn}
              data-testid="nav-sign-in"
              className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl glass-panel text-xs font-mono font-bold transition-all hover:border-cyan-500/40 ${isLight ? "bg-white/80 text-slate-700" : "bg-slate-900/80 text-heading"}`}
            >
              Sign In
            </button>
          )}

          {role && (
            <button
              type="button"
              onClick={openProfile}
              data-testid="nav-profile"
              className="hidden lg:flex items-center justify-center p-2 rounded-xl glass-panel text-heading hover:border-cyan-500/50 hover:text-cyan-300 transition-all"
              aria-label="Profile settings"
              title="Profile settings"
            >
              <UserRound className="w-4 h-4" />
            </button>
          )}

          {role && (
            <button
              type="button"
              onClick={handleSignOut}
              data-testid="nav-sign-out"
              className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl glass-panel text-xs font-mono font-bold text-heading hover:border-rose-500/50 hover:text-rose-400 transition-all"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          )}

          {role && (
            <button
              type="button"
              onClick={handleSignOut}
              data-testid="nav-sign-out-mobile"
              className="inline-flex lg:hidden shrink-0 items-center gap-1 rounded-xl glass-panel px-2 py-2 text-[11px] font-mono font-bold text-heading transition-all hover:border-rose-500/50 hover:text-rose-400"
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}

          <button
            onClick={toggleTheme}
            className="shrink-0 rounded-xl glass-panel p-1.5 text-heading transition-all hover:border-blue-500 sm:p-2.5"
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
            className="shrink-0 rounded-xl glass-panel p-1.5 text-heading transition-colors hover:border-blue-500 lg:hidden sm:p-2.5"
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
          {!role && (
            <button
              onClick={openSignIn}
              data-testid="nav-sign-in"
              className="w-full p-3 rounded-xl glass-panel text-xs font-mono font-bold text-heading text-center transition border border-slate-700/40 hover:border-cyan-500/40"
            >
              Sign In
            </button>
          )}
          {role && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl glass-panel">
              <div className="flex items-center gap-2.5 min-w-0">
                <IdentityAvatar
                  identity={identity}
                  name={identityName}
                  testIdPrefix="nav-avatar-drawer"
                />
                <div className="min-w-0 text-left">
                  <div className="text-xs font-semibold text-heading truncate">
                    {identityName}
                  </div>
                  <div
                    className="text-[10px] font-mono font-bold"
                    style={{ color: "var(--accent-cyan)" }}
                  >
                    {roleLabelFor(role)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openProfile}
                  data-testid="nav-profile-mobile"
                  className="p-2 rounded-xl glass-panel text-heading hover:text-cyan-300"
                  aria-label="Profile settings"
                >
                  <UserRound className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  data-testid="nav-sign-out-drawer"
                  className="px-3 py-2 rounded-xl glass-panel text-xs font-mono font-bold text-rose-400 inline-flex items-center gap-1.5"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
          {role && (
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
          )}
        </div>
      )}

      {isProfileOpen && (
        <ProfileSettingsDialog onClose={() => setIsProfileOpen(false)} />
      )}
    </header>
  );
}
