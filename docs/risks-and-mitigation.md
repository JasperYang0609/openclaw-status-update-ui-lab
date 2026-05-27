# Risks and Mitigation

## P0

### send/edit failures

Risk: status UI failure could interrupt the main task.

Mitigation:
- wrap send/edit in try/catch
- never make status UI failure fatal to the main assistant turn
- return concise warning only when useful

Difficulty: Low

### edit fallback

Risk: editable status message cannot be updated because it was deleted, locked, archived, or permissions changed.

Mitigation:
- try edit first
- fallback to sending a new status message
- update cached message id if fallback send succeeds

Difficulty: Low-Medium

### message id state

Risk: the plugin does not know which message to edit.

Mitigation:
- maintain session/task-scoped in-memory state
- avoid permanent DB for the first prototype

Difficulty: Medium

### concurrent tasks

Risk: two tasks in the same channel overwrite the same status card.

Mitigation:
- key state by session id + conversation route + task id when available
- if task id is unavailable, use current agent turn/run id

Difficulty: Medium-High

### rate limits

Risk: frequent edits/sends hit Discord limits.

Mitigation:
- throttle updates
- dedupe identical status text
- respect Retry-After on 429

Difficulty: Medium

## P1

### gateway restart loses state

Risk: in-memory message id disappears after restart.

Mitigation:
- accept this in v0.1 lab
- next update sends a new status message
- do not introduce DB until UX value is proven

Difficulty: Low-Medium

### platform support differences

Risk: not every channel supports editing messages.

Mitigation:
- adapter capability detection
- `auto` mode fallback to plain send

Difficulty: Medium

### duplicate completion messaging

Risk: final assistant reply and status card both say the same thing.

Mitigation:
- status card: short lifecycle summary
- final reply: actual answer / deliverable / evidence

Difficulty: Low

## P2

### persistent task state

Risk: useful but increases operational complexity.

Mitigation:
- defer until prototype proves value
- if needed, design pluggable storage later

Difficulty: High

### full task-card UI

Risk: scope creep from B into C.

Mitigation:
- keep first lab focused on editable message, not full dashboard cards

Difficulty: High
