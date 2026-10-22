'use client';

import React from 'react';
import { Lock, FileCheck, UserX, Activity } from 'lucide-react';

export function LandingSecurity() {
  return (
    <section id="security" className="py-24 px-4 md:px-8 relative z-10 max-w-7xl mx-auto space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-brand-purple">
                <span>// ENTERPRISE GOVERNANCE MATRIX</span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold text-heading">
                Enterprise Security & Data Isolation
            </h2>
            <p className="text-muted-custom text-base">
                Architected from the bottom up to guarantee multi-tenant boundaries and audit compliance.
            </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 font-mono text-xs">
            <div className="glass-panel p-6 rounded-2xl border border-[var(--card-border)] space-y-3">
                <Lock className="w-6 h-6 text-brand-cyan" />
                <div className="font-bold text-heading text-sm">Tenant Isolation</div>
                <p className="text-muted-custom text-[11px] leading-relaxed">Server-side contextual injection for all DB & Vector queries. Zero leakage risk.</p>
            </div>
            <div className="glass-panel p-6 rounded-2xl border border-[var(--card-border)] space-y-3">
                <FileCheck className="w-6 h-6 text-brand-purple" />
                <div className="font-bold text-heading text-sm">SOC 2 & ISO 27001</div>
                <p className="text-muted-custom text-[11px] leading-relaxed">Fully compliant logging, encrypted backups, and automated key rotation pipelines.</p>
            </div>
            <div className="glass-panel p-6 rounded-2xl border border-[var(--card-border)] space-y-3">
                <UserX className="w-6 h-6 text-brand-emerald" />
                <div className="font-bold text-heading text-sm">Session Flush</div>
                <p className="text-muted-custom text-[11px] leading-relaxed">Immediate client-side memory and token wipe on switching organization contexts.</p>
            </div>
            <div className="glass-panel p-6 rounded-2xl border border-[var(--card-border)] space-y-3">
                <Activity className="w-6 h-6 text-brand-rose" />
                <div className="font-bold text-heading text-sm">Immutable Audit Logs</div>
                <p className="text-muted-custom text-[11px] leading-relaxed">Every administrative action and agent execution logged with cryptographic hashes.</p>
            </div>
        </div>
    </section>
	
    
  );
}
