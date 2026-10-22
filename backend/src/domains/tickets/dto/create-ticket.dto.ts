export class CreateTicketDto {
  title!: string;
  description!: string;
  customerEmail!: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category?: string;
  tenantId!: string;
}
