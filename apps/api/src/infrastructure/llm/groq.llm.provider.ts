/**
 * Groq development adapter (T4.01, D-18).
 *
 * The owner selected Groq as the development LLM provider (owner-supplied
 * key and model list, console.groq.com/docs). The adapter speaks Groq's
 * OpenAI-compatible POST /openai/v1/chat/completions endpoint and
 * implements the LlmProvider port, so T4.03's runtime stays
 * provider-agnostic: swapping in a production provider under D-07 is one
 * provider registration change.
 *
 * SECURITY.md §6: the request carries a timeout (AbortSignal) and no
 * retry — the runtime owns retry policy around this port (T4.03). The
 * API key comes from GROQ_API_KEY only and never appears in source,
 * logs or docs. A missing key or a transport/provider failure rejects,
 * which the runtime maps to abstain/escalate (AC-F09-2).
 */

import { Injectable } from '@nestjs/common';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
} from './llm.provider.js';

/** OpenAI-compatible Groq endpoint (setup reference: console.groq.com/docs). */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Default from the owner-supplied model list; override with GROQ_MODEL. */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Per-request timeout; retry policy belongs to the runtime (T4.03). */
const GROQ_TIMEOUT_MS = 20_000;

@Injectable()
export class GroqLlmProvider implements LlmProvider {
  readonly model: string;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.GROQ_API_KEY?.trim() ?? '';
    this.model = process.env.GROQ_MODEL?.trim() || GROQ_DEFAULT_MODEL;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const transcript = request.messages
      .map((message) => message.content)
      .join('\n');
    if (transcript.trim().length === 0) {
      throw new Error('LLM request contains no message content');
    }
    if (this.apiKey.length === 0) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Status only: the body may echo request content or headers.
      throw new Error(`groq: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('groq: malformed completion response');
    }

    return {
      text: content,
      model:
        typeof body.model === 'string' && body.model.length > 0
          ? body.model
          : this.model,
    };
  }
}
