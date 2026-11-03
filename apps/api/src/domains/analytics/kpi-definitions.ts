/**
 * KPI definitions (T5.03; F-12; AC-F12-1).
 *
 * Every value the summary reports names one definition here, including its
 * formula, unit and source. The version moves when a formula changes, so a
 * stored or displayed value can always be read against the formula that
 * produced it. Formulas use only data the platform already stores; a cost
 * metric waits for provider billing data (D-23 style production condition).
 */

export const KPI_DEFINITION_VERSION = '1.0.0';

export type KpiCode =
  | 'ai_resolution_rate'
  | 'escalation_rate'
  | 'ticket_resolution_hours'
  | 'open_ticket_backlog'
  | 'ai_latency_p95_ms'
  | 'audit_event_count';

export type KpiUnit = 'ratio' | 'hours' | 'count' | 'milliseconds';

export interface KpiDefinition {
  code: KpiCode;
  label: string;
  unit: KpiUnit;
  definitionVersion: string;
  /** One-sentence formula a reader can check against the data. */
  formula: string;
  /** Table the values come from. */
  source: string;
}

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  {
    code: 'ai_resolution_rate',
    label: 'AI resolution rate',
    unit: 'ratio',
    definitionVersion: KPI_DEFINITION_VERSION,
    formula:
      'Conversations with a system-authoured message that reach RESOLVED or CLOSED without any agent message, divided by conversations with a system-authoured message in the range.',
    source: 'conversations, messages',
  },
  {
    code: 'escalation_rate',
    label: 'Escalation rate',
    unit: 'ratio',
    definitionVersion: KPI_DEFINITION_VERSION,
    formula:
      'Conversations with a system-authoured message and at least one ticket, divided by conversations with a system-authoured message in the range.',
    source: 'conversations, tickets',
  },
  {
    code: 'ticket_resolution_hours',
    label: 'Ticket resolution time (median)',
    unit: 'hours',
    definitionVersion: KPI_DEFINITION_VERSION,
    formula:
      'Median of resolved_at minus created_at, in hours, for tickets resolved inside the range. The median limits distortion by one long ticket.',
    source: 'tickets',
  },
  {
    code: 'open_ticket_backlog',
    label: 'Open ticket backlog',
    unit: 'count',
    definitionVersion: KPI_DEFINITION_VERSION,
    formula:
      'Tickets created at or before the end of the range and not resolved and not closed by that instant.',
    source: 'tickets',
  },
  {
    code: 'ai_latency_p95_ms',
    label: 'AI latency p95',
    unit: 'milliseconds',
    definitionVersion: KPI_DEFINITION_VERSION,
    formula:
      'Nearest-rank 95th percentile of latency_ms for AI traces created in the range.',
    source: 'ai_traces',
  },
  {
    code: 'audit_event_count',
    label: 'Audited actions',
    unit: 'count',
    definitionVersion: KPI_DEFINITION_VERSION,
    formula: 'Audit events recorded for the tenant inside the range.',
    source: 'audit_events',
  },
] as const;

export function findKpiDefinition(code: KpiCode): KpiDefinition {
  const definition = KPI_DEFINITIONS.find((item) => item.code === code);
  if (!definition) {
    throw new Error(`Unknown KPI definition: ${code}`);
  }
  return definition;
}
