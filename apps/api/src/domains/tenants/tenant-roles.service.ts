/**
 * Tenant role CRUD (Roles & RBAC).
 *
 * System roles are read-only. A tenant administrator may create, rename and
 * delete a tenant-owned custom role, and chooses one tenant-assignable base
 * role. The base role is the permission profile: the resolver maps a custom
 * role to that canonical role, so a custom name never invents permissions.
 * A custom role that is still assigned cannot be deleted.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ROLE_PERMISSIONS } from '../permissions/role-permissions.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { isTenantAssignableRole } from './tenant-roles.js';
import type { CreateRoleDto, UpdateRoleDto } from './dto/governance.dto.js';

const ROLE_CODE = /^R-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLE_NAME_MAX = 60;

export interface TenantRoleView {
  id: string;
  code: string;
  name: string;
  systemManaged: boolean;
  baseRoleCode: string;
  membershipCount: number;
  permissionCount: number;
}

@Injectable()
export class TenantRolesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<TenantRoleView[]> {
    await this.requireTenant(tenantId);
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      include: { _count: { select: { memberships: true } } },
      orderBy: [{ systemManaged: 'desc' }, { name: 'asc' }],
    });
    return roles
      .map((role) => this.toView(role))
      .sort((a, b) => Number(b.systemManaged) - Number(a.systemManaged));
  }

  async create(
    tenantId: string,
    input: CreateRoleDto,
  ): Promise<TenantRoleView> {
    await this.requireTenant(tenantId);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    const baseRoleCode = requireBaseRole(input.baseRoleCode);

    const existing = await this.prisma.role.findFirst({
      where: {
        OR: [
          { tenantId: null, code },
          { tenantId, code },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Role code ${code} already exists`);
    }

    const role = await this.prisma.role.create({
      data: {
        tenantId,
        code,
        name,
        systemManaged: false,
        baseRoleCode,
      },
      include: { _count: { select: { memberships: true } } },
    });
    return this.toView(role);
  }

  async update(
    tenantId: string,
    roleId: string,
    input: UpdateRoleDto,
  ): Promise<TenantRoleView> {
    const role = await this.requireCustomRole(tenantId, roleId);
    const data: { name?: string; baseRoleCode?: string } = {};
    if (input.name !== undefined) data.name = normalizeName(input.name);
    if (input.baseRoleCode !== undefined) {
      data.baseRoleCode = requireBaseRole(input.baseRoleCode);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('name or baseRoleCode is required');
    }

    const updated = await this.prisma.role.update({
      where: { id: role.id },
      data,
      include: { _count: { select: { memberships: true } } },
    });
    return this.toView(updated);
  }

  async remove(
    tenantId: string,
    roleId: string,
  ): Promise<{ id: string; deleted: true }> {
    const role = await this.requireCustomRole(tenantId, roleId);
    const assigned = await this.prisma.membershipRole.count({
      where: { roleId: role.id },
    });
    if (assigned > 0) {
      throw new ConflictException(
        'Reassign the memberships using this role before deleting it',
      );
    }
    await this.prisma.role.delete({ where: { id: role.id } });
    return { id: role.id, deleted: true };
  }

  private async requireTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
  }

  private async requireCustomRole(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.tenantId !== tenantId) {
      throw new NotFoundException('Role not found in this tenant');
    }
    if (role.systemManaged) {
      throw new BadRequestException('System roles cannot be changed');
    }
    return role;
  }

  private toView(role: {
    id: string;
    code: string;
    name: string;
    systemManaged: boolean;
    baseRoleCode: string | null;
    _count: { memberships: number };
  }): TenantRoleView {
    const base = role.baseRoleCode ?? role.code;
    const permissions = ROLE_PERMISSIONS[base as CanonicalRole] ?? [];
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      systemManaged: role.systemManaged,
      baseRoleCode: base,
      membershipCount: role._count.memberships,
      permissionCount: permissions.length,
    };
  }
}

function normalizeCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!ROLE_CODE.test(code) || code.length > 64) {
    throw new BadRequestException(
      'code must look like R-support-lead (lowercase letters, digits, hyphens)',
    );
  }
  return code;
}

function normalizeName(value: unknown): string {
  const name =
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > ROLE_NAME_MAX) {
    throw new BadRequestException(
      `name must be between 2 and ${ROLE_NAME_MAX} characters`,
    );
  }
  return name;
}

function requireBaseRole(value: unknown): string {
  if (typeof value !== 'string' || !isTenantAssignableRole(value)) {
    throw new BadRequestException(
      'baseRoleCode must be R-tenant-admin, R-agent or R-customer',
    );
  }
  return value;
}
