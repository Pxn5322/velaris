/**
 * Shared VELARIS API contracts.
 *
 * Only shapes that are already decided in docs/ARCHITECTURE.md belong here.
 * Feature-specific DTO schemas are added by the tasks that introduce them
 * (Phase 1+), each with a reference to its F-/API- IDs.
 */

/** Standard error body for every REST error response (ARCHITECTURE.md §4). */
export interface ApiError {
  code: string;
  message: string;
  /** Safe validation metadata only; never secrets or stack traces. */
  details?: Record<string, unknown>;
  requestId: string;
}
