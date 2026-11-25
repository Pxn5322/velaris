"use client";

/**
 * Customer self-service page (T2.04 follow-up, journey J-03).
 *
 * Reads the signed-in R-customer's tenant from `GET /auth/session`, lists the
 * customer's own tickets from `GET /tickets?tenantId=...`, and opens a new one
 * with `POST /tickets/self?tenantId=...`. The server derives the customer row
 * and the tenant from the verified identity, so this page sends neither.
 *
 * The page never invents data: a failed load shows an error state, and a
 * failed submit keeps the form open with a message instead of adding a row.
 * Ticket rows carry no description column, so the form collects a subject and
 * a category only; free-form customer text belongs to conversations.
 */

import React, { useCallback, useEffect, useState } from "react";
import { LifeBuoy, Search, PlusCircle, FileText, Send, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useRole } from "@/context/RoleContext";

interface CustomerTicket {
  id: string;
  customerId: string;
  title: string;
  status: string;
  priority: string;
  tags?: string[];
  createdAt: string;
}

interface TenantEntry {
  tenantId: string;
  name?: string;
}

interface AuthSessionResponse {
  tenantContext: { userId: string; tenants: TenantEntry[] } | null;
}

type Phase = "loading" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN PROGRESS",
  PENDING_CUSTOMER: "PENDING CUSTOMER",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
};

