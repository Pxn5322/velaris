import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { AuthAccountService } from './auth-account.service.js';
import { AuthSecurityController } from './auth-security.controller.js';
import { PasswordChangeService } from './password-change.service.js';
import { RecoveryApprovalController } from './recovery-approval.controller.js';
import { RecoveryApprovalService } from './recovery-approval.service.js';
import { RecoveryResetService } from './recovery-reset.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { SignupService } from './signup.service.js';
import { StepUpGuard } from './step-up.guard.js';
import { StepUpService } from './step-up.service.js';
import { SupabaseAdminService } from './supabase-admin.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';
import { TokenRevocationService } from './token-revocation.service.js';
import { ProfileService } from './profile.service.js';

@Module({
  imports: [TenantsModule, PermissionsModule, AuditModule],
  controllers: [
    AuthController,
    AuthSecurityController,
    RecoveryApprovalController,
  ],
  providers: [
    SupabaseTokenVerifier,
    SupabaseAuthGuard,
    SupabaseAdminService,
    AuthAccountService,
    PasswordPolicyService,
    PasswordChangeService,
    StepUpService,
    StepUpGuard,
    RecoveryApprovalService,
    RecoveryResetService,
    SignupService,
    TokenRevocationService,
    ProfileService,
  ],
  // Consumers that apply SupabaseAuthGuard on their own controllers
  // (example: TicketsModule) resolve the verifier through this export.
  // SupabaseAdminService is exported for the governance user routes.
  exports: [
    SupabaseTokenVerifier,
    SupabaseAuthGuard,
    SupabaseAdminService,
    AuthAccountService,
    StepUpService,
    StepUpGuard,
  ],
})
export class AuthModule {}
