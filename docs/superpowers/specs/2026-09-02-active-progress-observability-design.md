# Status Update UI Lab Active-Progress Observability Design

Date: 2026-09-02
Status: approved in conversation by Jasper; written-spec review pending
Baseline: `v0.3.1` plus client parity guide commit `4f8c6197e780dd5d8b79a414371d2a51f5481130`
Target release: `v0.4.0`

## 1. Decision

Improve Status Update UI Lab for tasks that are already executing. Do not add a queue acknowledgement card and do not change OpenClaw queue ordering.

The desired experience is:

- queued work may wait for the current task to finish;
- once a task is active, the user can understand its current phase;
- meaningful findings, blockers, strategy changes, recovery, and verification are surfaced while work continues;
- each progress card states what the agent expects to do next;
- cards expose decision summaries, not hidden chain-of-thought;
- status updates remain event-driven rather than a fixed heartbeat.

The implementation remains hybrid:

1. Runtime enforcement provides a safe automatic start-card attempt and a one-shot wait card for tool calls visible to OpenClaw typed lifecycle hooks.
2. Static system guidance and the installed agent marker require model-authored active-progress cards at meaningful execution events.
3. Installation self-checks verify both the deterministic runtime layer and the model/instruction layer. They must not treat a working start card as proof that active-progress behavior is complete.

## 2. Problem statement

### Confirmed behavior

- `v0.3.x` deterministically attempts a start card in `before_agent_run` for an eligible channel-originated run.
- `v0.3.x` can send one automatic wait card when a non-status tool remains active beyond `autoWaitAfterMs` and the tool is visible through `before_tool_call` and `after_tool_call`.
- Codex and other external harnesses may execute nested tools that are not visible to those OpenClaw typed hooks. The plugin therefore cannot reliably infer every active phase or long tool from runtime hooks alone.
- Customer installations that only load the plugin commonly show a start card and little else. The Ansai workspace feels more informative because its agent instructions separately require event-based updates.
- Generic queue text such as “received and waiting” does not satisfy the user need. The missing information is progress and decision visibility after work has started.

### Observed diagnostic lesson

An inbound message can arrive while a prior run is still active, and Codex can also rotate its native thread when transcript limits are reached. Those conditions can delay the next task's active run. This design does not attempt to change queue semantics or hide that wait with a low-information card.

When the new task actually begins, its progress cards must still be timely and meaningful.

## 3. Success criteria

### Active-task behavior

- Before the first substantial tool batch or execution phase, the agent states the planned method or verification approach when the task is multi-step.
- At every meaningful phase transition, the agent states the new phase and expected next step.
- A critical finding, blocker, risk, assumption change, strategy change, recovery, or validation result produces a new card at the next safe model boundary.
- A tool or phase failure produces a safe summary of the failure location, the selected alternative, and the next action. Raw commands, paths, payloads, stack traces, and secrets are excluded.
- Before validation, the agent states what will be tested. After validation, it states the result and the next disposition.
- If an active phase has no visible output for approximately 10–15 seconds, the agent may report what is still being checked or awaited and what follows. A single long-running tool may receive a waiting update around 15–20 seconds.
- Consecutive meaningful changes should generally be separated by approximately 5–10 seconds when practical. This is a rate ceiling, not a reason to delay important failure or safety updates.
- No unchanged status is repeated merely to satisfy a timer.

### Content contract

Each model-authored active-progress card should include the smallest useful subset of:

1. current phase;
2. confirmed finding, blocker, or changed condition;
3. decision or strategy-change summary and its practical basis;
4. next action or verification step.

Recommended Traditional Chinese shape:

`狀態更新：目前在查／改／測 XXX；發現／卡點是 YYY；決策調整為 ZZZ；下一步 WWW。`

The card does not need all four clauses when some are not yet applicable. It must include the current phase and next action, and it must add the finding or decision clause whenever either changed.

### Non-goals

