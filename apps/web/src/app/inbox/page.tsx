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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  X,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";
import { useStepUp } from "@/context/StepUpContext";
import { STEP_UP_ACTIONS } from "@/lib/auth/step-up";

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
  /** Conversation holding the customer's description, when one was started. */
  primaryConversationId?: string | null;
  /** Server-flattened first customer message of that conversation. */
  descriptionPreview?: string | null;
}

interface Message {
  id: string;
  body: string;
  authorType: string;
  visibility: string;
  createdAt: string;
  metadataJson?: { attachments?: MessageAttachment[] } | null;
}

interface MessageAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
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

interface Assignee {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  roles: string[];
}

const PRIORITY_LABEL: Record<string, string> = {
  HIGH: "HIGH",
  MEDIUM: "MED",
  LOW: "LOW",
};

const PRIORITY_BADGE: Record<string, string> = {
  HIGH: "bg-[var(--pill-bg)] text-[var(--accent-rose)] border-[var(--accent-rose)]",
  MEDIUM:
    "bg-[var(--pill-bg)] text-[var(--accent-cyan)] border-[var(--accent-cyan)]",
  LOW: "bg-[var(--pill-bg)] text-muted-custom border-[var(--card-border)]",
};

const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
];
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 1024 * 1024;

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The selected file could not be read."));
    reader.onerror = () =>
      reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}

