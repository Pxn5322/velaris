export interface AiAgent {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  groundingThreshold: number;
  status: 'ACTIVE' | 'DRAFT' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}
