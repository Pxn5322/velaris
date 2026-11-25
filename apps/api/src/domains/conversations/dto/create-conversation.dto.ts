/**
 * Request bodies for the conversation routes (T2.03).
 *
 * No class-validator in this repository (D-xx required first): field
 * checks live in ConversationsService and run before any write.
 */
export class CreateConversationDto {
  customerId!: string;
  channel!: string;
}

/**
 * Self-service conversation input (T2.04 follow-up).
 *
 * An R-customer opens its own conversation through `POST /conversations/self`.
 * The tenant comes from the query scope and the customer row from the verified
 * identity email, so the body carries only the channel and the optional first
 * message. A body customerId may confirm the caller's row, never contradict it.
 */
export class CreateOwnConversationDto {
  channel?: string;
  /** First customer message; omitted leaves the thread empty for a reply. */
  body?: string;
  customerId?: string;
}
