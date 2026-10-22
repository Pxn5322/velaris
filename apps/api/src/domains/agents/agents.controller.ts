import { Controller, Get, Query } from '@nestjs/common';
import { AgentsService } from './agents.service.js';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.agentsService.findAll(tenantId);
  }
}
