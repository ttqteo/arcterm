---
name: initiatives
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

Put it under its topic: `wsh effort list --topics` lists the efforts others are linked under (Chat,
Council, …), and `--parent <oid>` files the new one there, where the Brief nests it. Leave `--parent`
out only when no topic fits; a run's follow-ups never go to the top level when one does.

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
| `wsh effort list [--project P] [--archived] [--topics]` | efforts: oid, title, status, done/total, active chunk; archived hidden unless `--archived`; `--topics` keeps only the efforts others are linked under |
| `wsh effort show <effort>` | full detail: chunks, statuses, owners, note trails |
| `wsh effort rename <effort> <title>` | retitle |
| `wsh effort project <effort> <project\|"">` | set/clear project |
| `wsh effort ticket <effort> <ticket\|"">` | set/clear ticket |
| `wsh effort status <effort> <active\|paused\|done\|archived>` | effort-level status |
| `wsh effort unarchive <effort>` | restore an archived effort to the status it held when archived |
| `wsh effort pin <effort> [--replace-oldest]` / `unpin <effort>` | pin to (or unpin from) the Brief's cards, at most 6; at the cap `pin` fails naming the oldest pin, and `--replace-oldest` unpins it to make room. A view preference: no note, no event, the effort's updated time is kept. Archiving unpins |
| `wsh effort link <effort> --parent <effort>` / `unlink` | parent link (e.g. sub-migration under the rollout) |
| `wsh effort delete <effort> [--force]` | delete (refuses unless archived or `--force`) |
| `wsh effort advance <effort> [--note "..."]` | active chunk → done; marker moves to the next non-done chunk |
| `wsh effort reopen <effort> <chunk>` | undo an advance (done → active, previous active back to pending) |
| `wsh effort chunk add <effort> "<label>" [--at N] [--owner X] [--due YYYY-MM-DD\|+Nd] [--proposed]` | add a chunk; `--proposed` leaves it for the person to accept or drop |
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
- **Propose, don't add, what nobody asked for.** Chunks you add on your own (scope you found, a split you
  suggest, a whole plan for an idea) go in with `--proposed`. The person accepts or drops them on your rail; a
  proposed chunk is not progress and `advance` never starts it. Once you have proposed a plan, stop and say so.
- **Skipped shrinks the denominator**: an effort that finishes by skipping still reads 100%.
- Run↔chunk links detach automatically when the run's evidence seals; session workrefs detach at
  session end. Nothing auto-ticks — completion is always a deliberate action.

## In a Claude agent's Chat: write directly for your own work, propose the rest

When the person reads you in arcterm's Chat (a Claude agent they opened, not an agent an Arc run started), what
you do to an initiative splits two ways:

- **Directly with `wsh effort`, as above:** your own work. Progress notes and status on the chunk you hold,
  claiming it, ticking it done. And whatever the person asked you to put in an initiative ("bỏ vào initiative đi",
  "add that as a chunk"): they already decided, so a card would only ask again. Write it, then say in one line what
  you wrote where (a chunk added with no `--proposed`, since they asked for it).
- **Through a card:** anything new, or not yours, that the person did not ask for. A new chunk, a new initiative, a
  note on a chunk you do not hold. Write one fenced block in your reply; Chat draws it as a card the person adds,
  edits or dismisses, and nothing is written until they add it. Do not run `wsh effort chunk add` or `create` for
  these yourself.

Agents an Arc run started (a lead, a worker) keep writing directly: their Chat is not an inbox. So does any agent
whose Chat is not there (pi, codex). Outside Chat the block reads as raw JSON.

The block is the fence `arc-initiative` around one JSON object:

````
```arc-initiative
{"kind": "note", "effort": "<oid>", "chunk": "<exact chunk label>", "text": "<the note>"}
```
````

- `kind` (`"note"`, `"chunk"` or `"initiative"`) and `text` are required: the note, the new chunk's label (200
  characters at most; a longer one is clipped), or, for an initiative, what it is for.
- `effort` is the initiative's oid; left out, the card opens on the initiative you work on. `chunk` is a note's chunk by
  its exact label; left out, it is the chunk you hold. One that does not exist opens the card with that target
  empty, for the person to pick.
- A new initiative also takes `title` (left out, the first line of `text`), `chunks` (its first chunks, an array of
  labels) and `parent` (the oid of its topic, from `wsh effort list --topics`; left out, the topic yours sits under).
- Broken JSON, an unknown `kind` or no `text` leaves the block as plain code, with no card. A field this list does not
  name is ignored.
- **Word a new proposal differently from one the person already handled.** A block is remembered by its content: the
  very same block written again shows as the row it folded into, and the person is not asked twice.

Do not wait on a card. When the person has handled one, the outcome opens their next message, one line per card
in the order they were handled, then a blank line and what they wrote:

- `initiative: added note to <title> (effort:<oid>) › <chunk>`
- `initiative: added chunk "<label>" to <title> (effort:<oid>)`
- `initiative: created initiative <title> (effort:<oid>) under <topic>`
- `initiative: dismissed <note|chunk|initiative> for <title>`

These lines are the outcome, nothing to act on unless the person says so; do not answer them, and do not propose a
card they dismissed again. The oid is there so you can carry on with `wsh effort` (claim the new chunk, say) without
searching. If the person sends nothing more, you never hear, which is fine.

## Statuses

`pending` (not started) · `active` (in progress — one at a time) · `blocked` (needs eyes) ·
`deferred` (parked, counts as remaining) · `done` · `skipped` (not doing it) · `proposed` (your suggestion,
waiting on the person; counts in neither done nor total).
