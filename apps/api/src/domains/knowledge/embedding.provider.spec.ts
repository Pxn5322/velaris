/**
 * Embedding provider port contract (T4.01, F-09; port from T3.03/D-07).
 *
 * The retrieval query (T3.04) compares pgvector cosine distance against
 * these vectors, so the contract pins the properties retrieval depends
 * on: fixed width, finite values, unit norm and input sensitivity. A
 * production embedding adapter (D-07, owner decision) must pass the same
 * checks before it may register behind EMBEDDING_PROVIDER.
 */

import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER,
  LocalDeterministicEmbeddingProvider,
} from './embedding.provider.js';

describe('EmbeddingProvider contract (LocalDeterministicEmbeddingProvider)', () => {
  const provider = new LocalDeterministicEmbeddingProvider();

  it('exposes a non-empty model identifier for provenance rows', () => {
    expect(provider.model.trim().length).toBeGreaterThan(0);
  });

  it('matches the schema vector width (vector(1536))', () => {
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it('returns a finite vector of the declared width', async () => {
    const vector = await provider.embed('Where is my order?');

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('returns a unit vector so cosine distance behaves as designed', async () => {
    const vector = await provider.embed('Where is my order?');
    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic: the same text maps to the same vector', async () => {
    const first = await provider.embed('Where is my order?');
    const second = await provider.embed('Where is my order?');

    expect(first).toEqual(second);
  });

  it('maps different texts to different vectors', async () => {
    const first = await provider.embed('Where is my order?');
    const other = await provider.embed('Cancel my subscription');

    expect(first).not.toEqual(other);
  });
});

describe('EMBEDDING_PROVIDER token', () => {
  it('is a stable injection token', () => {
    expect(EMBEDDING_PROVIDER).toBe('EMBEDDING_PROVIDER');
  });
});
