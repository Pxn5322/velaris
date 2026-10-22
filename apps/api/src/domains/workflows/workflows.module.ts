import { Module, Injectable, Controller, Get, Post, Body, Query } from '@nestjs/common';

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
