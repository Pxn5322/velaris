---
doc: DESIGN_SYSTEM
version: 0.1
status: Draft
owner: Product/design owner
depends_on: [PRD]
---
# Design System — VELARIS

## 1. Product and visual direction
VELARIS is positioned as an enterprise AI Customer Operations Platform. The interface should communicate enterprise trust, modern AI, operational clarity, security/governance, technical sophistication and simplicity despite platform complexity. The product name and working tagline are confirmed: “Intelligent customer operations, powered by AI.” No final Figma or visual reference is locked.

## 2. Design principles
1. Clarity before density: prioritize the next support/admin action and keep secondary telemetry inspectable.
2. Trust is visible: expose source citations, agent version, evaluation status, approval requirements and audit context where relevant.
3. Human control remains obvious: handoff, approval, retry and rollback are explicit states, not hidden side effects.
4. Scope is clear: show tenant/workspace context and avoid implying cross-tenant access.
5. Accessible by default: semantic HTML, keyboard operation, visible focus, contrast, clear errors and screen-reader announcements.
6. Consistent operational states: loading, empty, success, partial failure, error, disabled, unauthorized and stale states are designed for every data-backed screen.

## 3. Proposed tokens
Values below are Proposed starting points, not approved brand decisions. No contrast ratios are claimed; compute them for the final selected palette before approval.

| Token | Proposed value | Usage | Status |
| --- | --- | --- | --- |
| color.brand.primary | `#3157D5` | Primary actions, selected navigation | Proposed |
| color.brand.deep | `#172554` | Dark surfaces, strong emphasis | Proposed |
| color.text.primary | `#172033` | Main text on light surfaces | Proposed |
| color.text.secondary | `#526078` | Supporting text | Proposed |
| color.surface.canvas | `#F6F8FC` | Application background | Proposed |
| color.surface.panel | `#FFFFFF` | Cards, drawers, tables | Proposed |
| color.border.default | `#D9E0EC` | Dividers and control borders | Proposed |
| color.status.success | `#16794B` | Successful operations | Proposed |
| color.status.warning | `#9A5B00` | Warnings, pending approvals | Proposed |
| color.status.danger | `#B42318` | Destructive/error state | Proposed |
| color.status.info | `#175CD3` | Informational state | Proposed |
| radius.control | `8px` | Inputs and buttons | Proposed |
| radius.panel | `12px` | Cards and dialogs | Proposed |
| spacing.base | `4px` | Spacing scale unit | Proposed |
| typography.body | System sans-serif stack | Body text and UI | Proposed |
| typography.mono | System monospace stack | IDs, code, trace identifiers | Proposed |

## 4. Component conventions
- Buttons: primary, secondary, tertiary/ghost, destructive; include hover, focus-visible, active, disabled, pending/loading states. Avoid multiple primary actions in one region.
- Form fields: persistent labels, help text when needed, inline validation, error association and focus management after submit.
- Tables: clear column labels, deterministic sorting, pagination, empty/loading/error states, responsive overflow strategy and accessible row/action semantics.
- Status badges: use text plus color/icon where meaningful; never encode status by color alone.
- Dialogs/drawers: labelled title, predictable focus trap/return, keyboard dismissal when safe, explicit confirmation for destructive actions.
- Toasts/alerts: announce meaningful success/error; persistent or inline alert for actionable failures.
- Code/trace panels: copyable identifiers, redaction, expandable technical details and clear provenance.
- Knowledge citations: source title and location where available; clearly distinguish retrieved evidence from generated text.
- AI action cards: identify proposed action, requested permissions, risk level and approval state before execution.

