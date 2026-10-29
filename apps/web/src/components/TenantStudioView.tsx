"use client";

import React, { useState, useRef } from "react";
import {
  Bot,
  CheckCircle2,
  BookOpen,
  Wrench,
  ShieldAlert,
  Shield,
  Workflow,
  BarChart2,
  History,
  Cpu,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useRole } from "@/context/RoleContext";
import { TenantStudioKnowledge } from "./TenantStudioKnowledge";

export function TenantStudioView() {
  const [activeTab, setActiveTab] = useState<string>("instructions");
  const [groundingThreshold, setGroundingThreshold] = useState<number>(0.75);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { theme } = useRole();
  const isLight = theme === "light";

  const tabs = [
    { id: "overview", label: "1. Overview", icon: Activity },
    { id: "instructions", label: "2. Instructions", icon: BookOpen },
    { id: "knowledge", label: "3. Knowledge", icon: BookOpen },
    { id: "tools", label: "4. Tools & Actions", icon: Wrench },
    { id: "guardrails", label: "5. Guardrails", icon: ShieldAlert },
    { id: "permissions", label: "6. Permissions", icon: Shield },
    { id: "workflows", label: "7. Workflows", icon: Workflow },
    { id: "evals", label: "8. Evaluation", icon: BarChart2 },
    { id: "versions", label: "9. Versions", icon: History },
    { id: "observability", label: "10. Observability", icon: Cpu },
  ];

  const scrollTabs = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const amount = 200;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -amount : amount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span
            className="text-xs font-mono uppercase tracking-widest font-bold"
            style={{ color: "var(--accent-cyan)" }}
          >
            AI Agent Studio
          </span>
          <h1 className="text-2xl font-bold font-display text-heading">
            Governance & Configuration Studio
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
            style={{
              background: isLight
                ? "rgba(5,150,105,0.1)"
                : "rgba(52,211,153,0.1)",
              color: "var(--accent-emerald)",
              border: "1px solid var(--card-border)",
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Published v1.4
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => scrollTabs("left")}
          className="flex-shrink-0 p-1.5 rounded-lg glass-panel hover:text-heading transition"
          style={{ color: "var(--text-muted)" }}
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex-1 flex overflow-x-auto gap-1 p-1.5 glass-panel rounded-xl border border-slate-700/50"
          style={{ scrollbarWidth: "thin" }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const tcls = isActive
              ? `${isLight ? "bg-blue-600/10 text-blue-700 border-blue-600" : "bg-blue-600/40 text-cyan-300 border-cyan-500/40"} shadow-sm`
              : `${isLight ? "text-slate-600 hover:text-slate-900 hover:bg-slate-200" : "text-muted-custom hover:text-heading hover:bg-slate-800/40"}`;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={
                  "flex-shrink-0 px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap transition-all border " +
                  tcls
                }
              >
                <Icon
                  className="w-3.5 h-3.5"
                  style={{ color: isActive ? "inherit" : "var(--accent-cyan)" }}
                />
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => scrollTabs("right")}
          className="flex-shrink-0 p-1.5 rounded-lg glass-panel hover:text-heading transition"
          style={{ color: "var(--text-muted)" }}
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {activeTab === "instructions" && (
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <h2 className="text-sm font-bold text-heading uppercase tracking-wider">
            System Prompt & Persona Rules
          </h2>
          <textarea
            rows={6}
            defaultValue="You are VELARIS Support Copilot for Acme Corp. You respond concisely to customer inquiries using grounded information from internal knowledge sources. If certainty is below threshold, request human agent escalation."
            className={`w-full rounded-xl p-3.5 text-xs text-heading font-mono focus:outline-none border ${isLight ? "bg-white border-slate-300" : "bg-slate-900/80 border-slate-700/60"}`}
          />
        </div>
      )}

      {activeTab === "guardrails" && (
        <div className="glass-panel p-6 rounded-2xl space-y-6">
          <div>
            <h2 className="text-sm font-bold text-heading uppercase tracking-wider mb-2">
              Grounding & Confidence Threshold
            </h2>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={groundingThreshold}
                onChange={(e) =>
                  setGroundingThreshold(parseFloat(e.target.value))
                }
                className="w-64 cursor-pointer"
              />
              <span
                className="text-sm font-mono font-bold"
                style={{ color: "var(--accent-cyan)" }}
              >
                {groundingThreshold}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Minimum RAG confidence score required before autonomous response.
            </p>
          </div>
        </div>
      )}

      {activeTab === "knowledge" && <TenantStudioKnowledge />}

      {activeTab !== "instructions" &&
        activeTab !== "guardrails" &&
        activeTab !== "knowledge" && (
          <div className="glass-panel p-8 rounded-2xl text-center space-y-3">
            <Bot
              className="w-10 h-10 mx-auto"
              style={{ color: "var(--accent-cyan)" }}
            />
            <h3 className="text-base font-bold text-heading uppercase tracking-wider">
              {activeTab} Configuration
            </h3>
            <p
              className="text-xs max-w-md mx-auto"
              style={{ color: "var(--text-muted)" }}
            >
              Configured tenant rules and vector retrieval parameters are active
              for this environment.
            </p>
          </div>
        )}
    </div>
  );
}
