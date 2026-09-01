# Status Update UI Lab v0.3.0 Runtime Enforcement Design

Date: 2026-09-01  
Status: proposed for Jasper review  
Target release: `v0.3.0`

## 1. Decision

Upgrade Status Update UI Lab from a callable-tool-only plugin to a hybrid runtime-enforced status system.

For every channel-originated assistant turn with a valid delivery route, the plugin will:

1. Send one concise start card before the model begins normal work.
2. Inject stable system guidance that the runtime already sent the start card and that later cards are only for meaningful phase, blocker, strategy, verification, or recovery changes.
3. If a single non-status tool call is still running after the configured wait threshold, send at most one automatic waiting card for that run.
4. Keep the final answer as an ordinary assistant message.
5. Fail open for the final answer if status delivery is unavailable or uncertain; never retry an unknown platform delivery and never block the user's result solely because a progress card failed.

This removes the current dependency on a model remembering to call `status_update_ui` early, while preserving meaningful model-authored phase updates.

## 2. Problem and success criteria

### Confirmed current behavior

- `v0.2.2` registers `status_update_ui` but no plugin lifecycle hooks.
- Installing the plugin only makes the tool available. It does not force the model to invoke it before work.
- `scripts/install_agent_hook.py` is a separate manual step and currently requires only one card somewhere in the turn; it does not enforce early delivery or tool-wait coverage.
- The Ansai deployment has additional workspace and Discord-guild system instructions, so it behaves more aggressively than a plugin-only customer installation.

### Success criteria

- A channel-originated turn with a valid route attempts its first card before the initial model call.
- A short pure-text turn still gets exactly one automatic start card unless a route is unavailable.
- A non-status tool running longer than the configured threshold gets one automatic wait card, not a fixed repeating heartbeat.
- A fast tool does not get an automatic wait card.
- Model-authored phase cards remain available and are not replaced by generic automatic text.
- Final answers remain normal messages and are never wrapped as status UI.
- `/new`, `/reset`, model changes, Gateway restart, and fresh Sessions do not remove enforcement.
- Cron, heartbeat, background, subagent, or route-less runs do not leak cards into an unrelated conversation.
- Unknown delivery outcomes remain fail-closed against duplicate sends, matching v0.2.2 safety behavior.

## 3. Approaches considered

### A. Stronger README and `AGENTS.md` prompt only

Lowest implementation risk, but still model-dependent. A model can comply late, forget after a model switch, or interpret “at least once” as “before final.” This does not solve the reported issue.

### B. Runtime prompt injection only

More consistent across resets and customer workspaces, but still asks the model to make the first tool call. It improves compliance without guaranteeing early visibility.

### C. Hybrid runtime enforcement — selected

The plugin sends the first and long-tool-wait cards deterministically, while prompt guidance reserves model calls for meaningful updates. This provides an early visible signal without turning the plugin into a noisy fixed heartbeat system.

Trade-off: `v0.3.0` adds lifecycle behavior and therefore needs broader regression coverage than the current single-tool plugin. The delivery operation remains bounded, route-scoped, and non-blocking to the final answer.

## 4. Architecture

### 4.1 Components

- `src/turn-enforcement.js`
  - Owns turn/run state, bounded cleanup, wait timers, and safe automatic messages.
  - Stores only opaque run/session/route identifiers and timestamps in memory.
  - Never stores prompt text, conversation messages, tool parameters, tool results, secrets, or customer content.
- `before_prompt_build` hook
  - Confirms the turn is channel-originated and a current delivery route can be resolved.
  - Sends the automatic start card once per run.
  - Adds static `appendSystemContext` guidance for meaningful later updates.
- `before_tool_call` hook
  - Ignores `status_update_ui` itself.
  - Starts a one-shot waiting timer for other tools.
- `after_tool_call` hook
  - Cancels a pending waiting timer when the corresponding tool finishes.
  - Preserves the run-level “wait card already sent” flag so only one automatic wait card can be emitted per run.
- Existing `status_update_ui` tool
  - Continues to deliver model-authored status cards.
  - Marks progress time in the run state but does not alter final-answer delivery.
- Existing delivery guard
  - Prefers `runId` over `sessionKey` when both are present so identical automatic text in two consecutive turns is not incorrectly suppressed.
  - Keeps route, account, target, thread, and session/run isolation.

### 4.2 Turn flow

