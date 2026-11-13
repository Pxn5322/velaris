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
 * The layout follows the admin-v2.7 prototype: a support-agent header,
 * ticket queue on the left (search, priority, rows per page, pagination),
 * active ticket detail in the middle with a reply composer, and customer
 * context on the right.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Headset,
  Inbox,
  PanelLeftClose,
  PanelRightClose,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  User,
} from "lucide-react";
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
  HIGH: "bg-red-500/20 text-red-300 border-red-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  LOW: "bg-slate-500/20 text-slate-300 border-slate-500/30",
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
  const [rowsPerPage, setRowsPerPage] = useState(3);
  const [page, setPage] = useState(1);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [profile, setProfile] = useState<Customer | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

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
      setSendError(null);
      setReply("");
      setConversationId(null);
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
        setConversationId(own.id);
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

  const sendReply = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!scope || !conversationId || !reply.trim() || sending) return;
      setSending(true);
      setSendError(null);
      try {
        const message = await apiFetch<Message>(
          `/conversations/${conversationId}/messages?tenantId=${encodeURIComponent(scope.tenantId)}`,
          {
            method: "POST",
            body: JSON.stringify({
              body: reply.trim(),
              visibility: "CUSTOMER_VISIBLE",
              idempotencyKey: `inbox-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`,
            }),
          },
        );
        setMessages((rows) => [...rows, message]);
        setReply("");
      } catch (error) {
        setSendError(
          error instanceof Error
            ? error.message
            : "The reply could not be sent.",
        );
      } finally {
        setSending(false);
      }
    },
    [scope, conversationId, reply, sending],
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

  const pageCount = Math.max(1, Math.ceil(visibleTickets.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const pageTickets = visibleTickets.slice(
    startIndex,
    startIndex + rowsPerPage,
  );
  const shownFrom = visibleTickets.length === 0 ? 0 : startIndex + 1;
  const shownTo = Math.min(startIndex + rowsPerPage, visibleTickets.length);

  const centerSpan =
    leftOpen && rightOpen
      ? "lg:col-span-6"
      : leftOpen || rightOpen
        ? "lg:col-span-9"
        : "lg:col-span-12";

  return (
    <section className="flex-1 flex flex-col gap-4" data-testid="inbox">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/50 pb-3">
        <div>
          <div
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold"
            style={{ color: "var(--accent-emerald)" }}
          >
            <Headset className="w-3.5 h-3.5" /> SUPPORT AGENT CENTER
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-heading">
            Unified Agent Inbox & Copilot
          </h1>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs font-bold">
          <button
            type="button"
            onClick={() => setLeftOpen((open) => !open)}
            aria-pressed={leftOpen}
            data-testid="inbox-toggle-tickets"
            className="px-3 py-1.5 rounded-xl glass-panel text-heading hover:border-blue-600 flex items-center gap-1.5 transition-all"
          >
            <PanelLeftClose
              className="w-4 h-4"
              style={{ color: "var(--accent-cyan)" }}
            />
            <span>Tickets</span>
          </button>
          <button
            type="button"
            onClick={() => setRightOpen((open) => !open)}
            aria-pressed={rightOpen}
            data-testid="inbox-toggle-copilot"
            className="px-3 py-1.5 rounded-xl glass-panel text-heading hover:border-blue-600 flex items-center gap-1.5 transition-all"
          >
            <PanelRightClose
              className="w-4 h-4"
              style={{ color: "var(--accent-cyan)" }}
            />
            <span>Copilot & Context</span>
          </button>
        </div>
      </header>

      {phase === "loading" && (
        <p
          className="text-sm text-muted-custom glass-panel rounded-xl p-4"
          data-testid="inbox-loading"
          role="status"
        >
          Loading tickets…
        </p>
      )}

      {phase === "denied" && (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200"
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
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200"
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
        <div
          className="grid grid-cols-12 gap-3 sm:gap-4 items-start min-h-[580px]"
          data-testid="inbox-layout"
        >
          {leftOpen && (
            <div
              className="col-span-12 lg:col-span-3 glass-panel rounded-2xl p-3.5 space-y-3"
              data-testid="inbox-queue"
            >
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                <span className="font-mono text-xs font-bold text-heading flex items-center gap-1.5">
                  <Inbox
                    className="w-3.5 h-3.5"
                    style={{ color: "var(--accent-cyan)" }}
                  />
                  TICKET QUEUE
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-mono font-bold"
                  style={{
                    background: "rgba(56,189,248,0.2)",
                    color: "var(--accent-cyan)",
                  }}
                  data-testid="inbox-count"
                >
                  {visibleTickets.length}
                </span>
              </div>

              <div className="space-y-2 font-mono text-xs">
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search ID or subject..."
                    aria-label="Search tickets"
                    data-testid="inbox-search"
                    className="w-full rounded-xl border px-2.5 py-1.5 pl-8 text-[11px] text-heading focus:outline-none focus:border-blue-600"
                    style={{
                      background: "var(--input-bg)",
                      borderColor: "var(--input-border)",
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <select
                    value={priority}
                    onChange={(event) => {
                      setPriority(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by priority"
                    data-testid="inbox-priority"
                    className="rounded-lg border px-1.5 py-1 text-heading focus:outline-none focus:border-blue-600"
                    style={{
                      background: "var(--input-bg)",
                      borderColor: "var(--input-border)",
                    }}
                  >
                    <option value="ALL">All Priority</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>

                  <select
                    value={rowsPerPage}
                    onChange={(event) => {
                      setRowsPerPage(Number(event.target.value));
                      setPage(1);
                    }}
                    aria-label="Tickets per page"
                    data-testid="inbox-rows"
                    className="rounded-lg border px-1.5 py-1 text-heading focus:outline-none focus:border-blue-600"
                    style={{
                      background: "var(--input-bg)",
                      borderColor: "var(--input-border)",
                    }}
                  >
                    <option value={3}>3 / page</option>
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                  </select>
                </div>

                <div
                  className="grid grid-cols-2 gap-1 rounded-xl p-1 glass-panel"
                  role="tablist"
                  aria-label="Inbox scope"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "all"}
                    data-testid="inbox-tab-all"
                    onClick={() => {
                      setTab("all");
                      setPage(1);
                    }}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                      tab === "all"
                        ? "bg-blue-600/30 text-cyan-300"
                        : "text-muted-custom"
                    }`}
                  >
                    All tickets
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "mine"}
                    data-testid="inbox-tab-mine"
                    onClick={() => {
                      setTab("mine");
                      setPage(1);
                    }}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                      tab === "mine"
                        ? "bg-blue-600/30 text-cyan-300"
                        : "text-muted-custom"
                    }`}
                  >
                    Assigned to me
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {visibleTickets.length === 0 ? (
                  <p
                    className="p-4 text-center text-muted-custom font-mono text-xs font-bold"
                    data-testid="inbox-empty"
                  >
                    No matching tickets
                  </p>
                ) : (
                  pageTickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      data-testid="inbox-ticket"
                      onClick={() => void openTimeline(ticket)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selected?.id === ticket.id
                          ? "bg-blue-600/15 border-blue-500/50"
                          : "bg-slate-800/40 border-slate-700/40 hover:bg-slate-800/80"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2 text-[10px] font-mono mb-1">
                        <span
                          className="font-bold"
                          style={{ color: "var(--accent-cyan)" }}
                        >
                          #{ticket.id.slice(0, 8)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded border font-bold ${
                            PRIORITY_BADGE[ticket.priority] ??
                            "bg-slate-500/20 text-slate-300"
                          }`}
                        >
                          {PRIORITY_LABEL[ticket.priority] ?? ticket.priority}
                        </span>
                      </span>
                      <span className="block text-xs font-semibold text-heading truncate">
                        {ticket.title}
                      </span>
                      <span className="block text-[10px] text-muted-custom mt-1 font-bold">
                        {ticket.customerId.slice(0, 8)} •{" "}
                        {timeAgo(ticket.updatedAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between font-mono text-[10px] text-muted-custom font-bold">
                <span>
                  {shownFrom}-{shownTo} of {visibleTickets.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage <= 1}
                    aria-label="Prev ticket page"
                    className="px-2 py-0.5 rounded glass-panel hover:border-blue-600 text-heading disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((value) => Math.min(pageCount, value + 1))
                    }
                    disabled={currentPage >= pageCount}
                    aria-label="Next ticket page"
                    className="px-2 py-0.5 rounded glass-panel hover:border-blue-600 text-heading disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            className={`col-span-12 ${centerSpan} glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[540px] transition-all`}
            data-testid="inbox-detail"
          >
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-center p-6">
                <p className="text-sm text-muted-custom">
                  Select a ticket to see its timeline.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-700/50 pb-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-sm sm:text-base font-bold text-heading truncate">
                        #{selected.id.slice(0, 8)}: {selected.title}
                      </h2>
                      <p className="text-[11px] text-muted-custom font-bold">
                        Status {selected.status} · v{selected.version}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-mono font-bold ${
                        PRIORITY_BADGE[selected.priority] ??
                        "bg-slate-500/20 text-slate-300"
                      }`}
                    >
                      {selected.priority} PRIORITY
                    </span>
                  </div>

                  {conflict && (
                    <p
                      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-200"
                      data-testid="inbox-conflict"
                    >
                      {conflict}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {STATUS_ACTIONS.map((status) => (
                      <button
                        key={status}
                        type="button"
                        data-testid={`inbox-status-${status}`}
                        onClick={() => void changeStatus(selected, status)}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-mono font-bold hover:bg-slate-800"
                      >
                        {status.replace("_", " ")}
                      </button>
                    ))}
                  </div>

                  <div>
                    <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-custom mb-2">
                      Timeline
                    </h3>
                    {timeline === "loading" && (
                      <p className="text-sm text-muted-custom" role="status">
                        Loading timeline…
                      </p>
                    )}
                    {timeline === "empty" && (
                      <p
                        className="text-sm text-muted-custom"
                        data-testid="inbox-timeline-empty"
                      >
                        No conversation for this customer yet.
                      </p>
                    )}
                    {timeline === "error" && (
                      <p
                        className="text-sm text-red-300"
                        data-testid="inbox-timeline-error"
                      >
                        Timeline could not be loaded.
                      </p>
                    )}
                    {timeline === "ready" && (
                      <ul
                        className="space-y-2 max-h-[320px] overflow-y-auto pr-1"
                        data-testid="inbox-timeline"
                      >
                        {messages.map((message) => {
                          const fromCustomer =
                            message.authorType === "CUSTOMER";
                          return (
                            <li
                              key={message.id}
                              className={`rounded-xl border p-3 text-sm ${
                                fromCustomer
                                  ? "bg-slate-800/60 border-slate-700/40"
                                  : "bg-blue-600/10 border-blue-500/30"
                              }`}
                            >
                              <span className="flex items-center gap-2 text-[10px] font-mono font-bold text-muted-custom mb-1">
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
                              <p className="text-heading">{message.body}</p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {timeline === "ready" && conversationId && (
                  <form
                    onSubmit={sendReply}
                    className="pt-4 mt-4 border-t border-slate-700/50 space-y-2"
                  >
                    {sendError && (
                      <p
                        className="text-xs text-red-300 font-bold"
                        data-testid="inbox-send-error"
                      >
                        {sendError}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled
                        title="Attachments are not available in this view"
                        aria-label="Attach a file"
                        className="p-2.5 rounded-xl glass-panel text-slate-400 opacity-60 cursor-not-allowed shrink-0"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <input
                        type="text"
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder="Type agent response..."
                        aria-label="Reply message"
                        data-testid="inbox-reply"
                        className="w-full rounded-xl border px-3.5 py-2 text-xs text-heading focus:outline-none focus:border-blue-600"
                        style={{
                          background: "var(--input-bg)",
                          borderColor: "var(--input-border)",
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!reply.trim() || sending}
                        data-testid="inbox-send"
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shrink-0 flex items-center gap-1.5 hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {sending ? "Sending…" : "Send"}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-custom font-mono">
                      Replies are sent as customer-visible messages.
                    </p>
                  </form>
                )}
              </>
            )}
          </div>

          {rightOpen && (
            <aside
              className="col-span-12 lg:col-span-3 glass-panel rounded-2xl p-3.5 space-y-4"
              data-testid="inbox-copilot"
            >
              <div className="border-b border-slate-700/50 pb-3 space-y-1.5 font-mono text-xs">
                <div className="text-[10px] text-muted-custom uppercase font-bold">
                  Customer Profile
                </div>
                {!selected && (
                  <p className="text-sm text-muted-custom">
                    Select a ticket to see the customer.
                  </p>
                )}
                {selected && profileState === "loading" && (
                  <p className="text-sm text-muted-custom" role="status">
                    Loading customer…
                  </p>
                )}
                {selected && profileState === "error" && (
                  <p
                    className="text-sm text-red-300"
                    data-testid="inbox-profile-error"
                  >
                    Customer profile unavailable.
                  </p>
                )}
                {selected && profileState === "ready" && profile && (
                  <div data-testid="inbox-profile" className="space-y-1">
                    <p className="font-bold text-heading text-sm">
                      {profile.displayName}
                    </p>
                    {profile.email && (
                      <p className="text-[11px] text-muted-custom">
                        {profile.email}
                      </p>
                    )}
                    {profile.phone && (
                      <p className="text-[11px] text-muted-custom">
                        {profile.phone}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-custom">
                      Status: {profile.status}
                    </p>
                  </div>
                )}
              </div>

              {selected && (
                <div className="space-y-2 font-mono text-xs">
                  <div className="text-[10px] text-muted-custom uppercase font-bold">
                    Ticket Context
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-custom">Priority</span>
                    <span className="text-heading font-bold">
                      {selected.priority}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-custom">Status</span>
                    <span className="text-heading font-bold">
                      {selected.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-custom">Version</span>
                    <span className="text-heading font-bold">
                      v{selected.version}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-custom">Assigned</span>
                    <span className="text-heading font-bold">
                      {selected.assigneeMembershipId ? "Yes" : "Unassigned"}
                    </span>
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-purple-500/10 border border-blue-500/30 text-xs text-slate-200">
                <div className="text-[10px] font-mono text-muted-custom uppercase font-bold mb-1.5">
                  Workspace Note
                </div>
                AI suggestions and knowledge citations appear when the
                conversation has grounded context.
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