- No queue acknowledgement card.
- No reordering, interrupting, or parallelizing same-Session work.
- No fixed repeating heartbeat.
- No automatic summarization of inbound user messages.
- No automatic summarization of tool inputs, tool results, prompts, or hidden reasoning.
- No promise that OpenClaw runtime hooks can observe provider- or harness-internal tools.
- No replacement of the ordinary final assistant reply.

## 4. Approaches considered

### A. Runtime-only timers with generic text

The plugin could send a fixed status every N seconds. This provides predictable timing but low information, creates noise, and cannot truthfully describe progress or decisions. Rejected.

### B. Automatic content summarization inside the plugin

The plugin could read user messages, tool payloads, results, or model output to generate dynamic cards. This increases prompt-injection, privacy, data-retention, and false-summary risk. It also expands the plugin's trust boundary far beyond status delivery. Rejected.

### C. Hybrid runtime fallback plus model-authored active progress

Selected. Runtime retains safe static guarantees, while the agent produces meaningful progress and decision summaries from the context it is already authorized to use for the task. Static guidance and installed instructions define the event and content contract. Post-install acceptance verifies actual behavior on the target harness.

Trade-off: active-progress quality remains partly model-dependent, especially under Codex nested-tool execution. The installation gate must report this honestly instead of claiming that typed hooks guarantee all progress updates.

## 5. Architecture

### 5.1 Runtime enforcement

Keep the existing bounded runtime state and route-isolation design:

- `before_agent_run` attempts one static start card for an eligible run;
- `before_prompt_build` injects static active-progress guidance;
- `before_tool_call` and `after_tool_call` provide one-shot timing only for observable non-status tools;
- `status_update_ui` remains the model-authored delivery tool;
- delivery dedupe, unknown-outcome handling, state TTL, capacity, and fail-open final-answer behavior remain unchanged.

The automatic start card is an acknowledgement that the task has begun. It is not evidence that the user has received meaningful progress.

The automatic wait card is a fallback for an observable long-running tool. It is not the primary progress mechanism and must not be counted as a phase, strategy, or validation update.

### 5.2 Static runtime guidance

Replace the current minimal guidance with a concise but explicit active-progress contract:

- do not duplicate the automatic start card;
- for multi-step work, send a meaningful card before the first substantial execution phase without repeating the automatic acknowledgement text;
- send cards on phase transitions, critical findings, blockers, failures, strategy changes, recovery, validation start, and validation result;
- state the current phase and next action;
- include a decision-basis summary when strategy, assumptions, risk, verification method, or confidence materially changes;
- if active work stays silent beyond the target window, explain what is still being checked or awaited and what follows;
- do not expose chain-of-thought, raw commands, paths, secrets, private content, or unredacted tool payloads;
- keep the final answer outside the status card.

The guidance is operator-controlled static text. It must not include the current user prompt, message history, tool arguments, results, or generated summaries.

### 5.3 Agent marker installer

Update the marker installed by `scripts/install_agent_hook.py` to match the runtime guidance and add the content contract.

The marker must explicitly distinguish:

- runtime acknowledgement card;
- model-authored active-progress card;
- runtime observable-tool wait fallback;
- ordinary final reply.

The installer remains idempotent. It replaces only the exact managed marker block and preserves all unrelated `AGENTS.md` content.

### 5.4 Preflight and post-install self-check

Extend deterministic preflight so it can verify:

- repository `package.json` version equals `openclaw.plugin.json` version;
- installed runtime version, install metadata version, and expected release version agree when those fields are available;
- the plugin is loaded and activated;
- required typed hooks are registered;
- `allowPromptInjection` and `allowConversationAccess` are true;
- `status_update_ui` is runtime-effective and owned by this plugin for the target Session;
- the actual agent instruction file contains exactly one current managed marker block;
- the marker includes phase, blocker, strategy, verification, decision-summary, silence-window, next-step, and safety clauses;
- existing tool inventory is captured before and after installation so the report can detect accidental tool loss rather than checking only `status_update_ui`;
- the target harness is identified and automatic wait coverage is classified as `SUPPORTED`, `PARTIAL`, or `UNVERIFIED` instead of assumed.