1. OpenClaw creates a run and calls `before_prompt_build`.
2. The plugin resolves a safe current route from hook context.
3. The plugin attempts the automatic start card using the existing delivery pipeline.
4. The hook returns static prompt guidance stating that the initial card has already been attempted and immediate duplicate status is unnecessary.
5. The model may send additional status cards only when phase/evidence changes.
6. Before a non-status tool starts, the plugin schedules a one-shot wait card.
7. If the tool finishes first, the timer is cancelled. If the threshold is reached first, one waiting card is sent.
8. The ordinary final reply is delivered normally.

## 5. Configuration

Add these validated plugin settings:

- `enforcementMode`: `"off" | "prompt" | "hybrid"`; default `"hybrid"` in `v0.3.0`.
- `autoStartMessage`: default `狀態更新：已收到任務，正在確認範圍並開始處理。`
- `autoWaitAfterMs`: default `15000`; allowed range `5000`–`60000`; `0` disables the automatic wait card.
- `autoWaitMessage`: default `狀態更新：目前仍在等待這個步驟完成；完成後會立即驗證結果並繼續。`
- `turnStateMaxEntries`: default `1000`; allowed range `100`–`10000`.
- `turnStateTtlMs`: default `600000`; allowed range `60000`–`3600000`.

Automatic messages are static operator-controlled strings. They must not interpolate user prompts, tool inputs, paths, errors, model reasoning, or external content.

`prompt` mode keeps automatic system guidance but does not auto-send cards. `off` preserves callable-tool-only behavior for operators who intentionally opt out. The major-version behavior change is documented prominently in release notes and rollback instructions.

## 6. Route and scope rules

Automatic delivery is allowed only when all of these are true:

- Hook context identifies a channel/message provider.
- A concrete current target can be resolved from hook context or the Session key.
- The run has a stable `runId` or a safe Session fallback identity.
- The route is not a background-only, cron-only, heartbeat-only, or route-less execution.

If any condition is uncertain, automatic delivery is skipped. The model may still use the callable tool if a later context exposes a valid route.

The plugin does not create new external destinations, discover recipients by display name, or fall back to a different channel.

## 7. Failure handling and idempotency

- Rendering failure before platform I/O may use the existing plain-text fallback.
- A dispatch exception, missing delivery result, or missing message identity after platform I/O remains an unknown outcome. No retry or fallback is attempted.
- Duplicate keys include account, channel, target, thread, run/session identity, and message.
- Concurrent start-hook execution for one run coalesces to one delivery attempt.
- Timer callbacks re-check run state and route ownership before sending.
- State saturation fails closed for additional automatic cards but does not block normal tools or the final reply.
- Gateway restart discards in-memory timers. The next new run recreates state; no stale timer is replayed.

## 8. Installation and upgrade behavior

The installation documentation and helper will become a complete deployment gate rather than a loose recommendation:

- Install and enable the plugin.
- Allow callable tool `status_update_ui`.
- Verify runtime hook registrations with `openclaw plugins inspect status-update-ui-lab --runtime --json`.
- Verify effective tool ownership with the existing static/session preflight.
- Install/update the marker block in the active agent instruction file as defense in depth.
- Restart the actual Gateway process serving the customer channel.
- Run fresh-Session acceptance tests before declaring the customer installation complete.

Per-guild manual system prompts are no longer required for baseline enforcement. Operators may keep stricter guild guidance, but it must not instruct the model to duplicate the automatic start card.

## 9. Acceptance tests

### Unit and deterministic hook tests

- One start attempt per `runId` under sequential and concurrent hook calls.
- Consecutive runs in the same Session both receive a start attempt.
- Route, account, target, thread, and Session/run isolation.
- No route, background trigger, cron trigger, heartbeat trigger, and subagent without bound delivery route all skip safely.
- Fast tool cancels its timer before delivery.
- Slow tool sends one wait card.
- Multiple slow tools in one run still send at most one automatic wait card.
- `status_update_ui` does not schedule a wait card for itself.
- Unknown delivery is not retried.
- State TTL and capacity are bounded and deterministic.
- Prompt guidance contains no prompt/tool/customer content.

### Package and runtime tests

