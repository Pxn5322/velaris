/**
 * Source content loader port (T3.03).
 *
 * The pipeline needs the source's text before it can parse and chunk.
 * Inline sources (MARKDOWN/FAQ/MANUAL) carry their content in the
 * source's provenance JSON, recorded at POST time (T3.02). WEBSITE
 * sources need the crawler and PDF/HISTORY uploads need object storage;
 * neither external service is configured yet (ARCHITECTURE.md §5:
 * object storage "as configured"), so those references fail with a
 * permanent, reportable error code instead of a retry loop (AC-F07-2).
 *
 * The port exists so the crawler/object-storage loader lands later as a
 * second implementation without touching the pipeline (Proposed D-xx,
 * run log).
 */

import { Injectable } from '@nestjs/common';
import { PermanentIngestionError } from './ingestion-types.js';

/** Permanent ingestion failure: the reference needs a loader that does not exist yet. */
export class SourceNotConfiguredError extends PermanentIngestionError {
  readonly errorCode = 'FETCH_NOT_CONFIGURED';

  constructor(sourceType: string) {
    super(
      'FETCH_NOT_CONFIGURED',
      `No loader configured for ${sourceType} sources (crawler/object storage pending)`,
    );
    this.name = 'SourceNotConfiguredError';
  }
}

/** Minimal source shape the loader reads (provenance + type). */
export interface LoadableSource {
  sourceType: string;
  provenanceJson: unknown;
}

@Injectable()
export class SourceContentLoader {
  /** Return the source text, or throw SourceNotConfiguredError. */
  load(source: LoadableSource): string {
    const provenance =
      typeof source.provenanceJson === 'object' &&
      source.provenanceJson !== null
        ? (source.provenanceJson as Record<string, unknown>)
        : {};
    const content = provenance.content;
    if (typeof content === 'string') {
      // Inline content: parsing decides whether it is usable (PARSE_FAILED).
      return content;
    }
    throw new SourceNotConfiguredError(source.sourceType);
  }
}
