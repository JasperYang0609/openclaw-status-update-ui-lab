#!/usr/bin/env python3
"""Install or update the status-update-ui-lab agent hook."""

from __future__ import annotations

import argparse
from pathlib import Path

START = "<!-- status-update-ui-lab:start -->"
END = "<!-- status-update-ui-lab:end -->"
BLOCK = f"""{START}
Status Update UI Lab runtime attempts the initial progress card automatically for eligible channel turns. Do not duplicate that initial card.

Use `status_update_ui` only when there is a meaningful phase change, blocker, strategy change, verification step, recovery, or new evidence. Keep updates event-based, short, specific, and safe. For a long-running step, the runtime may send one automatic waiting card; do not add fixed heartbeat spam.

Final conclusions remain plain text replies, not UI cards. Do not use `status_update` unless `status_update_ui` is unavailable or fails.

Status cards must not expose hidden chain-of-thought, message bodies, raw commands, tool parameters/results, secrets, or sensitive local paths.
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