## 5. Screen states
| Screen family | Loading | Empty | Error | Unauthorized | Success/partial |
| --- | --- | --- | --- | --- | --- |
| Landing/signup | Content skeleton only where needed | N/A for marketing sections | Signup/API error with retry | Protected route denied | Signup step and tenant creation confirmation |
| Tenant/admin dashboards | Skeleton rows/cards | Explain no tenants/users/configuration and next action | Inline error with retry and request ID | Hide protected data and show access-denied path | Freshness timestamp and action result |
| Inbox/ticket timeline | Preserve layout with skeletons | No assigned tickets with useful CTA | Recoverable error; unsent message preserved where safe | No ticket details leaked | State/assignment change reflected with timeline event |
| Knowledge ingestion | Per-source progress/status | No sources with upload/add-source CTA | Source-specific error and retry/re-index | Restricted sources omitted/denied | Indexed/failed counts and provenance |
| AI agent lifecycle | Version/evaluation loading | No agent/draft state with setup steps | Validation/evaluation failures visible | Publish/configure controls denied | Draft/testing/published/disabled version states |
| Analytics/observability | Skeleton chart/table | No data or no permission clearly distinguished | Query error and time range preserved | No restricted metrics | Timestamp, metric definition and scope visible |

## 6. Navigation and information architecture
- Public navigation: Product, Solutions, Security, Pricing, Resources, Sign In / Start Free.
- Enterprise administrator: Dashboard, Tenants, Users, Roles & Permissions, AI Agents, Analytics, Audit Logs, Settings.
- Tenant administrator: Dashboard, Inbox, Tickets, Customers, AI Agents, Knowledge, Automation, Analytics, Integrations, Settings.
- Human agent: My Inbox, Assigned to Me, Tickets, Customers, AI Copilot, Knowledge.
- Customer: My Tickets, New Request, Conversations, Profile.
- AI agent detail sections: Overview, Instructions, Knowledge, Tools & Actions, Guardrails, Permissions, Workflows, Evaluation, Versions, Observability.
- Navigation is permission-aware, but all route/API access is still checked server-side.

## 7. Key flows
- Onboarding: Landing → Sign Up → Create Company → Tenant Created → Invite Agent → Upload Knowledge → Configure AI Agent → Test Agent → Publish → Customer Conversation → AI Resolution/Human Escalation.
- Escalation: Customer asks/request human → AI stops or hands off according to policy → conversation/customer/retrieval/tool context attached → agent inbox shows reason and prior attempts.
- Publishing: edit draft → validate configuration → run evaluation → show gate results → authorized publish → immutable version active → monitor traces/outcomes; rollback preserves history.
- Sensitive tool action: show action intent and impact → server-side checks → approval UI if required → execute → show outcome and audit reference.

## 8. Responsive behavior
- Target responsive web. Exact breakpoints are Proposed and should use the selected component system's conventions.
- Desktop: multi-pane inbox and admin tables may use available width; preserve keyboard navigation between panes.
- Tablet: collapse secondary context panels into drawers/tabs while retaining conversation/ticket context.
- Mobile web: prioritize message/ticket content and primary actions; tables become cards or horizontally scrollable with accessible labels. Native mobile apps are deferred.

## 9. Accessibility
- Target WCAG 2.2 AA for critical journeys.
- Keyboard-only completion for signup, ticket handling, knowledge upload, agent configuration/testing/publishing and human escalation.
- Visible focus indicators; no keyboard traps outside modal patterns; logical focus order.
- Semantic headings, landmarks, labels, table headers and status announcements.
- Errors identify the field and how to fix it; async states are announced without excessive interruptions.
- Respect reduced-motion preference; avoid color-only signals; test zoom/reflow and contrast.
- Verify with automated accessibility tooling and manual keyboard/screen-reader checks. Automated checks alone do not prove conformance.

## 10. Content and interaction writing
- Use direct, neutral, operational language; describe what happened and the next action.
- Distinguish “AI suggested”, “awaiting approval”, “executed”, “blocked by policy”, and “handed to a human”.
- Error messages should be safe and actionable, include request/correlation ID where useful, and never expose stack traces or secrets.
- Do not claim a response is grounded unless source provenance/citation behavior supports that claim.

## 11. Design review checklist
- [ ] Approved palette has computed text/non-text contrast ratios.
- [ ] Every data screen has loading, empty, error, and unauthorized states.
- [ ] Critical flows work with keyboard only.
- [ ] Focus and screen-reader announcements verified.
- [ ] Tenant context and authorization do not depend on visual hiding.
- [ ] AI source, version, approval and escalation state are understandable.
- [ ] Destructive actions are explicit and reversible where possible.
- [ ] Responsive behavior tested at representative widths.
