/**
 * LLM provider selection (T4.01, D-18).
 *
 * D-18 selects Groq as the development LLM provider: with GROQ_API_KEY
 * set (never committed; see SETUP_GUIDE), the runtime gets the real
 * Groq adapter. Without a key — CI, unit tests, offline development —
 * selection falls back to LocalDeterministicLlmProvider so the suite
 * runs without network or secrets. T4.03 registers this factory behind
 * LLM_PROVIDER in the AI module; a production provider under D-07
 * replaces this selection in one place.
 */

import {
  LocalDeterministicLlmProvider,
  resolveLlmProviderName,
} from './llm.provider.js';
import { GroqLlmProvider } from './groq.llm.provider.js';

export function createLlmProvider():
  LocalDeterministicLlmProvider | GroqLlmProvider {
  return resolveLlmProviderName() === 'groq'
    ? new GroqLlmProvider()
    : new LocalDeterministicLlmProvider();
}