Add a customer-facing post-install acceptance workflow with two result layers:

#### Deterministic layer

- version and artifact parity;
- plugin runtime and hook registration;
- permissions;
- effective tool ownership and tool-inventory preservation;
- agent marker integrity and idempotency;
- config validation and plugin doctor;
- restart and fresh-Session readiness.

#### Live behavior layer

Run an isolated task that contains multiple phases and record only sanitized timing/category evidence:

- start acknowledgement appears before normal work;
- a planning or phase card states the next step;
- a controlled blocker or failed probe produces a safe failure/strategy-change card;
- validation start and validation result are separately visible;
- an observable long tool produces at most one runtime wait fallback;
- a Codex or external-harness run still produces model-authored active-progress cards even when automatic tool timing is `PARTIAL` or `UNVERIFIED`;
- the final result is an ordinary assistant reply;
- no card contains raw commands, sensitive paths, secrets, private message text, or hidden reasoning;
- no status crosses channel, account, or thread boundaries.

The live layer must never mark `PASS` from card count alone. It validates semantic categories and the presence of a next action.

### 5.6 Expected implementation surface

- `src/turn-enforcement.js`: strengthen the static system guidance while preserving bounded runtime behavior.
- `scripts/install_agent_hook.py`: install the canonical active-progress marker idempotently.
- `scripts/status-ui-preflight.mjs`: add version, marker, tool-inventory, and harness-coverage checks.
- `scripts/status-ui-postinstall-check.mjs`: evaluate redacted deterministic and live-acceptance evidence without reading raw conversation transcripts.
- `tests/turn-enforcement.test.mjs`, `tests/install-agent-hook.test.mjs`, and `tests/capability-preflight.test.mjs`: cover the updated contracts.
- A dedicated post-install test file: cover evidence-state validation, semantic-category requirements, leakage rejection, and `LIMITED` harness reporting.
- README, client parity guide, release notes, and security closeout: document behavior, limitations, installation, acceptance, and rollback.

### 5.5 Evidence format

Self-check output should use explicit states:

- `PASS`: verified from runtime/config/evidence;
- `FAIL`: requirement violated;
- `LIMITED`: target harness does not expose the required lifecycle event but the documented model-authored fallback was tested;
- `NOT_RUN`: live test was not executed;
- `BLOCKED`: a prerequisite prevents safe testing.

Installation is complete only when deterministic checks are `PASS`, required live behavior is `PASS`, and any harness limitation is truthfully reported as `LIMITED` with the fallback test passing.

## 6. Timing and noise policy

- `autoWaitAfterMs` remains a per-observable-tool threshold, not a global status frequency.
- Default runtime wait threshold remains 15 seconds unless implementation evidence supports another value.
- Model-authored active-progress guidance uses approximately 10–15 seconds of active silence as the point to consider a useful update.
- Long waits should be updated around 15–20 seconds only when the card can state what is awaited and what follows.
- Meaningful failures, safety findings, scope changes, and strategy changes should not be held merely to satisfy a minimum interval.
- Identical or materially unchanged text must continue to be deduplicated.
- A run must not emit fixed periodic messages indefinitely.

## 7. Failure handling

- Status delivery failure never blocks the task's ordinary final response.
- Unknown platform delivery is not retried or converted into a fallback send that could duplicate a visible card.
- If instructions are missing, stale, or duplicated, post-install check fails before customer acceptance.
- If runtime and release versions differ, post-install check fails with a version-parity finding.
- If required existing tools disappear after config merge, post-install check fails and instructs rollback rather than broadening policy.
- If the harness does not expose nested tool hooks, the report marks runtime wait coverage `LIMITED`; it does not lower the requirement for model-authored phase, blocker, strategy, and validation cards.
- If active-progress cards leak sensitive content, acceptance fails even when timing and card counts are otherwise correct.

## 8. Installation and upgrade flow

