import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const base = path.join(__dirname, '..', 'src', 'domains');

const files = {
  'tickets/dto/create-ticket.dto.ts': `export class CreateTicketDto {
  title!: string;
  description!: string;
  customerEmail!: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category?: string;
  tenantId!: string;
}
`,
  'tickets/dto/update-ticket.dto.ts': `export class UpdateTicketDto {
  title?: string;
  description?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedAgentId?: string;
  category?: string;
}
`,
  'tickets/ticket.interface.ts': `export interface Ticket {
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
`,
  'tickets/tickets.service.ts': `import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';
import { Ticket } from './ticket.interface.js';

@Injectable()
export class TicketsService {
  private tickets: Ticket[] = [];

  create(createTicketDto: CreateTicketDto): Ticket {
    const ticket: Ticket = {
      id: 'tick_' + Date.now(),
      tenantId: createTicketDto.tenantId,
      title: createTicketDto.title,
      description: createTicketDto.description,
      status: 'OPEN',
      priority: createTicketDto.priority || 'MEDIUM',
      customerEmail: createTicketDto.customerEmail,
      category: createTicketDto.category || 'General',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tickets.push(ticket);
    return ticket;
  }

  findAll(tenantId?: string): Ticket[] {
    if (tenantId) {
      return this.tickets.filter((t) => t.tenantId === tenantId);
    }
    return this.tickets;
  }

  findOne(id: string, tenantId?: string): Ticket {
    const ticket = this.tickets.find((t) => t.id === id && (!tenantId || t.tenantId === tenantId));
    if (!ticket) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    return ticket;
  }

  update(id: string, updateTicketDto: UpdateTicketDto, tenantId?: string): Ticket {
    const ticket = this.findOne(id, tenantId);
    Object.assign(ticket, updateTicketDto, { updatedAt: new Date() });
    return ticket;
  }

  remove(id: string, tenantId?: string): { success: boolean } {
    const index = this.tickets.findIndex((t) => t.id === id && (!tenantId || t.tenantId === tenantId));
    if (index === -1) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    this.tickets.splice(index, 1);
    return { success: true };
  }
}
`,
  'tickets/tickets.controller.ts': `import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@Body() createTicketDto: CreateTicketDto) {
    return this.ticketsService.create(createTicketDto);
  }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.ticketsService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.ticketsService.findOne(id, tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTicketDto: UpdateTicketDto, @Query('tenantId') tenantId?: string) {
    return this.ticketsService.update(id, updateTicketDto, tenantId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.ticketsService.remove(id, tenantId);
  }
}
`,
  'tickets/tickets.module.ts': `import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
`,
  'ai-agent/dto/create-ai-agent.dto.ts': `export class CreateAiAgentDto {
  name!: string;
  description?: string;
  systemPrompt!: string;
  groundingThreshold?: number;
  tenantId!: string;
}
`,
  'ai-agent/ai-agent.interface.ts': `export interface AiAgent {
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
`,
  'ai-agent/ai-agent.service.ts': `import { Injectable, NotFoundException } from '@nestjs/common';
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
`,
  'ai-agent/ai-agent.controller.ts': `import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
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
`,
  'ai-agent/ai-agent.module.ts': `import { Module } from '@nestjs/common';
import { AiAgentController } from './ai-agent.controller.js';
import { AiAgentService } from './ai-agent.service.js';

@Module({
  controllers: [AiAgentController],
  providers: [AiAgentService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
`,
  'customers/customers.service.ts': `import { Injectable } from '@nestjs/common';

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  company?: string;
  createdAt: Date;
}

@Injectable()
export class CustomersService {
  private customers: Customer[] = [];

  create(customer: Partial<Customer>): Customer {
    const newCust: Customer = {
      id: 'cust_' + Date.now(),
      tenantId: customer.tenantId || 'default',
      name: customer.name || 'Anonymous',
      email: customer.email || '',
      company: customer.company || '',
      createdAt: new Date(),
    };
    this.customers.push(newCust);
    return newCust;
  }

  findAll(tenantId?: string): Customer[] {
    return tenantId ? this.customers.filter((c) => c.tenantId === tenantId) : this.customers;
  }
}
`,
  'customers/customers.controller.ts': `import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { CustomersService } from './customers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() body: any) {
    return this.customersService.create(body);
  }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.customersService.findAll(tenantId);
  }
}
`,
  'customers/customers.module.ts': `import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
`,
  'agents/agents.service.ts': `import { Injectable } from '@nestjs/common';

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
`,
  'agents/agents.controller.ts': `import { Controller, Get, Query } from '@nestjs/common';
import { AgentsService } from './agents.service.js';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.agentsService.findAll(tenantId);
  }
}
`,
  'agents/agents.module.ts': `import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
`,
  'knowledge/knowledge.module.ts': `import { Module, Injectable, Controller, Get, Post, Body, Query } from '@nestjs/common';

@Injectable()
export class KnowledgeService {
  private sources: any[] = [];
  findAll(tenantId?: string) { return tenantId ? this.sources.filter(s => s.tenantId === tenantId) : this.sources; }
  create(source: any) { const item = { id: 'kn_' + Date.now(), ...source, createdAt: new Date() }; this.sources.push(item); return item; }
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}
  @Get() findAll(@Query('tenantId') t?: string) { return this.service.findAll(t); }
  @Post() create(@Body() b: any) { return this.service.create(b); }
}

@Module({ controllers: [KnowledgeController], providers: [KnowledgeService], exports: [KnowledgeService] })
export class KnowledgeModule {}
`,
  'guardrails/guardrails.module.ts': `import { Module, Injectable, Controller, Get, Post, Body, Query } from '@nestjs/common';

@Injectable()
export class GuardrailsService {
  private rules: any[] = [];
  findAll(tenantId?: string) { return tenantId ? this.rules.filter(r => r.tenantId === tenantId) : this.rules; }
  create(rule: any) { const item = { id: 'gr_' + Date.now(), groundingThreshold: 0.75, ...rule }; this.rules.push(item); return item; }
}

@Controller('guardrails')
export class GuardrailsController {
  constructor(private readonly service: GuardrailsService) {}
  @Get() findAll(@Query('tenantId') t?: string) { return this.service.findAll(t); }
  @Post() create(@Body() b: any) { return this.service.create(b); }
}

@Module({ controllers: [GuardrailsController], providers: [GuardrailsService], exports: [GuardrailsService] })
export class GuardrailsModule {}
`,
  'workflows/workflows.module.ts': `import { Module, Injectable, Controller, Get, Post, Body, Query } from '@nestjs/common';

@Injectable()
export class WorkflowsService {
  private workflows: any[] = [];
  findAll(tenantId?: string) { return tenantId ? this.workflows.filter(w => w.tenantId === tenantId) : this.workflows; }
  create(wf: any) { const item = { id: 'wf_' + Date.now(), status: 'ACTIVE', ...wf }; this.workflows.push(item); return item; }
}

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService) {}
  @Get() findAll(@Query('tenantId') t?: string) { return this.service.findAll(t); }
  @Post() create(@Body() b: any) { return this.service.create(b); }
}

@Module({ controllers: [WorkflowsController], providers: [WorkflowsService], exports: [WorkflowsService] })
export class WorkflowsModule {}
`,
  'analytics/analytics.module.ts': `import { Module, Injectable, Controller, Get, Query } from '@nestjs/common';

@Injectable()
export class AnalyticsService {
  getOverview(tenantId?: string) {
    return {
      totalTickets: 128,
      deflectionRate: '42%',
      avgResolutionTimeMinutes: 14,
      aiResolutionRate: '68%',
      tenantId: tenantId || 'all',
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get('overview') getOverview(@Query('tenantId') t?: string) { return this.service.getOverview(t); }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService], exports: [AnalyticsService] })
export class AnalyticsModule {}
`
};

for (const [relPath, content] of Object.entries(files)) {
  const fullPath = path.join(base, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}
console.log('Successfully generated all domain files!');
