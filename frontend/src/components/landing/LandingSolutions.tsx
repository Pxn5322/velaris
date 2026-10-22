'use client';

import React from 'react';
import { LayoutGrid, Database, ShieldAlert } from 'lucide-react';

export function LandingSolutions() {
  return (
    <section id="solutions" className="py-24 px-4 md:px-8 relative z-10 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-brand-cyan">
                <span>// UNIFIED OPERATIONS</span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold text-heading">
                Break Free from Disconnected <br />
                <span className="gradient-text">Customer Support Tools</span>
            </h2>
            <p className="text-muted-custom text-base">
                Stop switching between fragmented tickets, isolated knowledge bases, and ungoverned automation scripts.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-panel p-8 rounded-3xl relative overflow-hidden group hover:border-brand-cyan transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-brand-purple mb-6 group-hover:scale-110 transition-transform">
                    <LayoutGrid className="w-6 h-6" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">Unified Workspace</h3>
                <p className="text-sm text-muted-custom leading-relaxed mb-6">
                    Eliminate repetitive manual work and slow resolutions by bringing human agents, AI agents, and internal APIs into a single workspace.
                </p>
                <div className="font-mono text-xs text-brand-cyan flex items-center gap-2">
                    <span>ZERO CONTEXT SWITCHING</span>
                </div>
            </div>

            <div className="glass-panel p-8 rounded-3xl relative overflow-hidden group hover:border-brand-cyan transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-brand-cyan mb-6 group-hover:scale-110 transition-transform">
                    <Database className="w-6 h-6" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">Grounded AI Answers</h3>
                <p className="text-sm text-muted-custom leading-relaxed mb-6">
                    Retrieve answers exclusively from authorized, tenant-isolated knowledge sources with built-in citation provenance.
                </p>
                <div className="font-mono text-xs text-brand-purple flex items-center gap-2">
                    <span>100% SOURCE CITATION VERIFIED</span>
                </div>
            </div>

            <div className="glass-panel p-8 rounded-3xl relative overflow-hidden group hover:border-brand-cyan transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-brand-emerald mb-6 group-hover:scale-110 transition-transform">
                    <ShieldAlert className="w-6 h-6" />
                </div>
                <h3 className="font-display font-bold text-xl text-heading mb-3">Governed & Observable</h3>
                <p className="text-sm text-muted-custom leading-relaxed mb-6">
                    Retain total control with deterministic application policies, human approval checkpoints, and complete audit logging.
                </p>
                <div className="font-mono text-xs text-brand-emerald flex items-center gap-2">
                    <span>DETERMINISTIC SAFETY GATES</span>
                </div>
            </div>
        </div>
    </section>
	
	
  );
}
