# Run handoff lifecycle — design

A plan handed from a session to the engine has a life after the handoff: it may have to wait for room, it runs, it
lands, and the session that wrote it is the one best placed to review the result. Today only the middle part exists.
This spec adds a run queue, a visible link between a session and the runs it started, and a message back to that
session when its run lands.

## Problem

- With four runs going, a session that finishes a plan offers "Arc engine". Picking it starts a fifth run at once;
  not picking it leaves the plan waiting on the person to come back and remember. There is no "start this when there
  is room".
- Two plans that touch the same files should not run side by side, and nothing lets one wait for the other to land.
- A run started from a session (`Run.OriginTabId`, `OriginTranscript`) shows no link to it on the tree since
  5c290e631 removed the nesting; the only reader of the link is `donesuggest.ts`. The session sits idle with a ✓ and
  nobody tells it, or the person, how its run ended.
- The review after a run (against the spec, hand checks, CHANGELOG, initiative chunk) depends on the person
  remembering to ask for it.

## Scope

- In: a persisted queue of run starts with a cap on active runs and an optional "after" dependency; queued rows and
  a session↔run link on the Agent tree; one message to the origin session when its run lands.
- Out: a RAM-based start rule (decided against: a run's RAM at start says nothing about its width ten minutes later,
  and heavy commands already queue on RAM in `pkg/jobqueue`); drag reordering (Run next covers it); queueing
  from the + Run launcher (a person at the launcher starts now); resuming a closed origin session to deliver the
  message; a message when a queued run starts.

## Decisions

### 1. The queue is its own store, not a run status

`pkg/runqueue` holds entries; the engine is untouched. An entry is the `CommandCreateRunData` that `wsh runs start`
would have sent, plus:

| Field | Meaning |
|---|---|
| `Id` | `q-` + 4 hex, its own id space |
| `After` | a run id or a queue entry id, optional |
| `QueuedTs` | when it entered the queue (shown, not used for order) |
| `State` | `waiting` or `blocked` |
| `Reason` | why it is blocked |

The queue's order is the order of the entries in the file: a new entry goes last, Run next moves one first. It is
stored as one JSON file in the data dir (`runqueue.json`), written atomically. No waveobj, so no migration.
When an entry starts it is removed; from then on the run is an ordinary run carrying `OriginTabId`.

A `queued` run status was considered and rejected: every status switch (lineage, attention, runs list, cancel, seal)
would learn it, and `BaseCommit`, set at create, would have to move to start. With a separate store the run is
created at start, so it takes the base and reads the plan as they are then.

### 2. Commands

- `wsh runs start --plan X --queue [--after <id>]` resolves channel, route, initiative and `OriginTabId` exactly as
  a start does, then calls `RunQueueAddCommand` instead of `CreateRunCommand`. The route is fixed at queue time, so the
  models the person approved at the handoff are the ones that run. Prints
  `queued q-3f2a (#2 in line) — starts when fewer than 3 runs are active`.
- `--after` takes a run id or a queue entry id, a unique prefix of either, and implies `--queue`. Pointing at a queue
  entry chains two queued plans before either has a run id.
- `wsh runs list` lists queue entries first, marked `queued #N`, `after <id>` or `blocked: <reason>`.
- `wsh runs start-now <q-id>`, `wsh runs run-next <q-id>` and `wsh runs dequeue <q-id>` are the tree's Start now,
  Run next and Remove.
- The engine handoff in AGENTS.md ("A finished plan offers the engine first") gains a second engine choice,
  **Arc engine, queued**, worded so the person reads it as "the engine, when there is room".

New wshrpc commands (`RunQueueAdd`, `RunQueueList`, `RunQueueStartNow`, `RunQueueRunNext`, `RunQueueRemove`) and a
`runqueue:changed` event; run `task generate` after adding them.

### 3. The scheduler starts one entry at a time

A loop in wavesrv evaluates the queue at startup, on every run status change, on every land change, when an entry is
added, moved or removed, and when `runs:maxactive` changes. One evaluation walks the entries in queue order and starts the
**first** one that is ready, then evaluates again, so it never overshoots the cap:

- **Active runs** are top-level runs (orchestrator and quick; not task, reviewer, stage or lead-spawned child runs)
  whose status is neither `done` nor `cancelled`. A done run whose land is held holds no agents and does not count.
  Runs started from the + Run launcher start at once and count.
- An entry is ready when active runs < `runs:maxactive` (0 = no cap) and, if it has `After`, the target has landed:
  `Land.State == landed`, or `done` with no branch land. A target that is a queue entry is not landed by definition.
