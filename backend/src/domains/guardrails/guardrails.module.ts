import { Module, Injectable, Controller, Get, Post, Body, Query } from '@nestjs/common';

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
