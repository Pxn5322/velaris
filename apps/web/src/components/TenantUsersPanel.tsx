"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Mail,
  RefreshCw,
  SearchX,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";

interface TenantOption {
  tenantId: string;
  name: string;
  slug: string;
  membershipId: string;
}

interface SessionResponse {
  role: string | null;
  tenantContext: {
    userId: string;
    tenants: TenantOption[];
  } | null;
}

interface TenantMember {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
}

interface InviteResult {
  membershipId: string;
  userId: string;
  email: string;
  status: string;
  roles: string[];
  invited: boolean;
  message?: string;
}

const ASSIGNABLE_ROLES = [
  { code: "R-tenant-admin", label: "Tenant admin" },
  { code: "R-agent", label: "Agent" },
  { code: "R-customer", label: "Customer" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  "R-enterprise-admin": "Platform admin",
  "R-tenant-admin": "Tenant admin",
  "R-agent": "Agent",
  "R-customer": "Customer",
};

/** Readable message for an API failure; 401/403 get an action. */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Your session has expired. Sign in again.";
    }
    if (error.status === 403) {
      return "You do not have permission to manage users in this tenant.";
    }
    return error.message;
  }
  return "The user directory could not be loaded.";
}

function statusLabel(status: string): string {
  if (status === "ACTIVE") return "Active";
  if (status === "SUSPENDED") return "Suspended";
  return status;
}

