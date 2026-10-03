# AGENTS.md

This file provides instructions for AI agents working on the VELARIS codebase.

## Project Context

VELARIS is an enterprise AI customer operations platform currently in the prototype phase. The codebase consists of high-fidelity HTML prototypes demonstrating the intended user experience before full implementation.

## Codebase Conventions

### File Organization
- Prototypes are in prototypes/ directory
- Shared JavaScript modules in prototypes/js/
- Shared CSS in prototypes/css/
- Documentation in root directory (PRD.md, DESIGN.md, PRODUCT.md)

### HTML Standards
- Use semantic HTML5 elements (<header>, <main>, <nav>, <section>, <article>)
- Include lang="en" on <html> element
- Add skip links for accessibility: <a href="#main-content" class="skip-link">Skip to main content</a>
- Include ARIA labels on all interactive elements without visible text
- Use ria-hidden="true" on decorative icons

### JavaScript Standards
- Use IIFE pattern to avoid global scope pollution
- Use 'use strict'; directive
- Initialize on DOMContentLoaded event
- Prefer ddEventListener over inline onclick handlers
- Include error handling with try-catch blocks
- Debounce input handlers (e.g., search, deflection widgets)
- Clean up event listeners on page unload

### CSS Standards
- Use Tailwind utility classes for styling
- Custom CSS goes in prototypes/css/design-system.css
- Use CSS custom properties for design tokens
- Maintain 4.5:1 contrast ratio for text

### External Dependencies
- Pin to specific versions (e.g., lucide@0.453.0 instead of @latest)
- Include SRI integrity hashes for CDN scripts
- Load external scripts with crossorigin="anonymous"

## Accessibility Requirements

### WCAG 2.2 AA Compliance
- Keyboard navigation for all interactive elements
- Visible focus indicators (outline: 2px solid #6366F1)
- Screen reader announcements via ria-live="polite" regions
- Form labels associated with inputs
- No reliance on color alone to convey information

### Keyboard Shortcuts
- Cmd/Ctrl + K: Global search
- Alt + R: Focus reply textarea (agent workspace)
- Alt + E: Trigger escalation
- Escape: Close modals/drawers
- Tab/Shift+Tab: Navigate focusable elements

### Modal Patterns
- Use ole="dialog" and ria-modal="true"
- Set ria-labelledby pointing to dialog title
- Trap focus within modal when open
- Return focus to trigger element on close
- Close on Escape key and backdrop click

## Security Requirements

### Prototype Phase
- No hardcoded credentials or API keys
- Input validation before processing
- Sanitize any user-provided content
- Use el="noopener noreferrer" on external links

### Never Do
- Commit .env files or secrets
- Disable CSP or security headers in production
- Log sensitive data (passwords, tokens, PII)
- Use innerHTML with unsanitized user input

## Multi-Tenancy

### Tenant Isolation
- All tenant-scoped operations must enforce tenant context
- Tenant isolation enforced server-side, not just UI filtering
- Cross-tenant access tests are mandatory
- Cache keys must include tenant scope

### Role-Based Access
- ENTERPRISE: Platform-wide operations
- ADMIN: Tenant-scoped configuration
- AGENT: Ticket handling and AI copilot
- USER: Customer self-service

## AI Agent Configuration

### Studio Tabs
1. Overview - Status and metrics
2. Instructions - System prompts and rules
3. Knowledge - RAG source management
4. Tools & Actions - Tool schemas and permissions
5. Guardrails - Policy thresholds
6. Permissions - Agent capabilities
7. Workflows - Schema-driven automation
8. Evaluation - Test suites and release gates
9. Versions - Version history and rollback
10. Observability - Traces and telemetry

### Guardrails
- Grounding threshold: 0.75 minimum for autonomous response
- Citation requirement: Enabled by default
- Human approval: Required for actions over \

## Evaluation & Release Gates

### Deployment Criteria
- Overall evaluation score >= 90%
- Critical guardrail tests: PASS
- No unauthorized tool execution
- Retrieval/citation quality threshold met

### Evaluation Categories
- Intent classification
- Knowledge RAG grounding
- Tool selection and schema
- Safety and policy compliance
- Escalation behavior

## Error Handling

### User-Facing Errors
- Display in toast notifications
- Include correlation ID for support
- Provide actionable resolution steps
- Never expose stack traces or internal details

### API Error Format
```json
{
  "statusCode": 422,
  "errorCode": "ERR_GUARDRAIL_VIOLATION",
  "message": "AI action blocked by policy: Tool requires human approval.",
  "correlationId": "trc_9401829104",
  "timestamp": "2026-09-24T03:00:00Z"
}
```

## Documentation References

- **PRD.md**: Full product requirements and constraints
- **DESIGN.md**: Page layouts, state machines, interaction flows
- **PRODUCT.md**: Brand commitments and operating context

## Testing Checklist

Before submitting changes:
- [ ] Keyboard navigation works
- [ ] Screen reader announcements present
- [ ] Focus indicators visible
- [ ] Color contrast meets 4.5:1
- [ ] No console errors
- [ ] External scripts have SRI hashes
- [ ] Modals trap focus correctly
- [ ] Forms have associated labels
- [ ] No hardcoded secrets
- [ ] Responsive breakpoints work
