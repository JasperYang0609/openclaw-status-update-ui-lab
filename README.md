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
- Use the installed Discord bot name in the card title when available, so the UI adapts for each customer.
- Do not store message ids.
- Do not edit previous messages.

## Safety baseline

Status updates must not expose:

- hidden chain-of-thought
- raw commands
- secrets / tokens / keys
- sensitive local paths
- private customer data beyond the requested task context
