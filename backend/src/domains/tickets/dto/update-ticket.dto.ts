export class UpdateTicketDto {
  title?: string;
  description?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedAgentId?: string;
  category?: string;
}
