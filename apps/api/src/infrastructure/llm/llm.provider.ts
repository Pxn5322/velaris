/**
 * LLM provider port and local development adapter (T4.01, F-09).
 *
 * ARCHITECTURE.md §5 assigns grounded responses to an LLM provider, but
 * D-07 (provider and data terms) is still Unknown, so no external
 * provider may be called. The port keeps the AI runtime (T4.03)
 * provider-agnostic: LocalDeterministicLlmProvider returns a
 * deterministic offline reply, so runtime tests for grounded answers,
 * abstention and provider failure (AC-F09-1/2) run without network
 * state. Swapping in the real provider is one provider registration
 * once D-07 is decided (D-18 records this development selection).
 *
 * Contract (exercised by llm.provider.spec.ts): `complete` resolves
 * with non-empty text attributed to `model`, and rejects on invalid
 * input or provider failure — T4.03 maps rejection to abstain/escalate
 * (AC-F09-2). SECURITY.md §6: external calls need timeouts and bounded
 * retries; the runtime owns retry policy around this port, not the
 * port itself.
 */

import { Injectable } from '@nestjs/common';

export const LLM_PROVIDER = 'LLM_PROVIDER';

/**
 * Injection token naming the selected provider family for trace rows
 * (T5.06). The port exposes a model, not a vendor, so the selection is
 * resolved from configuration instead of guessed from a model string.
 */
export const LLM_PROVIDER_NAME = 'LLM_PROVIDER_NAME';

/** Provider family selected by configuration (D-18). */
export function resolveLlmProviderName(): 'groq' | 'local' {
  return process.env.GROQ_API_KEY?.trim() ? 'groq' : 'local';
}

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
}

export interface LlmCompletion {
  text: string;
  /** Model/version identifier recorded on traces and citations. */
  model: string;
}

export interface LlmProvider {
  readonly model: string;
  /** Map a conversation to a reply. Rejects on invalid input or failure. */
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}

/** FNV-1a 32-bit hash: stable across runs for deterministic replies. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Offline development adapter (D-18): derives a stable reply from the
 * conversation transcript, so identical inputs give identical outputs
 * and no configuration is needed. It rejects an empty conversation —
 * the runtime treats that as a validation failure, not a reply.
 */
@Injectable()
export class LocalDeterministicLlmProvider implements LlmProvider {
  readonly model = 'local-deterministic-llm-v1';

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const transcript = request.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    if (transcript.trim().length === 0) {
      throw new Error('LLM request contains no message content');
    }

    const lastUser = [...request.messages]
      .reverse()
      .find((message) => message.role === 'user');
    const digest = fnv1a(transcript).toString(16).padStart(8, '0');
    const prompt = (lastUser?.content ?? transcript).trim();

    return {
      text: `[local-dev ${digest}] Acknowledged: ${prompt}`,
      model: this.model,
    };
  }
}
