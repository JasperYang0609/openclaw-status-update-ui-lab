# Active-Progress Observability v0.4.0 Implementation Plan

Date: 2026-09-02
Design: `docs/superpowers/specs/2026-09-02-active-progress-observability-design.md`
Target: `v0.4.0`

## Scope

Deliver meaningful, event-driven progress visibility after an agent task begins. Preserve the existing static runtime start card, bounded observable-tool wait fallback, route isolation, deduplication, and fail-open final response.

This implementation does not add queue cards, periodic heartbeats, plugin-side content summarization, new external services, or automatic deployment.

## Security scope

- Trust boundaries: untrusted user/model/tool content; operator-controlled plugin configuration; installed agent instructions; OpenClaw typed hooks; channel routing; release artifact.
- Data: static guidance, model-authored status text, opaque route/run/version metadata, and redacted acceptance evidence.
- Writes: repository files and local test fixtures only. No customer config, Gateway restart, channel send, release, or deployment is authorized by this implementation task.
- Abuse cases: secret/path/raw-command leakage, wrong-route delivery, fixed-card storms, stale version/marker acceptance, tool-policy loss, and overclaiming harness coverage.
- ASVS: `N/A_WITH_REASON`; the plugin exposes no Web/API endpoint. Equivalent runtime, supply-chain, authorization, and output-safety controls are tested below.

## Work batches

### Batch 1 — Contract and version

- Bump package and manifest to `0.4.0`.
- Strengthen static runtime guidance with phase, finding/blocker, strategy/decision, validation, silence-window, next-step, and safety requirements.
- Upgrade the managed AGENTS marker idempotently while preserving unrelated content.
- Add focused contract tests before implementation changes where practical.

### Batch 2 — Deterministic preflight

- Verify package/manifest/expected/installed/runtime version parity when evidence is supplied.
- Verify current marker uniqueness and required clauses.
- Compare before/after effective-tool inventories and fail on removed tools.
- Classify harness wait coverage as `SUPPORTED`, `PARTIAL`, or `UNVERIFIED` without silent promotion.
- Preserve existing plugin ownership, hook, permission, and effective-tool checks.

### Batch 3 — Post-install evidence evaluator

- Add a standalone customer-facing post-install checker.
- Validate deterministic result states and semantic live categories rather than card count.
- Require start, phase/next-step, controlled blocker or strategy change, validation start/result, ordinary final reply, route isolation, and safety evidence.
- Report unsupported nested-tool timing as `LIMITED` only when model-authored fallback evidence passes.
- Reject raw commands, sensitive paths, secrets, private text, and hidden-reasoning indicators.

### Batch 4 — Documentation and acceptance workflow

- Update README and client parity guide with install, evidence schema, acceptance, limitation, and rollback instructions.
- Add a redacted sample evidence file or schema documentation sufficient for operators to run the checker.
- Add v0.4.0 security closeout with A01–A10 states and reproducible evidence references.

### Batch 5 — Verification and closeout

- Run syntax checks, all unit/regression tests, package inventory/self-test, dependency audit, secret scan, and targeted attacker review.
- Inspect the final diff for scope, secrets, placeholders, and accidental policy broadening.
- Commit implementation and closeout evidence; confirm clean worktree and report exact commit.

## Acceptance register

- A01 PASS target: route/account/thread isolation regressions and no model-selected destination.
- A02 PASS target: exact hooks/permissions, marker integrity, version parity, tool preservation, bounded config.
- A03 PASS target: package inventory, lockfile audit, archive self-test, no new runtime dependency.
- A04 N/A_WITH_EVIDENCE: no cryptography or secret storage introduced.
- A05 PASS target: no dynamic content interpolation into runtime guidance; safe model-output contract and evidence leakage rejection.
- A06 PASS target: no new external request path; existing route resolver and fail-closed uncertainty tests remain green.
- A07 PASS target: no auth mechanism introduced; channel authorization remains OpenClaw-owned and exact-route scoped.
- A08 PASS target: idempotent managed marker, deterministic evidence schema, version/artifact parity.
- A09 PASS target: redacted operator-readable result states without prompt/tool transcript retention.
- A10 PASS target: bounded timers/state, one-shot wait fallback, fail-open status delivery, no fixed periodic loop.

Completion requires all in-scope tests passing, no open P0/P1 findings, a commit hash, and a clean worktree. Publishing or installing remains a separate explicit gate.
