#!/usr/bin/env python3
"""Install or update the status-update-ui-lab agent hook."""

from __future__ import annotations

import argparse
from pathlib import Path

START = "<!-- status-update-ui-lab:start -->"
END = "<!-- status-update-ui-lab:end -->"
BLOCK = f"""{START}
Status Update UI Lab runtime attempts the initial progress card automatically for eligible channel turns. Do not duplicate that initial card.

Once a multi-step task is active, use `status_update_ui` before the first substantial execution phase and at meaningful events: phase changes, key findings or blockers, tool failures, strategy or assumption changes, recovery, validation start, and validation result.

Each model-authored card must state the current phase and next action. When strategy, risk, assumptions, verification method, or confidence materially changes, include a concise decision-basis summary without exposing chain-of-thought. If active work has no visible output for about 10–15 seconds, report what is still being checked or awaited and what follows. A visible long-running tool may also receive one runtime waiting fallback around 15–20 seconds. Do not send fixed or materially unchanged heartbeat messages.

Recommended shape: `狀態更新：目前在查／改／測 XXX；發現／卡點是 YYY；決策調整為 ZZZ；下一步 WWW。` Omit clauses that do not apply, but retain the current phase and next action.

Final conclusions remain plain text replies, not UI cards. Do not use `status_update` unless `status_update_ui` is unavailable or fails.

Status cards must not expose hidden chain-of-thought, message bodies, raw commands, tool parameters/results, secrets, private content, or sensitive local paths.
{END}
"""


def install_hook(path: Path) -> str:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    start_idx = text.find(START)
    end_idx = text.find(END)

    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        end_idx += len(END)
        new_text = text[:start_idx].rstrip() + "\n\n" + BLOCK + text[end_idx:].lstrip("\n")
        action = "updated"
    else:
        prefix = text.rstrip()
        new_text = (prefix + "\n\n" if prefix else "") + BLOCK
        action = "added"

    if not new_text.endswith("\n"):
        new_text += "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding="utf-8")
    return action


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install the status-update-ui-lab hook into AGENTS.md or equivalent."
    )
    parser.add_argument(
        "path",
        nargs="?",
        default="AGENTS.md",
        help="Target instruction file (default: AGENTS.md)",
    )
    args = parser.parse_args()
    target = Path(args.path).expanduser()
    action = install_hook(target)
    print(f"status-update-ui-lab hook {action}: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
