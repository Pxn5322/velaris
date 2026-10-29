"use client";

import React, { useState, useCallback, useEffect } from "react";
import { LandingSvgDefs } from "./LandingSvgDefs";
import { LandingBackgroundCanvas } from "./LandingBackgroundCanvas";
import { LandingHeader } from "./LandingHeader";
import { LandingHero } from "./LandingHero";
import { LandingProduct } from "./LandingProduct";
import { LandingSolutions } from "./LandingSolutions";
import { LandingSecurity } from "./LandingSecurity";
import { LandingTelemetry } from "./LandingTelemetry";
import { LandingPricing } from "./LandingPricing";
import { LandingResources } from "./LandingResources";
import { LandingFooter } from "./LandingFooter";
import { LandingAuthModal } from "./LandingAuthModal";

export function LandingPageContent() {
  const [activePattern, setActivePattern] = useState<
    "icosa" | "wave" | "galaxy"
  >("icosa");
  const [pulseSignal, setPulseSignal] = useState<number>(0);
  const [authModal, setAuthModal] = useState<{
    isOpen: boolean;
    mode: "signin" | "signup";
  }>({
    isOpen: false,
    mode: "signin",
  });

  const handleOpenAuth = useCallback((mode: "signin" | "signup") => {
    setAuthModal({ isOpen: true, mode });
  }, []);

  const handleCloseAuth = useCallback(() => {
    setAuthModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Nav "Sign In" entries route to /?signin=1 so the existing landing
  // sign-in modal opens instead of creating a separate sign-in page. The
  // open runs in a scheduled callback (react-hooks/set-state-in-effect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") !== "1") return;
    const timer = setTimeout(
      () => setAuthModal({ isOpen: true, mode: "signin" }),
      0,
    );
    return () => clearTimeout(timer);
  }, []);

  const handlePatternChange = useCallback(
    (pattern: "icosa" | "wave" | "galaxy") => {
      setActivePattern(pattern);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("velaris:pattern", { detail: pattern }),
        );
      }
    },
    [],
  );

  const handleTriggerPulse = useCallback(() => {
    setPulseSignal((prev) => prev + 1);
  }, []);

  return (
    <div className="relative min-h-screen text-body-custom overflow-x-hidden selection:bg-brand-cyan selection:text-slate-900">
      <LandingSvgDefs />
      <LandingBackgroundCanvas
        activePattern={activePattern}
        pulseSignal={pulseSignal}
      />

      <LandingHeader onOpenAuth={handleOpenAuth} />

      <main className="relative z-10">
        <LandingHero
          activePattern={activePattern}
          onChangePattern={handlePatternChange}
          onTriggerPulse={handleTriggerPulse}
          onOpenAuth={handleOpenAuth}
        />
        <LandingProduct />
        <LandingSolutions />
        <LandingSecurity />
        <LandingTelemetry />
        <LandingPricing onOpenAuth={handleOpenAuth} />
        <LandingResources />
      </main>

      <LandingFooter />

      <LandingAuthModal
        isOpen={authModal.isOpen}
        mode={authModal.mode}
        onClose={handleCloseAuth}
      />
    </div>
  );
}
