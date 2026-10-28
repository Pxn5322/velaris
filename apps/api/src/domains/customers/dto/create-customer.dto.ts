/**
 * Create-customer body (T2.03). tenantId is injected by the controller
 * from the query scope; field checks live in CustomersService.
 */
export class CreateCustomerDto {
  displayName!: string;
  email?: string;
  phone?: string;
  /** Injected by the controller from the tenantId query scope. */
  tenantId!: string;
}