- Existing title, identity, fallback, dedupe, and capability tests remain green.
- Syntax check, package contents, secret scan, and dependency audit pass.
- Runtime inspect shows `before_prompt_build`, `before_tool_call`, and `after_tool_call` registrations.
- Fresh `/new` short-text smoke: start card appears before the final answer.
- Long-tool smoke: start card appears immediately and one wait card appears after threshold.
- Tool-error smoke: automatic cards do not expose raw errors or paths; final answer still reports the safe result.
- Gateway-restart smoke: a new Session retains enforcement.
- Two-channel smoke: no cross-channel or cross-thread delivery.

## 10. Security scope and threat model

### SECURITY_SCOPE

- Data classification: public status templates; operational run/route identifiers; no message bodies retained.
- Trust boundaries: model output, hook events, channel adapter, Discord/platform delivery, plugin config, and OpenClaw Gateway.
- Roles and tenants: operator-configured plugin; route/account/thread isolation is mandatory.
- External services and costs: existing configured channel only; at most two automatic cards per run under default behavior.
- AI tools and writes: plugin writes progress messages only; it cannot alter files, permissions, billing, deployments, or customer data.

### Primary abuse and failure cases

- Cross-channel or cross-thread status leakage.
- Prompt/tool content leaking through automatic messages or logs.
- Duplicate storms from concurrent hooks, unknown delivery, or timers.
- Timer/state memory growth causing Gateway degradation.
- Status-delivery failure blocking a valid final answer.
- Prompt injection attempting to change automatic destinations or reveal hidden reasoning.

### Controls

- Static automatic templates; no untrusted interpolation.
- Exact route scoping and fail-closed route uncertainty.
- Bounded state, one-shot timers, run-level dedupe, and unknown-delivery suppression.
- No external destination selection by model content.
- Status failures fail open only for the normal final response, not by retrying uncertain writes.

## 11. OWASP Top 10:2025 implementation plan

- A01 Broken Access Control: verify route/account/thread isolation and no destination override from model input.
- A02 Security Misconfiguration: validate config bounds, default hybrid mode, install preflight, and Gateway restart requirement.
- A03 Software Supply Chain: retain pinned package provenance, package-content inspection, dependency audit, license review, and secret scan.
- A04 Cryptographic Failures: `NOT_APPLICABLE_WITH_EVIDENCE`; plugin introduces no cryptography or secret storage. Existing channel authentication stays owned by OpenClaw.
- A05 Injection: prove automatic templates never interpolate prompts, tool inputs/results, paths, or errors.
- A06 Insecure Design: test duplicate storms, capacity saturation, timer races, unknown delivery, and cross-run behavior.
- A07 Authentication Failures: `NOT_APPLICABLE_WITH_EVIDENCE`; plugin does not authenticate users and accepts only the current OpenClaw route context.
- A08 Software/Data Integrity: verify release artifact contents/hash and clean committed source.
- A09 Logging/Alerting Failures: logs contain bounded operational outcomes only, with no message bodies, secrets, or sensitive paths.
- A10 Exceptional Conditions: test adapter load/render/send failures, null delivery results, timer cancellation, restart, capacity, and concurrent calls.

AI security overlay is required. Prompt injection cannot choose status destinations or automatic content. The callable tool continues to normalize and length-limit model-authored text.

ASVS v5.0.0 is not applicable because this plugin exposes no Web/API authentication or application endpoints. Equivalent controls are the OpenClaw plugin-hook contract tests, channel route isolation tests, delivery fault tests, and package provenance checks above.

## 12. Rollout and rollback

Rollout sequence:

1. Implement and review on a feature branch.
2. Run deterministic tests and local runtime inspection.
3. Install candidate on the Ansai Gateway and run isolated fresh-Session smokes.
4. Publish only after independent review reports no open P0/P1 findings.
5. Update the canonical OpenClaw client onboarding checklist.
6. Upgrade one customer as a controlled canary and verify short/long/error/restart cases.

Rollback:

- Set `enforcementMode` to `prompt` or `off` and restart Gateway for immediate behavior rollback.
- If the plugin itself regresses, reinstall the pinned `v0.2.2` artifact and restore its matching config.
- Do not delete customer Sessions, Discord messages, or unrelated configuration during rollback.

## 13. Out of scope

- Editing previously sent status cards.
- Persisting status state across Gateway restarts.
- Repeating fixed heartbeats indefinitely.
- Reading or summarizing user prompts for automatic card text.
- Blocking the final answer because a progress card failed.
- Sending status to a fallback recipient or alternate channel.
- Deploying the candidate to a customer before local tests, independent review, and explicit deployment approval.
