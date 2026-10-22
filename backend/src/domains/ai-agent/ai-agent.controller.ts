import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service.js';
import { CreateAiAgentDto } from './dto/create-ai-agent.dto.js';

@Controller('ai-agents')
export class AiAgentController {
  constructor(private readonly aiAgentService: AiAgentService) {}

  @Post()
  create(@Body() dto: CreateAiAgentDto) {
    return this.aiAgentService.create(dto);
  }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.aiAgentService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.aiAgentService.findOne(id);
  }
}
