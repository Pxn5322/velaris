import { Injectable } from '@nestjs/common';

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