export function CustomerPortalView() {
  const [deflectionQuery, setDeflectionQuery] = useState("");
  const [deflectionResult, setDeflectionResult] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const { theme } = useRole();
  const isLight = theme === "light";

  const load = useCallback(async () => {
    try {
      const auth = await apiFetch<AuthSessionResponse>("/auth/session");
      const tenant = auth.tenantContext?.tenants?.[0];
      if (!tenant) {
        setFailure("This account has no active tenant membership.");
        setPhase("error");
        return;
      }
      setTenantId(tenant.tenantId);
      setTenantName(tenant.name ?? null);
      const rows = await apiFetch<CustomerTicket[]>(
        `/tickets?tenantId=${encodeURIComponent(tenant.tenantId)}`,
      );
      setTickets(rows);
      setPhase("ready");
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Support requests are unavailable.",
      );
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // The kick-off runs in a scheduled callback so the effect body never
    // starts a synchronous setState cascade (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const handleSearchChange = (q: string) => {
    setDeflectionQuery(q);
    if (
      q.toLowerCase().includes("sso") ||
      q.toLowerCase().includes("saml") ||
      q.toLowerCase().includes("login")
    ) {
      setDeflectionResult(
        "SAML SSO setup guide: Go to Admin Settings > Security > Identity Provider and upload your SAML metadata XML file.",
      );
    } else if (
      q.toLowerCase().includes("bill") ||
      q.toLowerCase().includes("invoice") ||
      q.toLowerCase().includes("tax")
    ) {
      setDeflectionResult(
        "Invoices and tax receipts can be downloaded directly under Organization > Billing History.",
      );
    } else if (q.length > 4) {
      setDeflectionResult(
        "Our AI Knowledge Base recommends reviewing our troubleshooting docs or creating a support request below.",
      );
    } else {
      setDeflectionResult(null);
    }
  };

  const openComposer = () => {
    setSubmitError(null);
    setIsModalOpen(true);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !tenantId || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch<CustomerTicket>(
        `/tickets/self?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            priority: "MEDIUM",
            tags: [newCategory],
          }),
        },
      );
      setNewTitle("");
      setNewCategory("General");
      setIsModalOpen(false);
      // Reload instead of pushing a local row: the list is server state.
      await load();
    } catch (error) {
      const denied =
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403);
      setSubmitError(
        denied
          ? "Your account cannot open a support request in this workspace."
          : "Your request could not be sent. Try again in a moment.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /** Local time for a stored instant; an unreadable value stays visible. */
  const formatSubmitted = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString(undefined, {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
  };

  const isResolved = (status: string) =>
    status === "RESOLVED" || status === "CLOSED";

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header Hero */}
        <div
          className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border"
          style={{ borderColor: "var(--card-border)" }}
        >
          <div>
            <span
              className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider font-mono"
              style={{
                background: isLight
                  ? "rgba(37,99,235,0.1)"
                  : "rgba(59,130,246,0.1)",
                color: "var(--accent-cyan)",
              }}
            >
              Customer Self-Service Hub
            </span>
            <h1
              className="text-2xl md:text-3xl font-bold font-display text-heading mt-2"
              data-testid="portal-tenant-heading"
            >
              {tenantName ? `Welcome to ${tenantName}` : "Support workspace"}
            </h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Search our AI knowledge base or submit a support request directly.
            </p>
          </div>
          <button
            onClick={openComposer}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition"
          >
            <PlusCircle className="w-4 h-4" /> Submit New Ticket
          </button>
        </div>

        {/* AI Deflection Widget */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <LifeBuoy
              className="w-5 h-5"
              style={{ color: "var(--accent-cyan)" }}
            />
            <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
              AI Instant Solution Search
            </h2>
          </div>
          <div className="relative">
            <Search
              className="absolute left-3.5 top-3 h-4 w-4"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              type="text"
              value={deflectionQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search issues (e.g. SSO login error, billing invoice)..."
              className={`w-full border rounded-xl pl-10 pr-4 py-2.5 text-xs text-heading focus:outline-none ${isLight ? "bg-white border-slate-300" : "bg-slate-900 border-slate-700/60"}`}
            />
          </div>

          {deflectionResult && (
            <div
              className="border rounded-xl p-4 space-y-2 animate-fadeIn"
              style={{
                background: isLight
                  ? "rgba(14,116,144,0.06)"
                  : "rgba(30,58,138,0.2)",
                borderColor: "var(--accent-cyan)",
              }}
            >
              <span
                className="text-[10px] font-bold uppercase tracking-widest block font-mono"
                style={{ color: "var(--accent-cyan)" }}
              >
                AI Knowledge Response
              </span>
              <p className="text-xs leading-relaxed font-mono text-heading">
                {deflectionResult}
              </p>
              <div
                className="pt-2 flex items-center justify-between text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                <span>Did this resolve your inquiry?</span>
                <div className="flex gap-2">
                  <button
                    className="px-2.5 py-1 rounded font-bold transition border"
                    style={{
                      background: isLight
                        ? "rgba(5,150,105,0.1)"
                        : "rgba(52,211,153,0.1)",
                      color: "var(--accent-emerald)",
                      borderColor: "var(--accent-emerald)",
                    }}
                  >
                    ✓ Yes, thanks
                  </button>
                  <button
                    onClick={openComposer}
                    className="px-2.5 py-1 rounded font-bold transition border"
                    style={{
                      background: isLight ? "#FFFFFF" : "rgba(30,41,59,0.5)",
                      color: "var(--text-main)",
                      borderColor: "var(--card-border)",
                    }}
                  >
                    No, contact support
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* My Support Requests */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <h2 className="text-sm font-bold text-heading uppercase tracking-wider flex items-center gap-2">
            <FileText
              className="w-4 h-4"
              style={{ color: "var(--accent-cyan)" }}
            />{" "}
            My Support Requests ({tickets.length})
          </h2>

          {phase === "loading" && (
            <p
              className="text-xs font-mono"
              style={{ color: "var(--text-muted)" }}
              role="status"
            >
              Loading support requests…
            </p>
          )}

          {phase === "error" && (
            <p
              className="text-xs font-mono"
              style={{ color: "#DC2626" }}
              data-testid="portal-tickets-error"
              role="alert"
            >
              {failure}
            </p>
          )}

          {phase === "ready" && tickets.length === 0 && (
            <p
              className="text-xs font-mono"
              style={{ color: "var(--text-muted)" }}
              data-testid="portal-tickets-empty"
            >
              You have no support requests yet.
            </p>
          )}

          {tickets.length > 0 && (
            <div className="overflow-x-auto">
              <table
                className="w-full text-left text-xs"
                style={{ color: "var(--text-main)" }}
              >
                <thead
                  className="font-mono uppercase border-b"
                  style={{
                    borderColor: "var(--card-border)",
                    color: "var(--text-muted)",
                  }}
                >
                  <tr>
                    <th className="p-3">Ticket</th>
                    <th className="p-3">Subject</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Submitted</th>
                  </tr>
                </thead>
                <tbody
                  className="divide-y"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  {tickets.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-slate-500/10 transition"
                      data-testid="portal-ticket-row"
                    >
                      <td
                        className="p-3 font-mono font-bold"
                        style={{ color: "var(--accent-cyan)" }}
                      >
                        {t.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td
                        className="p-3 font-semibold text-heading"
                        data-testid="portal-ticket-title"
                      >
                        {t.title}
                      </td>
                      <td className="p-3">
                        <span
                          className="px-2 py-0.5 rounded font-mono text-[10px]"
                          style={{
                            background: isLight
                              ? "#E2E8F0"
                              : "rgba(30,41,59,0.8)",
                            color: "var(--text-main)",
                          }}
                        >
                          {t.tags?.[0] ?? "—"}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className="px-2 py-0.5 rounded font-bold text-[10px]"
                          style={{
                            background: isResolved(t.status)
                              ? isLight
                                ? "rgba(5,150,105,0.1)"
                                : "rgba(52,211,153,0.15)"
                              : isLight
                                ? "rgba(217,119,6,0.1)"
                                : "rgba(245,158,11,0.15)",
                            color: isResolved(t.status)
                              ? "var(--accent-emerald)"
                              : "#D97706",
                          }}
                        >
                          ● {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </td>
                      <td
                        className="p-3 font-mono text-[10px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {formatSubmitted(t.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        >
          <div
            className="glass-panel w-full max-w-lg rounded-2xl p-6 relative shadow-2xl animate-fadeIn border"
            style={{
              borderColor: "var(--card-border)",
              background: isLight ? "#FFFFFF" : "var(--card-bg)",
            }}
          >
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute right-4 top-4 hover:opacity-75"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold font-display text-heading mb-4">
              Submit New Support Ticket
            </h2>
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label
                  htmlFor="portal-ticket-title-input"
                  className="block text-xs font-mono uppercase mb-1 font-bold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Subject
                </label>
                <input
                  id="portal-ticket-title-input"
                  data-testid="portal-ticket-title-input"
                  type="text"
                  required
                  maxLength={200}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Brief summary of your issue..."
                  className={`w-full border rounded-lg p-2.5 text-xs text-heading focus:outline-none ${isLight ? "bg-white border-slate-300" : "bg-slate-900 border-slate-700"}`}
                />
              </div>
              <div>
                <label
                  htmlFor="portal-ticket-category"
                  className="block text-xs font-mono uppercase mb-1 font-bold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Category
                </label>
                <select
                  id="portal-ticket-category"
                  data-testid="portal-ticket-category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className={`w-full border rounded-lg p-2.5 text-xs text-heading focus:outline-none ${isLight ? "bg-white border-slate-300" : "bg-slate-900 border-slate-700"}`}
                >
                  <option value="Authentication">Authentication & SSO</option>
                  <option value="Billing">Billing & Subscriptions</option>
                  <option value="API Integration">API Integration</option>
                  <option value="General">General Inquiries</option>
                </select>
              </div>
              {submitError && (
                <p
                  className="text-xs font-mono"
                  style={{ color: "#DC2626" }}
                  data-testid="portal-ticket-error"
                  role="alert"
                >
                  {submitError}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  data-testid="portal-ticket-cancel"
                  className="px-4 py-2 border text-xs font-bold rounded-lg"
                  style={{
                    background: isLight ? "#F1F5F9" : "rgba(30,41,59,0.8)",
                    borderColor: "var(--card-border)",
                    color: "var(--text-main)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="portal-ticket-submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />{" "}
                  {submitting ? "Sending…" : "Submit Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
