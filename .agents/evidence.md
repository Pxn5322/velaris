# Evidence record (template)

Verification evidence for one task. AGENTS.md section 3.3 requires real
commands, real exit codes and relevant output. "Looks good" is not evidence.
The verification agent creates this record; the orchestrator stores it with the
run-log row.

## Identity
- Task ID:
- Captured by (role) and date:
- Capture type: `EXECUTED` (independent agent) / `SIMULATED` (sequential pass)

## Commands
| # | Command | Exit code | Result (short output or artifact) |
| --- | --- | --- | --- |
| 1 | | | |

## Acceptance criteria mapping
| Criterion | Test or check that proves it | Observed result |
| --- | --- | --- |
| AC-1 | | |

## Denial and validation checks
State each denial, isolation or validation check that the task touches. Write
`N/A` with the reason when no data or permission surface changes.

## Scope check
- Diff stays inside the file scope: yes / no (list the differences):
- New dependencies: none / listed with D-xx decision:

## Score
| Check | Points (AGENTS.md section 4) | Evidence line |
| --- | --- | --- |
| RED seen | 15 | |
| Task tests pass | 20 | |
| Full checks pass | 20 | |
| Criteria map to tests | 15 | |
| Denial/validation tests | 10 | |
| Scope clean | 10 | |
| Docs synced | 10 | |
| **Total** | **/100** | |

## Residual risks and follow-up
List what the evidence does not prove.
