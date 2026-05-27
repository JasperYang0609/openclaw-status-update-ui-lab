# OpenClaw Status Update UI Lab

Experimental UI/UX research repo for OpenClaw task status display.

This repo is intentionally separate from `openclaw-status-update-plugin`.
The original plugin should stay lightweight and broadly usable for customers who only need plain status updates.

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

This lab plugin is optional. Keep the original `openclaw-status-update-plugin` installed for lightweight plain status updates, and install this repo only when you want UI-wrapped in-progress status cards.

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
          "style": "presentation"
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

## Usage boundary

Use `status_update_ui` only for in-progress status updates. Final assistant conclusions should remain normal text replies.
