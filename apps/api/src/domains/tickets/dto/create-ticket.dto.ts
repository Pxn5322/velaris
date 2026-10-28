/**
 * Create-ticket input (T2.02).
 *
 * Aligned to the T2.01 schema: a ticket row needs the customer foreign
 * key. The prototype's `description`/`customerEmail`/`category` fields
 * are gone; free-form customer text arrives as conversation messages
 * with T2.03.
 */
export class CreateTicketDto {
  title!: string;
  customerId!: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  /** Injected by the controller from the tenantId query scope. */
  tenantId!: string;
}
