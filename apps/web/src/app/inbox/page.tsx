"use client";

/**
 * Agent inbox (T2.04, F-06, AC-F06-1/2/3, journeys J-04).
 *
 * Role-aware workspace over the real API: tickets load through the
 * Supabase-guarded endpoints, so the page renders explicit states for
 * loading, denial (no session or no permission), failure (network/5xx)
 * and empty results. The "Assigned to me" tab filters by the caller's
 * own membership id from GET /auth/session. The timeline pane shows the
 * conversation of the ticket's customer; the API strips internal notes
 * for roles without note.internal.read (TH-05), and status changes go
 * through the version-guarded PATCH, so a stale write surfaces as a
 * visible conflict instead of a silent overwrite (AC-F05-2).
 *
 * Layout follows the unified-agent example: ticket queue on the left
 * (search + priority filter), active ticket detail in the middle, and
 * the customer profile of the selected ticket on the right.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox, RefreshCw, Search, User } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";

interface TenantEntry {
  tenantId: string;
  membershipId: string;
}

interface AuthSessionResponse {
  identity: { provider: string; subject: string; email?: string };
  tenantContext: { userId: string; tenants: TenantEntry[] } | null;
}

interface Ticket {
  id: string;
  customerId: string;
  title: string;
  status: string;
  priority: string;
  version: number;
  assigneeMembershipId: string | null;
  updatedAt: string;
}

interface Message {
  id: string;
  body: string;
  authorType: string;
  visibility: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  customerId: string;
  status: string;
  channel: string;
}

interface Customer {
  id: string;
  displayName: string;
  email?: string;
  phone?: string;
  status: string;
}

const PRIORITY_LABEL: Record<string, string> = {
  HIGH: "HIGH",
  MEDIUM: "MED",
  LOW: "LOW",
};

const PRIORITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-300",
  MEDIUM: "bg-amber-500/20 text-amber-300",
  LOW: "bg-slate-500/20 text-slate-300",
};

/** Compact "4m ago" label for the queue cards. */
function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type Phase = "loading" | "denied" | "error" | "ready";
type Tab = "all" | "mine";
type TimelineState = "idle" | "loading" | "empty" | "error" | "ready";
type ProfileState = "idle" | "loading" | "error" | "ready";

