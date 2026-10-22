import { Injectable } from '@nestjs/common';

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'AGENT' | 'ENTERPRISE';
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
}

@Injectable()
export class AgentsService {
  private agents: Agent[] = [];

  findAll(tenantId?: string): Agent[] {
    return tenantId ? this.agents.filter((a) => a.tenantId === tenantId) : this.agents;
  }
}
