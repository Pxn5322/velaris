/**
 * Embedding provider port and local implementation (T3.03, D-07).
 *
 * ARCHITECTURE.md §5 assigns knowledge embeddings to an external
 * embedding provider, but D-07 (provider and data terms) is still
 * Unknown, so no provider may be called. The port keeps the pipeline
 * provider-agnostic: LocalDeterministicEmbeddingProvider returns a
 * deterministic pseudo-vector from the text, dimension-matched to the
 * schema's `vector(1536)`, so ingestion and retrieval run end to end
 * offline. Swapping in the real provider is one provider registration
 * once D-07 is decided (Proposed D-xx, run log).
 *
 * SECURITY.md §6: external calls need timeouts and bounded retries; the
 * ingestion pipeline owns retry policy around this port, not the port
 * itself.
 */

import { Injectable } from '@nestjs/common';

export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';

/** Vector width fixed by the knowledge_embeddings schema (vector(1536)). */
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  /** Model/version identifier recorded on every embedding row. */
  readonly model: string;
  readonly dimensions: number;
  /** Map one text to a vector. Rejects on provider failure. */
  embed(text: string): Promise<number[]>;
}

/** FNV-1a 32-bit hash: stable across runs for deterministic vectors. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32) seeded from the text hash. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

@Injectable()
export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'local-hash-v1';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(text: string): Promise<number[]> {
    const random = mulberry32(fnv1a(text));
    const vector = Array.from({ length: this.dimensions }, () => {
      // Map [0,1) to [-1,1) for a centred pseudo-vector.
      return random() * 2 - 1;
    });
    // L2-normalize so cosine similarity behaves like a real embedding.
    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );
    return vector.map((value) => value / norm);
  }
}
