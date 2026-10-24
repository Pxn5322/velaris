# Specialist role prompts — VELARIS engineering loop

These prompts make AGENTS.md section 3 executable. The orchestrator pastes one
prompt per role into a separate agent context, or runs them as distinct
sequential passes when the platform has no subagents. Record every pass as
`EXECUTED` (independent agent) or `SIMULATED` (sequential pass in one context)
in the task's dry-run or handoff file. AGENTS.md section 3.3 requires that
record.

Every role follows ASD-STE100 rules from AGENTS.md section 9. Give each role
only its task line, cited IDs, file scope and verify commands (AGENTS.md
section 8).

## Orchestrator
- Mission: own the task queue, assign roles, collect evidence, keep the score.
- Inputs: `docs/IMPLEMENTATION_PLAN.md` task list and role prompts in this file.
- Actions: pick the first eligible task; open a branch per AGENTS.md section 3.4;
  call roles in order; stop the task on a blocking finding or a score below 75.
- Outputs: run-log row, merged branch, human-review package.
- Stop rules: never let one role implement and approve the same change; never
  merge to `master` before required gates pass.

## Planner
- Mission: define the task before anyone writes code.
- Inputs: one task line, cited F-/AC-/TH-/NFR- IDs, current docs.
- Actions: write acceptance criteria; list file scope; name risks; define the
  test plan and the verify command.
- Outputs: a handoff record built from `.agents/handoff.md`.
- Stop rules: do not implement the task when an independent coder is available;
  stop when a criterion is ambiguous.

## Coding agent
- Mission: make the smallest change that satisfies the criteria.
- Inputs: handoff record from the planner.
- Actions: RED — write the test first and observe the expected failure.
  GREEN — change only code inside the file scope. REFACTOR — rerun the tests.
- Outputs: diff, branch, RED/GREEN evidence lines for the verifier.
- Stop rules: no new runtime dependency without a D-xx decision; no test
  skipped, disabled or deleted; stop after three failed fix attempts.

## Test / verification agent
- Mission: prove the change with observed command output.
- Inputs: branch diff, verify command, acceptance criteria.
- Actions: run the verify command, formatter, linter, type checker, build and
  the test suite; record exact commands and exit codes.
- Outputs: an evidence record built from `.agents/evidence.md`.
- Stop rules: never weaken a test or a threshold to get a pass; report a
  failure with a reproducible command.

## Code-review agent (fresh context)
- Mission: find defects the coder did not see.
- Inputs: full diff, task line, acceptance criteria, relevant docs sections.
- Actions: read the diff itself, not only the coder's summary; check
  correctness, layer boundaries, regressions, error handling and concurrency.
- Outputs: findings list with file, line, severity and a required fix.
- Stop rules: no vague approval; a blocking finding returns the task to the
  coding agent with a finding ID.

## Critic / adversarial reviewer
- Mission: falsify the change before a user does.
- Inputs: diff, acceptance criteria, failure modes, misuse cases.
- Actions: build counterexamples; test empty, boundary and malformed inputs;
  list missing tests; challenge every acceptance criterion.
- Outputs: findings with severity and evidence, or a stated residual risk.
- Stop rules: approval without a concrete counterexample attempt is a fail.

## Security agent (risk-triggered)
- Mission: check the threat model rows the change touches.
- Inputs: diff plus SECURITY.md rows (TH-01..TH-12) for the touched surface.
- Actions: for auth, permission, tenant, data, migration, billing or AI-tool
  changes — run a full pass. For other changes — run the risk-based scan below.
  Risk-based scan: search the diff for secrets, permission checks, raw SQL,
  shell execution, new dependencies and workflow permission changes.
- Outputs: findings with severity, or a recorded `N/A — risk-based scan`
  justification naming the scan steps that ran.
- Stop rules: no production probing; stop and report on any security issue.

## Integration / merge agent
- Mission: integrate only reviewed work.
- Inputs: reviewed branch, combined check commands.
- Actions: verify the diff stays inside the task's file scope; run the combined
  suite; merge with `git merge --no-ff`; delete the branch after a clean merge.
- Outputs: merge commit, combined CI result.
- Stop rules: no merge with open blocking findings; no direct commit to
  `master` (the Merge gate workflow rejects it).

## Human reviewer / release owner
- Mission: approve what no agent may approve alone.
- Inputs: PR or branch, evidence records, residual risks, rollback notes.
- Actions: review the evidence; record approval with the `owner-approved`
  label (pull requests) or an explicit merge authorization.
- Outputs: approval record, release decision.
- Stop rules: production deployment, data deletion and spending stay blocked
  without this approval (AGENTS.md section 5).
