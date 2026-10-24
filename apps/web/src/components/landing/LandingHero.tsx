"use client";

import React from "react";
import { Box, Waves, Disc, Zap, Terminal, ChevronDown } from "lucide-react";

interface LandingHeroProps {
  activePattern: "icosa" | "wave" | "galaxy";
  onChangePattern: (pattern: "icosa" | "wave" | "galaxy") => void;
  onTriggerPulse: () => void;
  onOpenAuth: (mode: "signin" | "signup") => void;
}

export function LandingHero({
  activePattern,
  onChangePattern,
  onTriggerPulse,
  onOpenAuth,
}: LandingHeroProps) {
  const modeLabels = {
    icosa: "VELARIS OS :: GOVERNED AI AGENT MATRIX",
    wave: "VELARIS OS :: WORKFLOW AUTOMATION PIPELINE",
    galaxy: "VELARIS OS :: RAG KNOWLEDGE VECTOR CLUSTER",
  };

  const handleStartFree = () => {
    onTriggerPulse();
    onOpenAuth("signup");
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-28 pb-16 px-4 md:px-8 z-10">
      <div className="max-w-5xl mx-auto text-center space-y-8">
        {/* Telemetry Pill */}
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full glass-pill text-xs font-mono font-semibold text-brand-cyan stagger-anim">
          <span className="w-2 h-2 rounded-full bg-brand-emerald animate-ping" />
          <span id="active-mode-label" className="tracking-wide">
            {modeLabels[activePattern]}
          </span>
        </div>

        {/* Headline */}
        <h1 className="font-display text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.1] text-heading stagger-anim">
          Intelligent Customer Operations <br />
          <span className="gradient-text">Powered by Governed AI</span>
        </h1>

        {/* Subtitle */}
        <p className="max-w-2xl mx-auto text-base sm:text-lg md:text-xl text-muted-custom font-normal leading-relaxed stagger-anim">
          Combine human support workflows with governed AI agents, RAG knowledge
          retrieval, automation, analytics, and enterprise security in one
          unified platform.
        </p>

        {/* Pattern Selector Buttons */}
        <div
          id="shader-modes"
          className="max-w-lg mx-auto glass-panel p-2 rounded-2xl flex items-center justify-between gap-2 border border-[var(--card-border)] stagger-anim"
        >
          <button
            id="mode-icosa"
            onClick={() => onChangePattern("icosa")}
            className={`pattern-btn flex-1 py-2.5 px-3 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 border border-transparent ${
              activePattern === "icosa"
                ? "active"
                : "text-muted-custom hover:text-heading"
            }`}
          >
            <Box className="w-4 h-4" />
            AGENT
          </button>
          <button
            id="mode-wave"
            onClick={() => onChangePattern("wave")}
            className={`pattern-btn flex-1 py-2.5 px-3 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 border border-transparent ${
              activePattern === "wave"
                ? "active"
                : "text-muted-custom hover:text-heading"
            }`}
          >
            <Waves className="w-4 h-4" />
            WORKFLOW
          </button>
          <button
            id="mode-galaxy"
            onClick={() => onChangePattern("galaxy")}
            className={`pattern-btn flex-1 py-2.5 px-3 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 border border-transparent ${
              activePattern === "galaxy"
                ? "active"
                : "text-muted-custom hover:text-heading"
            }`}
          >
            <Disc className="w-4 h-4" />
            RAG GRID
          </button>
        </div>

        {/* CTA Controls */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2 stagger-anim">
          <button
            id="trigger-motion"
            onClick={handleStartFree}
            className="px-7 py-3.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-semibold shadow-xl shadow-blue-500/25 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-2.5 text-sm"
          >
            <Zap className="w-4 h-4 fill-current" />
            Start Free
          </button>
          <a
            href="#telemetry"
            className="px-7 py-3.5 rounded-xl glass-panel font-semibold text-heading hover:border-brand-cyan transition-all duration-200 text-sm flex items-center gap-2"
          >
            <Terminal className="w-4 h-4 text-brand-cyan" />
            View Demo
          </a>
        </div>

        <p className="text-xs text-muted-custom font-mono">
          Enterprise-grade security with strict multi-tenant isolation and
          complete human-in-the-loop control.
        </p>

        {/* Scroll Indicator */}
        <div className="pt-6 flex flex-col items-center gap-2 text-muted-custom text-xs font-mono animate-bounce opacity-80">
          <span>SCROLL DOWN TO EXPLORE PLATFORM CAPABILITIES</span>
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
    </section>
  );
}
