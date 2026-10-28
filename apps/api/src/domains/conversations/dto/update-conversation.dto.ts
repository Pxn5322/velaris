/**
 * Conversation state change (T2.03, AC-F05-1). expectedVersion is the
 * optimistic-concurrency guard from the schema's `version` column.
 */
export class UpdateConversationDto {
  status!: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  expectedVersion?: number;
}
