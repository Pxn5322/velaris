---
name: project-docs-autopilot
description: Generate the ten pre-coding project documents (PRD, ARCHITECTURE, SECURITY, DATABASE, DESIGN_SYSTEM, CODE_STYLE, TESTING, IMPLEMENTATION_PLAN, SETUP_GUIDE, AGENTS.md) so an AI coding agent can build a product test-first, score its own work from evidence, and need very little human input. Use this skill whenever the user wants to start a new software project or app, prepare a repo for AI-assisted, agentic or "vibe" coding, write a PRD together with technical docs, create AGENTS.md or CLAUDE.md, produce a checkbox implementation plan for coding agents or subagents, or asks for spec-driven or autopilot development, even if they do not name all ten files. Do not use it to edit one existing document or to write application code.
---

# Project Docs Autopilot

A coding agent builds well when decisions are written down, every requirement can be tested, and "done" is measured by evidence instead of opinion. This skill produces ten linked documents that make that possible, then checks them with a script before any code is written. The documents are the agent's memory: nothing lives only in chat.

## What you produce

| File | Job | It is the single source of truth for |
| --- | --- | --- |
| docs/PRD.md | What and why | roles (R-), journeys (J-), features (F-), acceptance criteria (AC-), NFRs |
| docs/ARCHITECTURE.md | How it is built | stack, boundaries, API contracts (API-), decision log (D-) |
| docs/SECURITY.md | Who may do what | threats (TH-), the roles × permissions matrix |
| docs/DATABASE.md | Stored data | entities (E-), schema, validation, retention |
| docs/DESIGN_SYSTEM.md | How it looks | tokens, component states, screen states, accessibility target |
| docs/CODE_STYLE.md | How code is written | conventions, format/lint/type-check commands |
| docs/TESTING.md | How it is proven | AC → test matrix, test commands, thresholds, results log |
| docs/IMPLEMENTATION_PLAN.md | What to do next | checkbox tasks, gates, run log (this is the progress state) |
| docs/SETUP_GUIDE.md | How to run it | environment, env-var names, deploy, rollback |
| AGENTS.md (repo root) | How the agent behaves | task loop, confidence score, when to ask a human |

Templates are in `references/templates.md`. Open only the template for the document you are drafting. Each fact has one owner: other documents link to it by ID instead of copying it, because copies drift and drift is what the checker and the agent will trip over later.

## Principles

1. **Evidence over assertion.** Write only commands you ran and saw succeed; otherwise write `Not configured`. Keep `Not run` distinct from `Passed`. Never invent credentials, statistics, product claims or test results.
2. **Tag what is not confirmed.** Anything the user did not state is `Proposed` (your reversible default) or `Unknown` (blocks work). Confirmed facts come from the user or the repository.
3. **IDs make consistency checkable.** F-01, J-01, AC-F01-1, NFR-01, R-admin, E-user, API-01, TH-01, D-01, T1.03. A requirement without an ID cannot be traced to a test or a task.
4. **Few, batched human gates.** Ask once up front, approve once before coding, and let the agent decide everything reversible after that. Irreversible or costly actions always go back to the human.
5. **Small context.** A task should need AGENTS.md, one task line and a few cited sections, not all ten documents.

## Workflow

### Phase 0: inspect and intake
1. If a repository exists, inspect it before writing anything: README, package manifests and lockfiles, CI config, test config, existing docs, AGENTS.md or CLAUDE.md. Record the stack and the commands you actually ran. Keep existing instructions: move their content into the right document, never delete it.
2. State the project in 6 to 10 lines (the brief) so the user can correct you early.
3. Send one **Decision Brief**: at most 10 questions, each with your recommended default and what changes if the answer differs. Ask only about things that change the documents materially: the product goal and users, platform, must-have scope, identity and data sensitivity, hosting and budget limits, compliance, required integrations, constraints from existing code.
4. If the user says "you decide" or gives no answer, proceed with the defaults and label them `Proposed`. Stop only if the product goal, users or MVP cannot be inferred at all.