1. Read current OpenClaw version, plugin runtime, install metadata, tool policy, plugin allowlist, and target agent instruction path.
2. Capture the existing effective tool inventory for the target Session.
3. Verify OpenClaw and package compatibility before mutation.
4. Back up current config and agent instructions.
5. Merge only the `status-update-ui-lab` plugin entry and required tool allowance; never replace unrelated allowlists or tool policy.
6. Install or update the managed agent marker idempotently.
7. Validate config, plugin package, runtime hooks, permissions, and exact version parity.
8. Restart the actual Gateway serving the target channel.
9. Create a fresh Session.
10. Re-read effective tools and compare with the pre-install inventory.
11. Run deterministic and live behavior acceptance.
12. Save a redacted report with exact versions, statuses, limitations, rollback point, and evidence references.

## 9. Acceptance matrix

### Unit tests

- static guidance includes all required active-progress event categories and safety exclusions;
- static guidance contains no dynamic prompt/tool/customer interpolation;
- marker installer writes one canonical block and is idempotent;
- marker upgrade replaces the old managed block without touching surrounding content;
- preflight rejects package/manifest/runtime version mismatch;
- preflight rejects missing hooks, permissions, tool ownership, or marker clauses;
- tool-inventory comparison detects removed non-UI tools;
- harness classification cannot silently upgrade `PARTIAL` or `UNVERIFIED` to `SUPPORTED`;
- live-evidence evaluator rejects card-count-only evidence, missing next steps, sensitive content, and missing validation categories.

### Regression tests

- title and identity resolution;
- route/account/thread isolation;
- presentation and text fallback;
- unknown-delivery dedupe;
- concurrent start claims;
- fast/slow/multiple observable tools;
- state capacity and TTL;
- start-delivery timeout;
- package contents and release self-test;
- final-answer fail-open behavior.

### Local and customer canary

- short task;
- multi-phase task;
- controlled blocker and strategy change;
- validation start/result;
- observable long tool;
- Codex or target external harness;
- Gateway restart and fresh Session;
- two-route isolation;
- version-parity and existing-tool preservation.

## 10. Security scope and threat model

### SECURITY_SCOPE

- Data classification: static operator guidance; model-authored status text; opaque run, Session, account, route, thread, timer, and version metadata.
- Trust boundaries: untrusted user content; model output; tool output; OpenClaw typed hooks; plugin configuration; agent instructions; channel adapters; release artifact; customer Gateway.
- Roles and tenants: operator installs and configures the plugin; user receives only route-scoped status; account/channel/thread isolation is mandatory.
- External services and costs: only the already configured channel adapter; no new model call, summarizer, database, or external service is introduced.
- AI tools and writes: the plugin can send status text to the current exact route. It cannot modify application data, permissions, billing, deployments, or external destinations.
- ASVS target: `NOT_APPLICABLE_WITH_EVIDENCE`; this is a local OpenClaw plugin without Web/API endpoints. Equivalent plugin/runtime controls and tests are defined here.

### Threats and abuse cases

- Prompt injection causes the agent to reveal hidden reasoning, tool payloads, paths, secrets, or private content in a card.
- Automatic text generation reads or persists inbound content beyond the task's existing trust boundary.
- Status cards are sent to the wrong account, channel, or thread.
- Repeated timers or model instructions create a message storm.
- Stale installed package or marker text is mistaken for the current release.
- Config merging removes unrelated tools or plugins.
- A Codex harness limitation is misreported as full runtime coverage.
- Unknown delivery creates duplicate sends.
- Status failure blocks the actual work or final result.

### Controls

- No plugin-side summarization of user, prompt, tool, or model content.
- Automatic runtime messages remain static operator text.
- Model-authored text is normalized and length-limited by the existing delivery path.
- Static instructions prohibit hidden reasoning, secrets, raw commands, sensitive paths, and private payloads.
- Exact route isolation and fail-closed behavior on route uncertainty.
- One-shot runtime timers, bounded state, dedupe, and no fixed heartbeat.
- Version parity, marker integrity, tool-inventory preservation, and live semantic acceptance.
- Honest harness coverage states.
- Status delivery always fails open for the normal task result.