- An entry waiting on `After` does not hold up the entries behind it.

An entry becomes `blocked`, and stays so until Start now or Remove, when:

- its `After` run is cancelled, or its land is held for a reason other than `Dirty` (a dirty hold lands by itself
  once the checkout is clean, so the entry keeps waiting);
- its plan file no longer exists at start;
- `CreateRun` fails (the error is the reason).

Start now starts the entry past the cap and past `After`. Run next moves it to the head of the queue, where it still
waits for room (and for its `After`): the way to let one plan go before the others without exceeding the cap. Remove
drops it.

Setting: `runs:maxactive`, default 3.

### 4. Queued rows on the tree

- An entry is a row in its project's folder, right under the project's runs, in queue order. When it starts, it
  becomes the run row in the same place: nothing jumps.
- A clock glyph, the plan's title, and a meta line: `Queued #2`, `After Learned additions`, or `Blocked · <reason>`
  in the warning token.
- Hover shows **Start now** and **Remove**; the context menu has those and **Run next** (left out on the head entry).
  Remove confirms.
- A click shows nothing in the centre (there is nothing to show yet); the tooltip has the plan path, the lead and
  worker route and when it was queued. No new panel (compact by default).
- A blocked entry is also a Needs you item ("Brainstorm ideas did not start: Learned additions was held") with the
  same two actions.

### 5. A session and its runs point at each other without moving

- The origin agent's row gets one small meta line: `→ Setup → Project tab · 3/5`, `→ Queued #2` before it starts,
  `→ merged` or `→ held` after it lands; `→ 2 runs` when there are several. A click focuses the run's row
  (`openTarget`).
- A run's row gets `from Rail chắt lọc…`; a click focuses the origin agent. Left out when the origin tab is gone.
- The origin row is not dimmed: the person may still be talking to it.
- `doneSuggestion` also holds back ✓ Close while a queue entry the agent queued is waiting or blocked; closing the
  session then would leave nobody to tell when the run lands.

The tree reads queue entries through a `runQueueAtom` fed by `runqueue:changed`; the pure placement and meta-line
logic sits beside `agenttreemodel.ts` / `runlineage.ts` with tests.

### 6. The origin session hears how its run ended

**When.** Once, when the run has a final outcome: `Land.State == landed`; `held` with `Dirty == false`; or `done`
with no branch land. Not on cancel (the person usually did it) and not on a mid-run `blocked` (Needs you covers it).

**How.** Server side, through the same path as `AgentsSendCommand`, with `FromORef` the run, so the transcript reads
"sent by run X" and a sleeping session is woken first. If the origin agent is working, the message waits until it
reports idle or waiting, so it never lands in the middle of a turn the person is having. If the origin tab is gone,
nothing is sent. `Run.OriginNotifiedTs` (a JSON field, no migration) records the send; at wavesrv startup a run with
an outcome and no `OriginNotifiedTs` is sent then, and a run with one is never sent twice.

**What.** English, like the engine's other prompts. Landed:

```
[arc] Run 4f2a "Brainstorm ideas" landed: merged into main (5/5 tasks, Final passed, 23 files +812/-140).
Plan: docs/superpowers/plans/2026-10-14-brainstorm-ideas.md
Review it as the session that wrote the plan: check the result against the spec, record anything that still needs
a hand check, make sure user-facing changes have their CHANGELOG line, tick the initiative chunk if one is linked,
then report to the user in a few lines. Do not start another run.
```

Held: the first line says `held: <reason>`, and the instruction is "Diagnose with `wsh runs show 4f2a`. Do not force
the land; propose the fix to the user." The prompt names no repo-specific convention; the session knows those from
its AGENTS.md and memory.

**Cost.** Each message is one turn on the origin session's full context. A long session pays its cache read; that is
still cheaper than a fresh session rereading the spec.

Setting: `runs:wakeorigin`, default true.

## Testing

- Go, `pkg/runqueue`: queue order and Run next; the cap; `After` on a run and on a queue entry; each blocked case, and a dirty hold
  that keeps waiting; Start now past both gates; the atomic file write and reload.
- Go, scheduler: with scripted runs, one start per evaluation, never past the cap.
- Go, message: the text for landed, held and done-without-land; `OriginNotifiedTs` idempotence across a restart; held
  while the origin is working.
- Vitest: queued row placement and meta lines, the `→` and `from` lines, `doneSuggestion` with a queued entry.
- CDP: a `run-queue` scenario injects a fixture with one live run, one queued entry and one blocked entry, and shots
  the project's rows.
