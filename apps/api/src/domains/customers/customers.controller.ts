import { Controller, Get, Post, Body, Query } from '@nestjs/common';
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
