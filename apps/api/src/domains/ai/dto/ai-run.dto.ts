/**
 * Body for the guarded AI run route (T5.06).
 *
 * No class-validator decorators exist in this repository, so the controller
 * checks the field types before the runtime runs. `tenantId` is never part of
 * a body: it is a query parameter and the caller must hold an ACTIVE
 * membership in that tenant. The role is never a field either — it comes from
 * the guard's server-side membership lookup (AC-F09-3).
 */

export class AiRunDto {
  /** Customer message to answer. The runtime decides the outcome. */
  message!: string;
  /** Explicit human-handoff request: skip retrieval and the model. */
  requestHuman?: boolean;
}
