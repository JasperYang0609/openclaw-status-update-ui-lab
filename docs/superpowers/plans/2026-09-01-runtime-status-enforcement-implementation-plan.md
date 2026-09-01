# Status Update UI Lab v0.3.0 Implementation Plan

Date: 2026-09-01  
Approved design: `docs/superpowers/specs/2026-09-01-runtime-status-enforcement-design.md`  
Design commit: `e4ad1e262d73b63e62bfb825fa972d072af7dd19`  
Execution scope: local implementation, tests, security evidence, independent review, and commits only

## Task spec / dispatch

### Background

`v0.2.2` exposes `status_update_ui` but has no lifecycle hooks. Customer installations therefore have a callable tool without deterministic early status delivery. Ansai currently compensates with workspace and Discord-guild prompts, which are not automatically present on customer systems.

### Objective

Implement the approved hybrid runtime enforcement for `v0.3.0`:

- one automatic start card per valid channel-originated run before normal model work;
- one automatic wait card at most per run when a non-status tool exceeds the configured threshold;
- stable prompt guidance for meaningful later model-authored updates;
- no fixed repeating heartbeat;
- normal final replies remain unchanged;
- all automatic delivery remains route-scoped, bounded, content-minimized, and safe on unknown delivery.

### In scope

- Add bounded turn/run enforcement state and hook handlers.
- Register `before_prompt_build`, `before_tool_call`, and `after_tool_call`.
- Extend route resolution for documented hook context fields without weakening existing route checks.
- Prefer `runId` for dedupe identity when available.
- Add and validate the approved config fields.
- Update agent-hook helper, README, manifest, package version, tests, and security closeout evidence.
- Run local runtime inspection and package verification.
- Independent reviewer examines exact implementation commit and evidence.

### Out of scope / forbidden

- No GitHub push, PR, Release, tag, or public artifact publication.
- No installation into the live Ansai Gateway.
- No Gateway restart or live Discord smoke in this implementation run.
- No customer-device update or customer Discord message.
- No Notion checklist modification.
- No secrets, tokens, prompt bodies, tool inputs/results, raw errors, or sensitive paths in automatic cards or persisted state.
- No persistent ledger, edited status messages, alternate recipient fallback, repeated fixed heartbeat, or final-answer blocking.
- No unrelated refactor.

### Required changed areas

- `index.js`
- `openclaw.plugin.json`
- `package.json`
- `src/core.js`
- `src/delivery.js`
- `src/delivery-guard.js`
- new `src/turn-enforcement.js`
- `scripts/install_agent_hook.py`
- `README.md`
- new/updated tests under `tests/`
- new security closeout record under `docs/security/`

Implementer may add a focused helper/test file when necessary, but must explain it in the completion report.

### Acceptance criteria

- Existing test suite remains green.
- Deterministic tests prove one start attempt per run and two consecutive runs in one Session both attempt delivery.
- Concurrent duplicate hook calls coalesce.
- Route/account/target/thread/run isolation passes.
- Missing or background-only route context skips automatic sends.
- Fast tool cancels its timer; slow tool sends exactly one wait card; multiple slow tools do not exceed one automatic wait card per run.
- `status_update_ui` never schedules a wait card for itself.
- Automatic templates never include untrusted content.
- Unknown delivery is never retried or converted into fallback delivery.
- State capacity and TTL fail closed without blocking tools or final replies.
- Runtime inspection reports all three hooks.
- Package version is `0.3.0`; packed files contain only intended project artifacts.
- Repository secret scan and dependency audit pass.
- Worktree is clean after commit.

### Required implementer report

```text
COMPLETE | BLOCKED | NEEDS_PM
changed_files:
tests_and_logs:
security_evidence:
commit:
risks_or_questions:
dirty_status:
```

### Stop and ask PM if

- OpenClaw hook context cannot provide an exact current route without reading or persisting conversation content.
- Implementation requires `allowConversationAccess=true`.
- The only viable design needs repeated timers, destination fallback, final-answer blocking, or prompt/tool content interpolation.
- Existing v0.2.2 unknown-delivery protection would be weakened.
- A P0/P1 security finding appears.
- A test would require live Discord, Gateway restart, customer mutation, publication, or credentials.

