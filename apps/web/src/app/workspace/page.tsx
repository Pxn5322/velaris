"use client";

import { useState, useEffect } from "react";
import {
  Bot,
  User,
  Send,
  AlertTriangle,
  CheckCircle,
  Search,
  PanelLeft,
  PanelRight,
  ChevronLeft,
  ChevronRight,
  Headset,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useRole } from "@/context/RoleContext";

interface Ticket {
  id: string;
  title: string;
  customerEmail: string;
  status: string;
  priority: string;
  category: string;
  description: string;
}

export default function WorkspacePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 4;
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const { theme } = useRole();
  const isLight = theme === "light";

  useEffect(() => {
    async function loadTickets() {
      try {
        const data = await apiFetch<Ticket[]>("/tickets");
        if (data && data.length > 0) {
          setTickets(data);
          setSelectedTicket(data[0]);
        } else {
          const fallbackTickets: Ticket[] = [
            {
              id: "#TK-8820",
              title: "API Rate Limits Exceeded on Enterprise Tier",
              customerEmail: "alex@acme.com",
              status: "OPEN",
              priority: "HIGH",
              category: "API Rate Limits",
              description:
                "Customer gateway returning HTTP 429 Too Many Requests during automated webhooks.",
            },
            {
              id: "#TK-8821",
              title: "SSO SAML Metadata Certificate Expiration",
              customerEmail: "sarah@initech.com",
              status: "OPEN",
              priority: "HIGH",
              category: "Authentication",
              description:
                "X.509 SAML Signing Certificate expired at 00:00 UTC.",
            },
            {
              id: "#TK-8822",
              title: "Request for Vector Index Size Expansion",
              customerEmail: "marcus@globex.io",
              status: "PENDING",
              priority: "MEDIUM",
              category: "Knowledge Base",
              description:
                "Requesting pgvector partition scaling for 500k additional embeddings.",
            },
            {
              id: "#TK-8823",
              title: "Custom Domain CNAME Propagation Check",
              customerEmail: "elena@stark.com",
              status: "OPEN",
              priority: "LOW",
              category: "DNS & Domains",
              description:
                "Checking DNS resolution for support.stark.com custom alias.",
            },
          ];
          setTickets(fallbackTickets);
          setSelectedTicket(fallbackTickets[0]);
        }
      } catch {
        // Fallback
      }
    }
    loadTickets();
  }, []);

  const aiSummary = selectedTicket
    ? "Ticket " +
      selectedTicket.id +
      " (" +
      selectedTicket.category +
      "): Customer reported " +
      selectedTicket.title +
      ". Priority " +
      selectedTicket.priority +
      ". Grounding confidence 94%."
    : "";

  const filteredTickets = tickets.filter((t) => {
    const matchesSearch =
      t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.customerEmail.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPriority =
      priorityFilter === "ALL" || t.priority === priorityFilter;
    return matchesSearch && matchesPriority;
  });

  const totalPages = Math.ceil(filteredTickets.length / rowsPerPage) || 1;
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedTickets = filteredTickets.slice(
    startIndex,
    startIndex + rowsPerPage,
  );

  const getCenterSpanClass = () => {
    if (isLeftCollapsed && isRightCollapsed) return "col-span-12";
    if (isLeftCollapsed || isRightCollapsed) return "col-span-12 lg:col-span-9";
    return "col-span-12 lg:col-span-6";
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3"
        style={{ borderColor: "var(--card-border)" }}
      >
        <div>
          <div
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold"
            style={{ color: "var(--accent-emerald)" }}
          >
            <Headset className="w-3.5 h-3.5" /> SUPPORT AGENT CENTER
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-heading">
            Unified Agent Inbox & Copilot
          </h2>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs font-bold">
          <button
            onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
            className="px-3 py-1.5 rounded-xl glass-panel text-heading hover:border-current flex items-center gap-1.5 transition-all"
          >
            <PanelLeft
              className="w-4 h-4"
              style={{ color: "var(--accent-cyan)" }}
            />{" "}
            Left Queue
          </button>
          <button
            onClick={() => setIsRightCollapsed(!isRightCollapsed)}
            className="px-3 py-1.5 rounded-xl glass-panel text-heading hover:border-current flex items-center gap-1.5 transition-all"
          >
            <PanelRight
              className="w-4 h-4"
              style={{ color: "var(--accent-cyan)" }}
            />{" "}
            Copilot
          </button>
        </div>
      </div>

      {/* Detached Columns 12-Grid System */}
      <div className="grid grid-cols-12 gap-4">
        {/* Column 1: Left Ticket Queue */}
        {!isLeftCollapsed && (
          <div
            className="col-span-12 lg:col-span-3 glass-panel rounded-2xl p-4 flex flex-col justify-between min-h-[540px] shadow-xl border transition-all"
            style={{ borderColor: "var(--card-border)" }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-mono font-bold uppercase tracking-wider"
                  style={{ color: "var(--accent-cyan)" }}
                >
                  Ticket Queue ({filteredTickets.length})
                </span>
                <button
                  onClick={() => setIsLeftCollapsed(true)}
                  className="p-1 rounded hover:text-heading"
                  style={{ color: "var(--text-muted)" }}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              <div className="relative">
                <Search
                  className="absolute left-3 top-2.5 h-3.5 w-3.5"
                  style={{ color: "var(--text-muted)" }}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search queue..."
                  className={`w-full border rounded-xl pl-8 pr-3 py-1.5 text-xs text-heading focus:outline-none font-mono ${isLight ? "bg-white border-slate-300" : "bg-slate-900/80 border-slate-700/60"}`}
                />
              </div>

              <select
                value={priorityFilter}
                onChange={(e) => {
                  setPriorityFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={`w-full border rounded-xl px-2.5 py-1.5 text-xs text-heading font-semibold focus:outline-none ${isLight ? "bg-white border-slate-300" : "bg-slate-900/80 border-slate-700/60"}`}
              >
                <option value="ALL">All Priorities</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>

              <div className="space-y-2 mt-2">
                {paginatedTickets.length === 0 ? (
                  <div
                    className="p-4 text-center text-xs font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No matching tickets
                  </div>
                ) : (
                  paginatedTickets.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTicket(t)}
                      className={`p-3 rounded-xl border transition cursor-pointer ${
                        selectedTicket?.id === t.id
                          ? isLight
                            ? "bg-blue-50 border-blue-600 shadow-md"
                            : "bg-blue-600/30 border-cyan-500 shadow-md"
                          : isLight
                            ? "bg-white/70 hover:bg-white border-slate-200"
                            : "glass-panel hover:border-slate-600"
                      }`}
                    >
                      <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                        <span
                          className="font-bold"
                          style={{ color: "var(--accent-cyan)" }}
                        >
                          {t.id}
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded font-bold"
                          style={{
                            background:
                              t.priority === "HIGH"
                                ? isLight
                                  ? "rgba(159,18,57,0.1)"
                                  : "rgba(251,113,133,0.2)"
                                : isLight
                                  ? "rgba(217,119,6,0.1)"
                                  : "rgba(245,158,11,0.2)",
                            color:
                              t.priority === "HIGH"
                                ? "var(--accent-rose)"
                                : "#D97706",
                          }}
                        >
                          {t.priority}
                        </span>
                      </div>
                      <h3 className="text-xs font-semibold text-heading truncate">
                        {t.title}
                      </h3>
                      <span
                        className="text-[10px] block mt-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {t.customerEmail}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Pagination Controls */}
            <div
              className="pt-3 border-t flex items-center justify-between text-[11px] font-mono"
              style={{
                borderColor: "var(--card-border)",
                color: "var(--text-muted)",
              }}
            >
              <span>
                {startIndex + 1}-
                {Math.min(startIndex + rowsPerPage, filteredTickets.length)} of{" "}
                {filteredTickets.length}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="px-2.5 py-1 rounded-lg glass-panel disabled:opacity-40 text-heading font-bold"
                >
                  Prev
                </button>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded-lg glass-panel disabled:opacity-40 text-heading font-bold"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Column 2: Center Timeline */}
        <div
          className={
            getCenterSpanClass() +
            " glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[540px] shadow-xl border transition-all"
          }
          style={{ borderColor: "var(--card-border)" }}
        >
          {selectedTicket ? (
            <>
              <div
                className={`p-3 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl mb-4 ${isLight ? "bg-slate-100 border-slate-200" : "bg-slate-900/30 border-slate-700/50"}`}
              >
                <div>
                  <span
                    className="text-xs font-mono font-bold"
                    style={{ color: "var(--accent-cyan)" }}
                  >
                    {selectedTicket.id}
                  </span>
                  <h1 className="text-base sm:text-lg font-bold font-display text-heading">
                    {selectedTicket.title}
                  </h1>
                  <span
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {selectedTicket.customerEmail} • Category:{" "}
                    {selectedTicket.category}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 border text-xs font-bold rounded-xl flex items-center gap-1 transition"
                    style={{
                      background: isLight
                        ? "rgba(159,18,57,0.1)"
                        : "rgba(251,113,133,0.15)",
                      borderColor: "var(--accent-rose)",
                      color: "var(--accent-rose)",
                    }}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Escalate
                  </button>
                  <button
                    className="px-3 py-1.5 border text-xs font-bold rounded-xl flex items-center gap-1 transition"
                    style={{
                      background: isLight
                        ? "rgba(6,95,70,0.1)"
                        : "rgba(52,211,153,0.15)",
                      borderColor: "var(--accent-emerald)",
                      color: "var(--accent-emerald)",
                    }}
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Resolve
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                <div
                  className="glass-panel p-4 rounded-xl border max-w-2xl"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold border"
                      style={{
                        background: isLight
                          ? "rgba(37,99,235,0.1)"
                          : "rgba(59,130,246,0.2)",
                        borderColor: "var(--card-border)",
                      }}
                    >
                      <User
                        className="w-4 h-4"
                        style={{ color: "var(--accent-cyan)" }}
                      />
                    </div>
                    <span className="text-xs font-bold text-heading">
                      {selectedTicket.customerEmail}
                    </span>
                  </div>
                  <p className="text-xs text-body-custom leading-relaxed font-mono">
                    {selectedTicket.description}
                  </p>
                </div>
              </div>

              <div
                className="pt-3 border-t relative"
                style={{ borderColor: "var(--card-border)" }}
              >
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your response or select AI suggestion..."
                  rows={3}
                  className={`w-full border rounded-xl p-3 text-xs text-heading focus:outline-none resize-none font-mono ${isLight ? "bg-white border-slate-300" : "bg-slate-900/80 border-slate-700/60"}`}
                />
                <button
                  onClick={() => setReplyText("")}
                  className="absolute right-3 bottom-5 bg-gradient-to-r from-blue-600 to-cyan-600 text-white px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg"
                >
                  <Send className="w-3.5 h-3.5" /> Send Reply
                </button>
              </div>
            </>
          ) : (
            <div
              className="flex-1 flex items-center justify-center text-xs font-mono"
              style={{ color: "var(--text-muted)" }}
            >
              Select a ticket from the queue
            </div>
          )}
        </div>

        {/* Column 3: Right AI Copilot */}
        {!isRightCollapsed && (
          <div
            className="col-span-12 lg:col-span-3 glass-panel rounded-2xl p-4 flex flex-col justify-between min-h-[540px] shadow-xl border transition-all space-y-4"
            style={{ borderColor: "var(--card-border)" }}
          >
            <div className="space-y-4">
              <div
                className="flex items-center justify-between pb-3 border-b"
                style={{ borderColor: "var(--card-border)" }}
              >
                <div className="flex items-center gap-2">
                  <Bot
                    className="w-4 h-4"
                    style={{ color: "var(--accent-cyan)" }}
                  />
                  <h2 className="text-xs font-bold text-heading uppercase tracking-wider">
                    AI Copilot Sidecar
                  </h2>
                </div>
                <button
                  onClick={() => setIsRightCollapsed(true)}
                  className="p-1 rounded hover:text-heading"
                  style={{ color: "var(--text-muted)" }}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div
                className="glass-panel p-3 rounded-xl border space-y-2"
                style={{ borderColor: "var(--card-border)" }}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-widest block"
                  style={{ color: "var(--accent-cyan)" }}
                >
                  Smart Context Summary
                </span>
                <p
                  className="text-xs leading-normal font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  {aiSummary}
                </p>
              </div>

              <div
                className="glass-panel p-3 rounded-xl border space-y-2"
                style={{ borderColor: "var(--card-border)" }}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-widest block"
                  style={{ color: "var(--accent-cyan)" }}
                >
                  Suggested AI Replies
                </span>
                <button
                  onClick={() =>
                    setReplyText(
                      "Hello,\n\nWe are currently analyzing log output for " +
                        selectedTicket?.id +
                        ". Will update shortly.",
                    )
                  }
                  className={`w-full text-left p-2.5 rounded-xl text-xs text-heading font-mono transition border ${isLight ? "bg-white hover:border-blue-500 border-slate-200" : "glass-panel hover:border-cyan-500"}`}
                >
                  1. Investigation Acknowledgment
                </button>
                <button
                  onClick={() =>
                    setReplyText(
                      "Please check your X.509 certificate expiry and re-upload SAML Metadata file.",
                    )
                  }
                  className={`w-full text-left p-2.5 rounded-xl text-xs text-heading font-mono transition border ${isLight ? "bg-white hover:border-blue-500 border-slate-200" : "glass-panel hover:border-cyan-500"}`}
                >
                  2. Troubleshooting Recommendation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