### Phase 1: draft in dependency order
**PRD → ARCHITECTURE → SECURITY → DATABASE → DESIGN_SYSTEM → CODE_STYLE → TESTING → IMPLEMENTATION_PLAN → SETUP_GUIDE → AGENTS.md**

The order follows what each document needs from the previous ones: architecture needs the scope; security needs the architecture to know where the boundaries are, and owns the role matrix; the database implements that matrix instead of inventing its own; design tokens depend on the platform and framework; tests need acceptance criteria and threats; the plan needs all of them; the setup guide needs the final stack; AGENTS.md summarizes the operating rules last.

Rules for every document:
- Copy the template, keep its front matter (`status: Draft`), and replace every `<<FILL: …>>`. Where a section does not apply, write `N/A — reason` so the file set stays stable.
- Every feature gets acceptance criteria of kind happy and invalid, plus unauthorized when it touches data or permissions. UI features also get loading, empty and error criteria. Each criterion has its own ID so a test can point at it.
- Non-functional requirements are measurable (a number and a way to check it). Mark numbers `Proposed` unless the user supplied them.
- Existing repository: describe what exists as `Confirmed`, new work as `Proposed`.
- Design tokens are `Proposed` unless the user gave approved values. Compute contrast ratios rather than estimating them.
- Do not copy example content from templates or other projects. Every sentence must come from this project's brief.

### Phase 2: validate
1. Copy `scripts/check_docs.py` into the repo (for example `scripts/check_docs.py`) and run `python scripts/check_docs.py --draft`, then without `--draft` once everything is filled. Fix every error. Explain each warning you keep.
2. Check by hand what a script cannot:
   - roles are identical in PRD, SECURITY and DATABASE
   - every entity is used by a feature; every API maps to a feature; every screen maps to a journey
   - every threat has a test; stack names match everywhere
   - env-var names appear only in SETUP_GUIDE; verified commands match across CODE_STYLE, TESTING, AGENTS and SETUP_GUIDE
   - plan tasks cover every feature and acceptance criterion
3. Prepare a short consistency report: what you fixed, what remains, who decides.

### Phase 3: the approval gate (the one required human gate before coding)
Save the documents with `status: Draft`, then present in one message: the ten most consequential `Proposed` defaults with what each costs to change, the unresolved issues, and the checker result. Approval means the user says so (or lists changes). Then set `status: Approved` in each front matter and run `python scripts/check_docs.py --require-approved`. If the user asked for full autopilot and no further questions, treat the Proposed defaults as approved after presenting them, and say so.

### Phase 4: hand off
Tell the user the build starts by reading AGENTS.md and taking the first unchecked task in docs/IMPLEMENTATION_PLAN.md. For Claude Code, suggest a `CLAUDE.md` containing `@AGENTS.md` so both files stay in sync. Remind them that the confidence score is a gate built from test evidence, not a guarantee, and that production deployment, data deletion, spending and real credentials stay with the human.

## Quality bar for the documents
- Size: each document stays near 150 to 250 lines (PRD up to about 400); AGENTS.md under 200 lines; each plan task fits on one or two lines and fits a 10-minute change.
- The plan states in a few lines which plan styles were considered and why one was chosen. It does not carry long essays.
- A task is not valid without `files:`, `dep:` and `verify:`; the first step of every task is a failing test.
- Setup steps end with a Verify line. The setup guide says `Not verified` until someone has run it on a clean machine.

## Ending your run
Report: the files created, the checker result, the number of `Proposed` assumptions, the unresolved issues with owners, and the next step. Be explicit about what you did not verify.

## Resources
- `references/templates.md`: the ten templates with ID conventions.
- `scripts/check_docs.py`: deterministic checks (placeholders, tables, ID coverage, plan structure, links, command consistency). Standard library only.