function attachmentsOf(message: Message): MessageAttachment[] {
  const rows = message.metadataJson?.attachments;
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is MessageAttachment =>
          typeof row?.name === "string" &&
          typeof row?.type === "string" &&
          typeof row?.dataUrl === "string",
      )
    : [];
}

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
  const { runWithStepUp } = useStepUp();
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
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneeState, setAssigneeState] = useState<
    "loading" | "error" | "ready"
  >("loading");
  const [assigneeChoice, setAssigneeChoice] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

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
      const tenantQuery = `tenantId=${encodeURIComponent(tenants[0].tenantId)}`;
      const [rows, assigneeRows] = await Promise.all([
        apiFetch<Ticket[]>(`/tickets?${tenantQuery}`),
        apiFetch<Assignee[]>(`/tickets/assignees?${tenantQuery}`).catch(
          () => null,
        ),
      ]);
      setTickets(rows);
      if (assigneeRows) {
        setAssignees(
          assigneeRows.filter(
            (person) =>
              typeof person?.membershipId === "string" &&
              typeof person?.displayName === "string",
          ),
        );
        setAssigneeState("ready");
      } else {
        setAssignees([]);
        setAssigneeState("error");
      }
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
      setAssigneeChoice(ticket.assigneeMembershipId ?? "");
      setAssignmentError(null);
      setTimeline("loading");
      void loadProfile(ticket);
      if (!scope) {
        setTimeline("error");
        return;
      }
      const tenantQuery = `tenantId=${encodeURIComponent(scope.tenantId)}`;
      try {
        // The ticket names the thread that carries the customer's description
        // (D-75). Read that one first; a customer may have older threads, so a
        // match by customerId alone can show the wrong conversation.
        let ownId = ticket.primaryConversationId ?? null;
        if (!ownId) {
          const conversations = await apiFetch<Conversation[]>(
            `/conversations?${tenantQuery}`,
          );
          ownId =
            conversations.find(
              (conversation) => conversation.customerId === ticket.customerId,
            )?.id ?? null;
        }
        if (!ownId) {
          setTimeline("empty");
          return;
        }
        setConversationId(ownId);
        const detail = await apiFetch<Conversation & { messages: Message[] }>(
          `/conversations/${ownId}?${tenantQuery}`,
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

  const changeAssignee = useCallback(
    async (ticket: Ticket, membershipId: string) => {
      if (!scope || assigning) return;
      const nextAssignee = membershipId || null;
      if (nextAssignee === ticket.assigneeMembershipId) return;
      setAssigning(true);
      setConflict(null);
      setAssignmentError(null);
      try {
        const updated = await apiFetch<Ticket>(
          `/tickets/${ticket.id}?tenantId=${encodeURIComponent(scope.tenantId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              assigneeMembershipId: nextAssignee,
              expectedVersion: ticket.version,
            }),
          },
        );
        setTickets((rows) =>
          rows.map((row) => (row.id === updated.id ? updated : row)),
        );
        setSelected(updated);
        setAssigneeChoice(updated.assigneeMembershipId ?? "");
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setConflict(`${error.message} — the current state is shown below.`);
          await load();
          const fresh = await apiFetch<Ticket[]>(
            `/tickets?tenantId=${encodeURIComponent(scope.tenantId)}`,
          ).catch(() => []);
          const current = fresh.find((row) => row.id === ticket.id) ?? null;
          setSelected(current);
          setAssigneeChoice(current?.assigneeMembershipId ?? "");
        } else {
          setAssignmentError(
            error instanceof Error ? error.message : "Assignment failed.",
          );
        }
      } finally {
        setAssigning(false);
      }
    },
    [scope, assigning, load],
  );

  const sendReply = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !scope ||
        !selected ||
        (!reply.trim() && attachments.length === 0) ||
        sending
      ) {
        return;
      }
      setSending(true);
      setSendError(null);
      try {
        // A ticket may have no conversation yet. Start one for the ticket's
        // customer so the composer always has a destination, then send the
        // agent reply into it.
        let activeConversationId = conversationId;
        if (!activeConversationId) {
          const created = await apiFetch<Conversation>(
            `/conversations?tenantId=${encodeURIComponent(scope.tenantId)}`,
            {
              method: "POST",
              body: JSON.stringify({
                customerId: selected.customerId,
                channel: "WEB",
              }),
            },
          );
          activeConversationId = created.id;
          setConversationId(created.id);
          setTimeline("ready");
        }
        const sendMessage = (stepUpToken?: string) =>
          apiFetch<Message>(
            `/conversations/${activeConversationId}/messages?tenantId=${encodeURIComponent(scope.tenantId)}`,
            {
              method: "POST",
              headers: stepUpToken
                ? { "x-step-up-token": stepUpToken }
                : undefined,
              body: JSON.stringify({
                body:
                  reply.trim() ||
                  `Attached: ${attachments.map((file) => file.name).join(", ")}`,
                visibility: "CUSTOMER_VISIBLE",
                ...(attachments.length > 0 ? { attachments } : {}),
                idempotencyKey: `inbox-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2)}`,
              }),
            },
          );
        const message =
          attachments.length > 0
            ? await runWithStepUp(
                STEP_UP_ACTIONS.ATTACHMENT_SEND,
                scope.tenantId,
                sendMessage,
              )
            : await sendMessage();
        setMessages((rows) => [...rows, message]);
        setReply("");
        setAttachments([]);
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
    [
      scope,
      selected,
      conversationId,
      reply,
      attachments,
      sending,
      runWithStepUp,
    ],
  );

  const chooseAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    setSendError(null);
    if (attachments.length + selectedFiles.length > MAX_ATTACHMENTS) {
      setSendError(`Attach at most ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const invalid = selectedFiles.find(
      (file) =>
        !ATTACHMENT_TYPES.includes(file.type) ||
        file.size === 0 ||
        file.size > MAX_ATTACHMENT_BYTES,
    );
    if (invalid) {
      setSendError("Use PNG, JPEG, WebP, PDF or text files of 512 KB or less.");
      return;
    }
    const total = [...attachments, ...selectedFiles].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      setSendError("Attachments must total 1 MB or less per message.");
      return;
    }

    setAttachmentBusy(true);
    try {
      const rows = await Promise.all(
        selectedFiles.map(async (file) => ({
          name: file.name.slice(0, 120),
          type: file.type,
          size: file.size,
          dataUrl: await readDataUrl(file),
        })),
      );
      setAttachments((current) => [...current, ...rows]);
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "The selected file could not be read.",
      );
    } finally {
      setAttachmentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
    // The customer's own words are searchable too: an agent can find a ticket
    // by the phrase the customer used, not only by its subject or id.
    return (
      ticket.title.toLowerCase().includes(needle) ||
      ticket.id.toLowerCase().includes(needle) ||
      (ticket.descriptionPreview ?? "").toLowerCase().includes(needle)
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
  const selectedAssignee = selected
    ? (assignees.find(
        (person) => person.membershipId === selected.assigneeMembershipId,
      ) ?? null)
    : null;

  const centerSpan =
    leftOpen && rightOpen
      ? "lg:col-span-6"
      : leftOpen || rightOpen
        ? "lg:col-span-9"
        : "lg:col-span-12";

  // The linked thread's first customer message is the description the customer
  // typed in the portal (D-75). Other tickets keep the timeline alone.
  const descriptionMessage = selected?.primaryConversationId
    ? (messages.find(
        (message) =>
          message.authorType === "CUSTOMER" &&
          message.visibility !== "INTERNAL",
      ) ?? null)
    : null;

  return (
    <section className="flex-1 flex flex-col gap-4" data-testid="inbox">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--card-border)] pb-3">
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

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs font-bold">
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
          className="rounded-xl border border-[var(--accent-cyan)] bg-[var(--pill-bg)] p-4 text-[var(--accent-cyan)]"
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
          className="rounded-xl border border-[var(--accent-rose)] bg-[var(--pill-bg)] p-4 text-[var(--accent-rose)]"
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
              <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-2">
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
                    background: "var(--pill-bg)",
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
                    className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-custom"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search ID, subject or description..."
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
                        ? "bg-[var(--pill-bg)] text-[var(--accent-cyan)]"
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
                        ? "bg-[var(--pill-bg)] text-[var(--accent-cyan)]"
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
                          ? "bg-[var(--pill-bg)] border-[var(--accent-cyan)]"
                          : "border-[var(--card-border)] hover:bg-[var(--pill-bg)]"
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
                            "border-[var(--card-border)] bg-[var(--pill-bg)] text-muted-custom"
                          }`}
                        >
                          {PRIORITY_LABEL[ticket.priority] ?? ticket.priority}
                        </span>
                      </span>
                      <span className="block text-xs font-semibold text-heading truncate">
                        {ticket.title}
                      </span>
                      {ticket.descriptionPreview && (
                        <span
                          className="mt-1 block text-[10px] leading-snug text-muted-custom line-clamp-2"
                          data-testid="inbox-ticket-preview"
                        >
                          {ticket.descriptionPreview}
                        </span>
                      )}
                      <span className="block text-[10px] text-muted-custom mt-1 font-bold">
                        {ticket.customerId.slice(0, 8)} •{" "}
                        {timeAgo(ticket.updatedAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-[var(--card-border)] flex items-center justify-between font-mono text-[10px] text-muted-custom font-bold">
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
                  <div className="flex items-start justify-between gap-3 border-b border-[var(--card-border)] pb-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-sm sm:text-base font-bold text-heading break-words sm:truncate">
                        #{selected.id.slice(0, 8)}: {selected.title}
                      </h2>
                      <p className="text-[11px] text-muted-custom font-bold">
                        Status {selected.status} · v{selected.version}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-mono font-bold ${
                        PRIORITY_BADGE[selected.priority] ??
                        "border-[var(--card-border)] bg-[var(--pill-bg)] text-muted-custom"
                      }`}
                    >
                      {selected.priority} PRIORITY
                    </span>
                  </div>

                  {conflict && (
                    <p
                      className="rounded-xl border border-[var(--accent-rose)] bg-[var(--pill-bg)] p-2 text-sm text-[var(--accent-rose)]"
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
                        className="rounded-lg border border-[var(--card-border)] px-2 py-1 text-[10px] font-mono font-bold text-heading hover:bg-[var(--pill-bg)]"
                      >
                        {status.replace("_", " ")}
                      </button>
                    ))}
                  </div>

                  <div
                    className="rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] p-3 space-y-2"
                    data-testid="inbox-assignment"
                  >
                    <label
                      htmlFor="inbox-assignee"
                      className="block text-[10px] font-mono font-bold uppercase tracking-wider text-muted-custom"
                    >
                      Assign ticket
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        id="inbox-assignee"
                        value={assigneeChoice}
                        onChange={(event) =>
                          setAssigneeChoice(event.target.value)
                        }
                        disabled={assigning || assigneeState !== "ready"}
                        data-testid="inbox-assignee"
                        className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs text-heading focus:outline-none focus:border-blue-600 disabled:opacity-60"
                        style={{
                          background: "var(--input-bg)",
                          borderColor: "var(--input-border)",
                        }}
                      >
                        <option value="">Unassigned</option>
                        {assignees.map((person) => (
                          <option
                            key={person.membershipId}
                            value={person.membershipId}
                          >
                            {person.displayName}
                            {person.roles.includes("R-tenant-admin")
                              ? " · admin"
                              : ""}
                          </option>
                        ))}
                        {selected.assigneeMembershipId &&
                          !assignees.some(
                            (person) =>
                              person.membershipId ===
                              selected.assigneeMembershipId,
                          ) && (
                            <option value={selected.assigneeMembershipId}>
                              Current assignee
                            </option>
                          )}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          void changeAssignee(selected, assigneeChoice)
                        }
                        disabled={
                          assigning ||
                          assigneeState !== "ready" ||
                          assigneeChoice ===
                            (selected.assigneeMembershipId ?? "")
                        }
                        data-testid="inbox-assign"
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        {assigning
                          ? "Saving…"
                          : assigneeChoice
                            ? "Assign"
                            : "Unassign"}
                      </button>
                    </div>
                    {assigneeState === "error" && (
                      <p
                        className="text-[10px] font-mono text-[var(--accent-rose)]"
                        data-testid="inbox-assignee-error"
                      >
                        Assignee list unavailable.
                      </p>
                    )}
                    {assignmentError && (
                      <p
                        className="text-xs font-bold text-[var(--accent-rose)]"
                        data-testid="inbox-assignment-error"
                      >
                        {assignmentError}
                      </p>
                    )}
                    <p className="text-[10px] font-mono text-muted-custom">
                      Only active agents and tenant administrators can receive
                      tickets.
                    </p>
                  </div>

                  {descriptionMessage && (
                    <div
                      className="rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] p-3"
                      data-testid="inbox-ticket-description"
                    >
                      <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-custom mb-1">
                        Customer description
                      </h3>
                      <p className="text-sm text-heading whitespace-pre-wrap">
                        {descriptionMessage.body}
                      </p>
                    </div>
                  )}

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
                        No conversation for this customer yet. Send the first
                        reply below to start one.
                      </p>
                    )}
                    {timeline === "error" && (
                      <p
                        className="text-sm text-[var(--accent-rose)]"
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
                          const files = attachmentsOf(message);
                          return (
                            <li
                              key={message.id}
                              className={`rounded-xl border p-3 text-sm ${
                                fromCustomer
                                  ? "bg-[var(--pill-bg)] border-[var(--card-border)]"
                                  : "border-[var(--accent-blue)]"
                              }`}
                            >
                              <span className="flex items-center gap-2 text-[10px] font-mono font-bold text-muted-custom mb-1">
                                <User aria-hidden="true" className="h-3 w-3" />
                                {message.authorType}
                                {message.visibility === "INTERNAL" && (
                                  <span
                                    className="rounded border border-[var(--card-border)] bg-[var(--pill-bg)] px-1.5 py-0.5 text-[var(--accent-blue)]"
                                    data-testid="inbox-internal-note"
                                  >
                                    Internal note
                                  </span>
                                )}
                              </span>
                              <p className="text-heading">{message.body}</p>
                              {files.length > 0 && (
                                <div
                                  className="mt-2 flex flex-wrap gap-2"
                                  data-testid="inbox-message-attachments"
                                >
                                  {files.map((file, index) =>
                                    file.type.startsWith("image/") ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={`${file.name}-${index}`}
                                        src={file.dataUrl}
                                        alt={`Attached ${file.name}`}
                                        data-testid="inbox-attachment-image"
                                        className="max-h-36 rounded-lg border border-[var(--card-border)] object-cover"
                                      />
                                    ) : (
                                      <a
                                        key={`${file.name}-${index}`}
                                        href={file.dataUrl}
                                        download={file.name}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--pill-bg)] px-2.5 py-1.5 font-mono text-[10px] font-bold text-[var(--accent-cyan)] hover:border-[var(--accent-cyan)]"
                                      >
                                        <Paperclip className="h-3 w-3" />
                                        {file.name} · {formatBytes(file.size)}
                                      </a>
                                    ),
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {
                  <form
                    onSubmit={sendReply}
                    className="pt-4 mt-4 border-t border-[var(--card-border)] space-y-2"
                  >
                    {sendError && (
                      <p
                        className="text-xs text-[var(--accent-rose)] font-bold"
                        data-testid="inbox-send-error"
                      >
                        {sendError}
                      </p>
                    )}
                    {attachments.length > 0 && (
                      <div
                        className="flex flex-wrap gap-2"
                        data-testid="inbox-attachment-list"
                      >
                        {attachments.map((file) => (
                          <span
                            key={file.name + file.size}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--pill-bg)] px-2.5 py-1.5 font-mono text-[10px] text-heading"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0 text-muted-custom">
                              {formatBytes(file.size)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setAttachments((current) =>
                                  current.filter((row) => row !== file),
                                )
                              }
                              className="shrink-0 rounded p-0.5 hover:bg-rose-500/15"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={attachmentBusy || sending}
                        title="Attach a file (PNG, JPEG, WebP, PDF or text; 512 KB)"
                        aria-label="Attach a file"
                        data-testid="inbox-attach"
                        className="p-2.5 rounded-xl glass-panel text-muted-custom hover:text-[var(--accent-cyan)] disabled:opacity-60 shrink-0"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
                        aria-label="Choose files to attach"
                        onChange={(event) =>
                          void chooseAttachments(event.target.files)
                        }
                        data-testid="inbox-attach-input"
                        className="sr-only"
                      />
                      <input
                        type="text"
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder={
                          timeline === "loading"
                            ? "Loading conversation…"
                            : "Type agent response..."
                        }
                        disabled={timeline === "loading" || sending}
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
                        disabled={
                          (!reply.trim() && attachments.length === 0) ||
                          sending ||
                          timeline === "loading"
                        }
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
                }
              </>
            )}
          </div>

          {rightOpen && (
            <aside
              className="col-span-12 lg:col-span-3 glass-panel rounded-2xl p-3.5 space-y-4"
              data-testid="inbox-copilot"
            >
              <div className="border-b border-[var(--card-border)] pb-3 space-y-1.5 font-mono text-xs">
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
                    className="text-sm text-[var(--accent-rose)]"
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
                    <span className="text-muted-custom">Assigned to</span>
                    <span
                      className="max-w-[60%] truncate text-heading font-bold"
                      title={
                        selectedAssignee?.displayName ??
                        (selected.assigneeMembershipId
                          ? "Assigned member"
                          : "Unassigned")
                      }
                    >
                      {selectedAssignee?.displayName ??
                        (selected.assigneeMembershipId
                          ? "Assigned member"
                          : "Unassigned")}
                    </span>
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[var(--pill-bg)] border border-[var(--card-border)] text-xs text-body-custom">
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
