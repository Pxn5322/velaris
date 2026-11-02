/**
 * LLM provider port contract (T4.01, F-09, AC-F09-2).
 *
 * T4.03's runtime maps a rejected `complete()` to "provider unavailable"
 * and must abstain or escalate, so rejection is part of this contract,
 * not an edge case. The suite runs against the selected development
 * adapter (D-18). A production adapter selected under D-07 must pass the
 * same checks before it may register behind LLM_PROVIDER.
 *
 * The embedding half of T4.01 is contract-tested in
 * `domains/knowledge/embedding.provider.spec.ts` (port from T3.03).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER,
  LocalDeterministicLlmProvider,
  type LlmMessage,
  type LlmProvider,
} from './llm.provider.js';

const conversation: LlmMessage[] = [
  { role: 'system', content: 'You are a support agent.' },
  { role: 'user', content: 'Where is my order?' },
];

describe('LlmProvider contract (LocalDeterministicLlmProvider)', () => {
  let provider: LlmProvider;

  beforeEach(() => {
    provider = new LocalDeterministicLlmProvider();
  });

  it('exposes a non-empty model identifier for trace rows', () => {
    expect(provider.model.trim().length).toBeGreaterThan(0);
  });

  it('resolves with non-empty text attributed to the provider model', async () => {
    const result = await provider.complete({ messages: conversation });

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.model).toBe(provider.model);
  });

  it('rejects an empty message list so the runtime can abstain (AC-F09-2)', async () => {
    await expect(provider.complete({ messages: [] })).rejects.toThrow();
  });

  it('never resolves with empty text', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: '' }],
    });

    expect(result.text.length).toBeGreaterThan(0);
  });
});

describe('LocalDeterministicLlmProvider development guarantees (D-18)', () => {
  const provider = new LocalDeterministicLlmProvider();

  it('is offline: no configuration or network state is required', () => {
    expect(new LocalDeterministicLlmProvider()).toBeInstanceOf(
      LocalDeterministicLlmProvider,
    );
  });

  it('returns the same completion for the same conversation', async () => {
    const first = await provider.complete({ messages: conversation });
    const second = await provider.complete({ messages: conversation });

    expect(first).toEqual(second);
  });

  it('distinguishes different conversations', async () => {
    const first = await provider.complete({ messages: conversation });
    const other = await provider.complete({
      messages: [{ role: 'user', content: 'Cancel my subscription' }],
    });

    expect(first.text).not.toBe(other.text);
  });
});

describe('LLM_PROVIDER token', () => {
  it('is a stable injection token', () => {
    expect(LLM_PROVIDER).toBe('LLM_PROVIDER');
  });
});
