/**
 * Tenant registration (F-01, AC-F01-2): the "Start Free" flow.
 *
 * One public call creates an identity provider account, an enterprise
 * organization, a tenant, the application user row, an ACTIVE membership
 * and the R-tenant-admin role, so a new workspace owner lands in a working
 * tenant instead of an empty account.
 *
 * Order of operations matters for AC-F01-2 ("validation errors appear
 * without creating an account"):
 * 1. validate every field locally - nothing external runs yet,
 * 2. require the admin configuration (503 when absent),
 * 3. create the auth account,
 * 4. write the tenant rows in one transaction; on failure the auth
 *    account is removed again, so a partial signup leaves nothing behind.
 *
 * Authorization is not decided here: the route is public by design and
 * the service grants exactly one role, R-tenant-admin, to the owner.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { SignupDto } from './dto/signup.dto.js';
import { SupabaseAdminService } from './supabase-admin.service.js';

export interface SignupResult {
  /** Application user row id (docs/DATABASE.md, E-user). */
  userId: string;
  /** Identity-provider subject of the new account (audit actor). */
  authSubject: string;
  tenantId: string;
  slug: string;
  email: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
/** Role granted to the workspace owner (docs/SECURITY.md section 3). */
const OWNER_ROLE = 'R-tenant-admin';

@Injectable()
export class SignupService {
  // Explicit token: resolves without emitDecoratorMetadata (see PRISMA_SERVICE).
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdminService,
  ) {}

  async signup(input: SignupDto): Promise<SignupResult> {
    const email = this.validate(input);
    this.admin.requireConfigured();

    const authUser = await this.admin.createUser(email, input.password);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const slug = await this.uniqueSlug(tx, input.tenantName);
        const organization = await tx.enterpriseOrganization.create({
          data: { name: input.tenantName },
        });
        const tenant = await tx.tenant.create({
          data: {
            enterpriseOrganizationId: organization.id,
            name: input.tenantName,
            slug,
          },
        });
        const user = await tx.user.create({
          data: {
            provider: 'supabase',
            externalSubject: authUser.id,
            emailNormalized: email,
            displayName: email,
          },
        });
        const membership = await tx.tenantMembership.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            status: 'ACTIVE',
          },
        });
        const role = await tx.role.findFirst({
          where: { code: OWNER_ROLE, tenantId: null },
        });
        if (!role) {
          // The seeded system roles are a migration contract (0002).
          throw new InternalServerErrorException(
            `System role ${OWNER_ROLE} is not seeded`,
          );
        }
        await tx.membershipRole.create({
          data: { membershipId: membership.id, roleId: role.id },
        });
        return {
          tenantId: tenant.id,
          slug: tenant.slug,
          userId: user.id,
          authSubject: authUser.id,
        };
      });
      return { ...created, email };
    } catch (error) {
      // The auth account exists but the workspace does not: remove it so a
      // failed signup never leaves a half-registered identity behind.
      await this.admin.removeUser(authUser.id);
      if (isUniqueViolation(error)) {
        throw new ConflictException('That workspace address is already taken');
      }
      throw error;
    }
  }

  /**
   * AC-F01-2: every field check runs before the identity provider is
   * called, so malformed input produces a 400 and no account.
   */
  private validate(input: SignupDto): string {
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new BadRequestException('email must be a valid email address');
    }
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    const tenantName =
      typeof input.tenantName === 'string' ? input.tenantName.trim() : '';
    if (tenantName.length < MIN_NAME_LENGTH) {
      throw new BadRequestException('tenantName is required');
    }
    if (tenantName.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(
        `tenantName must be at most ${MAX_NAME_LENGTH} characters`,
      );
    }
    return email.toLowerCase();
  }

  /** Readable slug from the workspace name, made unique against the table. */
  private async uniqueSlug(
    tx: Prisma.TransactionClient,
    tenantName: string,
  ): Promise<string> {
    const base =
      tenantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'workspace';
    let candidate = base;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const existing = await tx.tenant.findUnique({
        where: { slug: candidate },
      });
      if (!existing) {
        return candidate;
      }
      candidate = `${base}-${attempt + 1}`;
    }
    throw new ConflictException('Could not derive a free workspace address');
  }
}

/** Prisma unique-constraint error (code P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
