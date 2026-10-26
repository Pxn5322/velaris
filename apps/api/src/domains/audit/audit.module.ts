import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Audit persistence module (T1.04). Guards and controllers import it to
 * append security-sensitive events. PrismaModule is global, so the
 * PRISMA_SERVICE token resolves without an explicit import.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
