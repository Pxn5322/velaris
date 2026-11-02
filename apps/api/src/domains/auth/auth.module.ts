import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { SignupService } from './signup.service.js';
import { SupabaseAdminService } from './supabase-admin.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

@Module({
  imports: [TenantsModule, PermissionsModule, AuditModule],
  controllers: [AuthController],
  providers: [
    SupabaseTokenVerifier,
    SupabaseAuthGuard,
    SupabaseAdminService,
    SignupService,
  ],
  // Consumers that apply SupabaseAuthGuard on their own controllers
  // (example: TicketsModule) resolve the verifier through this export.
  // SupabaseAdminService is exported for the governance user routes.
  exports: [SupabaseTokenVerifier, SupabaseAuthGuard, SupabaseAdminService],
})
export class AuthModule {}
