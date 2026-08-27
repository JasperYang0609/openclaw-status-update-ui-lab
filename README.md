# OpenClaw Status Update UI Lab

Experimental UI/UX research repo for OpenClaw task status display.

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


## Reply policy

**Every assistant turn must send at least one `status_update_ui` card**, including short tasks and pure-text/conversational turns where no command is executed. Treat this as a required pre-send gate, not a courtesy. Keep the card short, specific, and safe.

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
        "enabled": true
      }
    }
  },
  "tools": {
    "alsoAllow": ["status-update-ui-lab"]
  }
}
```

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
          "guardMaxEntries": 1000
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

## Unknown-delivery safety

Starting with v0.2.2, an adapter error after platform dispatch is treated as an unknown delivery outcome. The plugin does not immediately send a text fallback because the rich card may already be visible. A short, in-process guard also suppresses identical retries from the same Session and route while allowing other Sessions and targets to continue normally.

The guard is intentionally not a durable ledger. Exact reconciliation across Gateway restarts or processes belongs in OpenClaw core delivery infrastructure.

## Usage boundary

Use `status_update_ui` only for in-progress status updates. Final assistant conclusions should remain normal text replies.

Recommended unified prompt rule:

```text
每個 assistant turn 至少 1 張 `status_update_ui`，包含短任務/純文字回合；
內容要短、具體、安全，用來說明當下立場、處理方向或下一步。
過程狀態一律優先使用 `status_update_ui`。
不要主動使用 `status_update`，除非 `status_update_ui` 不可用或失敗。
最後正式結論必須用一般文字回覆，不要包成 UI 卡。
```

If the original `status_update` plugin is also installed, keep it as a fallback only. Do not ask the model to use both tools as primary status channels.

## Install-time agent hook

A plugin alone is not a global middleware. To make the "every turn" rule reliable across model switches and session resets, installation should write a marker block into the target agent instructions (`AGENTS.md` or equivalent always-loaded instruction file).

Use the bundled helper:

```bash
python3 scripts/install_agent_hook.py AGENTS.md
```

The helper is idempotent: re-running it replaces only the marker block above. For uninstall, remove the marker block from `AGENTS.md`.

The installed marker block enforces:

- Every assistant turn sends at least one `status_update_ui` card.
- UI cards are for in-progress status only; final conclusions stay plain text.
- `status_update` is fallback only.
- Cards must not expose chain-of-thought, raw commands, secrets, or sensitive paths.

## Maintainer use of Codex

This project is maintained as an OpenClaw ecosystem experiment for status update UI/UX. We plan to use Codex to review pull requests, expand UI fallback tests, check channel compatibility, and turn validated experiments into documented release candidates.

API-assisted maintenance should focus on safe UI behavior, regression tests, accessibility-friendly copy, documentation updates, and release notes. Codex should not be used to expose hidden chain-of-thought, secrets, raw commands, or private customer context in status cards.

## Releases

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

The preflight calls `tools.effective` only. It never invokes `status_update_ui` and never sends a message. It fails closed when the tool is missing, owned by another plugin, the session is unavailable, or the Gateway query fails. A static-only PASS is not proof that native subagent binding works; supply both parent and child session keys for deployment acceptance.
