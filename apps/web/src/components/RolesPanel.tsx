"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";

interface TenantRole {
  id: string;
  code: string;
  name: string;
  systemManaged: boolean;
  baseRoleCode: string;
  membershipCount: number;
  permissionCount: number;
}

const BASE_ROLES = [
  { code: "R-tenant-admin", label: "Tenant admin" },
  { code: "R-agent", label: "Agent" },
  { code: "R-customer", label: "Customer" },
] as const;

const BASE_DESCRIPTION: Record<string, string> = {
  "R-tenant-admin":
    "Workspace governance, members, retention, analytics and AI configuration.",
  "R-agent":
    "Ticket inbox, customer context and conversation replies without governance.",
  "R-customer":
    "Own customer portal conversations and customer-visible replies only.",
};

function baseLabel(code: string): string {
  return BASE_ROLES.find((role) => role.code === code)?.label ?? code;
}

/**
 * Roles & RBAC access matrix.
 *
 * The prototype's role cards and create action are backed by real tenant
 * routes. System roles are read-only; a custom role inherits one canonical
 * permission profile and can be renamed or deleted when unassigned.
 */
export function RolesPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [baseRoleCode, setBaseRoleCode] = useState("R-agent");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBase, setEditBase] = useState("R-agent");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setRoles(await apiFetch<TenantRole[]>(`/tenants/${id}/roles`));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? "Your role cannot manage roles in this tenant."
          : caught instanceof Error
            ? caught.message
            : "Roles could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const session = await apiFetch<{
            tenantContext: { tenants: { tenantId: string }[] } | null;
          }>("/auth/session");
          const id = session.tenantContext?.tenants[0]?.tenantId ?? null;
          setTenantId(id);
          if (!id) {
            setError("This account has no active tenant.");
            setLoading(false);
            return;
          }
          await load(id);
        } catch {
          setError("Roles could not be loaded.");
          setLoading(false);
        }
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const createRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<TenantRole>(`/tenants/${tenantId}/roles`, {
        method: "POST",
        body: JSON.stringify({ code, name, baseRoleCode }),
      });
      setRoles((current) => [...current, created]);
      setNotice(`${created.name} was created.`);
      setCreating(false);
      setCode("");
      setName("");
      setBaseRoleCode("R-agent");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The role could not be made.",
      );
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (role: TenantRole) => {
    setEditingId(role.id);
    setEditName(role.name);
    setEditBase(role.baseRoleCode);
    setCreating(false);
    setError(null);
    setNotice(null);
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantId || !editingId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<TenantRole>(
        `/tenants/${tenantId}/roles/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: editName, baseRoleCode: editBase }),
        },
      );
      setRoles((current) =>
        current.map((role) => (role.id === updated.id ? updated : role)),
      );
      setNotice(`${updated.name} was updated.`);
      setEditingId(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The role could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (role: TenantRole) => {
    if (!tenantId) return;
    if (!window.confirm(`Delete the custom role ${role.name}?`)) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/tenants/${tenantId}/roles/${role.id}`, {
        method: "DELETE",
      });
      setRoles((current) => current.filter((item) => item.id !== role.id));
      setNotice(`${role.name} was deleted.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The role could not be deleted.",
      );
    }
  };

  return (
    <section className="space-y-5" data-testid="roles-panel">
      <div className="flex flex-col gap-3 border-b border-[var(--card-border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-heading sm:text-2xl">
            Roles & RBAC Access Matrix
          </h2>
          <p className="text-xs font-mono text-muted-custom">
            Define role permissions, policy scopes, and enforcement levels
          </p>
        </div>
        <button
          type="button"
          data-testid="role-create-open"
          onClick={() => {
            setCreating((open) => !open);
            setEditingId(null);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-blue-600 bg-blue-600/10 px-4 py-2 text-xs font-mono font-bold text-cyan-300 hover:bg-blue-600/20"
        >
          <Plus className="h-3.5 w-3.5" /> Create New Custom Role
        </button>
      </div>

      {notice && (
        <p
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300"
          data-testid="roles-notice"
          role="status"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300"
          data-testid="roles-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {creating && (
        <form
          onSubmit={createRole}
          data-testid="role-create-form"
          className="glass-panel grid gap-3 rounded-2xl p-4 font-mono text-xs sm:grid-cols-4"
        >
          <label className="space-y-1">
            <span className="text-muted-custom">Role code</span>
            <input
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="R-support-lead"
              pattern="R-[a-z0-9]+(-[a-z0-9]+)*"
              data-testid="role-code"
              className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-custom">Display name</span>
            <input
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Support lead"
              data-testid="role-name"
              className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-custom">Permission profile</span>
            <select
              value={baseRoleCode}
              onChange={(event) => setBaseRoleCode(event.target.value)}
              data-testid="role-base"
              className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading"
            >
              {BASE_ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={saving}
              data-testid="role-create-submit"
              className="rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan px-4 py-2 font-bold text-white disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create role"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-xl glass-panel px-3 py-2 font-bold text-muted-custom"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p role="status" className="text-xs text-muted-custom">
          Loading roles…
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const editing = editingId === role.id;
            return (
              <article
                key={role.id}
                data-testid="role-card"
                data-role-code={role.code}
                className="glass-panel space-y-3 rounded-2xl p-5"
              >
                {editing ? (
                  <form onSubmit={saveEdit} className="space-y-3 text-xs">
                    <label className="block space-y-1">
                      <span className="text-muted-custom">Display name</span>
                      <input
                        required
                        minLength={2}
                        maxLength={60}
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        data-testid="role-edit-name"
                        className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-muted-custom">
                        Permission profile
                      </span>
                      <select
                        value={editBase}
                        onChange={(event) => setEditBase(event.target.value)}
                        data-testid="role-edit-base"
                        className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-heading"
                      >
                        {BASE_ROLES.map((base) => (
                          <option key={base.code} value={base.code}>
                            {base.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={saving}
                        data-testid="role-save"
                        className="rounded-lg bg-blue-600 px-3 py-1.5 font-bold text-white disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg glass-panel px-3 py-1.5 font-bold text-muted-custom"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-mono text-sm font-bold text-heading">
                          {role.name}
                        </h3>
                        <span className="text-[10px] font-mono text-muted-custom">
                          {role.code}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-mono font-bold ${
                          role.systemManaged
                            ? "bg-purple-500/20 text-purple-300"
                            : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {role.systemManaged ? "SYSTEM" : "CUSTOM"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-custom">
                      {BASE_DESCRIPTION[role.baseRoleCode] ??
                        `Inherits the ${baseLabel(role.baseRoleCode)} profile.`}
                    </p>
                    <div className="flex items-center justify-between gap-2 border-t border-[var(--card-border)] pt-2 text-[11px] font-mono">
                      <span className="font-bold text-cyan-300">
                        {role.permissionCount} permissions ·{" "}
                        {baseLabel(role.baseRoleCode)}
                      </span>
                      <span className="text-muted-custom">
                        {role.membershipCount} assigned
                      </span>
                    </div>
                    {!role.systemManaged && (
                      <div className="flex gap-2 text-[10px] font-mono font-bold">
                        <button
                          type="button"
                          onClick={() => startEdit(role)}
                          data-testid="role-edit"
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--card-border)] px-2.5 py-1 text-heading hover:border-cyan-500/40"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteRole(role)}
                          data-testid="role-delete"
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1 text-rose-300 hover:bg-rose-500/10"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-custom">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
        Custom roles inherit a canonical permission profile. System role
        permissions are fixed.
        <RefreshCw
          className="h-3.5 w-3.5 cursor-pointer"
          onClick={() => tenantId && void load(tenantId)}
          aria-label="Reload roles"
        />
        <Lock className="h-3.5 w-3.5" />
      </div>
    </section>
  );
}
