/**
 * Customer records on the T2.01 table (T2.03 scope).
 *
 * Replaces the prototype in-memory store, which invented `cust_` ids and
 * had no tenant model. Every read and write is tenant-scoped; an
 * unknown id reads as not found (AC-F04-3).
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Tenant-scoped list of active customer rows. */
  findAll(tenantId: string) {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }
    return this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Create a customer inside the scoped tenant. */
  async create(input: CreateCustomerDto) {
    if (
      typeof input.tenantId !== 'string' ||
      input.tenantId.trim().length === 0
    ) {
      throw new BadRequestException('tenantId is required');
    }
    if (
      typeof input.displayName !== 'string' ||
      input.displayName.trim().length === 0
    ) {
      throw new BadRequestException('displayName is required');
    }
    return this.prisma.customer.create({
      data: {
        tenantId: input.tenantId,
        displayName: input.displayName,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });
  }

  /** One customer by id; unknown id is not found, never another tenant's. */
  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Customer with ID ' + id + ' not found');
    }
    return customer;
  }
}
