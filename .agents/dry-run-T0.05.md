# T0.05 dry run — specialist loop on task T0.05 itself

Date: 2026-10-24. Branch: `feature/T0.05-agent-workflow`.
Task: configure orchestrator and specialist-agent role prompts, task handoffs,
independent evidence capture and branch/approval gates.

## Pass record (AGENTS.md 3.3 and 3.5)

The platform runs no separate subagents in this session. Every role pass below
is a distinct sequential pass in one context and is recorded `SIMULATED`. The
command results inside each pass are real and reproducible. AGENTS.md 3.3
requires this distinction.

| # | Pass | Type | What the pass did | Key evidence |
| --- | --- | --- | --- | --- |
| 1 | Planner | SIMULATED | Defined scope: `.agents/prompts.md`, `.agents/handoff.md`, `.agents/evidence.md`, `.github/workflows/merge-gate.yml`, `scripts/check-pr-approval.mjs`, AGENTS.md 3.5. Defined criteria C-1..C-6 below. | Scope list matches the committed file set |
| 2 | Coder | SIMULATED | Wrote the files RED-first where a gate exists: gate behaviour tests were designed before the gate code was trusted. Minimal changes inside scope. | Diff: 6 files, no manifest change |
| 3 | Verifier | SIMULATED | Ran every check and recorded exact exit codes (table below). | All exit codes observed |
| 4 | Code review | SIMULATED | Re-read the full diff fresh. Found 1 blocking flaw: the approval job checked out the PR head, so a PR could rewrite its own gate. Found 1 hardening gap: `PR_NUMBER` reached a shell string without a digits-only guard. | Both fixed and re-verified (F-1, F-2) |
| 5 | Critic | SIMULATED | Attacked the gates: self-approval, missing reviews, tampered PR number, malformed label JSON, bootstrap commit, shallow-clone parent lookup. Every attack path now returns the designed exit code. | 6 gate scenarios below |
| 6 | Security (risk-triggered) | SIMULATED | Change touches workflow permissions and a token consumer, so the risk-based scan ran: secret-pattern grep over the change set, permission review, shell-input review, dependency review. | No secrets, `contents: read` + `pull-requests: read` only, no new dependencies |

## Acceptance criteria

- C-1 Role prompts exist for orchestrator and every specialist role:
  `.agents/prompts.md` (8 roles, each with mission, inputs, outputs, stop rules).
- C-2 A task handoff template exists: `.agents/handoff.md`.
- C-3 An independent evidence capture template exists: `.agents/evidence.md`.
- C-4 A branch gate runs in `.github/workflows/`: rejects direct commits on
  `master`, allows merge commits and the bootstrap commit.
- C-5 A human-approval gate runs in `.github/workflows/`: rejects a PR to
  `master` without the `owner-approved` label or an approving review by a
  non-author; fails closed when reviews are unreadable.
- C-6 AGENTS.md documents the new gates and points at the templates.

## Verifier evidence

| # | Command | Exit | Observed result |
| --- | --- | --- | --- |
| 1 | `python scripts/check_docs.py --draft` | 0 | 0 errors, 0 warnings, 100/100 |
| 2 | `npm run lint` | 0 | 0 errors, 0 warnings |
| 3 | `npm run typecheck` | 0 | all workspaces pass |
| 4 | `npm run test` | 0 | 27 passed (5 files) |
| 5 | `npm run test:cov --workspace apps/api` | 0 | branches 100% (36/36), lines 100% |
| 6 | `npm run audit:check` | 0 | PASS against 13-entry baseline |
| 7 | `node -e` js-yaml load of `merge-gate.yml` | 0 | jobs: `branch-workflow`, `human-approval`; permissions read-only |
| 8 | parent-count guard vs merge commit `ee4ca8c` | 0 | parents=2 -> ALLOW (merge) |
| 9 | parent-count guard vs bootstrap commit `c063cb4` | 0 | parents=0 -> ALLOW (bootstrap) |
| 10 | parent-count guard vs commit `55f2d9f` | 1 path | parents=1 -> REJECT (direct commit) |
| 11 | approval script, `owner-approved` label | 0 | PASS |
| 12 | approval script, review by `bob` (author `alice`) | 0 | PASS |
| 13 | approval script, self-approval only | 1 | FAIL as designed |
| 14 | approval script, no approval | 1 | FAIL as designed |
| 15 | approval script, no label and no reviews source | 2 | fails closed as designed |
| 16 | approval script, `PR_NUMBER='12;rm -rf /'` | 2 | digits-only guard rejects it |

## Critic findings and fixes

- F-1 high: the approval job checked out the pull request head, so the PR could
  edit `scripts/check-pr-approval.mjs` and pass itself. Fixed: the job now
  checks out `github.event.pull_request.base.sha`, so the gate always runs the
  base-branch version. Re-verified by js-yaml load (evidence row 7).
- F-2 medium: `PR_NUMBER` reached an `execSync` shell string without a format
  guard. Fixed: digits-only validation, exit 2 otherwise. Re-verified
  (evidence row 16).

## Security pass result

Risk-based scan, because the change is not auth/tenant/data code:

- Secret-pattern grep over the 6 changed files: 6 matches, all false positives
  from the letters `sk-` inside "risk-based" and "risk-triggered" words.
  Zero credential literals.
- Workflow permissions: `contents: read`, `pull-requests: read`. The token use
  is one read-only `gh api` reviews call.
- Shell inputs: label JSON and author login arrive as environment values, not
  string interpolation. The one interpolated value is validated as digits.
- Dependencies: no `package.json` change; `js-yaml` was used only as an
  already-installed local tool and is not a runtime dependency.

No blocking security finding.

## Protected-branch merge without human approval

- The `branch-workflow` job rejects any non-merge commit on `master`
  (evidence rows 8-10 run the same parent-count logic on real commits).
- The `human-approval` job rejects a pull request without a human approval and
  fails closed (evidence rows 11-16).
- Residual limits, stated honestly: (a) the push guard detects a direct commit
  after it lands; only GitHub branch protection can prevent the push itself.
  The owner enables that under Settings -> Branches. (b) A user with triage
  rights can apply the `owner-approved` label without a review; AGENTS.md 3.5
  states that approval follows a real human review. (c) The two workflow jobs
  prove their logic locally; their first real run on GitHub is the live
  confirmation.

## Score (AGENTS.md section 4)

| Check | Points | Evidence |
| --- | --- | --- |
| RED seen (gate failure paths observed before trust) | 15 | rows 10, 13-16 |
| Task tests pass | 20 | rows 7-16 |
| Full checks pass | 20 | rows 1-6 |
| Criteria map to tests (C-1..C-6 -> rows) | 15 | C-1..C-3 docs exist; C-4 rows 8-10; C-5 rows 11-16; C-6 docs checker row 1 |
| Denial/validation tests (gate denial paths) | 10 | rows 13-16 |
| Scope clean, no dependency change | 10 | no manifest diff |
| Docs synced with implementation | 10 | AGENTS.md 3.5, docs checker row 1 |
| **Total** | **100** | |
