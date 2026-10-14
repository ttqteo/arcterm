---
name: ideas
description: Use when brainstorming, designing or weighing options with the user — record each decision, idea and open question as it comes up, via `wsh idea add`.
---

# Recording a brainstorm's ideas

While you brainstorm, design or weigh options with the user, record what comes up as it comes up. The user reads
the list on the agent's details rail (Ideas), edits, merges and drops items there, and catches up from it after a
long exchange. A line that is not written is lost the moment the conversation moves on.

One line per item, in the language of the conversation, written as soon as it is said:

- **decision** — the user settled something, or you both did. `wsh idea add "<line>" --kind decision`
- **idea** — a direction was floated and is still open to weigh. `wsh idea add "<line>" --kind idea`
- **question** — something was left open and needs an answer later. `wsh idea add "<line>" --kind question`

Rules:
- Run `wsh idea list` first, and again after a long stretch, so you do not repeat an item the list already holds.
- Never batch a turn's ideas into one line: three ideas are three `wsh idea add` calls.
- When the user settles an open question, move it: `wsh idea update <id> --kind decision`, adding
  `--text "<the answer>"` in its own call if the answer changes what the line says. `update` takes exactly one
  action per call.
- Write what you decided or floated, not a transcript of the discussion. A line stands alone and stays short.
- A row that starts `arc:` and says turns have passed since the last idea was recorded is the reminder to catch up:
  list, then add what is missing.

The commands:

- `wsh idea add "<text>" [--kind idea|decision|question] [--by agent|you]` — `--kind` defaults to `idea` and `--by`
  to `agent`. Use `--by you` only for something the user said in their own words.
- `wsh idea list` — id, kind and text of each item not dropped. `--json` adds the dropped ones.
- `wsh idea update <id...> --kind <kind>` — move items to another kind.
- `wsh idea update <id> --text "<text>"` — replace one item's text.
- `wsh idea update <id...> --drop` / `--restore` — drop or restore items.
- `wsh idea update <id> <id> --merge` — merge two or more items into the oldest.
- All of them take `--session <id>` to name the agent session; with none they use the session in this terminal.
