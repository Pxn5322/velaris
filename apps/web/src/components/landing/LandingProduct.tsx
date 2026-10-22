'use client';

import React from 'react';
import { Bot, Check, Users, BookOpen, Lock } from 'lucide-react';

export function LandingProduct() {
  return (
    <section id="product" className="py-24 px-4 md:px-8 relative z-10 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-brand-cyan">
                <span>{'// CORE CAPABILITIES'}</span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold text-heading">
                Enterprise Platform <br />
                <span className="gradient-text">Engineered for Reliability</span>
            </h2>
            <p className="text-muted-custom text-base">
                Built from the ground up for modern enterprise operations, customer success, and security compliance.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="glass-panel p-8 rounded-3xl border border-[var(--card-border)] hover:border-brand-cyan/50 transition-all">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-brand-purple mb-4">
                    <Bot className="w-5 h-5" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">Autonomous AI Support Agents</h3>
                <p className="text-xs text-muted-custom leading-relaxed mb-4">
                    Deploy AI agents built on LangGraph orchestration to handle customer conversations, classify intent, and execute approved API tools safely.
                </p>
                <ul className="space-y-2 text-xs text-body-custom border-t border-[var(--card-border)] pt-4">
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Application-level permission checks before consequential tool execution</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Seamless human escalation with full conversation state preserved</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Evaluation gates and regression tests before production deployments</li>
                </ul>
            </div>

            <div className="glass-panel p-8 rounded-3xl border border-[var(--card-border)] hover:border-brand-cyan/50 transition-all">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-brand-cyan mb-4">
                    <Users className="w-5 h-5" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">AI-Augmented Human Workspace</h3>
                <p className="text-xs text-muted-custom leading-relaxed mb-4">
                    Empower human support teams with immediate ticket context, automated drafts, and real-time knowledge synthesis.
                </p>
                <ul className="space-y-2 text-xs text-body-custom border-t border-[var(--card-border)] pt-4">
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Unified Inbox with &quot;Assigned to Me&quot; views and real-time timelines</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> AI Copilot offering summary briefs, suggested replies, and RAG docs</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Smooth transition from AI automation to human agent taking control</li>
                </ul>
            </div>

            <div className="glass-panel p-8 rounded-3xl border border-[var(--card-border)] hover:border-brand-cyan/50 transition-all">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-brand-emerald mb-4">
                    <BookOpen className="w-5 h-5" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">Permission-Aware Knowledge (RAG)</h3>
                <p className="text-xs text-muted-custom leading-relaxed mb-4">
                    Ingest websites, PDFs, Markdown docs, FAQs, and ticket history into a high-precision vector store with strict access filters.
                </p>
                <ul className="space-y-2 text-xs text-body-custom border-t border-[var(--card-border)] pt-4">
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Multi-tenant vector retrieval ensuring users only query authorized files</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Automated chunking, re-indexing pipelines, and retrieval quality scores</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Direct links to source documents attached to generated agent responses</li>
                </ul>
            </div>

            <div className="glass-panel p-8 rounded-3xl border border-[var(--card-border)] hover:border-brand-cyan/50 transition-all">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-brand-purple mb-4">
                    <Lock className="w-5 h-5" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">Multi-Tenant Isolation & Security</h3>
                <p className="text-xs text-muted-custom leading-relaxed mb-4">
                    Security is enforced server-side at application boundaries rather than relying on frontend filtering.
                </p>
                <ul className="space-y-2 text-xs text-body-custom border-t border-[var(--card-border)] pt-4">
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Strict tenant context enforced across 100% of data queries</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Fine-grained Role-Based Access Control (RBAC) mapping team permissions</li>
                    <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Immutable audit logging for all administrative, security, and AI events</li>
                </ul>
            </div>
        </div>
    </section>

	
  );
}
