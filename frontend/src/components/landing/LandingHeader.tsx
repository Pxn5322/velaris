'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sun, Moon, ArrowRight, Menu, X, Zap } from 'lucide-react';
import { useRole } from '@/context/RoleContext';

interface LandingHeaderProps {
  onOpenAuth: (mode: 'signin' | 'signup') => void;
}

export function LandingHeader({ onOpenAuth }: LandingHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useRole();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === 'dark';

  return (
    <header className="fixed top-0 left-0 w-full z-50 px-4 md:px-8 py-4 transition-all duration-300">
      <div className="max-w-7xl mx-auto flex items-center justify-between glass-panel rounded-2xl px-5 py-3">
        
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 flex items-center justify-center group-hover:scale-105 transition-transform">
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
          <span className="font-display font-bold text-lg md:text-xl tracking-tight text-heading">VELARIS</span>
        </Link>

        {/* Desktop Nav Items */}
        <nav className="hidden lg:flex items-center gap-8 text-sm font-medium">
          <a href="#product" className="text-muted-custom hover:text-brand-cyan transition-colors">Product</a>
          <a href="#solutions" className="text-muted-custom hover:text-brand-cyan transition-colors">Solutions</a>
          <a href="#security" className="text-muted-custom hover:text-brand-cyan transition-colors">Security</a>
          <a href="#pricing" className="text-muted-custom hover:text-brand-cyan transition-colors">Pricing</a>
          <a href="#resources" className="text-muted-custom hover:text-brand-cyan transition-colors">Resources</a>
        </nav>

        {/* Actions Right */}
        <div className="flex items-center gap-3">
          {/* Light / Dark Mode Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl glass-panel hover:border-brand-purple transition-all duration-300 text-heading"
            aria-label="Toggle Theme"
          >
            {mounted && isDark ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-[var(--text-muted)]" />
            )}
          </button>

          <button
            onClick={() => onOpenAuth('signin')}
            className="hidden sm:inline-flex text-xs md:text-sm font-semibold text-heading hover:text-brand-cyan px-3 py-2 transition-colors"
          >
            Sign In
          </button>

          <button
            onClick={() => onOpenAuth('signup')}
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white text-xs md:text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity"
          >
            Start Free
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Mobile & Tablet Hamburger Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2.5 rounded-xl glass-panel text-heading hover:border-brand-cyan transition-colors"
            aria-label="Toggle Mobile Navigation"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile / Tablet Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden max-w-7xl mx-auto mt-2 glass-panel rounded-2xl p-6 flex flex-col gap-4 shadow-2xl transition-all border border-[var(--card-border)]">
          <nav className="flex flex-col gap-3 font-medium text-sm">
            <a
              href="#product"
              onClick={() => setMobileMenuOpen(false)}
              className="text-body-custom hover:text-brand-cyan py-2 border-b border-[var(--card-border)]"
            >
              Product
            </a>
            <a
              href="#solutions"
              onClick={() => setMobileMenuOpen(false)}
              className="text-body-custom hover:text-brand-cyan py-2 border-b border-[var(--card-border)]"
            >
              Solutions
            </a>
            <a
              href="#security"
              onClick={() => setMobileMenuOpen(false)}
              className="text-body-custom hover:text-brand-cyan py-2 border-b border-[var(--card-border)]"
            >
              Security & RBAC
            </a>
            <a
              href="#pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="text-body-custom hover:text-brand-cyan py-2 border-b border-[var(--card-border)]"
            >
              Pricing & Calculator
            </a>
            <a
              href="#resources"
              onClick={() => setMobileMenuOpen(false)}
              className="text-body-custom hover:text-brand-cyan py-2 border-b border-[var(--card-border)]"
            >
              Resources & FAQ
            </a>
          </nav>
          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('signin');
              }}
              className="w-full text-center py-2.5 glass-panel rounded-xl text-xs font-bold text-heading"
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAuth('signup');
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white text-sm font-semibold shadow-lg"
            >
              Start Free Platform Trial
              <Zap className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
