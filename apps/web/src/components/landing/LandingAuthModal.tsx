"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface LandingAuthModalProps {
  isOpen: boolean;
  mode: "signin" | "signup";
  onClose: () => void;
}

export function LandingAuthModal({
  isOpen,
  mode,
  onClose,
}: LandingAuthModalProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onClose();
    router.push("/workspace");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
      <div className="glass-panel rounded-3xl max-w-md w-full p-6 space-y-6 border border-[var(--card-border)] relative shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-custom hover:text-heading transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <h3 className="font-display text-2xl font-bold text-heading">
            {mode === "signup"
              ? "Start Free Platform Trial"
              : "Sign In to VELARIS"}
          </h3>
          <p className="text-xs text-muted-custom">
            Access your tenant operations console or agent copilot workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          <div>
            <label className="block text-muted-custom mb-1">Work Email</label>
            <input
              type="email"
              placeholder="name@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
            />
          </div>
          <div>
            <label className="block text-muted-custom mb-1">Password</label>
            <input
              type="password"
              placeholder="........"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-heading focus:outline-none focus:border-brand-cyan"
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-purple to-brand-cyan text-white font-bold text-xs shadow-lg hover:opacity-90 transition-opacity"
          >
            Continue to Platform
          </button>
        </form>
      </div>
    </div>
  );
}
