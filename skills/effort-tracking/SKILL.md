---
name: effort-tracking
description: Use when a task is too big for one run, when tracking multi-part work, or when brainstorming a large effort — creates and updates Wave effort trackers via `wsh effort`.
---

# Effort Tracking

Big efforts — a migration, an enablement rollout, a multi-week refactor — are too large for one
Run. Wave effort trackers hold the phase list with statuses, owners, and dated note trails, and the
cockpit's briefing surfaces them as cards with an inline chunk tracker.

## When to create

At design approval (or when a task decomposes into 3+ ordered phases), create one tracker:

```bash
wsh effort create "<title>" --chunk "<phase 1>" --chunk "<phase 2>" [--project X] [--ticket T] [--parent <oid>]
```

Seed chunks from the plan's phase list — one `--chunk` per line is the CLI form of the cockpit's
paste-and-tick list. Ticked lines become `done`; chunks you plan but have not started stay
`pending` (never pre-mark done).

The project defaults to the arcterm project holding the current directory; pass `--project` only when
the effort belongs to another one.

## When the route is still unclear

An effort too foggy to name its phases gets a tracker of decisions first, not build steps:

- **`Decide: <question>`** — one chunk per question you can state precisely now, even if it cannot be
  answered yet. Order it after the decisions it hangs on (`chunk move`).
- **`Fog: <area>`** — one chunk per area you can tell is coming but cannot yet phrase as a question,
  set `deferred` so it still counts as remaining. Do not pre-slice fog into decisions.
- **Resolve one decision per session.** The answer is the done note:
  `wsh effort chunk status <effort> "Decide: ..." done --note "<answer and why>"`. The note trail is
  the decision record; do not copy it elsewhere.
- **A decision waiting on the user is `blocked`** (`--note "needs: <question>"`), so it reaches the
  briefing's attention banner. **Out of scope is `skipped`** with the reason as the note.
- **Graduate fog as answers land:** add the `Decide:` chunks it now yields (`chunk add --at N`), then
  rename or remove the `Fog:` chunk.
- The route is clear when no `Decide:` or `Fog:` chunk is open. Add the build chunks then.

## Command reference

| Command | What it does |
|---|---|
| `wsh effort list [--project P] [--archived]` | efforts: oid, title, status, done/total, active chunk; archived hidden unless `--archived` |
| `wsh effort show <effort>` | full detail: chunks, statuses, owners, note trails |
| `wsh effort rename <effort> <title>` | retitle |
| `wsh effort project <effort> <project\|"">` | set/clear project |
| `wsh effort ticket <effort> <ticket\|"">` | set/clear ticket |
| `wsh effort status <effort> <active\|paused\|done\|archived>` | effort-level status |
| `wsh effort unarchive <effort>` | restore an archived effort to the status it held when archived |
| `wsh effort link <effort> --parent <effort>` / `unlink` | parent link (e.g. sub-migration under the rollout) |
| `wsh effort delete <effort> [--force]` | delete (refuses unless archived or `--force`) |
| `wsh effort advance <effort> [--note "..."]` | active chunk → done; marker moves to the next non-done chunk |
| `wsh effort reopen <effort> <chunk>` | undo an advance (done → active, previous active back to pending) |
| `wsh effort chunk add <effort> "<label>" [--at N] [--owner X] [--due YYYY-MM-DD\|+Nd]` | add a chunk |
| `wsh effort chunk rename <effort> <chunk> "<label>"` | rename a chunk |
| `wsh effort chunk move <effort> <chunk> <at>` | reorder (1-based target position) |
| `wsh effort chunk remove <effort> <chunk>` | remove a chunk |
| `wsh effort chunk status <effort> <chunk> <pending\|active\|done\|deferred\|blocked\|skipped> [--note "..."]` | set a chunk's status |
| `wsh effort chunk note <effort> <chunk> --note "..."` | append an annotation to the chunk's trail |
| `wsh effort chunk owner <effort> <chunk> <owner\|"">` | set/clear the chunk's owner |
| `wsh effort chunk due <effort> <chunk> <YYYY-MM-DD\|+Nd\|"">` | set/clear the day the chunk comes due |
| `wsh effort chunk attach <effort> <chunk> --run <oid> \| --agent <tabid>` | record that a run/agent is working this chunk |
| `wsh effort chunk detach <effort> [chunk] --run <oid> \| --agent <tabid>` | remove a workref |

All read commands accept `--json` for scriptable output. `<effort>` accepts an oid or `effort:<oid>`.
Chunks are always referenced by exact label, never index.

## Ticking conventions

- **Claim a chunk** when you start work on it: `wsh effort chunk attach <effort> "<chunk>" --agent <tabid>`
  (or `--run <oid>` for a run). The cockpit's effort detail shows who is working where.
- **Tick a chunk `done` only when the work is actually complete** — not when you start, not when you
  think you are close: `wsh effort chunk status <effort> "<chunk>" done --note "..."`.
- **Annotate every significant state change** with `--note` — the note becomes the chunk's dated
  trail entry. Status changes auto-stamp; your notes add the why.
- **Advance** moves the active marker: `wsh effort advance <effort>` — use it at completion
  handoffs, or set the next chunk `active` explicitly.
- **Reopen undoes**: `wsh effort reopen <effort> "<chunk>"` when a done chunk turns out not to be.
- **Blocked is a state, not a note**: `wsh effort chunk status <effort> "<chunk>" blocked --note "why"`.
  The briefing's attention banner folds blocked chunks in, so a stuck effort stays visible.
- **A decision to revisit gets a date**: a re-measure, or a call deferred until there is evidence, is a chunk
  with a due day: `wsh effort chunk add <effort> "Re-measure: <what>" --due +14d`, plus a chunk note saying
  what to measure and what each result decides. From that day it waits in the cockpit's Needs you until the
  chunk is done, deferred or skipped, or its date moves on (`wsh effort chunk due`). Nothing runs at the
  date; the person picks it up.
- **Skipped shrinks the denominator**: an effort that finishes by skipping still reads 100%.
- Run↔chunk links detach automatically when the run's evidence seals; session workrefs detach at
  session end. Nothing auto-ticks — completion is always a deliberate action.

## Statuses

`pending` (not started) · `active` (in progress — one at a time) · `blocked` (needs eyes) ·
`deferred` (parked, counts as remaining) · `done` · `skipped` (not doing it).
