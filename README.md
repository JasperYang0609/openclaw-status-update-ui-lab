# OpenClaw Status Update UI Lab

Experimental UI/UX research repo for OpenClaw task status display.

This repo is intentionally separate from `openclaw-status-update-plugin`.
The original plugin should stay lightweight and broadly usable for customers who only need plain status updates.

## Goal

Explore an optional UI/UX layer for richer task status display, especially Discord editable progress messages.

## Non-goals

- Do not modify or destabilize the original `status-update` plugin.
- Do not require every customer installation to use UI task cards.
- Do not depend on permanent storage in the first prototype.

## Initial direction

- Keep the base `status_update(message)` experience simple.
- Prototype an optional editable-message mode.
- Prefer graceful fallback over hard failure.
- Discord first; other channels can fallback to plain sends.

## Proposed modes

- `send`: existing behavior; every update sends a short status message.
- `edit`: first update sends one progress message, later updates edit the same message when possible.
- `auto`: use `edit` only when the channel adapter supports it; otherwise fallback to `send`.

## Safety baseline

Status updates must not expose:

- hidden chain-of-thought
- raw commands
- secrets / tokens / keys
- sensitive local paths
- private customer data beyond the requested task context
