/**
 * RBAC policy and deny-by-default checks (T1.03).
 *
 * Covers AC-F02-3 (an authenticated principal without the permission is
 * refused), AC-F03-3 (R-tenant-admin holds no platform-wide tenant
 * governance permission) and AC-F04-2 (a disabled tenant rejects new
 * business operations). The HTTP paths for AC-F02-3, AC-F03-3 and
 * AC-F04-3 run in permissions.integration.spec.ts.
 *
 * The role-to-permission map is the baseline matrix in docs/SECURITY.md
 * section 3. Unknown or missing roles map to an empty set: the policy
 * denies by default (TH-02).
 */

import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './permission.codes.js';
import { AuthorizationService } from './authorization.service.js';

describe('AuthorizationService', () => {
  const service = new AuthorizationService();

  describe('permissionsFor (deny-by-default)', () => {
    it('grants no permissions for a missing role', () => {
      expect(service.permissionsFor(null)).toEqual([]);
      expect(service.permissionsFor(undefined)).toEqual([]);
      expect(service.permissionsFor('')).toEqual([]);
    });

    it('grants no permissions for an unknown role code', () => {
      expect(service.permissionsFor('R-made-up')).toEqual([]);
    });

    it('maps R-enterprise-admin to platform tenant governance', () => {
      expect(service.permissionsFor('R-enterprise-admin')).toContain(
        PERMISSIONS.TENANT_MANAGE_PLATFORM,
      );
    });
  });

  describe('assertPermission (AC-F02-3)', () => {
    it('returns normally when the role holds the permission', () => {
      expect(() =>
        service.assertPermission('R-agent', PERMISSIONS.TICKET_READ),
      ).not.toThrow();
    });

    it('throws Forbidden when the role lacks the permission', () => {
      expect(() =>
        service.assertPermission('R-customer', PERMISSIONS.AUDIT_READ),
      ).toThrow(ForbiddenException);
    });

    it('throws Forbidden when the role is missing or unknown', () => {
      expect(() =>
        service.assertPermission(null, PERMISSIONS.TICKET_READ),
      ).toThrow(ForbiddenException);
      expect(() =>
        service.assertPermission('R-made-up', PERMISSIONS.TICKET_READ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('platform scope (AC-F03-3)', () => {
    it('denies R-tenant-admin platform-wide tenant governance', () => {
      expect(() =>
        service.assertPermission(
          'R-tenant-admin',
          PERMISSIONS.TENANT_MANAGE_PLATFORM,
        ),
      ).toThrow(ForbiddenException);
    });

    it('allows R-enterprise-admin platform-wide tenant governance', () => {
      expect(() =>
        service.assertPermission(
          'R-enterprise-admin',
          PERMISSIONS.TENANT_MANAGE_PLATFORM,
        ),
      ).not.toThrow();
    });

    it('gives R-developer no application permission without an explicit scope', () => {
      expect(service.permissionsFor('R-developer')).toEqual([]);
    });

    it('gives R-anonymous no permission at all', () => {
      expect(service.permissionsFor('R-anonymous')).toEqual([]);
    });

    it('keeps R-agent out of knowledge management and audit by default', () => {
      const agent = service.permissionsFor('R-agent');
      expect(agent).not.toContain(PERMISSIONS.KNOWLEDGE_MANAGE);
      expect(agent).not.toContain(PERMISSIONS.AUDIT_READ);
      expect(agent).not.toContain(PERMISSIONS.AI_AGENT_PUBLISH);
    });

    it('limits R-customer to customer-visible ticket reads', () => {
      expect(service.permissionsFor('R-customer')).toEqual([
        PERMISSIONS.TICKET_READ,
      ]);
    });
  });

  describe('requireActiveTenant (AC-F04-2)', () => {
    it('allows a new business operation while the tenant is ACTIVE', () => {
      expect(() =>
        service.requireActiveTenant({ id: 'tenant-a', status: 'ACTIVE' }),
      ).not.toThrow();
    });

    it('rejects a new business operation for a SUSPENDED tenant', () => {
      expect(() =>
        service.requireActiveTenant({ id: 'tenant-a', status: 'SUSPENDED' }),
      ).toThrow(ForbiddenException);
    });

    it('rejects a new business operation for a DELETED tenant', () => {
      expect(() =>
        service.requireActiveTenant({ id: 'tenant-a', status: 'DELETED' }),
      ).toThrow(ForbiddenException);
    });
  });
});
