export interface Ticket {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  customerEmail: string;
  assignedAgentId?: string;
  category?: string;
  createdAt: Date;
  updatedAt: Date;
}
