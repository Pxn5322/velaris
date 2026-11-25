/**
 * Self-service ticket input (T2.04 follow-up).
 *
 * An R-customer opens a ticket through `POST /tickets/self`. The body carries
 * only what the customer may choose: the title, an optional priority and
 * optional category tags. The tenant comes from the query scope and the
 * customer row from the verified identity email, so no client value can
 * redirect the write.
 */
export class CreateOwnTicketDto {
  title!: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  /** Free-form labels; the portal sends its category as the first tag. */
  tags?: string[];
  /**
   * Optional echo of the scope the caller believes it writes. A value that
   * contradicts the resolved tenant or the caller's customer row is a 400,
   * never silently ignored.
   */
  tenantId?: string;
  customerId?: string;
  /**
   * Optional conversation holding the customer's description. It must belong
   * to the caller's own customer row in the same tenant.
   */
  conversationId?: string;
}
