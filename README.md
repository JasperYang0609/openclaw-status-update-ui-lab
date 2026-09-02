# OpenClaw Status Update UI Lab

Runtime-enforced UI/UX plugin for OpenClaw task status display.

This repo is intentionally separate from `openclaw-status-update-plugin`.
The original plugin should stay lightweight and broadly usable for customers who only need plain status updates.


## Standalone behavior

This plugin is standalone. Customers do **not** need to install `openclaw-status-update-plugin` first.

- `openclaw-status-update-plugin` provides the lightweight plain-text `status_update` tool.
- This repo provides the UI-wrapped `status_update_ui` tool.
- Install either one depending on the customer experience you want.
- Installing both is allowed, but not required.

## Goal

Explore an optional UI/UX layer for prettier one-shot status messages first. Editable progress messages are deferred until the simple UI wrapper proves useful.

## Non-goals

- Do not modify or destabilize the original `status-update` plugin.
- Do not require every customer installation to use UI task cards.
- Do not depend on permanent storage in the first prototype.

## Initial direction

- Keep the base `status_update(message)` experience simple.
- Prototype a one-shot UI wrapper around the existing status update behavior.
- Do not edit previous messages in v0.1.
- Prefer graceful fallback over hard failure.
- Discord first, but keep a portable text fallback for every channel.


## v0.4.0 behavior

- Eligible user-triggered channel turns get one automatic start-card attempt before model inference.
- A non-status tool that exceeds the configured threshold gets at most one automatic waiting card per run.
- For active multi-step work, the installed guidance requires model-authored cards before substantial execution and on phase, finding/blocker, failure, strategy, recovery, and validation events.
- Model-authored cards state the current phase and next action, plus a concise decision-basis summary when assumptions, strategy, risk, validation method, or confidence changes.
- Around 10–15 seconds of active silence is a prompt to send useful progress, not a fixed heartbeat. Unchanged status is not repeated.
- Automatic text is operator-controlled and never interpolates prompts, messages, tool parameters/results, paths, or errors.
- Cron, heartbeat, background, route-less, conflicting-route, and missing-run contexts skip automatic delivery.
- Status failures never block the normal final answer.

Use UI cards only for in-progress status updates. Final assistant conclusions should remain normal text replies, not UI cards.

## v0.1 proposed behavior

- Keep one status update = one message.
- Wrap the message in a comfortable UI card when the channel supports semantic presentation.
- Fallback to a clean Markdown text card when rich UI is unavailable.
- Use the installed bot/assistant name in the card title when available, with a neutral `助理正在處理` fallback instead of hard-coded OpenClaw branding.
- Do not store message ids.
- Do not edit previous messages.

## Safety baseline

Status updates must not expose:

- hidden chain-of-thought
- raw commands
- secrets / tokens / keys
- sensitive local paths
- private customer data beyond the requested task context


## Install / enable

This plugin is optional and standalone. Install it when you want UI-wrapped in-progress status cards. The original `openclaw-status-update-plugin` is not required.

```bash
openclaw plugins install /path/to/openclaw-status-update-ui-lab
openclaw plugins enable status-update-ui-lab
```

Then allow the tool for the active tool profile and restart Gateway:

```json
{
  "plugins": {
    "allow": ["status-update-ui-lab"],
    "entries": {
      "status-update-ui-lab": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        }
      }
    }
  },
  "tools": {
    "alsoAllow": ["status-update-ui-lab"]
  }
}
```

Both hook permissions are required for v0.4.0:

- `allowPromptInjection` permits the plugin to append one static system-guidance string.
- `allowConversationAccess` permits registration of `before_agent_run`, which OpenClaw classifies as a conversation hook. The implementation reads only trusted account/route/run/Session metadata and never reads or retains `prompt`, `messages`, or `systemPrompt`. Tests use throwing proxies to enforce this boundary.

```bash
openclaw gateway restart
openclaw plugins doctor
```

## Optional config

