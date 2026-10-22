import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
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
