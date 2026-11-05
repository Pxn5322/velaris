/**
 * Shared audit event text (T6.06, D-38).
 *
 * The audit view and the retention panel both show a retention change. One
 * helper keeps the category, window and actor wording identical, so an
 * administrator reads the same sentence in both places.
 */

export interface AuditEventLike {
  action: string;
  actorId: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/** One UTC instant in the format the governance views use. */
export function shortInstant(value: string): string {
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * Human-readable retention change, or null for another action. The API
 * returns the event metadata; the caller renders the category, the new window
 * and the actor so the decision is readable without raw JSON.
 */
export function retentionDetail(event: AuditEventLike): string | null {
  if (event.action !== "retention.policy_changed") return null;
  const metadata = event.metadata ?? {};
  const category =
    typeof metadata.category === "string"
      ? metadata.category
      : "unknown category";
  const days =
    typeof metadata.retentionDays === "number"
      ? `${metadata.retentionDays} days`
      : "unknown window";
  const actor = event.actorId ? `actor ${event.actorId}` : "unknown actor";
  return `${category} · ${days} · ${actor}`;
}
