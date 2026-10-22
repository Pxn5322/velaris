import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateAiAgentDto } from './dto/create-ai-agent.dto.js';
import { AiAgent } from './ai-agent.interface.js';

@Injectable()
export class AiAgentService {
  private agents: AiAgent[] = [];

  create(dto: CreateAiAgentDto): AiAgent {
    const agent: AiAgent = {
      id: 'ai_' + Date.now(),
      tenantId: dto.tenantId,
      name: dto.name,
      description: dto.description || '',
      systemPrompt: dto.systemPrompt,
      groundingThreshold: dto.groundingThreshold ?? 0.75,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.agents.push(agent);
    return agent;
  }

  findAll(tenantId?: string): AiAgent[] {
    return tenantId ? this.agents.filter((a) => a.tenantId === tenantId) : this.agents;
  }

  findOne(id: string): AiAgent {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) throw new NotFoundException('AI Agent with ID ' + id + ' not found');
    return agent;
  }
}