## Implementation sequence

### Task 1 — Tests first for route and dedupe identity

- Add failing tests for hook-context route resolution.
- Add failing tests proving `runId` wins over Session identity and consecutive runs are independent.
- Implement the smallest changes in `src/core.js` and `src/delivery-guard.js`.
- Run focused tests.

### Task 2 — Bounded enforcement state

- Create `src/turn-enforcement.js` with config normalization, TTL cleanup, capacity guard, per-run start claim, tool-wait scheduling/cancellation, and one-wait-per-run semantics.
- Use injectable clock/timer/delivery dependencies for deterministic tests.
- Do not retain prompt or tool content.
- Run focused concurrency, TTL, capacity, fast-tool, and slow-tool tests.

### Task 3 — Hook registration and delivery integration

- Register the three approved hooks in `index.js`.
- Reuse `executeStatusUpdateUi` through an internal safe call path rather than duplicating delivery logic.
- Ensure `before_prompt_build` always returns static system guidance in `prompt` and `hybrid` modes, even if automatic start delivery fails.
- Ensure hook failures are logged safely and do not block the agent turn.
- Test hook registration and error containment.

### Task 4 — Config, documentation, and install helper

- Add schema fields and defaults.
- Set package and manifest version to `0.3.0`.
- Update README with behavior change, opt-out modes, upgrade steps, runtime inspection, acceptance checks, and rollback to `v0.2.2`.
- Update `install_agent_hook.py` marker text so it does not ask the model to duplicate the runtime start card and does require event-based updates.
- Test helper idempotency and config bounds.

### Task 5 — Full verification and security closeout

- Run syntax checks and complete test suite.
- Inspect runtime hook registration without installing or restarting the live Gateway.
- Run `npm pack --dry-run`, dependency audit, secret scan, and diff review.
- Record OWASP A01–A10 statuses, AI overlay, threats, test evidence, P0–P3, residual risk, rollback, and exact commit candidate.
- Commit implementation and evidence separately where practical.

### Task 6 — Independent exact-commit review

- Reviewer reads the approved design, this plan, exact diff, tests, and security evidence.
- Reviewer reruns focused and full tests independently.
- Reviewer reports `PASS`, `CHANGES_REQUIRED`, or `BLOCKED` with P0/P1/P2/P3 counts.
- Any requested change returns to implementation and requires a fresh exact-commit review.

## Security verification plan

### SECURITY_SCOPE

- Data: static public templates plus opaque in-memory run/route keys and timestamps.
- Boundaries: untrusted model output, hook events, plugin config, OpenClaw route context, channel adapter, external message platform.
- Write capability: status message only to the current exact route.
- Cost: default maximum two automatic messages per run.
- ASVS: not applicable; no Web/API endpoints or authentication surface.

### OWASP 2025 evidence targets

- A01: route/account/thread/run negative tests.
- A02: config bound/default/opt-out tests and runtime inspection.
- A03: package inventory, dependency audit, license/source review, secret scan.
- A04: `NOT_APPLICABLE_WITH_EVIDENCE`; no new cryptography or secret storage.
- A05: static-template tests and malicious prompt/tool fixture non-interpolation.
- A06: concurrency, dedupe, timer race, state saturation, and maximum-message invariants.
- A07: `NOT_APPLICABLE_WITH_EVIDENCE`; authentication remains OpenClaw-owned.
- A08: clean Git commit, package file list, artifact hash if packed.
- A09: safe bounded logs with no content/secrets/paths.
- A10: adapter load/render/send failure, null identity, timer cancellation, restart-equivalent state reset, and unknown-delivery tests.

### AI security overlay

- Prompt injection cannot select a destination, change automatic templates, reveal hidden reasoning, or cause retries.
- Model-authored status text retains normalization and length limits.
- No status behavior grants additional tools or permissions.

## Commit plan

- Commit 1: approved design (already `e4ad1e2`).
- Commit 2: implementation and tests.
- Commit 3: documentation/security closeout and any review-driven fixes, if needed.

No commit may contain credentials or generated local state.
