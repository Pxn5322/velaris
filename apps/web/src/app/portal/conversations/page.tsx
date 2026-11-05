"use client";

/**
 * Customer conversation timeline (T2.04, F-05, journey J-03).
 *
 * The signed-in R-customer reads their own conversations through the
 * guarded API: GET /conversations is scoped server-side to the caller's
 * own customer row, and the timeline endpoint strips internal notes for
 * every role without note.internal.read (TH-05). States: signed out
 * (link to sign-in), loading, empty, failure, and ready.
 *
 * T6.05 (API-13, F-09): the composer posts a question to
 * `POST /conversations/{id}/messages`. The API answers customer messages
 * through the AI runtime and returns the outcome with the stored reply, so
 * this page shows either the grounded answer with its citation count or the
 * handoff notice. It never invents an answer itself.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";

interface TenantEntry {
  tenantId: string;
}

interface AuthSessionResponse {
  identity: { provider: string; subject: string; email?: string };
  tenantContext: { userId: string; tenants: TenantEntry[] } | null;
}

interface Conversation {
  id: string;
  customerId: string;
  channel: string;
  status: string;
  version: number;
  createdAt: string;
}

interface Message {
  id: string;
  body: string;
  authorType: string;
  visibility: string;
  createdAt: string;
}

/** API-13 response: the stored message plus what the runtime decided. */
interface MessageReply extends Message {
  ai?: {
    outcome: string;
    reason: string;
    reply: { id: string; body: string; citationCount: number } | null;
    handoff: { reason: string; retrievedCount: number } | null;
  };
}

type Phase = "signedout" | "loading" | "empty" | "error" | "ready";

