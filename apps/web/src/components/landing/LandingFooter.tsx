'use client';

import React from 'react';

export function LandingFooter() {
  return (
    <footer className="py-12 px-4 md:px-8 border-t border-[var(--card-border)] relative z-10 glass-panel mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-muted-custom">
            <div className="flex items-center gap-3">
                
                <div className="w-7 h-7 flex items-center justify-center">
                    <svg viewBox="0 0 512 512" className="w-full h-full">
                      <g filter="url(#velaris-glow)">
                        <path d="M 256 420 L 390 120 L 310 120 L 256 250 L 202 120 L 122 120 Z" fill="url(#velaris-grad-2)" opacity="0.85" />
                        <path d="M 256 420 L 122 120 L 202 120 L 256 240 L 310 120 L 390 120 Z" fill="url(#velaris-grad-1)" />
                        <circle cx="256" cy="210" r="130" fill="none" stroke="url(#velaris-grad-1)" strokeWidth="20" strokeDasharray="210 60" strokeLinecap="round" />
                        <circle cx="256" cy="210" r="22" fill="#00F2FE" />
                        <circle cx="256" cy="210" r="10" fill="#FFFFFF" />
                      </g>
                    </svg>
                </div>
                <span className="font-mono">© 2026 VELARIS INC. ALL RIGHTS RESERVED.</span>
            </div>

            <div className="flex flex-wrap items-center gap-6 font-mono">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> PLATFORM ONLINE</span>
                <span>SYSTEM LATENCY: 3.2ms</span>
                <a href="#" className="hover:text-brand-cyan transition-colors">PRIVACY</a>
                <a href="#" className="hover:text-brand-cyan transition-colors">TERMS</a>
                <a href="#" className="hover:text-brand-cyan transition-colors">SECURITY</a>
            </div>
        </div>
    </footer>
  );
}
