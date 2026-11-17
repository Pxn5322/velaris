/**
 * Password policy (T6.08, D-58 Phase 1).
 *
 * A reset password must have at least 12 characters and must not repeat the
 * current password, contain the account's email local part, or use one of the
 * common passwords below. The service is pure: it makes no provider call.
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PasswordPolicyService } from './password-policy.service.js';

const policy = new PasswordPolicyService();
const email = 'alex@example.test';

function check(
  newPassword: unknown,
  currentPassword: unknown = 'Old-passphrase-12',
) {
  return () => policy.assertAcceptable({ newPassword, currentPassword, email });
}

describe('PasswordPolicyService', () => {
  it('accepts a long password that is not derived from the account', () => {
    expect(check('correct-horse-battery-staple-42')).not.toThrow();
  });

  it('rejects a password shorter than 12 characters', () => {
    expect(check('short-pass1')).toThrow(BadRequestException);
  });

  it('rejects the current password even when it meets the length rule', () => {
    expect(check('Old-passphrase-12', 'Old-passphrase-12')).toThrow(
      /current password/i,
    );
  });

  it('rejects a password derived from the email local part', () => {
    expect(check('alex-is-my-password')).toThrow(/email/i);
  });

  it('rejects a password derived from the full email address', () => {
    expect(check('alex@example.test')).toThrow(/email/i);
  });

  it('rejects a common password', () => {
    expect(check('password123456')).toThrow(/common/i);
  });

  it('rejects a non-text password', () => {
    expect(check(123456789012)).toThrow(BadRequestException);
  });

  it('rejects a password longer than 128 characters', () => {
    expect(check('a'.repeat(129))).toThrow(/128/);
  });
});
