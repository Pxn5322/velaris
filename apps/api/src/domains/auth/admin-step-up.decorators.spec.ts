/**
 * Sensitive-route step-up wiring (T6.08, D-58; INV-01..03).
 *
 * The guard behavior is covered over HTTP in auth-security.integration.spec.ts.
 * This spec checks that every existing sensitive handler actually declares an
 * action. A route that gains a write permission but lacks the decorator fails
 * here, so the gate cannot silently drift away from the controller.
 */

import { STEP_UP_DECORATOR_KEY } from './require-step-up.decorator.js';
import type { StepUpRequirement } from './require-step-up.decorator.js';
import { STEP_UP_ACTIONS } from './step-up.service.js';
import { AuthSecurityController } from './auth-security.controller.js';
import { ConversationsController } from '../conversations/conversations.controller.js';
import { RetentionController } from '../retention/retention.controller.js';
import { AiProvidersController } from '../tenants/ai-providers.controller.js';
import { GovernanceController } from '../tenants/governance.controller.js';

function requirementOf(
  controller: { prototype: object },
  handler: string,
): StepUpRequirement {
  const method = (controller.prototype as Record<string, unknown>)[handler];
  return Reflect.getMetadata(
    STEP_UP_DECORATOR_KEY,
    method as object,
  ) as StepUpRequirement;
}

describe('sensitive route step-up requirements', () => {
  it('declares one step-up action on every sensitive route', () => {
    const routes = [
      [GovernanceController, 'createTenant', STEP_UP_ACTIONS.TENANT_CHANGE],
      [GovernanceController, 'setTenantStatus', STEP_UP_ACTIONS.TENANT_CHANGE],
      [GovernanceController, 'createRole', STEP_UP_ACTIONS.ROLE_CHANGE],
      [GovernanceController, 'updateRole', STEP_UP_ACTIONS.ROLE_CHANGE],
      [GovernanceController, 'deleteRole', STEP_UP_ACTIONS.ROLE_CHANGE],
      [GovernanceController, 'setMembershipRole', STEP_UP_ACTIONS.ROLE_CHANGE],
      [GovernanceController, 'addUser', STEP_UP_ACTIONS.MEMBERSHIP_CHANGE],
      [GovernanceController, 'removeUser', STEP_UP_ACTIONS.MEMBERSHIP_CHANGE],
      [
        GovernanceController,
        'setMembershipStatus',
        STEP_UP_ACTIONS.MEMBERSHIP_CHANGE,
      ],
      [AiProvidersController, 'create', STEP_UP_ACTIONS.PROVIDER_CHANGE],
      [AiProvidersController, 'update', STEP_UP_ACTIONS.PROVIDER_CHANGE],
      [AiProvidersController, 'remove', STEP_UP_ACTIONS.PROVIDER_CHANGE],
      [RetentionController, 'update', STEP_UP_ACTIONS.RETENTION_CHANGE],
      [
        AuthSecurityController,
        'revokeSessions',
        STEP_UP_ACTIONS.SESSION_REVOKE,
      ],
    ] as const;

    for (const [controller, handler, action] of routes) {
      expect(
        requirementOf(controller, handler),
        `${controller.name}.${handler}`,
      ).toMatchObject({ action });
    }
  });

  it('requires attachment step-up only when a message carries files', () => {
    expect(requirementOf(ConversationsController, 'sendMessage')).toMatchObject(
      {
        action: STEP_UP_ACTIONS.ATTACHMENT_SEND,
        when: 'attachments',
      },
    );
  });
});
