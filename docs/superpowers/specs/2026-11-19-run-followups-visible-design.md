# To review: what runs leave behind, reviewed in one place

Status: design, from the brainstorm `.superpowers/brainstorm/run-followups-visible/` (2026-11-19).
Mockup: `.superpowers/design/run-review-inbox/project/B-strip-sheet.dc.html`.

## Why

Since 369de65d6 (2026-11-13) a run's lead files each open issue on a standing initiative (the run's own, the kind's
bucket such as Hand checks or Stale CDP scenarios, or a topic's bugs-and-polish) instead of making a
"… follow-ups (run X)" initiative per run. Leads file as many issues as before, counted by run id: 11-12 39 chunks
from 12 runs, 11-14 37/9, 11-16 33/8, 11-17 36/11. But the issues now sink into buckets of 90+ open
chunks (Hand checks 94, CDP scenarios 87), and nothing says a new one arrived: Needs you
(`pkg/jarvis/attention.go`) only raises chunks that are due (`chunk-due`) or proposed (`plan-review`). So the person
reviews far fewer of them.

## Goal

The person reviews each issue a run leaves and decides: **do** it (in a run), **drop** it, or **keep it for later**.
They review in one place, grouped by run, whenever they have time. Finishing a run does not interrupt them.

## Design

### Leads file issues as proposed chunks

The lead keeps its filing rule (`pkg/jarvis/leadprompt.go:168`, run-finished wrap-up): same initiative choice, note
an issue that is already there instead of adding it twice, create an initiative only when none fits. One change: a
new issue is added with `wsh effort chunk add <effort> "<issue>" --proposed`, not as pending.

What already exists for proposed chunks:
- They stay out of the initiative's Total (`pkg/jarvisstate/jarvisstate.go:311`) and out of Advance.
- `addChunk` writes a `proposed` note carrying the proposer's Session (`pkg/jarvis/effortops.go:366`).

A note on an existing chunk (the duplicate case) stays a note. It does not make that chunk proposed again.

When no initiative fits, the lead creates one. `wsh effort create` gains `--proposed` (Agent's call), which makes its
`--chunk` chunks proposed and writes the same `proposed` note as `chunk add --proposed`. The prompt's fallback line
uses it. Today `effort create` has no such flag (`cmd/wsh/cmd/wshcmd-effort.go:822-826`).

### Grouping by run

A proposed chunk belongs to the run named in the `Run` field (`run:<oid>`) of its newest `proposed` note. The Session
there is `agent:<tabid>` and never matches `Run.LeadSessionIds`. The field is set through `ownerRunForBlock`
(`pkg/wshrpc/wshserver/wshserver_ctx.go:18`). A run that is a dag child (a worker's or reviewer's run) resolves to
its top-level run, so a run's group holds what its lead, workers and reviewers proposed (Agent's call). A `proposed`
note with no `Run` (an agent outside any run proposing a plan for an initiative) is not run work. It keeps today's
path (below).

### Not raised in Needs you

`planReviewItems` (`pkg/jarvis/attention.go:627`) skips the proposed chunks whose newest `proposed` note names a run.
Those chunks show only in To review. The Jarvis badge, Sidecar and the palette do not count them. Proposed chunks with
no run still raise "N proposed" with Review in Needs you, as today. An initiative whose proposed chunks are all run
work raises nothing.

### The To review strip and sheet (Brief)

The Brief has one compact strip, **To review**, at the top of its main column: "<N> things <M> runs left", the age of
the oldest, and **Review**. With nothing to review, the strip does not show.

**Review** opens a sheet from the right (`springSheet`):
- Header: "To review", the count line, close (Esc).
- Body: one group per run, oldest run first. A group's head is the run's goal, its short id (mono) and its age. Each
  row is one proposed chunk:
  - a tick box: **do**;
  - the chunk's label in full (labels run 2-3 lines);
  - its initiative, in muted text;
  - **Later**: the chunk becomes `pending` on its initiative;
  - **Drop**: the chunk becomes `skipped`.