const STATUS_ACTIONS = [
  "IN_PROGRESS",
  "PENDING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;

export default function InboxPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [denial, setDenial] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [scope, setScope] = useState<TenantEntry | null>(null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("ALL");
  const [profile, setProfile] = useState<Customer | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>("idle");

  const load = useCallback(async () => {
    try {
      const auth = await apiFetch<AuthSessionResponse>("/auth/session");
      const tenants = auth.tenantContext?.tenants ?? [];
      if (tenants.length === 0) {
        setDenial("This account has no active tenant membership.");
        setPhase("denied");
        return;
      }
      setScope(tenants[0]);
      const rows = await apiFetch<Ticket[]>(
        `/tickets?tenantId=${encodeURIComponent(tenants[0].tenantId)}`,
      );
      setTickets(rows);
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDenial("Your session has expired. Sign in again.");
        setPhase("denied");
      } else if (error instanceof ApiError && error.status === 403) {
        setDenial("Your role cannot read tickets in this workspace.");
        setPhase("denied");
      } else {
        setFailure(
          error instanceof Error ? error.message : "Inbox is unavailable.",
        );
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    // The initial kick runs in a scheduled callback: a synchronous setState
    // (or a load that starts one) straight from the effect body would cascade
    // a render (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      if (!getSession()) {
        setDenial("Sign in to open the inbox.");
        setPhase("denied");
        return;
      }
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const loadProfile = useCallback(
    async (ticket: Ticket) => {
      setProfile(null);
      setProfileState("loading");
      if (!scope) {
        setProfileState("error");
        return;
      }
      try {
        const customer = await apiFetch<Customer>(
          `/customers/${ticket.customerId}?tenantId=${encodeURIComponent(scope.tenantId)}`,
        );
        setProfile(customer);
        setProfileState("ready");
      } catch {
        setProfileState("error");
      }
    },
    [scope],
  );

  const openTimeline = useCallback(
    async (ticket: Ticket) => {
      setSelected(ticket);
      setConflict(null);
      setTimeline("loading");
      void loadProfile(ticket);
      if (!scope) {
        setTimeline("error");
        return;
      }
      const tenantQuery = `tenantId=${encodeURIComponent(scope.tenantId)}`;
      try {
        const conversations = await apiFetch<Conversation[]>(
          `/conversations?${tenantQuery}`,
        );
        const own = conversations.find(
          (conversation) => conversation.customerId === ticket.customerId,
        );
        if (!own) {
          setTimeline("empty");
          return;
        }
        const detail = await apiFetch<Conversation & { messages: Message[] }>(
          `/conversations/${own.id}?${tenantQuery}`,
        );
        setMessages(detail.messages);
        setTimeline("ready");
      } catch {
        setTimeline("error");
      }
    },
    [scope, loadProfile],
  );

  const changeStatus = useCallback(
    async (ticket: Ticket, status: string) => {
      if (!scope) return;
      setConflict(null);
      try {
        const updated = await apiFetch<Ticket>(
          `/tickets/${ticket.id}?tenantId=${encodeURIComponent(scope.tenantId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status, expectedVersion: ticket.version }),
          },
        );
        setTickets((rows) =>
          rows.map((row) => (row.id === updated.id ? updated : row)),
        );
        setSelected(updated);
      } catch (error) {
        // AC-F05-2: a stale or illegal transition is a visible 409, never
        // a silent overwrite. Show the current state and reload.
        if (error instanceof ApiError && error.status === 409) {
          // J-04 recovery: show the current state after the refusal.
          setConflict(`${error.message} — the current state is shown below.`);
          await load();
          const fresh = await apiFetch<Ticket[]>(
            `/tickets?tenantId=${encodeURIComponent(scope.tenantId)}`,
          ).catch(() => []);
          setSelected(fresh.find((row) => row.id === ticket.id) ?? null);
        } else {
          setConflict(
            error instanceof Error ? error.message : "Update failed.",
          );
        }
      }
    },
    [scope, load],
  );

  const visibleTickets = tickets.filter((ticket) => {
    if (
      tab === "mine" &&
      scope &&
      ticket.assigneeMembershipId !== scope.membershipId
    ) {
      return false;
    }
    if (priority !== "ALL" && ticket.priority !== priority) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      ticket.title.toLowerCase().includes(needle) ||
      ticket.id.toLowerCase().includes(needle)
    );
  });

  return (
    <section className="flex-1 flex flex-col gap-4" data-testid="inbox">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Inbox aria-hidden="true" className="h-6 w-6" /> Support inbox
        </h1>
        <div
          className="flex rounded-lg overflow-hidden border border-slate-700"
          role="tablist"
          aria-label="Inbox scope"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "all"}
            data-testid="inbox-tab-all"
            onClick={() => setTab("all")}
            className={`px-4 py-1.5 text-sm ${tab === "all" ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
          >
            All tickets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            data-testid="inbox-tab-mine"
            onClick={() => setTab("mine")}
            className={`px-4 py-1.5 text-sm ${tab === "mine" ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
          >
            Assigned to me
          </button>
        </div>
      </header>

      {phase === "loading" && (
        <p className="text-slate-400" data-testid="inbox-loading" role="status">
          Loading tickets…
        </p>
      )}

      {phase === "denied" && (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200"
          data-testid="inbox-denied"
        >
          <p className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {denial}
          </p>
          <Link href="/?signin=1" className="underline mt-2 inline-block">
            Go to sign in
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-200"
          data-testid="inbox-error"
        >
          <p>{failure}</p>
          <button
            type="button"
            onClick={() => {
              setFailure(null);
              setDenial(null);
              setPhase("loading");
              void load();
            }}
            className="mt-2 inline-flex items-center gap-1 underline"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      {phase === "ready" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,6fr)_minmax(0,3fr)]">
          {/* Left: ticket queue (search + priority filter) */}
          <div className="rounded-lg border border-slate-800 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Ticket queue
              </span>
              <span
                className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white"
                data-testid="inbox-count"
              >
                {visibleTickets.length}
              </span>
            </div>

            <div className="p-3 space-y-2 border-b border-slate-800">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ID or subject..."
                  aria-label="Search tickets"
                  data-testid="inbox-search"
                  className="w-full rounded border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="Filter by priority"
                data-testid="inbox-priority"
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm focus:outline-none focus:border-cyan-500"
              >
                <option value="ALL">All Priority</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
            </div>

            {visibleTickets.length === 0 ? (
              <p className="p-4 text-slate-400" data-testid="inbox-empty">
                No tickets in this view.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800 overflow-y-auto">
                {visibleTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      data-testid="inbox-ticket"
                      onClick={() => void openTimeline(ticket)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-900 ${selected?.id === ticket.id ? "bg-slate-900 ring-1 ring-inset ring-cyan-500/40" : ""}`}
                    >
                      <span className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-cyan-400">
                          #{ticket.id.slice(0, 8)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_BADGE[ticket.priority] ?? "bg-slate-500/20 text-slate-300"}`}
                        >
                          {PRIORITY_LABEL[ticket.priority] ?? ticket.priority}
                        </span>
                      </span>
                      <span className="block mt-1 text-sm font-medium">
                        {ticket.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {ticket.customerId.slice(0, 8)} ·{" "}
                        {timeAgo(ticket.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-auto px-4 py-2 border-t border-slate-800 text-xs text-slate-500">
              {visibleTickets.length} of {tickets.length} tickets
            </div>
          </div>

          {/* Middle: active ticket detail */}
          <div
            className="rounded-lg border border-slate-800 p-4"
            data-testid="inbox-detail"
          >
            {!selected ? (
              <p className="text-slate-400">
                Select a ticket to see its timeline.
              </p>
            ) : (
              <>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="text-xs text-slate-500 mb-2">
                  {selected.status} · priority {selected.priority} · v
                  {selected.version}
                </p>
                {conflict && (
                  <p
                    className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-200"
                    data-testid="inbox-conflict"
                  >
                    {conflict}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mb-3">
                  {STATUS_ACTIONS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      data-testid={`inbox-status-${status}`}
                      onClick={() => void changeStatus(selected, status)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                    >
                      {status.replace("_", " ")}
                    </button>
                  ))}
                </div>
                <h3 className="text-sm text-slate-400 mb-2">Timeline</h3>
                {timeline === "loading" && (
                  <p className="text-slate-400" role="status">
                    Loading timeline…
                  </p>
                )}
                {timeline === "empty" && (
                  <p
                    className="text-slate-400"
                    data-testid="inbox-timeline-empty"
                  >
                    No conversation for this customer yet.
                  </p>
                )}
                {timeline === "error" && (
                  <p
                    className="text-red-300"
                    data-testid="inbox-timeline-error"
                  >
                    Timeline could not be loaded.
                  </p>
                )}
                {timeline === "ready" && (
                  <ul className="space-y-2" data-testid="inbox-timeline">
                    {messages.map((message) => (
                      <li
                        key={message.id}
                        className="rounded border border-slate-800 p-2 text-sm"
                      >
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          <User aria-hidden="true" className="h-3 w-3" />
                          {message.authorType}
                          {message.visibility === "INTERNAL" && (
                            <span
                              className="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-200"
                              data-testid="inbox-internal-note"
                            >
                              Internal note
                            </span>
                          )}
                        </span>
                        {message.body}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Right: customer profile of the selected ticket */}
          <aside
            className="rounded-lg border border-slate-800 p-4"
            data-testid="inbox-profile"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Customer profile
            </span>
            {!selected && (
              <p className="mt-3 text-sm text-slate-400">
                Select a ticket to see the customer.
              </p>
            )}
            {selected && profileState === "loading" && (
              <p className="mt-3 text-sm text-slate-400" role="status">
                Loading customer…
              </p>
            )}
            {selected && profileState === "error" && (
              <p
                className="mt-3 text-sm text-red-300"
                data-testid="inbox-profile-error"
              >
                Customer profile unavailable.
              </p>
            )}
            {selected && profileState === "ready" && profile && (
              <div className="mt-3 space-y-1">
                <p className="text-lg font-semibold">{profile.displayName}</p>
                {profile.email && (
                  <p className="text-sm text-slate-400">{profile.email}</p>
                )}
                {profile.phone && (
                  <p className="text-sm text-slate-400">{profile.phone}</p>
                )}
                <p className="text-xs text-slate-500">
                  Status: {profile.status}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
