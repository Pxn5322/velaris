'use client';

import React, { useState, useEffect, useRef } from 'react';

interface LogItem {
  tenant: string;
  msg: string;
  status: string;
  id: number;
}

const mockLogs = [
  { tenant: 'ACME_CORP', msg: 'LangGraph Agent matched ticket #9201 -> RESOLVED via RAG Citation [Doc #84]', status: 'AUTO-RESOLVED' },
  { tenant: 'GLOBEX', msg: "Vector search query: 'API rate limits' -> cosine similarity 0.96", status: 'GROUNDED' },
  { tenant: 'INITECH', msg: 'Triggering escalation gate: Confidence score 0.62 < 0.85 threshold', status: 'ESCALATED TO HUMAN' },
  { tenant: 'UMBRELLA', msg: "Executing tool call: 'RefundProcess' -> Permission validated via application policy", status: 'APPROVED' },
  { tenant: 'WAYNE_ENT', msg: 'Copilot generated response draft for Human Agent #402', status: 'SUGGESTION READY' },
];

export function LandingTelemetry() {
  const [logs, setLogs] = useState<LogItem[]>([
    { tenant: 'ACME_CORP', msg: 'LangGraph Agent matched ticket #9201 -> RESOLVED via RAG Citation [Doc #84]', status: 'AUTO-RESOLVED', id: 0 },
    { tenant: 'GLOBEX', msg: "Vector search query: 'API rate limits' -> cosine similarity 0.96", status: 'GROUNDED', id: 1 },
    { tenant: 'INITECH', msg: 'Triggering escalation gate: Confidence score 0.62 < 0.85 threshold', status: 'ESCALATED TO HUMAN', id: 2 },
  ]);
  const [resolvedToday, setResolvedToday] = useState<number>(18420);
  const streamRef = useRef<HTMLDivElement>(null);
  const logCounterRef = useRef<number>(3);

  useEffect(() => {
    const interval = setInterval(() => {
      const idx = logCounterRef.current % mockLogs.length;
      const nextLog = { ...mockLogs[idx], id: Date.now() + Math.random() };
      logCounterRef.current += 1;

      if (nextLog.status === 'AUTO-RESOLVED') {
        setResolvedToday((prev) => prev + 1);
      }

      setLogs((prev) => {
        const updated = [...prev, nextLog];
        return updated.length > 8 ? updated.slice(updated.length - 8) : updated;
      });
    }, 2200);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <section id="telemetry" className="py-20 px-4 md:px-8 relative z-10 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-5 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-brand-cyan">
            <span>// SYSTEM OBSERVABILITY</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-heading">
            Live Operational Traceability
          </h2>
          <p className="text-muted-custom text-sm md:text-base leading-relaxed">
            Monitor autonomous agent execution, inspect prompt traces, track model latency, and maintain complete audit compliance.
          </p>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="glass-panel p-4 rounded-2xl border-l-4 border-l-brand-cyan">
              <div className="text-xs text-muted-custom font-mono">RESOLVED TODAY</div>
              <div className="text-2xl font-bold font-mono text-heading mt-1" id="stat-sessions">
                {resolvedToday.toLocaleString()}
              </div>
            </div>
            <div className="glass-panel p-4 rounded-2xl border-l-4 border-l-brand-purple">
              <div className="text-xs text-muted-custom font-mono">TRACE COVERAGE</div>
              <div className="text-2xl font-bold font-mono text-heading mt-1" id="stat-latency">
                100%
              </div>
            </div>
          </div>
        </div>

        {/* Terminal Output Box */}
        <div className="lg:col-span-7 glass-panel rounded-3xl p-6 font-mono text-xs border border-[var(--card-border)] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
              <span className="ml-2 text-muted-custom">velaris-agent-trace // stream0</span>
            </div>
            <span className="text-emerald-500 font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              LIVE AGENTS
            </span>
          </div>

          <div
            id="terminal-stream"
            ref={streamRef}
            className="space-y-2 h-56 overflow-y-auto pr-2 text-body-custom"
          >
            {logs.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between font-mono text-xs border-b border-[var(--card-border)] pb-1"
              >
                <span className="text-brand-cyan font-semibold">[{item.tenant}]</span>
                <span className="truncate max-w-xs md:max-w-md">{item.msg}</span>
                <span className="text-emerald-500 font-bold ml-2 whitespace-nowrap">{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