export default function PortalConversationsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const auth = await apiFetch<AuthSessionResponse>("/auth/session");
      const tenants = auth.tenantContext?.tenants ?? [];
      if (tenants.length === 0) {
        setFailure("This account has no active tenant membership.");
        setPhase("error");
        return;
      }
      setTenantId(tenants[0].tenantId);
      const rows = await apiFetch<Conversation[]>(
        `/conversations?tenantId=${encodeURIComponent(tenants[0].tenantId)}`,
      );
      setConversations(rows);
      setPhase(rows.length === 0 ? "empty" : "ready");
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        setPhase("signedout");
        return;
      }
      setFailure(
        error instanceof Error
          ? error.message
          : "Conversations are unavailable.",
      );
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // The initial kick runs in a scheduled callback: a synchronous setState
    // (or a load that starts one) straight from the effect body would cascade
    // a render (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      if (!getSession()) {
        setPhase("signedout");
        return;
      }
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openTimeline = useCallback(
    async (conversation: Conversation) => {
      if (!tenantId) return;
      setSelected(conversation);
      setTimelineLoading(true);
      setTimelineError(false);
      try {
        const detail = await apiFetch<Conversation & { messages: Message[] }>(
          `/conversations/${conversation.id}?tenantId=${encodeURIComponent(tenantId)}`,
        );
        setMessages(detail.messages);
      } catch {
        setTimelineError(true);
      } finally {
        setTimelineLoading(false);
      }
    },
    [tenantId],
  );

  const sendReply = useCallback(async () => {
    if (!selected || !tenantId) return;
    const body = draft.trim();
    if (body.length === 0) return;
    setSending(true);
    setSendError(null);
    setAiNotice(null);
    try {
      const result = await apiFetch<MessageReply>(
        `/conversations/${selected.id}/messages?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      setDraft("");
      setMessages((current) => [
        ...current,
        result,
        // The AI answer is a stored SYSTEM message; show it as it will
        // appear on the next load instead of a client-side guess.
        ...(result.ai?.reply
          ? [
              {
                id: result.ai.reply.id,
                body: result.ai.reply.body,
                authorType: "SYSTEM",
                visibility: "CUSTOMER_VISIBLE",
                createdAt: new Date().toISOString(),
              },
            ]
          : []),
      ]);
      if (result.ai?.reply) {
        const count = result.ai.reply.citationCount;
        setAiNotice(
          count > 0
            ? `Answered from ${count} knowledge source${count === 1 ? "" : "s"}.`
            : "Answered by the assistant.",
        );
      } else if (result.ai) {
        setAiNotice("A teammate will follow up on this question.");
      }
    } catch (error) {
      setSendError(
        error instanceof ApiError && error.status === 403
          ? "Your account cannot reply in this conversation."
          : "Your message could not be sent. Try again.",
      );
    } finally {
      setSending(false);
    }
  }, [draft, selected, tenantId]);

  return (
    <section
      className="flex-1 flex flex-col gap-4"
      data-testid="portal-conversations"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MessageSquare aria-hidden="true" className="h-6 w-6" /> My
          conversations
        </h1>
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            setPhase("loading");
            void load();
          }}
          className="text-xs underline text-slate-400"
          data-testid="portal-refresh"
        >
          Refresh
        </button>
      </header>

      {phase === "loading" && (
        <p
          className="text-slate-400"
          role="status"
          data-testid="portal-loading"
        >
          Loading your conversations…
        </p>
      )}

      {phase === "signedout" && (
        <div
          className="rounded-lg border border-slate-700 p-4"
          data-testid="portal-signedout"
        >
          <p className="text-slate-300">
            Sign in to see your conversations with our support team.
          </p>
          <Link
            href="/portal/sign-in"
            className="mt-2 inline-block underline"
            data-testid="portal-signin-link"
          >
            Sign in
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-200"
          data-testid="portal-error"
        >
          <p>{failure}</p>
          <button
            type="button"
            onClick={() => {
              setFailure(null);
              setPhase("loading");
              void load();
            }}
            className="mt-2 underline"
          >
            Retry
          </button>
        </div>
      )}

      {phase === "empty" && (
        <p className="text-slate-400" data-testid="portal-empty">
          You have no conversations yet. Start one from the support page.
        </p>
      )}

      {phase === "ready" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <ul className="rounded-lg border border-slate-800 overflow-hidden">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  data-testid="portal-conversation"
                  onClick={() => void openTimeline(conversation)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-800 hover:bg-slate-900 ${selected?.id === conversation.id ? "bg-slate-900" : ""}`}
                >
                  <span className="text-sm font-medium">
                    {conversation.channel} conversation
                  </span>
                  <span className="block text-xs text-slate-400">
                    {conversation.status} ·{" "}
                    {new Date(conversation.createdAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div
            className="rounded-lg border border-slate-800 p-4"
            data-testid="portal-timeline-panel"
          >
            {!selected ? (
              <p className="text-slate-400">
                Select a conversation to read the messages.
              </p>
            ) : timelineLoading ? (
              <p className="text-slate-400" role="status">
                Loading messages…
              </p>
            ) : timelineError ? (
              <p className="text-red-300" data-testid="portal-timeline-error">
                Messages could not be loaded.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="portal-timeline">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className="rounded border border-slate-800 p-2 text-sm"
                  >
                    <span className="block text-xs text-slate-400">
                      {message.authorType}
                    </span>
                    {message.body}
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-3 border-t border-slate-800 pt-3"
              data-testid="portal-reply-form"
              onSubmit={(event) => {
                event.preventDefault();
                void sendReply();
              }}
            >
              <label
                htmlFor="portal-reply-body"
                className="block text-xs text-slate-400"
              >
                Reply to this conversation
              </label>
              <textarea
                id="portal-reply-body"
                data-testid="portal-reply-body"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                required
                maxLength={4000}
                placeholder="Describe what you need help with."
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={sending || draft.trim().length === 0}
                  data-testid="portal-reply-submit"
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
                {aiNotice && (
                  <p
                    className="text-xs text-slate-300"
                    role="status"
                    data-testid="portal-ai-notice"
                  >
                    {aiNotice}
                  </p>
                )}
                {sendError && (
                  <p
                    className="text-xs text-red-300"
                    role="alert"
                    data-testid="portal-reply-error"
                  >
                    {sendError}
                  </p>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
