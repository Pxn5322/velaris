/**
 * Groq development adapter contract (T4.01, D-18).
 *
 * The owner selected Groq as the development LLM provider and supplied a
 * key, so this is the selected development adapter behind LLM_PROVIDER,
 * with LocalDeterministicLlmProvider as the offline fallback for CI.
 * The adapter speaks Groq's OpenAI-compatible chat-completions endpoint
 * with a request timeout and no retry: SECURITY.md §6 leaves retry policy
 * to the runtime (T4.03), not the port. Every failure path rejects so the
 * runtime can abstain or escalate (AC-F09-2). The key comes from
 * GROQ_API_KEY only and never appears in source, logs or docs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GroqLlmProvider,
} from './groq.llm.provider.js';
import { createLlmProvider } from './llm.provider.factory.js';
import { LocalDeterministicLlmProvider } from './llm.provider.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GroqLlmProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GROQ_API_KEY', 'gsk_test_key');
    vi.stubEnv('GROQ_MODEL', 'openai/gpt-oss-120b');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects without making a request when GROQ_API_KEY is missing', async () => {
    vi.stubEnv('GROQ_API_KEY', '   ');
    const provider = new GroqLlmProvider();

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('GROQ_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty conversation before any network call', async () => {
    const provider = new GroqLlmProvider();

    await expect(provider.complete({ messages: [] })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts chat completions with Bearer auth and returns text + model', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        model: 'openai/gpt-oss-120b',
        choices: [
          { message: { role: 'assistant', content: 'Grounded answer' } },
        ],
        usage: { total_tokens: 42 },
      }),
    );
    const provider = new GroqLlmProvider();

    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Summarize the ticket.' },
      ],
    });

    expect(result).toEqual({
      text: 'Grounded answer',
      model: 'openai/gpt-oss-120b',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      GROQ_BASE_URL + '/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer gsk_test_key',
          'content-type': 'application/json',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Summarize the ticket.' },
      ],
    });
  });

  it('attributes the reply to the configured model when the answer omits it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
      }),
    );
    const provider = new GroqLlmProvider();

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toEqual({ text: 'ok', model: 'openai/gpt-oss-120b' });
    expect(provider.model).toBe('openai/gpt-oss-120b');
  });

  it('uses the default model when GROQ_MODEL is unset', async () => {
    vi.stubEnv('GROQ_MODEL', '');
    const provider = new GroqLlmProvider();
    expect(provider.model).toBe(GROQ_DEFAULT_MODEL);
  });

  it('rejects on a provider error status instead of returning a partial result', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'upstream' }));
    const provider = new GroqLlmProvider();

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('groq: 500');
  });

  it('rejects on a malformed response body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [] }));
    const provider = new GroqLlmProvider();

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('malformed');
  });

  it('rejects when the transport fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const provider = new GroqLlmProvider();

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('ECONNRESET');
  });
});

describe('createLlmProvider factory', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('selects the Groq adapter when GROQ_API_KEY is set', () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk_live');
    expect(createLlmProvider()).toBeInstanceOf(GroqLlmProvider);
  });

  it('falls back to the offline deterministic adapter without a key', () => {
    vi.stubEnv('GROQ_API_KEY', '');
    expect(createLlmProvider()).toBeInstanceOf(LocalDeterministicLlmProvider);
  });
});
