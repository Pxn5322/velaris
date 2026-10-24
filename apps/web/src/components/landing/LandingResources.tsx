"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FaqItem {
  question: string;
  answer: string;
}

const faqs: FaqItem[] = [
  {
    question: "Is VELARIS a chatbot or a ticketing system?",
    answer:
      "VELARIS is a full enterprise customer operations platform. It combines ticketing, unified inbox, and human workspace tools with governed AI support agents, RAG knowledge retrieval, and observability in one place.",
  },
  {
    question:
      "How does VELARIS ensure AI doesn't execute unauthorized actions?",
    answer:
      "Deterministic application code governs all permissions and executions. While AI agents propose actions or tool calls, server-side permission checks, policy rules, and required human approvals strictly enforce execution boundaries.",
  },
  {
    question: "How is customer data isolated in a multi-tenant setup?",
    answer:
      "Multi-tenancy is enforced server-side across database queries and vector indexes. Every request, cache key, background job, and retrieval query explicitly requires tenant context.",
  },
  {
    question:
      "What happens when the AI agent cannot resolve a customer request?",
    answer:
      "The AI automatically escalates the ticket to a human agent in the Unified Inbox, providing complete conversation context, attempted actions, and retrieved knowledge sources so the human agent takes over seamlessly.",
  },
];

export function LandingResources() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section
      id="resources"
      className="py-20 px-4 md:px-8 relative z-10 max-w-4xl mx-auto"
    >
      <div className="text-center space-y-4 mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill text-xs font-mono text-brand-cyan">
          <span>{"// FREQUENTLY ASKED QUESTIONS"}</span>
        </div>
        <h2 className="font-display text-3xl font-bold text-heading">
          Everything You Need to Know
        </h2>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={faq.question}
              className="glass-panel rounded-2xl border border-[var(--card-border)] overflow-hidden transition-all duration-200"
            >
              <button
                type="button"
                onClick={() => toggleFaq(idx)}
                aria-expanded={isOpen}
                className="w-full p-6 text-left flex items-center justify-between gap-4 group"
              >
                <h3 className="font-display font-bold text-base text-heading group-hover:text-brand-cyan transition-colors">
                  {faq.question}
                </h3>
                <ChevronDown
                  className={`w-5 h-5 text-muted-custom transition-transform duration-200 shrink-0 ${
                    isOpen ? "rotate-180 text-brand-cyan" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-6 pb-6 pt-0 animate-fadeIn">
                  <p className="text-xs text-muted-custom leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
