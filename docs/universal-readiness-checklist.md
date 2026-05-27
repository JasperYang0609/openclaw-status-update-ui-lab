# Universal Readiness Checklist

Goal: make `status-update-ui-lab` safe and usable across customer installs, without requiring Discord-only assumptions.

Rules:

- Finish and test one step before starting the next.
- UI cards are progress-only; final assistant replies remain normal text.
- No secrets in logs or returned tool output.
- If a capability is unavailable, fallback gracefully instead of failing the user task.

## Step 1 — Universal title fallback

Status: TODO

Requirements:

- Do not hard-code `OpenClaw 正在處理` as the default visible title.
- Support `title` override.
- Support `titleTemplate` such as `{name} 正在處理`.
- Use a neutral fallback name when bot identity cannot be resolved.
- Ensure the resolved title is visible in both rich UI and text fallback.

Tests:

- Unit-style title resolver checks for configured title, template, bot name, and unknown fallback.
- `npm run check` passes.

## Step 2 — Multi-source identity resolution

Status: TODO

Requirements:

- Try runtime/context identity fields first when available.
- Try Discord bot username only on Discord.
- Support top-level Discord token, account token, and environment token.
- Never log token values.
- Cache successful Discord bot name lookups.

Tests:

- Mocked resolver tests for context identity, Discord fetch success, Discord fetch failure, and no-token fallback.
- Live local Discord token smoke test must show the current bot username without printing the token.

## Step 3 — Installer/config portability docs

Status: TODO

Requirements:

- Document required plugin config: `plugins.allow`, `plugins.entries`, and `tools.alsoAllow`.
- Document optional title fallback config for customers.
- Document limitations for non-Discord channels.

Tests:

- README contains install/config section.
- No secret examples.

## Step 4 — Graceful failure contract

Status: TODO

Requirements:

- Status UI failure must not break the main task.
- Rich presentation send failure falls back to text send.
- Text send failure returns a concise tool error.
- Missing route returns a concise tool error.

Tests:

- Mocked send fallback test.
- `npm run check` passes.

## Step 5 — Local install and live Discord verification

Status: TODO

Requirements:

- Install updated plugin locally.
- Restart Gateway.
- `openclaw plugins doctor` passes.
- Live `status_update_ui` card in this thread shows the bot-specific or neutral universal title, not hard-coded `OpenClaw`.

Tests:

- Plugin inspect shows latest version loaded.
- Live message sent successfully.
