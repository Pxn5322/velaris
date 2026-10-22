import { Module, Injectable, Controller, Get, Post, Body, Query } from '@nestjs/common';

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
