---
name: notes
description: Use when the user asks you to write, save or keep a note ("note this down", "save these steps for later", "keep that as a note") — via `wsh note add`.
---

# Writing a note for the user

A note is markdown the user reads later from Ctrl+P, Notes scope. It stands alone, so it must make sense
without this conversation: give full commands, paths and the reason for each step.

- `wsh note add "<title>" --body "<markdown>"` — the title is one line of at most 200 bytes.
- For a body longer than a line, read it from stdin with `--body -`:

  ```
  wsh note add "<title>" --body - <<'EOF'
  ## Steps
  1. `cd path/to/repo` - why
  EOF
  ```
- `wsh note list` — id and title, newest day first. `wsh note show <id>` prints one.
- `wsh note delete <id>` removes one.
- There is no edit command: the user edits a note in the palette.

Rules:
- Write a note only when the user asks for one. Never on your own, not even when handing over steps.
- Do not delete a note unless the user asks.
