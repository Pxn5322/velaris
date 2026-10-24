# Task handoff record (template)

Copy this file per handoff. The sending role fills sections 1-5. The receiving
role fills section 6 before it starts work. The orchestrator keeps every
handoff with the task's run-log row.

## 1. Task identity
- Task ID (example: `T0.05`):
- Branch name:
- Cited IDs (F-/AC-/TH-/NFR-):
- Sending role: planner / coder / verifier / reviewer / critic / security / integrator
- Receiving role:

## 2. Scope
- File scope (allowed paths):
- Out of scope (explicit):
- Dependencies that are ticked:

## 3. Acceptance criteria
List each criterion as one line. Number them `AC-1`, `AC-2`, ...

## 4. Test plan and verify command
- RED test to write first:
- Verify command (exact):
- Other checks: format / lint / typecheck / build / suite / docs checker

## 5. Risks and known open points
Name the risks and the linked TH-/NFR- IDs. State what is unknown.

## 6. Receiving-role reply (fill before work starts)
- Confirmed scope: yes / no (state the difference):
- Questions or blocking ambiguity:
- Planned first action:

## 7. Findings on return (fill when the pass ends)
- Finding IDs and severities (example: `F-1 high`):
- Required fix and required regression test:
- Status: accepted / blocking / fixed and re-verified
