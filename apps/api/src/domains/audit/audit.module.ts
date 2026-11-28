import { Module } from '@nestjs/common';
import { AuditIntegrityService } from './audit-integrity.service.js';
import { AuditService } from './audit.service.js';

/**
 * Audit persistence module (T1.04). Guards and controllers import it to
 * append security-sensitive events. PrismaModule is global, so the
 * PRISMA_SERVICE token resolves without an explicit import.
 *
 * T6.10 adds the integrity service: it verifies one scope chain and has no
 * route, because D-60 keeps verification in a scheduled, manual or CI job
 * until the owner approves an operator surface.
 */
@Module({
  providers: [AuditService, AuditIntegrityService],
  exports: [AuditService, AuditIntegrityService],
})
export class AuditModule {}
