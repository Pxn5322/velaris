/**
 * Request body for POST /auth/signup (F-01, AC-F01-2).
 *
 * No class-validator decorators exist in this repository: adding one would
 * be a new runtime dependency and needs a D-xx decision first. Field
 * validation lives in SignupService and runs before any external call, so
 * malformed input can never create an account.
 */

export class SignupDto {
  email!: string;
  password!: string;
  /** Display name of the workspace the new account administers. */
  tenantName!: string;
}
