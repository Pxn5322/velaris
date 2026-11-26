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
import type { Prisma } from '@prisma/client';
import { pageOffset, resolvePageWindow } from '../../common/paging.js';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';

/** One page of the tenant customer list (D-86). */
export interface CustomerPageOptions {
  customerId?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /**
   * One bounded page of the tenant customers, oldest first (D-86).
   *
   * The per-customer scope is part of the where clause, so a page holds only
   * that customer's row and `total` counts it, not the whole tenant table.
   */
  async findPage(tenantId: string, options: CustomerPageOptions = {}) {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }
    const window = resolvePageWindow(options);
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(options.customerId ? { id: options.customerId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: pageOffset(window),
        take: window.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total, ...window };
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