## 11. OWASP Top 10:2025 plan

- A01 Broken Access Control: test account/channel/thread isolation, conflicting route metadata, and no model-selected recipient.
- A02 Security Misconfiguration: test config bounds, exact hook permissions, marker integrity, version parity, tool-policy preservation, restart, and fresh-Session behavior.
- A03 Software Supply Chain Failures: verify pinned release source, package inventory, artifact hash, dependency audit, license/provenance review, and package self-test.
- A04 Cryptographic Failures: `NOT_APPLICABLE_WITH_EVIDENCE`; the change introduces no cryptography or secret storage and continues to use OpenClaw's configured channel authentication.
- A05 Injection: prove runtime templates and self-check commands do not interpolate untrusted message/tool content; test model-authored card safety against prompt-injection attempts.
- A06 Insecure Design: test message-storm controls, state/timer bounds, stale-marker/version mismatch, harness overclaim, and tool-policy regression.
- A07 Authentication Failures: `NOT_APPLICABLE_WITH_EVIDENCE`; the plugin does not authenticate users and sends only through the current authorized OpenClaw route.
- A08 Software or Data Integrity Failures: verify clean committed source, package/source parity, exact versions, artifact checksum, and managed-marker upgrade integrity.
- A09 Security Logging and Alerting Failures: logs contain only bounded operational outcomes and coverage states; no status body, prompt, tool payload, secret, or sensitive path is logged by new diagnostics.
- A10 Mishandling of Exceptional Conditions: test delivery timeout/unknown result, missing hooks, stale Session, Gateway restart, unavailable harness events, duplicate marker, malformed evidence, config/tool regression, and rollback.

### Business-logic negative tests

- a second account/channel/thread cannot receive the first route's card;
- repeated identical events cannot create unbounded sends;
- a card count without semantic phase/decision/next-step evidence cannot pass acceptance;
- unsupported harness timing cannot be reported as supported;
- installing the plugin cannot silently remove unrelated tools or plugin allowlist entries;
- queueing a new task does not produce a status card or alter the current task order.

### AI security overlay

- Prompt injection cannot choose the recipient or automatic template.
- Untrusted content cannot be persisted in plugin state or diagnostic evidence.
- Model-authored status text is treated as untrusted output and constrained by length, normalization, static guidance, and live leakage checks.
- No new tool or permission is granted solely to improve status frequency.
- No high-impact external action is added.

## 12. Rollout and rollback

### Rollout

1. Complete written-spec review.
2. Create an implementation plan with file-level tasks, tests, and security evidence.
3. Implement on a feature branch derived from the approved design baseline.
4. Run unit, regression, package, dependency, secret, and security checks.
5. Review exact diff and evidence before any Gateway mutation.
6. Run an isolated Ansai canary with fresh Session and two-route checks.
7. Publish only after release review and explicit Human Gate.
8. Upgrade one customer as a controlled canary and run the full post-install acceptance workflow.
9. Update the canonical OpenClaw client onboarding checklist only after the released artifact and commands are final.

### Rollback

- Restore the previous managed marker block and plugin config backup.
- Set `enforcementMode` to `prompt` or `off` for immediate runtime behavior rollback when needed.
- Reinstall the last verified release artifact if package behavior regresses.
- Restore the captured effective tool policy if installation removed or changed unrelated tools.
- Restart Gateway and verify a fresh Session after rollback.
- Do not delete Sessions, messages, customer data, or unrelated configuration as a rollback step.

## 13. Implementation stop conditions

Stop and return to the Human Gate if implementation would require any of the following:

- reading or summarizing inbound message content inside the plugin;
- persisting prompt, tool, model, status-body, or customer content for automatic generation;
- adding a queue acknowledgement card or changing queue semantics;
- broadening tools, recipients, channel permissions, or plugin permissions beyond the documented hooks;
- fixed indefinite heartbeat behavior;
- claiming automatic Codex nested-tool coverage without reproducible evidence;
- publishing, deploying, restarting a customer Gateway, or mutating a customer environment without separate approval.
