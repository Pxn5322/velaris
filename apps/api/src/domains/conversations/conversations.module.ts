import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { AiModule } from '../ai/ai.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

/**
 * Conversation/message domain (T2.03). TenantsModule supplies the scope
 * check; PermissionsModule supplies the guard dependencies and the
 * policy service; AuthModule supplies the token verifier; AiModule supplies
 * the F-09 runtime that answers a customer message (T6.05, API-13).
 * PrismaModule is global, so PRISMA_SERVICE resolves without an import.
 */
@Module({
  imports: [
    TenantsModule,
    PermissionsModule,
    AuditModule,
    AuthModule,
    CustomersModule,
    // T6.05 (API-13): the message route answers customer messages through
    // the F-09 runtime, so this module needs the runtime it calls.
    AiModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
