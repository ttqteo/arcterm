# Choosing when a run starts (Run now / After runs / Queue, with Jarvis's suggestion)

From the brainstorm `run-start-choice` (2026-11-16). Every decision below was confirmed by the person.

## Why

Approve on a brainstorm's Builder check opens the run launcher, and so does + Run. The launcher only starts a run now.
The backend can already queue a start (`wsh runs start --queue`, `--after <run>`, `pkg/runqueue`), but no launcher
offers it, so a run that touches the same code as a live run starts anyway and its land is later held on a conflict
(`pkg/orchestrate/land.go` syncBase → `landresolver.go` landConflictLand: one resolver attempt, then a hold).

## What exists today (recon)

- `wsh runs start --queue` hands the start to the queue: it starts once fewer than `runs:maxactive` (default 3,
  `runqueue.DefaultMaxActive`) top-level runs are active (`runqueue.Active`). `--after <run or q-id>` also waits for
  that run to land and implies `--queue`. `start-now`, `run-next` and `dequeue` exist; Brief has the queue sheet
  (`frontend/app/view/jarvis/briefqueuesheet.tsx`); a run's sheet shows "queued after …".
- `RunQueueEntry.After` (`pkg/wshrpc/wshrpctypes_runqueue.go`) is a single id. `runqueue.Next` starts an entry once its
  After landed and blocks it (`BlockedOn`) when that run was held or cancelled.
- A live run has `BaseCommit` and `Branch` (`pkg/waveobj/wtype.go`); its dag has `PlanPath` and `SpecPath`; a plan's
  tasks carry `**Files:**` lines (`pkg/jarvis/plan.go` TaskFiles).
- `pkg/jarvis/chunkstale.go` `FileMentions` pulls file names out of prose and drops the files everyone edits
  (CHANGELOG.md, AGENTS.md, generated types…); `mentionMatches` matches a mention against a path.
- A run whose worker hits the usage limit is paused and resumed just past the window's reset
  (`pkg/runpause/limit.go` PauseForLimit, LimitResumeAt).
- The launcher (`frontend/app/view/agents/launchermodal.tsx`) starts a run through `startRunInBackground`
  (`startingrunsstore.ts`) and has no queue option.

## Decisions

### Intent

When a run is about to start, Jarvis weighs whether it touches the same code as a live run (to avoid a held merge) and
whether there is room under the active-run cap, and suggests one way to start: run now, wait for the overlapping runs,
or queue. Quota never holds a run (below).

### Jarvis preselects; the person presses Start

The launcher still opens as today. The way Jarvis suggests is preselected, with a one-line reason; the person can change
it before Start. Nothing starts on its own.

### How the suggestion is computed: rules, no session

1. Files of the new run: `FileMentions` of the spec (or, for a plan file, the plan's `**Files:**` lines plus
   `FileMentions` of its text).
2. Files of each live top-level run: its branch diff (`git diff --name-only <BaseCommit>..<Branch>`) plus the
   `**Files:**` lines of its plan when it has one.
3. Overlap (via `mentionMatches`) with one or more live runs → preselect **After** those runs.
4. No overlap and `runqueue.Active < cap` → preselect **Run now**.
5. No overlap and no room → preselect **Queue**.

A live run that has no plan and nothing committed yet (its lead still planning, the main case: two specs approved one
after the other) still has files: `FileMentions` of its goal and spec, as for the new run. A quick run also counts its
working-tree diff, uncommitted changes included. A top-level run's diff is `wave/<runId>` in its `LandPath` plus its
lane branches not merged yet: `Run.Branch` belongs to a lane's child run, not the top-level one. (Agent's call)

