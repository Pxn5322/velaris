/**
 * Database access for apps/api (D-02: Supabase PostgreSQL with Prisma).
 *
 * Prisma 7 requires a driver adapter at construction; the connection string
 * comes from the DATABASE_URL environment variable (docs/SETUP_GUIDE.md
 * section 4). Connection is lazy: the client connects on the first query,
 * so the application boots without a database configured and fails clearly
 * at query time instead.
 */

import { OnApplicationShutdown, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
