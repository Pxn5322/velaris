'use client';

import React, { useState, useMemo } from 'react';
import { Check, CheckCircle2 } from 'lucide-react';

interface LandingPricingProps {
  onOpenAuth: (mode: 'signin' | 'signup') => void;
}

export function LandingPricing({ onOpenAuth }: LandingPricingProps) {
  const [tickets, setTickets] = useState<number>(25000);
  const [isAnnual, setIsAnnual] = useState<boolean>(false);

  const tierInfo = useMemo(() => {
    let basePrice = 99;
    let tierName = 'STARTER TIER';
    let tierDesc = 'Essential AI agent support and RAG knowledge grounding for growing teams.';

    if (tickets > 10000 && tickets <= 40000) {
      basePrice = 299;
      tierName = 'PROFESSIONAL PLAN';
      tierDesc = 'Includes agent Copilot, LangGraph custom action tools, automated escalation, and RBAC governance.';
    } else if (tickets > 40000 && tickets <= 100000) {
      basePrice = 699;
      tierName = 'ENTERPRISE SCALE';
      tierDesc = 'High-volume autonomous resolution, full telemetry tracing, SLA response gates, and custom LLM routing.';
    } else if (tickets > 100000) {
      basePrice = 1299;
      tierName = 'HYPER-SCALE MATRIX';
      tierDesc = 'Dedicated tenant VPC deployment, custom fine-tuned weights, bespoke security adapters, and 24/7 dedicated engineering.';
    }

    if (isAnnual) {
      basePrice = Math.floor(basePrice * 0.8);
    }

    return { price: basePrice, tierName, tierDesc };
  }, [tickets, isAnnual]);

  return (
    <section id="pricing" className="py-24 px-4 md:px-8 relative z-10 max-w-7xl mx-auto">
        <div className="text-center space-y-4 mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-brand-cyan">
                <span>// TRANSPARENT ENTERPRISE PRICING</span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold text-heading">
                Plans for Teams of Any Scale
            </h2>
            <p className="text-muted-custom text-base max-w-xl mx-auto">
                Choose a plan calibrated to your resolution volume or calculate customized capacity below.
            </p>
        </div>

        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            
            
            <div className="glass-panel p-8 rounded-3xl flex flex-col justify-between border border-[var(--card-border)] hover:border-brand-purple/50 transition-all">
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-muted-custom uppercase font-semibold">STARTER</span>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-blue-500/10 text-brand-purple border border-blue-500/20">GROWTH</span>
                    </div>
                    <div>
                        <div className="text-4xl font-extrabold font-display text-heading">$99</div>
                        <div className="text-xs text-muted-custom mt-1">per month / billed annually</div>
                    </div>
                    <p className="text-xs text-muted-custom leading-relaxed">
                        Essential AI agent support and RAG knowledge search for growing support teams.
                    </p>
                    <ul className="space-y-3 text-xs text-body-custom pt-4 border-t border-[var(--card-border)]">
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Up to 5,000 Resolutions/mo</li>
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> 5 Human Agent Seats</li>
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Standard Knowledge RAG Ingestion</li>
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Community Support & Docs</li>
                    </ul>
                </div>
                <button type="button" onClick={() => onOpenAuth('signup')} className="w-full mt-8 py-3 rounded-xl glass-panel text-heading text-xs font-bold hover:border-brand-purple transition-all">
                    Start Free Trial
                </button>
            </div>

            
            <div className="glass-panel p-8 rounded-3xl flex flex-col justify-between border-2 border-brand-cyan relative shadow-2xl scale-105 z-10">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-brand-purple to-brand-cyan text-white text-[10px] font-bold font-mono tracking-wider shadow-md">
                    RECOMMENDED
                </div>
                <div className="space-y-6 pt-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-brand-cyan uppercase font-semibold">PROFESSIONAL</span>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-cyan-500/10 text-brand-cyan border border-cyan-500/20">SCALE</span>
                    </div>
                    <div>
                        <div className="text-4xl font-extrabold font-display text-heading">$299</div>
                        <div className="text-xs text-muted-custom mt-1">per month / billed annually</div>
                    </div>
                    <p className="text-xs text-muted-custom leading-relaxed">
                        Advanced AI workflows, tool integration execution, and AI Copilot workspace tools.
                    </p>
                    <ul className="space-y-3 text-xs text-body-custom pt-4 border-t border-[var(--card-border)]">
                        <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Up to 25,000 Resolutions/mo</li>
                        <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> 15 Human Agent Seats</li>
                        <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> LangGraph Custom Tool Integration</li>
                        <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Full Multi-Tenant Security & RBAC</li>
                        <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> AI Agent Copilot in Unified Inbox</li>
                    </ul>
                </div>
                <button type="button" onClick={() => onOpenAuth('signup')} className="w-full mt-8 py-3 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white text-xs font-bold shadow-lg shadow-blue-500/25 hover:opacity-90 transition-opacity">
                    Start Professional Trial
                </button>
            </div>

            
            <div className="glass-panel p-8 rounded-3xl flex flex-col justify-between border border-[var(--card-border)] hover:border-brand-purple/50 transition-all">
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-muted-custom uppercase font-semibold">ENTERPRISE</span>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-emerald-500/10 text-brand-emerald border border-emerald-500/20">CUSTOM</span>
                    </div>
                    <div>
                        <div className="text-4xl font-extrabold font-display text-heading">$699+</div>
                        <div className="text-xs text-muted-custom mt-1">per month / tailored capacity</div>
                    </div>
                    <p className="text-xs text-muted-custom leading-relaxed">
                        Dedicated infrastructure, custom SLAs, custom evaluations, and hands-on governance support.
                    </p>
                    <ul className="space-y-3 text-xs text-body-custom pt-4 border-t border-[var(--card-border)]">
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> 100,000+ Resolutions/mo</li>
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Unlimited Human Seats</li>
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Dedicated Success Manager & SLA</li>
                        <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-cyan" /> Custom RAG Pipelines & Data Connectors</li>
                    </ul>
                </div>
                <button type="button" onClick={() => onOpenAuth('signup')} className="w-full mt-8 py-3 rounded-xl glass-panel text-heading text-xs font-bold hover:border-brand-cyan transition-all">
                    Contact Enterprise Team
                </button>
            </div>

        </div>

        
        <div className="max-w-5xl mx-auto glass-panel rounded-3xl p-8 sm:p-10 shadow-2xl border border-[var(--card-border)] space-y-8">
            <div className="text-center space-y-2">
                <h3 className="font-display text-2xl font-bold text-heading">Resolution Capacity Estimator</h3>
                <p className="text-xs text-muted-custom">Adjust monthly ticket/resolution volume to determine your tier allocation.</p>
            </div>

            
            <div className="flex items-center justify-center gap-4 text-sm font-medium pt-2">
            <span id="billing-monthly-label" className={!isAnnual ? 'text-heading font-semibold' : 'text-muted-custom'}>
              Monthly Billing
            </span>
            <button
              id="billing-toggle"
              type="button"
              onClick={() => setIsAnnual(!isAnnual)}
              className="relative w-14 h-8 rounded-full bg-[var(--input-bg)] border border-[var(--card-border)] p-1 transition-colors"
              aria-label="Toggle annual billing"
            >
              <div
                id="billing-toggle-dot"
                className={`w-6 h-6 rounded-full bg-gradient-to-r from-brand-purple to-brand-cyan shadow-md transition-transform ${
                  isAnnual ? 'translate-x-6' : ''
                }`}
              />
            </button>
            <span id="billing-annual-label" className={isAnnual ? 'text-heading font-semibold' : 'text-muted-custom'}>
              Annual Billing <span className="text-emerald-500 text-xs font-bold">(Save 20%)</span>
            </span>
          </div>

            
            <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="ticket-slider" className="text-sm font-mono text-muted-custom font-semibold">
                ESTIMATED MONTHLY RESOLUTIONS
              </label>
              <span id="slider-ticket-count" className="font-mono text-2xl font-bold text-brand-cyan">
                {tickets.toLocaleString()} Resolutions/mo
              </span>
            </div>
            <input
              type="range"
              id="ticket-slider"
              min="5000"
              max="200000"
              step="5000"
              value={tickets}
              onChange={(e) => setTickets(parseInt(e.target.value, 10))}
              className="w-full h-3 bg-[var(--input-bg)] rounded-lg appearance-none cursor-pointer accent-brand-cyan"
            />
            <div className="flex justify-between text-xs font-mono text-muted-custom">
              <span>5K</span>
              <span>50K</span>
              <span>100K</span>
              <span>200K+</span>
            </div>
          </div>

            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-[var(--card-border)] items-center">
            <div className="md:col-span-2 space-y-2">
              <div className="text-xs font-mono text-muted-custom">RECOMMENDED VELARIS TIER</div>
              <div id="recommended-tier" className="text-2xl font-display font-bold text-heading">
                {tierInfo.tierName}
              </div>
              <p id="tier-description" className="text-xs text-muted-custom leading-relaxed">
                {tierInfo.tierDesc}
              </p>
            </div>

            <div className="glass-panel p-6 rounded-2xl text-center space-y-2 border border-brand-cyan/30">
              <div className="text-xs font-mono text-muted-custom">ESTIMATED PRICE</div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-extrabold font-display text-heading" id="calculated-price">
                  ${tierInfo.price}
                </span>
                <span className="text-xs text-muted-custom" id="billing-cycle-text">
                  {isAnnual ? '/month (billed annually)' : '/month'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenAuth('signup')}
                className="w-full mt-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white text-xs font-bold shadow-md hover:opacity-90 transition-opacity"
              >
                Claim 14-Day Free Trial
              </button>
            </div>
          </div>
        </div>
    </section>

    
  );
}
