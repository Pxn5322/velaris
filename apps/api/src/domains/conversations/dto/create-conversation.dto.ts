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