```json
{
  "plugins": {
    "entries": {
      "status-update-ui-lab": {
        "enabled": true,
        "config": {
          "titleTemplate": "{name} 正在處理",
          "fallbackName": "助理",
          "prefix": "狀態更新：",
          "maxLength": 240,
          "silent": true,
          "style": "presentation",
          "dedupeWindowMs": 30000,
          "guardMaxEntries": 1000,
          "enforcementMode": "hybrid",
          "autoStartMessage": "狀態更新：已收到任務，正在確認範圍並開始處理。",
          "autoWaitAfterMs": 15000,
          "autoWaitMessage": "狀態更新：目前仍在等待這個步驟完成；完成後會立即驗證結果並繼續。",
          "turnStateMaxEntries": 1000,
          "turnStateTtlMs": 600000,
          "turnToolTimerMaxEntries": 64
        }
      }
    }
  }
}
```

Notes:

- `title` is an exact override. If set, it bypasses auto-detected bot names.
- `titleTemplate` uses `{name}` and is preferred for customer installs.
- `fallbackName` is used when no bot/platform identity can be resolved.
- On Discord, the plugin tries to resolve the bot username from the runtime token. It never logs or returns the token.
- On non-Discord channels, rich UI may degrade to a clean text card.
- `dedupeWindowMs` suppresses identical attempts only within the same account, channel, target, thread, and Session. Values are bounded to 1–120 seconds.
- `guardMaxEntries` bounds the in-memory attempt guard. Values are bounded to 100–10,000 entries.
- `enforcementMode=hybrid` enables automatic start and one-shot waiting cards. `prompt` keeps only static model guidance; `off` returns to callable-tool-only behavior.
- `autoWaitAfterMs=0` disables the automatic waiting card. Non-zero values are bounded to 5–60 seconds.
- Turn state is memory-only, bounded, and discarded on Gateway restart.
- Per-run simultaneous waiting timers are separately bounded to 1–1,000 (default 64); overflow skips extra automatic wait cards without blocking tools.
- Automatic waiting cards require the tool call to pass through OpenClaw's typed `before_tool_call` / `after_tool_call` hooks. Provider- or harness-internal tools that OpenClaw cannot observe still receive the static model guidance, but cannot be runtime-timed by this plugin.

## Unknown-delivery safety

Starting with v0.2.2, an adapter error after platform dispatch is treated as an unknown delivery outcome. The plugin does not immediately send a text fallback because the rich card may already be visible. A short, in-process guard also suppresses identical retries from the same Session and route while allowing other Sessions and targets to continue normally.

The guard is intentionally not a durable ledger. Exact reconciliation across Gateway restarts or processes belongs in OpenClaw core delivery infrastructure.

## Usage boundary

Use `status_update_ui` only for in-progress status updates. Final assistant conclusions should remain normal text replies.

Recommended defense-in-depth prompt rule:

```text
Status Update UI Lab runtime 已處理每回合第一張進度卡；不要重複發送。
只有在階段、卡點、策略、驗證或恢復狀態有明顯變更時，才使用 `status_update_ui`。
過程狀態一律優先使用 `status_update_ui`。
不要主動使用 `status_update`，除非 `status_update_ui` 不可用或失敗。
最後正式結論必須用一般文字回覆，不要包成 UI 卡。
```

If the original `status_update` plugin is also installed, keep it as a fallback only. Do not ask the model to use both tools as primary status channels.

## Install-time agent hook

v0.4.0 keeps runtime enforcement and expands the managed marker into the active-progress content contract. The marker remains required defense in depth so model-authored updates stay event-based across model switches and Session resets.

Use the bundled helper:

```bash
python3 scripts/install_agent_hook.py AGENTS.md
```

The helper is idempotent: re-running it replaces only the marker block above. For uninstall, remove the marker block from `AGENTS.md`.

The installed marker block enforces:

- The model does not duplicate the runtime start card.
- Multi-step work reports its current phase and next action before substantial execution and after meaningful changes.
- Findings, blockers, failures, strategy/assumption changes, recovery, and validation start/result produce distinct event-based cards.
- Material decision changes include a concise basis summary without revealing hidden reasoning.
- Active silence around 10–15 seconds may produce a useful update; fixed or unchanged heartbeats are forbidden.
- UI cards are for in-progress status only; final conclusions stay plain text.
- `status_update` is fallback only.
- Cards must not expose chain-of-thought, message bodies, raw commands, tool payloads, secrets, private content, or sensitive paths.

## Maintainer use of Codex

This project is maintained as an OpenClaw ecosystem experiment for status update UI/UX. We plan to use Codex to review pull requests, expand UI fallback tests, check channel compatibility, and turn validated experiments into documented release candidates.

