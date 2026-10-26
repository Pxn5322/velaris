import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

@Module({
  imports: [TenantsModule],
  controllers: [AuthController],
  providers: [SupabaseTokenVerifier, SupabaseAuthGuard],
})
export class AuthModule {}
