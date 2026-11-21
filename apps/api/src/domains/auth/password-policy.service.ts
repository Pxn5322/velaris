/**
 * Password policy for a reset or self-service change (T6.08, D-58 Phase 1).
 *
 * The provider stores only hashes, so this check cannot compare against other
 * accounts. It enforces the documented minimum length and rejects the current
 * password, email-derived values and a bounded common-password list. Breached
 * password checks stay deferred under D-58.
 */

import { BadRequestException, Injectable } from '@nestjs/common';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  'password1234',
  'password12345',
  'password123456',
  'qwerty123456',
  'qwertyuiop12',
  'letmein123456',
  'welcome123456',
  'admin1234567',
  'iloveyou1234',
  'monkey123456',
  'dragon123456',
  'football1234',
  'baseball1234',
  'sunshine1234',
  'princess1234',
  'superman1234',
  'trustno12345',
  'changeme1234',
]);

export interface PasswordPolicyInput {
  newPassword: unknown;
  currentPassword: unknown;
  email: string;
}

@Injectable()
export class PasswordPolicyService {
  assertAcceptable(input: PasswordPolicyInput): void {
    if (
      typeof input.currentPassword !== 'string' ||
      input.currentPassword.length === 0
    ) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_REQUIRED',
        message: 'The current password is required',
      });
    }
    if (typeof input.newPassword !== 'string') {
      throw weak('The new password must be text');
    }
    if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw weak(
        `The new password must have at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (input.newPassword.length > MAX_PASSWORD_LENGTH) {
      throw weak(
        `The new password must have at most ${MAX_PASSWORD_LENGTH} characters`,
      );
    }
    if (input.newPassword === input.currentPassword) {
      throw weak('The new password must differ from the current password');
    }

    const candidate = input.newPassword.toLowerCase();
    const email = input.email.trim().toLowerCase();
    const localPart = email.split('@')[0] ?? '';
    if (
      candidate === email ||
      (localPart.length >= 3 && candidate.includes(localPart))
    ) {
      throw weak('The new password must not contain your email address');
    }
    if (COMMON_PASSWORDS.has(candidate)) {
      throw weak('The new password is too common');
    }
  }
}

function weak(message: string): BadRequestException {
  return new BadRequestException({ code: 'WEAK_PASSWORD', message });
}
