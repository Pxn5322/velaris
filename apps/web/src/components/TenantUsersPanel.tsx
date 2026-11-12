"use client";

import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import { Mail, RefreshCw, Trash2, UserPlus } from "lucide-react";
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

/**
 * Tenant-scoped user directory (F-03, AC-F03-1).
 *
 * The panel reads the caller's tenant from GET /auth/session, then reads
 * GET /tenants/{tenantId}/users. Only members of that tenant can appear:
 * the tenant id comes from the server-resolved membership, never from a
 * free-form input. Tenant administrators can invite, change a role,
 * suspend, reinstate and remove a membership in their own tenant.
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("R-agent");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string>("R-agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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
    return matchesSearch && matchesRole;
  });

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
    <div
      className="glass-panel p-6 rounded-2xl space-y-5 border border-slate-700/50"
      data-testid="tenant-users-panel"
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-heading uppercase tracking-wider">
            Tenant users
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Only members of the selected tenant appear here.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl glass-panel text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
          style={{ color: "var(--accent-cyan)" }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {tenants.length > 1 && (
        <label className="block text-xs font-mono">
          <span style={{ color: "var(--text-muted)" }}>Tenant</span>
          <select
            value={tenantId ?? ""}
            onChange={(event) => {
              setLoading(true);
              setTenantId(event.target.value);
              setEditingId(null);
              setNotice(null);
              setError(null);
            }}
            className="mt-1 w-full sm:w-72 border rounded-xl px-3 py-2 text-xs text-heading font-semibold focus:outline-none"
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

      <form
        onSubmit={sendInvite}
        className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end"
      >
        <div>
          <label
            htmlFor="tenant-invite-email"
            className="block text-[10px] uppercase font-mono font-bold mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            Work email
          </label>
          <input
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
            className="block text-[10px] uppercase font-mono font-bold mb-1"
            style={{ color: "var(--text-muted)" }}
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
          className="px-3 py-2 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <UserPlus className="w-3.5 h-3.5" />
          {busy === "invite" ? "Sending…" : "Send invite"}
        </button>
      </form>

      {loading && (
        <p
          role="status"
          data-testid="tenant-users-loading"
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Loading tenant users…
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid="tenant-users-error"
          className="text-xs text-red-400 font-bold"
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

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tenant users…"
          aria-label="Search tenant users"
          className="border rounded-xl px-3 py-2 text-xs text-heading focus:outline-none sm:max-w-xs"
          style={{
            background: "var(--input-bg)",
            borderColor: "var(--input-border)",
          }}
        />
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          aria-label="Filter by role"
          className="border rounded-xl px-3 py-2 text-xs text-heading font-semibold focus:outline-none"
          style={{
            background: "var(--input-bg)",
            borderColor: "var(--input-border)",
          }}
        >
          <option value="ALL">All roles</option>
          {roleOptions.map((code) => (
            <option key={code} value={code}>
              {ROLE_LABELS[code] ?? code}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead
            className="font-mono uppercase border-b"
            style={{
              borderColor: "var(--card-border)",
              color: "var(--text-muted)",
            }}
          >
            <tr>
              <th className="p-3">User</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody
            className="divide-y"
            style={{ borderColor: "var(--card-border)" }}
          >
            {!loading && filteredMembers.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="p-8 text-center font-mono"
                  style={{ color: "var(--text-muted)" }}
                  data-testid="tenant-users-empty"
                >
                  {members.length === 0
                    ? "This tenant has no users yet."
                    : "No users match this filter."}
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const isSelf = member.membershipId === ownMembershipId;
                const isPlatformMember =
                  member.roles.includes("R-enterprise-admin");
                const locked = isSelf || isPlatformMember;
                const rowBusy = busy === member.membershipId;
                return (
                  <tr
                    key={member.membershipId}
                    data-testid="tenant-user-row"
                    className="hover:bg-slate-500/10 transition"
                  >
                    <td className="p-3 font-semibold text-heading">
                      {member.displayName || member.email}
                      <br />
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {member.email}
                      </span>
                    </td>
                    <td className="p-3">
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
                    </td>
                    <td className="p-3">
                      <span
                        className="font-bold"
                        style={{
                          color:
                            member.status === "ACTIVE"
                              ? "var(--accent-emerald)"
                              : "var(--text-muted)",
                        }}
                      >
                        ● {statusLabel(member.status)}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
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
    </div>
  );
}
