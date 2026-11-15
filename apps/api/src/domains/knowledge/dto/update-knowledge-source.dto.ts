/** Request body for PATCH /knowledge-sources/:id. */

import type { KnowledgeSourceTypeValue } from './create-knowledge-source.dto.js';

export class UpdateKnowledgeSourceDto {
  sourceType?: KnowledgeSourceTypeValue;
  sourceUri?: string | null;
  objectKey?: string | null;
  content?: string | null;
  contentHash?: string;
}