/** Two-letter avatar fallback for a directory row. */
function initialsFor(member: TenantMember): string {
  const source = (member.displayName || member.email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Tenant-scoped user directory (F-03, AC-F03-1).
 *
 * The panel reads the caller's tenant from GET /auth/session, then reads
 * GET /tenants/{tenantId}/users. Only members of that tenant can appear:
 * the tenant id comes from the server-resolved membership, never from a
 * free-form input. Tenant administrators can invite, change a role,
 * suspend, reinstate and remove a membership in their own tenant.
 *
 * The layout follows the admin-v2.7 prototype: a header, a separate invite
 * card, then a separate directory card with search, role/status filters,
 * rows per page and pagination.
 */
export function TenantUsersPanel() {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("R-agent");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string>("R-agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const inviteEmailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await apiFetch<SessionResponse>("/auth/session");
        const list = session.tenantContext?.tenants ?? [];
        if (cancelled) return;
        setTenants(list);
        setTenantId(list[0]?.tenantId ?? null);
        if (list.length === 0) {
          setError("Your account has no active tenant.");
          setLoading(false);
        }
      } catch (sessionError) {
        if (cancelled) return;
        setError(describeError(sessionError));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void apiFetch<TenantMember[]>(`/tenants/${tenantId}/users`)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((loadError) => {
        if (!cancelled) setError(describeError(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, reloadToken]);

  const ownMembershipId =
    tenants.find((tenant) => tenant.tenantId === tenantId)?.membershipId ??
    null;

  const roleOptions = useMemo(() => {
    const codes = new Set<string>(
      ASSIGNABLE_ROLES.map((option) => option.code),
    );
    for (const member of members) {
      for (const code of member.roles) {
        codes.add(code);
      }
    }
    return Array.from(codes);
  }, [members]);

  const filteredMembers = members.filter((member) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch =
      !needle ||
      member.email.toLowerCase().includes(needle) ||
      member.displayName.toLowerCase().includes(needle);
    const matchesRole =
      roleFilter === "ALL" || member.roles.includes(roleFilter);
    const matchesStatus =
      statusFilter === "ALL" || member.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const pageCount = Math.max(
    1,
    Math.ceil(filteredMembers.length / rowsPerPage),
  );
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const pageMembers = filteredMembers.slice(
    startIndex,
    startIndex + rowsPerPage,
  );
  const shownFrom = filteredMembers.length === 0 ? 0 : startIndex + 1;
  const shownTo = Math.min(startIndex + rowsPerPage, filteredMembers.length);

  const refresh = () => {
    setError(null);
    setLoading(true);
    setReloadToken((value) => value + 1);
  };

  const sendInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantId) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy("invite");
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<InviteResult>(
        `/tenants/${tenantId}/users`,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            roleCode: inviteRole,
            invite: true,
          }),
        },
      );
      setNotice(
        result.invited
          ? `Invitation sent to ${result.email}.`
          : `${result.email} was added to this tenant.`,
      );
      setInviteEmail("");
      refresh();
    } catch (inviteError) {
      setError(describeError(inviteError));
    } finally {
      setBusy(null);
    }
  };

  const saveRole = async (member: TenantMember) => {
    if (!tenantId) return;
    setBusy(member.membershipId);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(
        `/tenants/${tenantId}/memberships/${member.membershipId}/roles`,
        {
          method: "PUT",
          body: JSON.stringify({ roleCode: editingRole }),
        },
      );
      setNotice(`Role updated for ${member.email}.`);
      setEditingId(null);
      refresh();
    } catch (roleError) {
      setError(describeError(roleError));
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = async (member: TenantMember) => {
    if (!tenantId) return;
    const nextStatus = member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setBusy(member.membershipId);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(
        `/tenants/${tenantId}/memberships/${member.membershipId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      setNotice(
        `${member.email} is now ${nextStatus === "ACTIVE" ? "active" : "suspended"}.`,
      );
      refresh();
    } catch (statusError) {
      setError(describeError(statusError));
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: TenantMember) => {
    if (!tenantId) return;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`Remove ${member.email} from this tenant?`);
    if (!confirmed) return;
    setBusy(member.membershipId);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(
        `/tenants/${tenantId}/memberships/${member.membershipId}`,
        { method: "DELETE" },
      );
      setNotice(`${member.email} was removed from this tenant.`);
      refresh();
    } catch (removeError) {
      setError(describeError(removeError));
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (member: TenantMember) => {
    const current = member.roles.find((code) =>
      ASSIGNABLE_ROLES.some((option) => option.code === code),
    );
    setEditingId(member.membershipId);
    setEditingRole(current ?? "R-agent");
    setNotice(null);
    setError(null);
  };

  return (
    <div className="space-y-5" data-testid="tenant-users-panel">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-700/50 pb-4">
        <div>
          <h2 className="text-2xl font-bold font-display text-heading">
            User Management
          </h2>
          <p className="text-xs mt-1 text-muted-custom font-mono">
            Manage system operators, agents and administrative accounts in this
            tenant.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            inviteEmailRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            inviteEmailRef.current?.focus();
          }}
          data-testid="tenant-invite-open"
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-mono font-bold inline-flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add System User
        </button>
      </div>

      {tenants.length > 1 && (
        <label className="block text-xs font-mono rounded-2xl glass-panel p-4">
          <span className="text-muted-custom font-bold">Tenant</span>
          <select
            value={tenantId ?? ""}
            onChange={(event) => {
              setLoading(true);
              setTenantId(event.target.value);
              setEditingId(null);
              setNotice(null);
              setError(null);
              setPage(1);
            }}
            className="mt-1 block w-full sm:w-72 border rounded-xl px-3 py-2 text-xs text-heading font-semibold focus:outline-none"
            style={{
              background: "var(--input-bg)",
              borderColor: "var(--input-border)",
            }}
          >
            {tenants.map((tenant) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>
                {tenant.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p
          role="alert"
          data-testid="tenant-users-error"
          className="text-xs text-red-400 font-bold rounded-xl border border-red-500/40 bg-red-500/10 p-3"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          data-testid="tenant-users-notice"
          className="text-xs text-emerald-300 font-bold inline-flex items-center gap-1.5"
        >
          <Mail className="w-3.5 h-3.5" />
          {notice}
        </p>
      )}

      <section
        className="glass-panel rounded-2xl p-5 space-y-4"
        data-testid="tenant-invite-card"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700/50 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-heading flex items-center gap-2">
              <Mail
                className="w-4 h-4"
                style={{ color: "var(--accent-cyan)" }}
              />
              Invite a team member
            </h2>
            <p className="text-xs mt-1 text-muted-custom">
              Send a workspace invitation. The invitee receives the selected
              role after they accept.
            </p>
          </div>
        </div>

        <form
          onSubmit={sendInvite}
          className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end"
        >
          <div>
            <label
              htmlFor="tenant-invite-email"
              className="block text-[10px] uppercase font-mono font-bold mb-1 text-muted-custom"
            >
              Work email
            </label>
            <input
              ref={inviteEmailRef}
              id="tenant-invite-email"
              data-testid="tenant-invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="new.member@company.com"
              className="w-full border rounded-xl px-3 py-2 text-xs text-heading focus:outline-none"
              style={{
                background: "var(--input-bg)",
                borderColor: "var(--input-border)",
              }}
            />
          </div>
          <div>
            <label
              htmlFor="tenant-invite-role"
              className="block text-[10px] uppercase font-mono font-bold mb-1 text-muted-custom"
            >
              Role
            </label>
            <select
              id="tenant-invite-role"
              data-testid="tenant-invite-role"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-xs text-heading font-semibold focus:outline-none"
              style={{
                background: "var(--input-bg)",
                borderColor: "var(--input-border)",
              }}
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            data-testid="tenant-invite-submit"
            disabled={!tenantId || busy === "invite"}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
        </form>
      </section>

      <section
        className="glass-panel rounded-2xl p-5 space-y-4"
        data-testid="tenant-users-directory-card"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/50 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-heading flex items-center gap-2">
              <Users
                className="w-4 h-4"
                style={{ color: "var(--accent-cyan)" }}
              />
              User directory
            </h2>
            <p className="text-xs mt-1 text-muted-custom">
              Only members of the selected tenant appear here.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl glass-panel text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60 self-start sm:self-auto"
            style={{ color: "var(--accent-cyan)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="relative w-full xl:w-72">
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search user name or email..."
              aria-label="Search tenant users"
              data-testid="tenant-users-search"
              className="w-full border rounded-xl px-3.5 py-2 text-xs text-heading focus:outline-none"
              style={{
                background: "var(--input-bg)",
                borderColor: "var(--input-border)",
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            <label className="flex items-center gap-2">
              <span className="text-muted-custom font-bold">Role:</span>
              <select
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value);
                  setPage(1);
                }}
                aria-label="Filter by role"
                data-testid="tenant-users-role-filter"
                className="border rounded-xl px-2.5 py-2 text-xs text-heading font-semibold focus:outline-none"
                style={{
                  background: "var(--input-bg)",
                  borderColor: "var(--input-border)",
                }}
              >
                <option value="ALL">All Roles</option>
                {roleOptions.map((code) => (
                  <option key={code} value={code}>
                    {ROLE_LABELS[code] ?? code}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="text-muted-custom font-bold">Status:</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                aria-label="Filter by status"
                data-testid="tenant-users-status-filter"
                className="border rounded-xl px-2.5 py-2 text-xs text-heading font-semibold focus:outline-none"
                style={{
                  background: "var(--input-bg)",
                  borderColor: "var(--input-border)",
                }}
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="text-muted-custom font-bold">Rows:</span>
              <select
                value={rowsPerPage}
                onChange={(event) => {
                  setRowsPerPage(Number(event.target.value));
                  setPage(1);
                }}
                aria-label="Rows per page"
                data-testid="tenant-users-rows"
                className="border rounded-xl px-2 py-2 text-xs text-heading font-semibold focus:outline-none"
                style={{
                  background: "var(--input-bg)",
                  borderColor: "var(--input-border)",
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
              </select>
            </label>
          </div>
        </div>

        {loading && (
          <p
            role="status"
            data-testid="tenant-users-loading"
            className="text-xs text-muted-custom"
          >
            Loading tenant users…
          </p>
        )}

        <div className="sm:overflow-x-auto">
          <table className="block w-full text-left text-xs sm:table">
            <thead
              className="hidden font-mono uppercase border-b text-muted-custom sm:table-header-group"
              style={{ borderColor: "var(--card-border)" }}
            >
              <tr>
                <th className="p-3">User</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody
              className="block sm:table-row-group sm:divide-y"
              style={{ borderColor: "var(--card-border)" }}
            >
              {!loading && filteredMembers.length === 0 ? (
                <tr className="block sm:table-row">
                  <td
                    colSpan={4}
                    className="block p-10 text-center font-mono sm:table-cell"
                    style={{ color: "var(--text-muted)" }}
                    data-testid="tenant-users-empty"
                  >
                    <span className="flex flex-col items-center justify-center gap-2">
                      <SearchX className="w-8 h-8 opacity-70" />
                      <span className="font-bold text-sm text-heading">
                        No data found
                      </span>
                      <span className="text-[11px] font-medium">
                        {members.length === 0
                          ? "This tenant has no users yet."
                          : "No users match your current search or filter criteria."}
                      </span>
                    </span>
                  </td>
                </tr>
              ) : (
                pageMembers.map((member) => {
                  const isSelf = member.membershipId === ownMembershipId;
                  const isPlatformMember =
                    member.roles.includes("R-enterprise-admin");
                  const locked = isSelf || isPlatformMember;
                  const rowBusy = busy === member.membershipId;
                  return (
                    <tr
                      key={member.membershipId}
                      data-testid="tenant-user-row"
                      className="mb-2 block rounded-xl border p-3 last:mb-0 hover:bg-slate-500/10 transition sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:p-0"
                      style={{ borderColor: "var(--card-border)" }}
                    >
                      <td className="block p-0 sm:table-cell sm:p-3">
                        <span className="flex items-start justify-between gap-3 sm:items-center">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-[10px] font-mono font-bold flex items-center justify-center shrink-0"
                              aria-hidden="true"
                            >
                              {initialsFor(member)}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-heading truncate">
                                {member.displayName || member.email}
                              </span>
                              <span className="block text-[10px] font-mono text-muted-custom truncate">
                                {member.email}
                              </span>
                            </span>
                          </span>
                          <span
                            data-testid="tenant-user-status-mobile"
                            className="sm:hidden shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold"
                            style={{
                              color:
                                member.status === "ACTIVE"
                                  ? "var(--accent-emerald)"
                                  : "var(--text-muted)",
                            }}
                          >
                            <span
                              className={
                                "w-1.5 h-1.5 rounded-full " +
                                (member.status === "ACTIVE"
                                  ? "bg-emerald-400"
                                  : "bg-slate-500")
                              }
                            />
                            {statusLabel(member.status)}
                          </span>
                        </span>
                      </td>
                      <td className="mt-3 block p-0 sm:mt-0 sm:table-cell sm:p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold uppercase text-muted-custom sm:hidden">
                            Role
                          </span>
                          {editingId === member.membershipId ? (
                            <select
                              value={editingRole}
                              onChange={(event) =>
                                setEditingRole(event.target.value)
                              }
                              aria-label={`Role for ${member.email}`}
                              data-testid="tenant-role-select"
                              className="border rounded-lg px-2 py-1 text-[11px] text-heading font-semibold focus:outline-none"
                              style={{
                                background: "var(--input-bg)",
                                borderColor: "var(--input-border)",
                              }}
                            >
                              {ASSIGNABLE_ROLES.map((option) => (
                                <option key={option.code} value={option.code}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="px-2 py-0.5 rounded font-mono font-bold text-[10px]"
                              style={{
                                background: "rgba(59,130,246,0.2)",
                                color: "var(--accent-cyan)",
                              }}
                            >
                              {member.roles
                                .map((code) => ROLE_LABELS[code] ?? code)
                                .join(", ") || "No role"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden p-3 sm:table-cell">
                        <span
                          className="font-bold inline-flex items-center gap-1.5"
                          style={{
                            color:
                              member.status === "ACTIVE"
                                ? "var(--accent-emerald)"
                                : "var(--text-muted)",
                          }}
                        >
                          <span
                            className={
                              "w-1.5 h-1.5 rounded-full " +
                              (member.status === "ACTIVE"
                                ? "bg-emerald-400"
                                : "bg-slate-500")
                            }
                          />
                          {statusLabel(member.status)}
                        </span>
                      </td>
                      <td className="mt-3 block p-0 sm:mt-0 sm:table-cell sm:p-3">
                        <div className="flex flex-wrap justify-start gap-1.5 sm:justify-end">
                          {editingId === member.membershipId ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void saveRole(member)}
                                disabled={rowBusy}
                                className="px-2.5 py-1 rounded glass-panel text-[10px] font-bold disabled:opacity-60"
                                style={{ color: "var(--accent-cyan)" }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                disabled={rowBusy}
                                className="px-2.5 py-1 rounded glass-panel text-[10px] font-bold disabled:opacity-60"
                                style={{ color: "var(--text-muted)" }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(member)}
                                disabled={locked || rowBusy}
                                title={
                                  isSelf
                                    ? "You cannot change your own membership here"
                                    : isPlatformMember
                                      ? "Platform administrator memberships are managed outside the tenant view"
                                      : undefined
                                }
                                className="px-2.5 py-1 rounded glass-panel text-[10px] font-bold disabled:opacity-50"
                                style={{ color: "var(--accent-cyan)" }}
                              >
                                Edit role
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleStatus(member)}
                                disabled={locked || rowBusy}
                                title={
                                  isSelf
                                    ? "You cannot change your own membership here"
                                    : isPlatformMember
                                      ? "Platform administrator memberships are managed outside the tenant view"
                                      : undefined
                                }
                                className="px-2.5 py-1 rounded glass-panel text-[10px] font-bold disabled:opacity-50"
                                style={{ color: "var(--accent-cyan)" }}
                              >
                                {member.status === "ACTIVE"
                                  ? "Suspend"
                                  : "Reinstate"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeMember(member)}
                                disabled={locked || rowBusy}
                                title={
                                  isSelf
                                    ? "You cannot remove your own membership"
                                    : isPlatformMember
                                      ? "Platform administrator memberships are managed outside the tenant view"
                                      : undefined
                                }
                                className="px-2.5 py-1 rounded glass-panel text-[10px] font-bold disabled:opacity-50 inline-flex items-center gap-1"
                                style={{ color: "var(--accent-rose)" }}
                              >
                                <Trash2 className="w-3 h-3" />
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-slate-700/50 font-mono text-xs text-muted-custom font-bold"
          data-testid="tenant-users-pagination"
        >
          <span>
            Showing {shownFrom} to {shownTo} of {filteredMembers.length} entries
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              data-testid="tenant-users-prev"
              className="px-3 py-1.5 rounded-xl glass-panel hover:border-blue-600 text-heading transition-all disabled:opacity-50"
            >
              Previous
            </button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(
              (pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  aria-label={`Page ${pageNumber}`}
                  aria-current={pageNumber === currentPage ? "page" : undefined}
                  className={
                    "px-3 py-1 rounded-xl font-bold transition-all " +
                    (pageNumber === currentPage
                      ? "bg-blue-600/20 border border-blue-600 text-blue-300"
                      : "glass-panel text-heading hover:border-blue-600")
                  }
                >
                  {pageNumber}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              disabled={currentPage >= pageCount}
              aria-label="Next page"
              data-testid="tenant-users-next"
              className="px-3 py-1.5 rounded-xl glass-panel hover:border-blue-600 text-heading transition-all disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
