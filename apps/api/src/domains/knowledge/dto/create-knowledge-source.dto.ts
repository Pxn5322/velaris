/**
 * Request body for POST /knowledge-sources (T3.02, API-08, F-07).
 *
 * No class-validator decorators exist in this repository: adding it would
 * be a new runtime dependency and needs a D-xx decision first. Field
 * presence, reference shape and size checks therefore live in
 * KnowledgeService and run before any write.
 *
 * The reference fields are source-specific (API-08: "source type and
 * source reference/upload metadata"):
 * - WEBSITE carries sourceUri (an http(s) URL to crawl later).
 * - PDF carries objectKey (an uploaded object reference).
 * - MARKDOWN/FAQ/MANUAL carry inline content.
 * - HISTORY carries sourceUri or objectKey (explicitly enabled
 *   historical support information, F-07).
 * - contentHash is optional: the uploader may supply the content digest
 *   used for idempotent re-ingestion; otherwise the service derives it.
 */

/** Source types F-07 allows. Anything else is rejected with 400. */
export const SUPPORTED_SOURCE_TYPES = [
  'WEBSITE',
  'PDF',
  'MARKDOWN',
  'FAQ',
  'MANUAL',
  'HISTORY',
] as const;

export type KnowledgeSourceTypeValue = (typeof SUPPORTED_SOURCE_TYPES)[number];

export class CreateKnowledgeSourceDto {
  sourceType!: KnowledgeSourceTypeValue;
  sourceUri?: string;
  objectKey?: string;
  content?: string;
  contentHash?: string;
}
