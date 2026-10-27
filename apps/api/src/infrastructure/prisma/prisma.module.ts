import { Global, Module } from '@nestjs/common';
import { PRISMA_SERVICE, PrismaService } from './prisma.service.js';

/**
 * Global module: every domain module can inject PrismaService without
 * importing this module again. PRISMA_SERVICE is the explicit token used
 * by consumers; it aliases the class provider.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: PRISMA_SERVICE, useExisting: PrismaService },
  ],
  exports: [PrismaService, PRISMA_SERVICE],
})
export class PrismaModule {}
