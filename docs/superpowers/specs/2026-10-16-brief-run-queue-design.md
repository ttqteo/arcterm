# Brief run queue — design

**Date:** 2026-10-16
**Status:** design agreed, not built

## Problem

A plan queued with `wsh runs start --queue` or `--after <run>` waits in the run queue (`pkg/runqueue`,
`runqueue.json` in the data dir) until there is room and its After run has landed. The only place that draws the queue
is the Agent tree, one row per entry in its project's folder, and that row names only what it waits on. Nothing shows
the other direction: a running run's row and its sheet never say a plan waits on it, and a chain A ← B ← C is drawn
as three unrelated rows. Jarvis's Brief, where the person reads every run at once, does not read the queue at all: its
Runs region is built from the live runs and the direct agents only (`sessionWindow`, `briefrows.ts:455`).

Once an entry starts, the link is gone: the entry leaves the queue, and the `Run` it becomes has no field that says
what it waited on (only a `queued-start` run event with the entry id, `wshserver_runqueue.go:242`).

## Decision

The Brief's Runs region draws the queue as part of the runs: **a queued plan sits under the run it waits on**, one
level deeper per link of a chain, and a plan that waits only for room sits at the end of Runs. A queued row opens a
small **queue sheet** with what it waits on and its actions. A run started from the queue **remembers what it started
after**, and its sheet says so.

## Rows in Runs

A pure `queuedBriefLines(entries, drawnRunLines)` in `briefrows.ts`, fed by `runQueueAtom` (live through
`runqueue:changed`), turns each entry into a `BriefLine`:

| Field | Value |
|---|---|
| `kind` | `↳ queued` when nested, `⏸ queued` at the top |
| `title` | the entry's title |
| `meta` | `after it lands` when nested; `after <title>` when its parent is not drawn; `waiting for room` |
| `state` | `#N` (its place among the waiting entries, as the Agent tree counts it); `blocked` in the warning tone, the reason in its tooltip |
| `parentOref` | `run:<after>` when After names a run; the queued line of the entry it names when After names an entry |
| `target` | `{ queued: <entry id> }` |

- **Order.** A nested row follows its parent (and the parent's earlier nested rows); `settleNesting` sets the depth, so
  a chain nests one level per link. Room-only entries follow every run, in queue order.
- **A parent not drawn** (filtered out, folded as stale, gone): the row stands at the top and its meta names the
  parent's title, which `queuedRows` already resolves (`runqueuemodel.ts`).
- **The run-kind toggle** reads the entry's `data.mode`, as a run row reads `run.mode`: an entry can be a quick run.
- **The cap and the fold** do not apply: a queued row is not active work, and hiding the line-up behind `+N more`
  defeats it. `ACTIVE_CAP` counts runs and agents only.
- **`j` / `k`** walk queued rows like any row.
- An empty queue leaves Runs as it is today.
- When an entry starts, its row leaves and its run's row arrives through the usual Runs path. No animation.

## The queue sheet

A queue entry is not an `ActiveSubject` and does not become one (it would reach the subject store, restore and the
palette). The row's `LineTarget` is `{ queued: entryId }`; the Brief keeps the open entry in its own atom, and
`sheetFace` gains `{ kind: "queued"; entryId }`. Opening any other row clears it.

The sheet, in the run sheet's frame, top to bottom:

- **Header:** title and a state chip: `Queued #2`, `Waiting on a run`, or `Blocked` (warning tone).
- **Waits on:** the parent's title and stage (`Office Needs you Board · working 2/5`), a link to its sheet; for an
  entry it names, that entry's title, a link to its queue sheet. A room-only entry reads `a free slot (3 of 3
  running)`, from `runs:maxactive` and the active runs.
- **Blocked:** the whole reason, unclipped.
- **Plan:** the plan path, opening the file.
- **Route:** lead and workers, as `queuedTooltip` words them: the models approved at queue time.
- **Queued:** its age, and the session that queued it when that tab is known.
- **Actions:** **Start now**, **Run next** (not at #1), **Remove** (the Agent tree's confirm), each the existing
  `runqueuestore.ts` action.

The lines come from a pure `queueSheetModel(entry, runs, maxActive)` beside the view.

**When the entry starts while its sheet is open,** the sheet becomes that run's sheet. `runqueue:changed` carries only
the new list today, so `RunQueueChangedData` gains `started: [{ entryid, runid }]`, filled by `startQueuedEntry` for
the entry it just started (`leaveRunQueue` already has the run id); every other publish leaves it empty. A sheet whose
entry vanishes with no `started` for it (removed, or the event missed) closes, and the Brief's toast says why:
`Office Floors started` or `Office Floors was removed from the queue`.

## A started run remembers what it waited on

`waveobj.Run` gains `AfterRunId string json:"afterrunid,omitempty"`. `startQueuedEntry` sets it when the entry's After
names a run (an After still naming an entry, which only Start now can start, sets nothing). The run sheet prints one
fact line, `Queued after <title>`, linking to that run's sheet; a run that is gone reads its first 8 characters. Runs
that did not come from the queue, and every run from before this change, print nothing. It says *queued* after, not
*started* after: Start now starts an entry past its After, so the run it waited on may not have landed.

Wire changes (`pkg/wshrpc` types and `waveobj.Run`) are followed by `task generate`; no migration, since `Run` is
stored as JSON.

## Testing

- **vitest**, all pure:
  - `briefrows.test.ts`, `queuedBriefLines`: nests under a drawn run; a chain nests one level per link; a parent not
    drawn puts the row at the top with `after <title>`; room-only entries sit at the end in queue order; a blocked
    row's state, tone and reason; the kind toggle by `data.mode`; queued rows count toward neither `ACTIVE_CAP` nor the
    fold.
  - `briefsheetmodel.test.ts`: the `queued` face, and that another row clears it.
  - `queueSheetModel`: waits-on text for a run, an entry and room; Run next hidden at #1; the blocked reason.
- **Go:** a started entry's `runqueue:changed` carries `started` with its run id and a failed start's does not; a run
  started from an entry whose After names a run has `AfterRunId`, and one whose After names an entry has none.
- **CDP scenario `brief-run-queue`**, arranged as `run-queue` is: `runs:maxactive` 1, one `deferstart` run filling it,
  entry A `--after` that run, B `--after` A, C room-only, D blocked. On the Brief it shows A under the run, B under A, C
  at the end with `waiting for room`, D `blocked`; it opens A's sheet and checks its lines and three actions; it presses
  Start now on C and checks the sheet becomes C's run sheet with no After line, then Start now on A and checks A's run
  sheet reads `Queued after` the filling run, and B's row now nests under A's run. Teardown restores `runs:maxactive`
  and removes the entries and the channel.

## Out of scope

A "N waiting" chip on the Agent tree's run row, reordering by drag, a graph of the chains, editing an entry's After
from the sheet, and a toast when an entry only moves place.
