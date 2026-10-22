export class CreateAiAgentDto {
  name!: string;
  description?: string;
  systemPrompt!: string;
  groundingThreshold?: number;
  tenantId!: string;
}