- Later and Drop fold the row away (`springReveal` to 0). A group with no rows left folds too. Both go through the
  Brief's undo (`briefundo.ts`).
- Footer: "<K> marked to do", **Clear**, and the primary **Start a run with K items**, dimmed at 0.
- Empty: "Nothing a run left is waiting on you."

Motion: the sheet slides on `springSheet`. Rows and groups fold on `springReveal`, with opacity on the Fluid ease at
`durMicro`. Ticking a box does not move anything (the person does it many times a session). The strip appears and
leaves with `springReveal`.

Keyboard: the sheet is a Brief region for the j/k cursor. A key ticks the row under the cursor, keys for Later and
Drop, and Esc closes. Bindings go in `bindings.ts` and `docs/keyboard-shortcuts.md`. Keys must survive Telex (no
brackets).

### Do: one run for the ticked items

**Start a run with K items** opens the run launcher with a goal made from the ticked chunks: each chunk's label and
its initiative, one per line. Picking the run type, route and project is the launcher's as usual.

The launcher sends the ticked chunks, as (effort, chunk) pairs, in the create request (`CommandCreateRunData`, so
`task generate`). wavesrv applies them where it attaches today's one chunk, in `startCreatedRun`
(`pkg/wshrpc/wshserver/wshserver_runs.go:635`). It flips each chunk to `pending` and attaches the run to it, the way
`AttachRunToChunk` (`:642`) does (Agent's call). A run that fails to start leaves the chunks proposed. Seal detaches
the run from each chunk (`:1357`). The builder checks that every run type the launcher offers is sealed, and detaches
for any type that is not where that run ends.

Today a run carries one `EffortRef`. The builder decides whether it becomes a list or the run keeps the first chunk
there and the rest go on as workrefs only. Either way, the run sheet and attention keep naming an initiative for the
run.

A launch that is cancelled changes nothing. The ticks stay until **Clear**.

Projects (Agent's call): an initiative with no project fits any project. The run's project is the one shared by the
ticked items that have a project. When none has one, it is the launcher's pick. Items from two different projects
refuse the start with a line naming them ("Tick items from one project to start a run"), and nothing changes.

### The backlog: one pass

One idempotent command (a `wsh effort` subcommand or a script under `scripts/`) moves chunks to `proposed`.
It picks a chunk only when all of these hold (Agent's call):
- the chunk is `pending`, has no workrefs, and was written on or after 2026-11-13 (its earliest note or
  `chunk-added` event);
- its **label** names the 8-character id of an orchestrator run created on or after that day.

This leaves out chunks that a run only noted (the duplicate case) or worked ("Run finished" notes), and `active` or
`blocked` work. Today that is 56 chunks. When a label names two runs, the newest run takes it.

The pass writes a `proposed` note with that run in its `Run` field, the same shape a lead's `--proposed` writes. So
the grouping and the Needs you skip treat these chunks as run work, and none of them is raised in Needs you. Older
chunks stay as they are. Running it again changes nothing.

## Out of scope

- An agent that pre-sorts the inbox (do / drop / later with a reason). Revisit when To review grows past what one
  sitting clears.
- Run-named initiatives: 369de65d6's rule stands.
- A daily digest or any prompt that interrupts the person.

## Left to the builder

- Where the matching of chunk to run lives (Go, sent with the attention snapshot, or the frontend over the efforts
  and runs it already holds). Proposed chunks whose proposer matches no run stay out of To review.
- `EffortRef` as a list versus workrefs only (above).
- An issue a second run notes on a chunk that is still proposed shows only under the run that proposed it.
- Exact keys, and where the strip sits relative to Waiting.

## Builder's decisions (2026-11-19, autonomous run)

Each settles a point left above, or a gap the code showed.

1. **A proposal's run is one helper.** `jarvis.ProposalRun(c waveobj.EffortChunk) string` returns the `Run` of the
   chunk's newest note whose text is `proposed` (any author; the backlog pass writes one with no Session), "" when it
   has none or the chunk is not `proposed`. `planReviewItems`, the grouping and the backlog pass all read it, so "names
   a run" means one thing. The plan review's `ProposerORef` keeps reading Session as today.
2. **The matching lives in Go, sent with the Brief's state.** `jarvisstate.FetchWorkState` already loads every
   channel's runs and every effort, so `WorkState` gains `RunReview []RunReviewGroup`, computed by a pure
   `jarvisstate.RunReview(efforts, runs)`. The frontend holds no run index that reaches old runs. An engine child
   run (`TaskId`, `Review` or `StageRole` set) resolves to the run with the same `DagORef` that has none of the three;
   any other run, a lead's `wsh jarvis run` child (`ParentLeadORef`, which owns its own dag) included, is its own
   group. A run id that matches no run is left out, as the spec says. Only `active` and `paused` initiatives count, as in `planReviewItems`.
   Group: run id, channel id, goal, created ts, and its items oldest proposal first; groups oldest run first. Item:
   effort oid, effort title, effort project, chunk label, proposed ts.
3. **`EffortRef` stays one chunk; the rest are workrefs.** A run with ticked chunks keeps the first one in
   `Run.EffortRef` (unless the request named its own `EffortOID`), so the run sheet, attention and every other reader
   of `EffortRef` stay as they are. The chunks a run holds are its workrefs, the one source of truth for the release.
4. **Ticked chunks are applied after a successful start.** `CommandCreateRunData.Chunks []waveobj.RunEffortRef`.
   CreateRun validates each one up front (effort and chunk exist) with the same errors as `EffortOID`. At the end of
   `startCreatedRun`, once the plan or first worker started (a deferred start counts), wavesrv flips each
   `proposed` chunk to `pending` and attaches the run, one effort batch per effort, synchronously, logging a failure
   without failing the start. A start whose run is cancelled or never persisted (a refused plan, a landing tree that
   failed, a validation error) applies nothing, so its chunks stay proposed. A quick run whose first spawn fails stays
   persisted, blocked and retryable: it holds its chunks (they are applied in that branch too), so a retry works them
   and a cancel releases them. A queued start carries the chunks in its stored create data and applies them when it
   really starts. The chunks never go through `startCreatedRun`'s `effortRef` argument: the first one only becomes
   `run.EffortRef`, so the existing early goroutine attach (for a request's own `EffortOID`) never touches them.
5. **One run may hold several live chunks of one effort.** `ApplyEffortOpsAs` validates every op against the
   effort as it was before the batch, so one batch that attaches a run to two chunks of one effort already passes
   `attachWork`'s one-live-chunk check, and the chunks are applied exactly once. No change to `effortops.go`; a later
   lone attach of that run to another live chunk is still refused.
6. **The release runs wherever a run ends.** One `releaseRunChunks(ctx, run, logPrefix)` in wshserver: it detaches
   the run from every chunk on every effort that holds its workref (`jarvisstate.DetachRunEverywhere`), and for a done
   run leaves the "Run finished" note on each of those chunks (the single-chunk note today, now one per chunk). Both
   seal paths call it (`sealDoneRunEvidence`, which today never detaches, and `SealRunEvidenceCommand`), and so does
   `CancelRunCommand` on both its exits, the dag owner's (`orchestrate.Cancel`, the path an orchestrator run takes)
   and the plain one (detach only: a cancelled run finished nothing, and its chunks stay pending on their initiatives). Quick and orchestrator runs, the two the
   launcher offers, both end in one of those.
7. **`effort create --proposed`** sends `Proposed` and `SourceBlock` on `CommandEffortCreateData`; the server derives
   the author as `noteAuthorFor` does and gives each seeded chunk status `proposed` and a `proposed` note.
8. **The backlog pass is `wsh effort backfill-proposed`** over a new RPC `EffortBackfillProposedCommand`, with the
   pure pick `jarvis.PickBacklogProposals(efforts, runs, since)` in `pkg/jarvis`. The cutoff is a constant,
   2026-11-13 00:00 local. A run counts when it is top-level, mode `orchestrator` and created on or after the cutoff;
   a label names it when it holds the run's first 8 id characters with no hex character on either side. A chunk's
   written time is its earliest note, else its `chunk-added` event; a chunk with neither is skipped. The pass writes
   `setChunkStatus proposed` and a note `proposed` attributed `{Who: "agent", Run: "run:<oid>"}`, and prints how many
   chunks on how many initiatives. It is not run at startup: a pending chunk a person adds later that names a run
   must not move. The person runs it once after installing (a hand-check line says so).
9. **Strip and sheet.** The strip sits at the top of the main column, above the Waiting strip (as the mockup draws it).
   Age is the oldest item's proposed ts. Keys, while the sheet is open (Telex-safe: none of s f r x j w a e o d is a
   new key, j/k are the Brief's own): `j`/`k` walk the sheet's rows only, `t` ticks, `l` Later, `Delete` Drop, `Esc`
   closes. Later and Drop go through `briefUndo.schedule` (the row hides at once, the status edit goes out when the
   undo window closes, Undo cancels). `briefUndo` un-hides a key once its commit returns, while the Brief's
   `WorkState` still holds the chunk until its next fetch; so the store keeps a committed key hidden ("settled") until
   a newer snapshot no longer lists it, and drops the key then. Ticks are kept by chunk key in a store atom until
   Clear; a tick whose chunk is no longer in To review is not counted. The footer with no tick reads "Tick what to do,
   then start one run with it." (the board's line).
10. **Start a run with K items** opens the launcher's run door with a prefill: the goal is one line per ticked chunk,
   `- <label> (<initiative title>)`; the shape is quick for one item and orchestrator for two or more (the launcher
   can change it); the project is the shared one, else none. `NewRunPrefill.chunks` carries the pairs, the launcher
   keeps them for that open and sends them on both its start paths (start now and queue). A prefill-less open clears
   them, so a later New never inherits ticked chunks.
11. **Picture and size.** The CHANGELOG line is `<!-- big -->`: the CDP scenario takes the What's new picture
   (`h.whatsnewShot("run-review", …)`), and until that file is committed the line carries `<!-- shot: none -->`.
   No RAM to measure: no new long-lived process.
12. **One place per proposal on the Brief** (fix round). An initiative row's "N proposed" count (the Ideas box and
   every initiative line, `briefrows.ts initiativeLine`) leaves out the chunks To review lists
   (`WorkState.runreview`, by initiative and label), so a run's proposal is decided in To review only. A proposal To
   review does not list (no run, an unknown run) still counts there; a row whose proposals are all in To review shows
   no count. The initiative sheet's own Proposed group is unchanged: opening the initiative still shows all of them.
   Reason: Final's picture showed the same four proposals in the sheet and as "3 proposed" / "1 proposed" in Ideas.
13. **The undo toast covers none of the sheet** (fix round). While the To review sheet is open, the Brief's toast is
   centred in the part of the page left of the sheet, not under the sheet's footer. The What's new picture shows the
   sheet's header (title and count line) whole.

## Verification

- Go tests: the lead prompt names `--proposed` for both `chunk add` and `effort create`. `effort create --proposed`
  writes the `proposed` note. `planReviewItems` skips proposals whose note names a run (a dag child's included) and
  keeps those with none. The backlog pass is idempotent, picks only pending chunks with no workrefs and a label naming
  a run since 2026-11-13, and writes the run on the note. Creating a run with ticked chunks flips them to pending and
  attaches the run. A failed start leaves them proposed. Seal detaches every one.
- Pure model + vitest: grouping by run, oldest first, counts, the empty state, the different-projects refusal.
- CDP scenario: the strip on a seeded Brief, the sheet open with groups, a tick showing the footer count, Later and
  Drop folding a row, an emptied group folding, and the empty state.
- `CHANGELOG.md` line under Added.
