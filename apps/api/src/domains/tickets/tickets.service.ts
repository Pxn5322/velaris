import { Injectable, NotFoundException } from '@nestjs/common';
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
    const ticket = this.tickets.find(
      (t) => t.id === id && (!tenantId || t.tenantId === tenantId),
    );
    if (!ticket) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    return ticket;
  }

  update(
    id: string,
    updateTicketDto: UpdateTicketDto,
    tenantId?: string,
  ): Ticket {
    const ticket = this.findOne(id, tenantId);
    Object.assign(ticket, updateTicketDto, { updatedAt: new Date() });
    return ticket;
  }

  remove(id: string, tenantId?: string): { success: boolean } {
    const index = this.tickets.findIndex(
      (t) => t.id === id && (!tenantId || t.tenantId === tenantId),
    );
    if (index === -1) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    this.tickets.splice(index, 1);
    return { success: true };
  }
}