API-assisted maintenance should focus on safe UI behavior, regression tests, accessibility-friendly copy, documentation updates, and release notes. Codex should not be used to expose hidden chain-of-thought, secrets, raw commands, or private customer context in status cards.

## Releases

- `v0.4.0` candidate: adds the active-progress event/content contract, version and marker parity checks, before/after tool-inventory preservation, honest harness-coverage classification, and semantic post-install acceptance evidence. It is not a published release until the separate release gate completes.
- `v0.3.1`: packaging-only patch; the published `.tgz` now includes the test suite so the exact downloadable artifact can rerun `npm test`. Runtime behavior is unchanged from `v0.3.0`.
- `v0.3.0`: adds metadata-only runtime start enforcement, one-shot long-tool waiting cards, bounded per-run state, static prompt guidance, opt-out modes, and explicit hook-permission gates. This release requires OpenClaw `2026.7.1-2` or newer hook fields.
- `v0.2.2`: prevents automatic fallback after ambiguous platform dispatch failures, adds bounded in-process duplicate suppression isolated by Session and route, and adds concurrency/TTL/capacity regression coverage.
- `v0.2.1`: adds capability preflight and universal route/title fallback checks.

## Capability preflight

Run the static contract check after install or upgrade:

```bash
npm run preflight
```

Before relying on the tool in parent and native subagent sessions, check every real session key with the read-only Gateway inventory:

```bash
node scripts/status-ui-preflight.mjs \
  --session-key 'agent:main:discord:channel:PARENT_ID' \
  --session-key 'agent:main:subagent:CHILD_ID'
```

For a complete deterministic check, also supply the actual runtime inspection, installed marker, expected version, before/after effective-tool inventories, and harness classification:

```bash
node scripts/status-ui-preflight.mjs \
  --expected-version 0.4.0 \
  --installed-metadata-json installed-plugin.redacted.json \
  --runtime-inspect-json runtime-inspect.redacted.json \
  --agent-instructions AGENTS.md \
  --effective-before-json tools-before.redacted.json \
  --effective-after-json tools-after.redacted.json \
  --harness-coverage-json harness-coverage.redacted.json
```

The preflight is read-only. It never invokes `status_update_ui` and never sends a message. It fails closed on version mismatch, stale/duplicate marker, missing hooks/permissions/ownership, or removed tools. Harness timing coverage is reported as `SUPPORTED`, `PARTIAL`, or `UNVERIFIED`; it is never inferred from a start card.

After the isolated live smoke, record only sanitized category/timing outcomes in the evidence schema and evaluate it:

```bash
npm run postinstall-check -- customer-evidence.redacted.json
```

Use `docs/postinstall-evidence.example.json` as the schema example. The evaluator rejects card-count-only evidence, missing next actions or decision summaries, sensitive paths, raw commands, credential-shaped text, private-content flags, missing validation categories, duplicate runtime waits, and unsupported harness claims without a tested model-authored fallback. It does not read a Session transcript.

## Upgrade acceptance and rollback

After upgrade, do not declare a customer installation complete until all of these pass in a fresh Session:

- `openclaw plugins inspect status-update-ui-lab --runtime --json` lists `before_agent_run`, `before_prompt_build`, `before_tool_call`, and `after_tool_call`.
- Effective config grants both hook permissions above.
- A short text turn shows one start card before the final answer.
- A tool running beyond the threshold shows exactly one waiting card.
- A tool error exposes no raw error/path in automatic cards and the final answer still arrives.
- A multi-phase task produces a phase/next-step card, a controlled blocker or strategy-change card with a decision summary, and separate validation-start/result cards.
- A Gateway restart and fresh `/new` retain enforcement.
- Two-channel/thread smoke shows no cross-route delivery.
- Deterministic preflight and redacted semantic post-install evidence both pass.

For Codex or another external harness, treat the automatic start card as the hard guarantee. Verify whether that harness exposes nested tool lifecycle events before claiming automatic waiting-card coverage; the injected event-based status guidance remains the fallback when it does not.

Immediate behavior rollback: set `enforcementMode` to `prompt` or `off`, then restart Gateway. Full package rollback: reinstall the last verified release artifact and restore its matching config, marker, and captured tool policy. Do not delete Sessions or messages during rollback.
