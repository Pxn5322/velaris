/**
 * Send-message body (T2.03). visibility defaults to CUSTOMER_VISIBLE;
 * INTERNAL requires note.internal.write (controller) and can never be
 * authorType CUSTOMER (service). authorType itself is never accepted
 * from the client: the controller derives it from the caller's role.
 */
export class SendMessageDto {
  body!: string;
  visibility?: 'CUSTOMER_VISIBLE' | 'INTERNAL';
  idempotencyKey?: string;
}