The new run's spec travels as data, not inside the goal text: `CommandCreateRunData` and `RunQueueEntry` gain a
`SpecPath` field (a wire change: `task generate`), which the launcher fills when it opens from Approve. A re-check reads
the files from the spec again at that time, since a spec edited after queuing is the spec that will be built.
(Agent's call)

Which runs count as live: every top-level run not done or cancelled, plus a done run whose land is still pending
(After waits for it to land). A run whose land is held is never preselected as After, since the queue would block the
entry at once; when it overlaps, the reason line says so: "Run X is held and edits land.go: land it first, or this run
will conflict".

No model session is called and no token is spent. When the new run names no file (a plain goal, or a spec that names
none), the overlap check is skipped and the reason line says so ("The spec names no files: only the run cap was
checked").

### Every run launcher

The row is in every run launcher: Approve from a brainstorm, + Run (goal or plan file). A spec or plan gives files to
compare; a plain goal gets only the cap check, said in the reason line.

A brainstorm's Approve that queues (Queue or After) tells the brainstorm agent "queued as q-xxxx" at once. When the
entry starts, wavesrv, not the launcher (which is closed by then), sends `brainstorm: run <id>` as today. While the
entry waits, the brainstorm's card shows Queued (or Queued after …) in place of Approve. An entry that is removed turns
Approve back on; an entry that is blocked shows its block reason on the card. (Agent's call)

### Overlap with several runs: wait for all of them

A run that overlaps several live runs waits until all of them land. `RunQueueEntry.After` becomes a list of ids
(`wsh runs start --after` takes several), read compatibly from a queue file written with a single id. Any one of them
held or cancelled blocks the entry as today. The launcher shows "After run A, run B".

### Re-check when its turn comes

When a queued entry's turn comes (room, and every After landed), Jarvis compares its files again with the runs live at
that moment. An overlap adds that run to the entry's After and the entry waits on; the queue sheet says why ("Waiting
for run X too: both edit pkg/orchestrate/land.go"). Start now still skips all of it.

The re-check adds only runs created after the entry was queued (the run's `createdts` later than the entry's
`QueuedTs`). A run the person saw and unticked, or passed over by picking Queue, is never added back, and no new queue
field is needed. An entry queued from the CLI follows the same rule. (Agent's call)

### Quota never holds a run; the reason line mentions it

Runs go until the 5-hour or weekly quota is spent; a run that hits the limit pauses and resumes after the reset
(`pkg/runpause/limit.go`, already in place). The suggestion ignores quota and the queue gets no reset gate. The reason
line still mentions it when the window is nearly spent, by the estimate of the run's share of the window
(`tokengate.WindowShare` over the project's earlier runs; with too few samples, when the window is over 85% used):
"Quota at 8%: the run will pause until 16:40, then carry on". The preselected choice does not change for it.

### The launcher row

A "When" row of three adjoining buttons: **Run now**, **After run…**, **Queue**. Jarvis's choice is preselected with a
small "Jarvis suggests" label, and one reason line sits under the row ("Edits pkg/orchestrate/land.go like run X",
"3 runs are already active", "The spec names no files: only the run cap was checked", plus the quota note when it
applies). After run… opens the list of live runs to tick, the overlapping ones ticked already. The Start button names
the choice: Start, Queue after X, Queue.

## Left to the builder

The wording of the buttons and the reason line; the name and shape of the RPC that returns the suggestion to the
launcher (Go is the source; run `task generate`); how to estimate a run's share of the window from earlier runs
(minimum samples, quick vs orchestrator); reading a spec's files with `FileMentions` / `mentionMatches`; getting a live
run's changed files (branch diff plus plan Files) without slowing the launcher; where the queue sheet in Brief shows a
wait reason; keeping old queue files (a single `after` id) readable when After becomes a list.

## The builder's decisions (autonomous run, 2026-11-16)

Each call below fills a point the section above left to the builder, or one recon showed it had to settle. Nobody was
at the cockpit, so each is the option the builder recommends, with why.

### Wire

- **`RunQueueEntry.After` and `CommandRunQueueAddData.After` become `[]string`** (`json:"after,omitempty"`). The wire
  stays plain: the compatibility lives in `pkg/runqueue`'s `load`, which reads an entry whose `after` is a JSON string
  as a one-element list (an empty string as none), and `save` always writes a list. Why: the queue file is the only
  place an old single id can come from, so one reader there keeps every other caller (Go, TS, the generator) on one
  shape.
- **`wsh runs start --after` takes several ids**: the flag repeats and each value may be a comma list
  (`--after r1,r2 --after q-3`); each resolves as today (a run or queue entry, by id or unique prefix). Why: both
  spellings are what a shell user tries first, and resolving per id keeps today's error for a typo.
- **`CommandCreateRunData.SpecPath`** (absolute path, optional) and **`Run.SpecPath`**, stored by `CreateRun`. Why:
  a live run started from Approve has no plan for a while; its spec is what names its files for the next launcher's
  overlap check (the spec's "files of each live run"), and the run is where that check can find it. The goal text keeps
  naming the spec as today, so leads see no change.
- **`Run.AfterRunId` stays one id**: the first run id of the entry's After. Why: it only feeds the run sheet's
  "queued after …" line once the run exists; while the entry waits the queue sheet lists every id. Changing a stored
  waveobj field for a line that is history by then is not worth it (YAGNI).
- **`RunQueueEntry.Brainstorm *RunQueueBrainstorm`** (`{tab, path}`: the brainstorm agent's tab id and its
  brainstorm.json's absolute path), set through `CommandRunQueueAddData.Brainstorm`. Why: when the entry starts, the
  launcher is closed, so wavesrv needs to know whom to tell; the card finds its own entry by `path`.
- **A waiting entry's `Reason`** holds the re-check's wait reason ("Waiting for run X too: both edit
  pkg/orchestrate/land.go"). Why: the field is already shown by the queue sheet and only meant "blocked" by
  convention; a waiting entry had none. Clearing a block still clears it.
- **One new RPC, `RunStartSuggestCommand`** (`pkg/wshrpc/wshrpctypes_runstart.go`, server
  `wshserver_runstart.go`), input `{channelid?, projectpath, goal, planpath?, specpath?}`, returning
  `RunStartSuggestion`: `choice` (`now` | `after` | `queue`), `after` (the run ids to pre-tick), `reason`, `quotanote`
  (empty when quota is fine), `live` (every live run of the same project: id, title, the files it shares with the new
  run, held and its reason), `active`, `maxactive`. Why: one call gives the launcher everything the row and the After
  list draw; the launcher may not have a channel yet (it is minted at Start), so the project path is the key.

### Which live runs, and their files

- **Same project only for overlap** (the live run's channel's project path equals the new run's), **every project for
  the cap** (`runqueue.Active` is global, as the queue counts it). Why: two runs in different repositories cannot
  conflict on a merge.
- **Files of a live run** = `FileMentions(goal, spec text)` (spec from `Run.SpecPath`, else its dag's `SpecPath`) ∪
  every task's `TaskFiles` in its dag ∪ its changed files. A branch-landed dag keeps `PlanPath`/`SpecPath`
  repo-relative (`TaskGroup`, `pkg/waveobj/wtype.go`), so they resolve in the run's `LandPath`, else `Run.ProjectPath`.
  A run started from a plan file has its dag from the start, so a run has no plan to read but its dag's. Changed files:
  - an orchestrator run: `git diff --name-only <BaseCommit>...wave/<runId>` in its project, plus the same diff for each
    of its child runs that has a `Branch`, done or not (a done worker's lane may not be merged yet; a merged lane's files
    are already in `wave/<runId>`, so counting it again changes nothing);
  - a quick run (and a checkout-landing run): `git diff --name-only <BaseCommit>` in its working dir (`LandPath`, else
    the project), which includes uncommitted edits.
  Diff paths go through the same hub-file filter as `FileMentions` (`CHANGELOG.md`, generated types…), exported from
  `pkg/jarvis` with `MentionMatches`.
- **Two files are the same** when either names the other (`MentionMatches(a, b) || MentionMatches(b, a)`). Why: both
  sides can be bare mentions ("land.go") as well as repo paths.
- **Keeping the launcher fast:** the git calls for all runs run concurrently, each bounded by 2 s; one that fails or
  times out adds no files and is logged with the run id. The launcher never waits on the answer: it opens with Run now
  and "Checking…" in the reason line, and applies the suggestion when it comes unless the person has already picked a
  choice by hand. A failed call says "Couldn't check: <error>" and leaves Run now.

### The new run's files

`runstart.NewRunFiles(goal, specText, planText)`: `FileMentions` of the goal and spec, plus `TaskFiles` of every plan
task and `FileMentions` of the plan's text. The reason line names its source: "The spec names no files", "The plan
names no files", "The goal names no files", each followed by ": only the run cap was checked".

### Quota note

- **Estimate of a run's tokens:** the median of the summed usage (the sealed `Usage` rows) of the project's last 10
  done top-level runs of the same kind (quick vs orchestrator), needing at least 3. Why: the median ignores one huge run;
  quick and orchestrator runs differ by an order of magnitude.
- **With an estimate:** its share of the 5-hour window (`tokengate.WindowShare` with the window's tokens since its
  start, `usagestats.WindowTokens`) is compared with what is left (100 − used %); the note shows when the share is
  larger. **Without one** (fewer than 3 samples, or `WindowShare` answering `false` because the window is too
  empty to size): the note shows when the 5-hour or weekly window is over 85% used.
- **Wording:** "Quota at 8%: the run will pause until 16:40, then carry on", the time being that window's reset in
  local time (a weekly reset adds the weekday: "Mon 16:40"). It never changes the preselected choice. No reading at all
  (no quota file) gives no note.

### Re-check when an entry's turn comes

In wavesrv's queue loop, the entry `runqueue.Next` names to start is first re-checked: its files are read again
(spec and plan read now), against the live runs of its project created after its `QueuedTs`, not held, and not already
in its After. Any overlap appends those runs to its After and sets its wait reason, in one write
(`runqueue.WaitAlsoOn`); the pass reports the queue changed, as an unblock does, so the loop reads it again at once
and the next ready entry starts in the same evaluation rather than at the next tick. Start now skips the re-check, as
the spec says.

### Brainstorm Approve that queues

- The launcher's prefill gains `brainstorm?: {tab, path}`, which `openRunLauncher` sets and the launcher passes to
  `RunQueueAddCommand` when it queues; its handback gains `queued(entryId)`. The brainstorm sends the agent `brainstorm: queued <q-id>`; the skill
  says to record nothing and wait for `brainstorm: run <id>`. Why: the file's `run` field is a run id, and the queue
  entry already is the record; a second field would be a second truth.
- **When the entry starts**, wavesrv arms the agent's sleep after run (as `AgentsSleepAfterRunCommand` does) and
  delivers `brainstorm: run <id>` to the entry's `Brainstorm.Tab` through the same path `wsh agents send` uses (woken if
  asleep). A failure is logged on the run's timeline, not retried. Why: it is the only process alive at that moment.
- **Chat draws that line as the run row**, as it does for a line the frontend sent: when `runqueue:changed` names a
  started entry that carried `brainstorm`, the frontend records a `run` answer for that agent (the record
  `sendBrainstorm` writes today), so Chat pairs the server's line with it.
- **The card** reads the queue: an entry whose `brainstorm.path` is this brainstorm's path puts "Queued", "Queued after
  <titles>" or the block reason where Approve was. Between the entry starting and the agent recording the run, the run
  id from `runqueue:changed`'s `started` keeps Approve off (the starting mark remembers the entry id). An entry removed
  without starting turns Approve back on.

### The launcher row

- Labels: **Run now**, **After run…**, **Queue**; a muted "Jarvis suggests" tag sits on the suggested button. The Start
  button reads **Start**, **Queue after <title>** (one run) / **Queue after 2 runs**, or **Queue**.
- **After run…** opens an inline list of the project's live runs with checkboxes: overlapping ones pre-ticked and
  showing the shared files; held runs listed but not tickable, with "held: land it first". After with nothing ticked
  disables Start with "Pick a run to wait for".
- **Queue and After start nothing in the launcher**: they call `RunQueueAddCommand` with the same
  `CommandCreateRunData` a start would send (one builder, `createRunPayload`, for both), close the dialog, and the
  queued row shows in the Agent tree as today.
- **The queue sheet in Brief** shows a waiting entry's reason under its "waits" line, and "After run A, run B" when it
  waits on several.
