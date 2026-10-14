# Run handoff lifecycle implementation plan

**Spec:** `docs/superpowers/specs/2026-10-14-run-handoff-lifecycle-design.md` (read it first)

**Verify:** `node scripts/verify.mjs ./pkg/runqueue ./pkg/jarvis ./pkg/wshrpc/... ./pkg/wstore ./pkg/wconfig ./pkg/waveobj ./pkg/wps ./pkg/tsgen ./cmd/wsh/cmd`

**Check:** `go vet ./pkg/runqueue/... ./pkg/wshrpc/... ./pkg/jarvis/... && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs run-queue run-origin`

**Goal:** A session can hand a plan to the engine as a queued start (`wsh runs start --plan X --queue [--after <id>]`)
that wavesrv starts when fewer than `runs:maxactive` runs are active (and its `--after` run has landed); queued entries
show on the Agent tree with Start now / Run next / Remove; a session and the runs it started point at each other on the
tree; and when a run lands, the session that started it gets one prompt to review the result.

**Architecture:** A new Go package `pkg/runqueue` keeps an ordered list of `wshrpc.RunQueueEntry` (each the
`CommandCreateRunData` a start would have sent) in `runqueue.json`, plus pure functions that decide which entry is
ready, which is blocked, and whether a run has a final outcome. A loop in wavesrv (`wshserver_runqueue.go`) runs on a
poke (every run write through `wstore.AppendRun` / `UpdateRun`, every queue change, a `runs:maxactive` change) and every
15s as a fallback: it starts the ready entry through `CreateRunCommand`, and it messages the origin session of each run
that reached a final outcome (`wshserver_originnotify.go`). wshrpc commands and a `runqueue:changed` event feed `wsh`
and the frontend; the tree gets queued rows and `→` / `from` lines from pure models in `frontend/app/view/agents`.

**Tech stack:** Go (wshrpc, wps, wconfig, cobra), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

## Worker and reviewer brief

- Read `AGENTS.md` and `DESIGN.md`. Colours are `@theme` tokens only (the blocked meta uses the warning token the tree
  already uses for a held land: `LEAD_MARK_CLASS` in `agenttree.tsx`).
- Never hand-edit generated files; after changing a wshrpc type, event or a wconfig setting, run `task generate`.
- Pure logic goes in a `.ts` with a `.test.ts` beside it; `.tsx` stays thin. No jsdom tests.
- Typecheck with `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (never `npx tsc`), with a
  timeout over 2 minutes.
- Check formatting only on files you touched (`gofmt -l <files>`, `npx prettier --check <files>`); never `--write`
  the tree; never prettier `scripts/*.mjs`.
- Commit with a pathspec (`git add -- <new files> && git commit -m "…" -- <paths>`); no Co-Authored-By trailer.
- Facts you will need:
  - `CreateRunCommand` is `pkg/wshrpc/wshserver/wshserver_runs.go:365`; it validates the plan (`readPlanFile`,
    `resolvePlanPath`) before persisting, sets `BaseCommit` at create, and sets `OriginTabId` / `OriginTranscript` at
    `:483`.
  - Run statuses are `pkg/jarvis/run.go:16-21`; land states are `pkg/orchestrate/land.go:30-32`
    (`pending | landed | held`). **`pkg/runqueue` imports neither `pkg/jarvis` nor `pkg/orchestrate`**: Task 3 makes
    jarvis import runqueue, and orchestrate imports jarvis, so either import is a cycle. runqueue imports only
    `wshrpc`, `waveobj`, `wavebase`, `fileutil` and the standard library; `waveobj.RunLand` is `pkg/waveobj/wtype.go:326` (`Dirty` = a hold that lands by
    itself once the checkout is clean).
  - A run is a child, not top-level, when `ParentLeadORef != ""`, `TaskId != ""`, `StageRole != ""` or `Review`.
  - `wstore.GetRunsByStatus` and `GetRunsByLandState` are `pkg/wstore/wstore_channel.go:374-385`. Every run write goes
    through `AppendRun` (`:207`) or `UpdateRun` (`:219`).
  - The job queue's startup wiring and `wconfig.ConfigHook` poke are `cmd/server/main-server.go:169-200` and `:388`.
  - The live-agent roster is `loadAgentRosterFacts` / `buildAgentRoster` (`wshserver_agentmsg.go:65,183`); a row has
    `TabId`, `State` (`wshrpc.AgentsState_*`), `blockId`; `wakeAgent` (`wshserver_agentsleep.go:314`) wakes a sleeping
    one with a message; `deliverAgentMessage` (`wshserver_agentmsg.go:68`) sends to a live one.
  - Settings pattern: `JobsSlots` / `JobsMode` in `pkg/wconfig/settingsconfig.go:128-129`.
  - Store pattern: `pkg/claudeaccount/claudeaccount.go:46` (`storePath` var over `wavebase.GetWaveDataDir()`) and
    `fileutil.AtomicWriteFile`.

### Task 1: `pkg/runqueue`: the store and the pure rules

**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/runqueue/runqueue.go`, `pkg/runqueue/rules.go`, `pkg/runqueue/runqueue_test.go`, `pkg/runqueue/rules_test.go`, `pkg/runqueue/consts_test.go`

**Where:**
- Create: `pkg/wshrpc/wshrpctypes_runqueue.go` (types only in this task; the command interface comes in Task 2),
  `pkg/runqueue/runqueue.go`, `pkg/runqueue/rules.go` and their tests.

Types (`wshrpctypes_runqueue.go`; the entry lives in wshrpc so `pkg/runqueue` can import wshrpc without a cycle):

```go
const (
    RunQueueState_Waiting = "waiting"
    RunQueueState_Blocked = "blocked"
)

type RunQueueEntry struct {
    Id          string               `json:"id"`          // "q-" + 4 hex
    Data        CommandCreateRunData `json:"data"`        // what wsh runs start would have sent
    Title       string               `json:"title"`       // the plan's title, for rows and messages
    ProjectPath string               `json:"projectpath"` // the channel's project, for the tree's folder
    After       string               `json:"after,omitempty"` // a run id or a queue entry id
    QueuedTs    int64                `json:"queuedts"`
    State       string               `json:"state"`       // RunQueueState_*
    Reason      string               `json:"reason,omitempty"`
}
```

Store (`runqueue.go`), shaped like `claudeaccount.go`: a package `mu sync.Mutex`, `storePath = func() string {
return filepath.Join(wavebase.GetWaveDataDir(), "runqueue.json") }` (a var, tests point it at `t.TempDir()`), the file
holds `{"entries": [...]}` in queue order, a missing file reads as empty, writes go through
`fileutil.AtomicWriteFile`. `now` is a var.

- `List() ([]wshrpc.RunQueueEntry, error)`
- `Add(e wshrpc.RunQueueEntry) (wshrpc.RunQueueEntry, error)` — mints `Id` (unique among entries), sets `QueuedTs`,
  `State = waiting`, appends last.
- `Remove(id string) error`, `MoveFirst(id string) error`, `SetBlocked(id, reason string) error`,
  `SetWaiting(id string) error` — an unknown id is an error naming it.
- `Resolve(prefix string) (wshrpc.RunQueueEntry, error)` — exact id or a unique prefix; ambiguous names the matches.

Rules (`rules.go`), pure, on `[]*waveobj.Run` passed in. The statuses and land states they read are literal string
constants in `rules.go` (`statusDone = "done"`, `statusCancelled = "cancelled"`, `landLanded = "landed"`, `landHeld =
"held"`), each commented with its source (`jarvis.RunStatus_*`, `orchestrate.LandState_*`), never imported (see the
brief). `consts_test.go` is an external test (`package runqueue_test`, which may import both without a cycle) that
fails when a literal drifts from its source, by asserting `Outcome` and `Active` on runs built with
`jarvis.RunStatus_*` and `orchestrate.LandState_*`.

- `TopLevel(r *waveobj.Run) bool` — none of the child markers in the brief.
- `Active(runs []*waveobj.Run) int` — top-level runs whose status is neither done nor cancelled.
- `Outcome(r *waveobj.Run) (final bool, landed bool, reason string)`:
  - `Land.State == "landed"` → final, landed.
  - `Land.State == "held"` and `!Land.Dirty` → final, not landed, reason `Land.Reason`.
  - status done, `Land == nil` and `LandPath == ""` (a checkout-landed run) → final, landed.
  - status cancelled → final, not landed, reason `"cancelled"`.
  - anything else (running, land pending, dirty hold, done with a branch not yet landed) → not final.
- `Next(entries []wshrpc.RunQueueEntry, runs map[string]*waveobj.Run, maxActive int) (start string, block map[string]string)`:
  walks entries in order; `block` names each waiting entry whose `After` run has a final outcome that is not landed
  (reason `"<after title> was " + reason`, e.g. `"Learned additions was held: the final stage failed"`) or whose
  `After` names an id that is neither a run nor an entry (`"<id> is not a run or a queued entry"`); `start` is the first
  waiting, unblocked entry whose `After` is empty or a landed run, when `maxActive == 0` or `Active < maxActive`. An
  `After` naming a queue entry is never ready. Blocked entries are skipped.
- `ClampMaxActive(v *int) int` — nil is 3; below 0 is 0.

**Steps:**
1. Write `rules_test.go`: `TopLevel` for each child marker; `Active` skips done, cancelled and children; `Outcome` for
   each row of the list above, including a dirty hold and a done branch run with `Land == nil`; `Next` with the cap
   reached, under it, `maxActive 0`, an entry after a landed run, after a running run (skipped, the next entry
   starts), after a held run (blocked), after a cancelled run (blocked), after a queue entry (never ready), after an
   unknown id (blocked), a blocked entry ahead (skipped).
2. Write `runqueue_test.go`: add/list round trip keeps order; ids unique; `MoveFirst`; `Remove`; `SetBlocked` then
   `SetWaiting`; unknown id errors; `Resolve` exact, prefix, ambiguous; a missing file lists empty; 20 concurrent
   `Add`s keep 20 entries.
3. Run `go test ./pkg/runqueue` — fails.
4. Implement.
5. Run `go test ./pkg/runqueue` — passes; `go list -deps ./pkg/runqueue | grep -E 'pkg/(jarvis|orchestrate)$'` prints
   nothing; `gofmt -l pkg/runqueue pkg/wshrpc/wshrpctypes_runqueue.go` prints nothing.
6. Commit `feat(runqueue): an ordered queue of run starts and the rules that start them`.

### Task 2: RPC, settings, the scheduler loop and `wsh runs --queue`

**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshrpctypes_channels.go`, `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wconfig/settingsconfig.go`, `cmd/server/main-server.go`, `cmd/wsh/cmd/wshcmd-runs.go`, `cmd/wsh/cmd/wshcmd-runs_test.go`, `pkg/wstore/wstore_channel.go`, `pkg/wstore/wstore_channel_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `pkg/wconfig/metaconsts.go`

**Where:**
- Modify: `pkg/wshrpc/wshrpctypes_runqueue.go` (add the interface and data types), `pkg/wshrpc/wshrpctypes.go:46`
  (embed `RunQueueCommands` beside `RunCommands`), `pkg/wps/wpstypes.go` (constant + `AllEvents`),
  `pkg/tsgen/tsgenevent.go` (`WaveEventDataTypes` entry), `pkg/wconfig/settingsconfig.go:128` (two settings beside
  `jobs:*`), `cmd/server/main-server.go` (start the loop after `startJobQueue()` at `:380`; poke it from the
  `ConfigHook` at `:388`; set `wstore.RunChangedHook = wshserver.PokeRunQueue` beside it), `cmd/wsh/cmd/wshcmd-runs.go`,
  `pkg/wstore/wstore_channel.go` (`RunChangedHook`)
- Create: `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`
- Generated by `task generate`: `wshclient.go`, `wshclientapi.ts`, `gotypes.d.ts`, `waveevent.d.ts`, `metaconsts.go`

```go
type RunQueueCommands interface {
    RunQueueAddCommand(ctx context.Context, data CommandRunQueueAddData) (*RunQueueEntry, error)
    RunQueueListCommand(ctx context.Context) (*CommandRunQueueListRtnData, error)
    RunQueueStartNowCommand(ctx context.Context, data CommandRunQueueIdData) error
    RunQueueRunNextCommand(ctx context.Context, data CommandRunQueueIdData) error
    RunQueueRemoveCommand(ctx context.Context, data CommandRunQueueIdData) error
}
type CommandRunQueueAddData struct {
    Data  CommandCreateRunData `json:"data"`
    After string               `json:"after,omitempty"`
}
type CommandRunQueueIdData struct {
    Id string `json:"id"` // an id or a unique prefix
}
type CommandRunQueueListRtnData struct {
    Entries   []RunQueueEntry `json:"entries"`
    MaxActive int             `json:"maxactive"`
    Active    int             `json:"active"`
}
type RunQueueChangedData struct {
    Entries []RunQueueEntry `json:"entries"`
}
```

Types the later tasks need, added here so only this task runs `task generate` (tasks 3 and 4 run side by side):
`QueueId string \`json:"queueid,omitempty"\`` on `wshrpc.AttentionItem` (`pkg/wshrpc/wshrpctypes_channels.go:95`;
Task 3 fills it), and on `waveobj.Run` beside `OriginTabId` (`pkg/waveobj/wtype.go:262-267`; Task 4 sets them):
`OriginNotify bool \`json:"originnotify,omitempty"\`` (the run's origin is to be told how it ended; set at create,
so runs from before this change are never messaged) and `OriginNotifiedTs int64 \`json:"originnotifiedts,omitempty"\``.

Settings: `RunsMaxActive *int \`json:"runs:maxactive,omitempty"\`` (active runs before a queued start waits; unset is
3, 0 is no cap) and `RunsWakeOrigin *bool \`json:"runs:wakeorigin,omitempty"\`` (message the session that started a run
when it lands; unset is true; read in Task 4).

Event: `Event_RunQueueChanged = "runqueue:changed" // type: wshrpc.RunQueueChangedData`, published with the whole list
after every store change the server makes.

Server (`wshserver_runqueue.go`):
- `RunQueueAdd`: for a `PlanPath`, run the same plan checks `CreateRunCommand` runs first (mode orchestrator,
  `resolvePlanPath`, `readPlanFile`, title from `planTitle`), so a bad plan is refused at queue time; load the channel
  for `ProjectPath`; resolve `After` (a run by id or unique id prefix across `GetRunsByStatus` of every status, or a
  queue entry via `runqueue.Resolve`) to its full id, refusing an unknown one; `runqueue.Add`; publish; poke.
- `RunQueueStartNow`: start that entry now (the same start path as the loop, past cap and `After`).
- `RunQueueRunNext`: `runqueue.MoveFirst`, then `SetWaiting` if it was blocked; publish; poke.
- `RunQueueRemove`: `runqueue.Remove`; publish.
- Run changes poke the loop: `pkg/wstore/wstore_channel.go` gains `var RunChangedHook func()` (nil by default), called
  after `AppendRun` and `UpdateRun` commit successfully (never inside the transaction, never on error). Every run status
  and land change goes through one of the two, so this is the spec's "on every run status change, on every land
  change"; pokes coalesce in the buffered channel, so a burst of writes is one evaluation.
- The loop: `StartRunQueue(ctx)` runs `evaluate` at start, on `PokeRunQueue()` (a buffered channel of 1, sent
  non-blocking), and every 15s as a fallback. `evaluate` reads the entries and every run named by an `After` plus all runs not done/cancelled
  (`GetRunsByStatus`), applies `runqueue.Next` with `ClampMaxActive(settings.RunsMaxActive)`, writes each `block` with
  `SetBlocked`, and starts `start`. Starting holds a `starting` flag (one start at a time; `evaluate` returns while it
  is set): it calls `ws.CreateRunCommand(ctx, entry.Data)` with a 5-minute context; on success `Remove` and log a
  run event `queued-start` with the entry id; on error `SetBlocked(id, err.Error())`. Then publish and evaluate again.
  `stateFns` (list runs, create run, settings) are package vars so the test scripts them.
- Panics are caught with `panichandler.PanicHandler("runqueue", recover())`, as `startJobQueue` does.

`wsh runs`:
- `start`: `--queue` (bool) and `--after <id>` (implies `--queue`). With either, call `RunQueueAddCommand` with the
  data built exactly as today, and print `queued <id> (#<n> in line) — starts when fewer than <max> runs are active`
  (or `— starts after <after title> lands` when `--after` is set; `#n` is the entry's 1-based place among waiting
  entries).
- `start-now <id>`, `run-next <id>`, `dequeue <id>`: the three commands, printing one line each.
- `list`: queue entries first (only this project's unless `--all`, matched by `ProjectPath`), each line marked
  `queued #n`, `after <id>` or `blocked: <reason>`; `--json` adds them under a `queued` key without changing the run
  rows' shape.

**Steps:**
1. Write `wshserver_runqueue_test.go` with scripted `stateFns`: a ready entry starts and is removed; two ready entries
   with room for one start one; a failing create blocks the entry with the error; an entry after a held run is
   blocked; StartNow starts past a full cap; RunNext moves a blocked entry first and makes it waiting; Add refuses a
   plan that does not parse and an unknown `After`; a poke runs `evaluate` without waiting for the tick. In
   `pkg/wstore/wstore_channel_test.go`: `RunChangedHook` fires once after `AppendRun` and after `UpdateRun`, and not
   when `UpdateRun`'s fn returns an error. Write `wshcmd-runs_test.go` cases: `--after` implies queue; the
   queued line's wording.
2. Run them — they fail.
3. Add the types, settings, event, server, wiring and commands; run `task generate`.
4. Run `go test ./pkg/wshrpc/... ./pkg/tsgen ./pkg/wconfig ./cmd/wsh/cmd -run 'RunQueue|Runs|Event'`,
   `go test ./pkg/wstore -run RunChanged` and
   `go build ./cmd/...` — pass.
5. Commit `feat(runqueue): wsh runs start --queue/--after, and wavesrv starts queued runs as room frees`.

### Task 3: A blocked queue entry in Needs you

**Depends on:** Task 2
**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `frontend/app/view/jarvis/attentionact.ts`, `frontend/app/view/jarvis/attentionact.test.ts`, `frontend/app/view/jarvis/attentionrun.ts`, `frontend/app/view/jarvis/attentionrun.test.ts`, `frontend/app/view/jarvis/petacts.ts`, `frontend/app/view/jarvis/petpeekmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/view/agents/needsyoustrip.tsx`, `frontend/app/view/agents/notifyevents.ts`, `frontend/app/cockpit/command-palette.tsx`, `frontend/app/view/jarvis/briefingmodel.ts`

**Where:**
- Modify: `pkg/jarvis/attention.go` (kind constant beside `AttentionRunLandHeld` at `:41`; `Queue` on
  `AttentionInput` at `:79`; items in `BuildAttention` at `:281`; `GatherAttentionFromLedger` at `:796` fills `Queue`
  from `runqueue.List()` — jarvis may import runqueue because Task 1 keeps runqueue free of jarvis and orchestrate; a
  `List` error is returned, not swallowed; `AttentionItem.QueueId` already exists from Task 2).
- `attentionact.ts`: an optional `queueId` on `AttentionActInput`; `attentionAct` gives `{label: "Start now", kind:
  "start-queued"}` for `run-queue-blocked` with a queue id; a new pure `attentionSecondAct(x): AttentionAct | null`
  gives `{label: "Remove", kind: "remove-queued"}` for the same item and null for every other kind (extend the
  `label`/`kind` unions with both).
- `attentionrun.ts`: `start-queued` runs `RunQueueStartNowCommand` (done text `Started · <source>`); `remove-queued`
  runs `RunQueueRemoveCommand` (done text `Removed · <source>`). Remove asks first with the app's confirm modal, as
  `confirmCloseRun` (`agentactions.ts`) does.
- `needsyoustripmodel.ts`: `KIND_LABEL` at `:15` gains `"run-queue-blocked": "Run to start"`; the row's
  `AttentionRunRow` passes `queueId: a.queueid`; `StripRow` gains `secondAct: AttentionAct | null` from
  `attentionSecondAct`. `needsyoustrip.tsx` draws `secondAct` as a second button beside `act` (the same button
  component and styling), with `data-strip-act={kind}` on both buttons for the scenario.
- The other places that list waiting items learn the kind, so it is never shown as a raw wire kind: `command-palette.tsx:194`
  (`"run-queue-blocked": "not started"`), `petpeekmodel.ts` `ROW_KIND_LABEL` (`"Run to start"`),
  `notifyevents.ts` (wherever it maps `run-land-held`, the same for `run-queue-blocked`), and `briefingmodel.ts` and
  `petacts.ts`, which build an `AttentionActInput` from an item: pass `queueId: item.queueid`. The Brief and the peek
  show the one `act` (Start now) only; the second button is the Needs you strip's.

Item: `Kind: "run-queue-blocked"`, `Key: "run-queue-blocked:" + id`, `QueueId: id`, `Source: entry.Title`, `Text:
"Did not start: " + entry.Reason`, `Action: "Start"`, `WaitingSince: entry.QueuedTs`, `Why: "Start now starts it
anyway; Remove drops it from the queue."`. Waiting entries make no item.

CDP: this task does not touch `scripts/cdp/scenarios.mjs` (Task 5 writes the `run-queue` scenario beside it); Task 6
adds the Needs you step that clicks these buttons, so keep the `data-strip-act` attributes exactly as named.

**Steps:**
1. Add to `attention_test.go`: a blocked entry makes one item with those fields; a waiting entry makes none. Add to
   `attentionact.test.ts`: `run-queue-blocked` with a queue id → Start now and second act Remove; without one → Open
   and no second act; every other kind → no second act. Add to `needsyoustripmodel.test.ts`: the blocked item's row
   has kind label `Run to start` and both acts. Add to `attentionrun.test.ts`: each of the two kinds calls its command.
2. Run `go test ./pkg/jarvis -run Attention` and `npx vitest run frontend/app/view/jarvis/attentionact.test.ts
   frontend/app/view/jarvis/attentionrun.test.ts frontend/app/view/agents/needsyoustripmodel.test.ts` — fail.
3. Implement.
4. Run them again — pass; `go build ./cmd/...` passes (no import cycle); typecheck passes.
5. Commit `feat(runqueue): a queued run that cannot start waits in Needs you with Start now and Remove`.

### Task 4: The origin session hears how its run ended

**Depends on:** Task 2
**Files:** `pkg/wstore/wstore_channel.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_originnotify.go`, `pkg/wshrpc/wshserver/wshserver_originnotify_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `docs/open-issues.md`

**Where:**
- Modify: `wshserver_runs.go:483` (set `OriginNotify`; the field exists from Task 2),
  `wshserver_runqueue.go` (`evaluate` also calls `notifyOrigins`)
- Create: `wshserver_originnotify.go`, `wshserver_originnotify_test.go`

`CreateRunCommand` sets `run.OriginNotify = data.OriginTabId != ""`.

`notifyOrigins(ctx)`:
- Return when `runs:wakeorigin` is false.
- Candidates: runs with `originnotify` true and no `originnotifiedts` (a `selectRuns` query on those two JSON fields,
  added beside `GetRunsByLandState` in `pkg/wstore/wstore_channel.go`).
- For each with `runqueue.Outcome` final and not cancelled: find the origin in the roster by `TabId == OriginTabId`.
  Gone → stamp `OriginNotifiedTs` and skip (nothing to tell). `AgentsState_Working` or `Asking` → leave it for a later
  tick. `Sleeping` → `wakeAgent(ctx, row, msg, false)`. Otherwise `deliverAgentMessage(row.blockId, msg)`. These two
  are the delivery half of `AgentsSendCommand` (`wshserver_agentmsg.go:321-330`), the path the spec names; its sender
  half (`senderTab`, `:267`) only takes an agent's block, so the run is named as sender in the text's first line
  (`[arc] Run <id8> …`) instead of an envelope. Stamp `OriginNotifiedTs` with `wstore.UpdateRun` after a send (that
  write pokes the loop through `RunChangedHook`; the stamp makes the next pass a no-op).
- Cancelled runs are stamped without a message.

`originMessage(run, dag) string`, pure. The plain text starts with `[arc]` (never a slash) and is not an
`agentmsg.Envelope` (it is not from an agent and has no reply channel). Landed:

```
[arc] Run <id8> "<goal>" landed: merged into <BaseBranch or "the checkout"> (<done>/<total> tasks<, Final passed|failed><, N files +A/-D>).
Plan: <PlanPath relative to ProjectPath>
Review it as the session that wrote the plan: check the result against the spec, record anything that still needs a hand check, make sure user-facing changes have their CHANGELOG line, tick the initiative chunk if one is linked, then report to the user in a few lines. Do not start another run.
```

Held: first line `[arc] Run <id8> "<goal>" held: <Land.Reason>.` (the spec's wording), then `Plan: …`, then `Diagnose with wsh runs show <id8>. Do not
force the land; propose the fix to the user.` Leave out a part whose data is missing (no dag → no task count; no
evidence → no file count). `PlanPath` is not on the run: read `TaskGroup.PlanPath` (`pkg/waveobj/wtype.go:541`) from
the run's dag (`DagORef`), and leave the line out when there is none.

**Steps:**
1. Write `wshserver_originnotify_test.go` with scripted roster and runs: landed → one message to the idle origin, run
   stamped; a second call sends nothing; working origin → nothing yet, then idle → sent; sleeping → `wakeAgent`;
   gone → stamped, no message; held dirty → nothing; held → the held text with `held: <reason>`; `runs:wakeorigin` false → nothing; a run
   without `OriginNotify` → nothing. Table-test `originMessage` for landed with and without evidence, held, and no dag.
2. Run them — they fail.
3. Implement.
4. Run `go test ./pkg/wshrpc/wshserver -run 'Origin|RunQueue'` and `go test ./pkg/wstore` — pass.
5. Add under "0 · Waiting on a hand check" in `docs/open-issues.md`: `- [ ] (arcterm) Run handoff: a run started with
   wsh runs start from a Claude session messages that session once it lands, and waits while you are mid-turn with it.`
6. Commit `feat(runs): the session that started a run is told how it landed`.

### Task 5: Queued rows on the Agent tree

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/runqueuemodel.ts`, `frontend/app/view/agents/runqueuemodel.test.ts`, `frontend/app/view/agents/runqueuestore.ts`, `frontend/app/view/agents/runlineagestore.ts`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Where:**
- Create: `runqueuemodel.ts` (+ test), `runqueuestore.ts`, a `QueuedRow` component in `agenttree.tsx`
- Modify: `agentsidebarmodel.ts:299-410` (`ProjectTreeRow` gains `{kind: "queued"; project; entry; place: number |
  null; afterTitle?: string}`; `projectTree` takes `queue`), `agenttree.tsx` (the `case "run":` at `:2354` area renders
  rows by kind: add `case "queued":`), `runlineagestore.ts:87` (export `lastPathSegment`), `scripts/cdp/scenarios.mjs`,
  `CHANGELOG.md`

`runqueuemodel.ts`, pure:
- `queueProject(entry)`: the last path segment of `entry.projectpath` (the same rule `runlineagestore.ts:87`
  `lastPathSegment` uses for a run's project; export and reuse it rather than copying).
- `queuedRows(entries, runTitles: Record<string,string>)`: per project, in queue order, `place` = 1-based place among
  all waiting entries (global, since the cap is global), `null` for a blocked one; `afterTitle` from `runTitles` or
  the after-entry's title.
- `queuedMeta(row)`: `"Queued #2"`, `"After Learned additions"` (when `after` is set and still unmet), or
  `"Blocked · <reason>"`.
- `queuedTooltip(entry, now)`: three lines — the plan path; `Lead <runtime>[ · <model>] · Workers <route>`, where the
  worker route is `data.workerroute`'s runtime and model, or `same as lead` when it is unset (the spec's "lead and
  worker route"); `Queued <age> ago`.

`projectTree`: each project's queued rows go right after its agent body rows and before its divider/terminals; a
project with only queued rows still gets a folder (after the agents' projects, before Home). A collapsed project hides
them; its group row does not count them as agents.

`runqueuestore.ts`: `runQueueAtom` loaded with `RpcApi.RunQueueListCommand` on first use and replaced from
`runqueue:changed` (`waveEventSubscribeSingle`, as `runlineagestore.ts:253` subscribes).

`QueuedRow`: Clock glyph (lucide `Clock`) in the row's `Slot`, title, the meta line (`text-warning`-family token for
blocked, as a held land is drawn); hover shows two icon buttons, Start now (`Play`) and Remove (`X`); the context menu
has Start now, Run next (not on the entry with `place === 1`) and Remove; Remove asks with the app's confirm modal (as
`confirmCloseRun` does). A click selects nothing and shows nothing in the centre; the `title` attribute is
`queuedTooltip`. `data-run-queue-row={entry.id}` on the row, `data-queue-act="start" | "remove"` on the two hover
buttons, for the scenario.

CDP scenario `run-queue` (in `scenarios.mjs`; `scenarios.mjs:1605-1625` creates a channel and a run held by
`deferstart` that spawns nothing, and `:9655` restores a `setconfig` in teardown). Every entry it queues carries
`data.deferstart: true`, so a Start now creates a run that spawns no agent:
- arrange: `setconfig {"runs:maxactive": 1}`; create a channel on `ctx.cwd`; `createrun` a quick run with
  `deferstart: true` (it stays in planning, spawns nothing, and counts as active); write a tiny valid plan file to a
  temp dir; `runqueueadd` it three times (entry A plain, entry B `after` A's id, entry C plain), with
  `data.workerroute` set on A; write a second plan, `runqueueadd` it as D, then delete that file and call
  `runqueuestartnow` on D so it blocks with "plan file … not found". Keep every id in `ctx`.
- goto the Agent surface; steps, each shot:
  1. rows `data-run-queue-row` for A, B, C and D in queue order; texts `Queued #1` (A), `After` (B, which still holds
     place 2, so `queuedRows` gives C place 3), `Queued #3` (C), `Blocked ·` (D).
  2. hover A (`Input.dispatchMouseEvent` mouseMoved over the row): `[data-queue-act="start"]` and
     `[data-queue-act="remove"]` become visible; A's `title` holds the plan path, `Lead ` and `Workers ` with A's worker
     runtime.
  3. context menu on C: the menu lists `Start now`, `Run next` and `Remove`; context menu on A (the head) has no
     `Run next`. Pick `Run next` on C: C's row moves above A and reads `Queued #1`, A reads `Queued #2`.
  4. hover A, click its Remove: the confirm modal opens; confirm it; A's row is gone and `runqueuelist` no longer has
     A.
  5. click C's Start now: C's row is gone, `runqueuelist` no longer has it, and the channel has a new run (a
     deferred one, which teardown cancels).
- teardown: `runqueueremove` every entry still listed, `cancelrun` the deferred runs (the arranged one and the one
  step 5 made), restore `runs:maxactive`, remove the temp files.

CHANGELOG (Added): one line saying a plan can be queued with `wsh runs start --queue` (or `--after` another run) and
starts by itself when fewer than `runs:maxactive` runs are going, with the tree's Start now / Run next / Remove.

**Steps:**
1. Write `runqueuemodel.test.ts` (places across projects, blocked has no place, the three meta texts, the tooltip
   with a worker route and with none) and add
   `projectTree` cases to `agentsidebarmodel.test.ts` (queued rows after the body and before the divider; a
   queue-only project gets a folder; collapsed hides them).
2. Run `npx vitest run frontend/app/view/agents/runqueuemodel.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts`
   — fails.
3. Implement the model, store, tree input and row; add the scenario and the CHANGELOG line.
4. Run the vitest files again — pass; typecheck passes; `task dev` and `task verify:ui -- run-queue` pass (the
   scenario needs the live dev app).
5. Commit `feat(agents): queued runs on the tree, with Start now, Run next and Remove`.

### Task 6: A session and its runs point at each other

**Depends on:** Task 3, Task 4, Task 5
**Files:** `frontend/app/view/agents/runorigin.ts`, `frontend/app/view/agents/runorigin.test.ts`, `frontend/app/view/agents/donesuggest.ts`, `frontend/app/view/agents/donesuggest.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Where:**
- Create: `runorigin.ts` (+ test)
- Modify: `donesuggest.ts:17-33` (a `queued` argument), `agenttree.tsx` (`ParentRow` at `:685` gets the `→` line and
  passes the queue to `doneSuggestion` at `:732`; `RunRow` at `:1026` and a lead's `ParentRow` get the `from` line via
  `RunSubline` at `:618`), `scripts/cdp/scenarios.mjs` (a `run-origin` scenario, and a Needs you step in
  `run-queue`)

`runorigin.ts`, pure:
- `originLinks(agentId, runs: Record<string, RunInfo>, queue: RunQueueEntry[])`: the runs whose `originId` is the agent
  and the waiting/blocked entries whose `data.origintabid` is the agent's tab id (`AgentVM.id` is the tab id, as
  `donesuggest.ts:31` compares). One link → `{text: "→ <title> · 3/5" | "→ Queued #2" | "→ merged" | "→ held",
  target}` (progress from `runProgress`, `runlineage.ts:337`; merged/held from `run.land`); two or more →
  `{text: "→ N runs", target: <the newest>}`; none → null.
- `originName(run, agents)`: the origin agent's name when its tab is in the roster, else null.

`ParentRow`: under the name line, when `originLinks` is not null, one `text-[11px]` muted line with
`data-origin-link`; clicking it goes through the one router, as the spec says (`openTarget`,
`frontend/app/view/jarvis/openref.ts:105`): for a run with a focus agent in the roster (the agent `RunRow` selects on
a click), `{kind: "agent", tabId: <that agent>}`, which focuses the run's row on the tree; for a run with none (not
started, or its agents gone), `{kind: "run", runId}`, which opens its sheet (`selectSheet`, `openref.ts:368`); for a
queued entry, which has no target the router knows, it
scrolls its `data-run-queue-row` into view. `RunRow` and a lead's row: `from <name>` appended to the subline, in a span
with `data-origin-from`; a click is `openTarget(model, {kind: "agent", tabId: run.origintabid})`. Rows never move and
are not dimmed.

`doneSuggestion(agent, unreadCount, runs, backgroundRunning, queued)`: false also while any entry in `queued` has
`data.origintabid === agent.id`.

CDP scenario `run-origin` (new, in `scenarios.mjs`). The origin session is a fake agent, staged as
`openUploadsAgent` (`scenarios.mjs:28075`) stages one: a shell terminal in a tab of its own, made an agent by
publishing `agent:status` for its block, so no real agent launches; the tab id is the agent id.
- arrange: open that agent tab (`ctx.tabId`) with a tab name of its own; create a channel on `ctx.cwd`; `createrun` a
  quick run with `deferstart: true` and `origintabid: ctx.tabId` (it spawns nothing); `setconfig {"runs:maxactive": 1}`
  so the next one waits, and `runqueueadd` a tiny plan with `data.deferstart: true` and `data.origintabid: ctx.tabId`.
- goto the Agent surface; steps, each shot:
  1. the agent's row shows `[data-origin-link]` reading `→ 2 runs` (one run and one queued entry); the run's row shows
     `[data-origin-from]` reading `from <the tab's name>`.
  2. `runqueueremove` the entry: the agent's line now reads `→ ` followed by the run's title (one link).
  3. click `[data-origin-link]`: the deferred run has no agent, so the router opens its sheet: the surface is
     `jarvis` and the sheet shows that run.
  4. goto the Agent surface again; click the run row's `[data-origin-from]`: the fake agent is selected
     (`focusIdAtom` holds `ctx.tabId`).
- teardown: remove the entry if left, `cancelrun` the run, close the tab (as the uploads scenario's teardown does),
  delete the channel, restore `runs:maxactive`.

Needs you step in `run-queue` (Task 3 built the item and its buttons): after step 1, open the Needs you strip and
assert one row with kind label `Run to start`, text starting `Did not start:`, and both `[data-strip-act="start-queued"]`
(`Start now`) and `[data-strip-act="remove-queued"]` (`Remove`); shot it. Click its Remove and confirm: D's row and the
strip row are gone (`runqueuelist` no longer has D). Start now on D is left to the unit tests: its plan file is gone,
so it would only block again.

CHANGELOG (Added): a session that started a run shows where the run is (`→ … 3/5`, queued, merged, held) and the
run names the session it came from; a click on either goes to the other.

**Steps:**
1. Write `runorigin.test.ts` (one run with progress, a queued entry, a landed run, a held run, two links, no link,
   the origin gone) and add a `donesuggest.test.ts` case for a queued entry.
2. Run `npx vitest run frontend/app/view/agents/runorigin.test.ts frontend/app/view/agents/donesuggest.test.ts` —
   fails.
3. Implement, then wire the rows.
4. Run the vitest files — pass; typecheck passes.
5. Add the two CDP pieces below; `task dev` and `task verify:ui -- run-queue run-origin` pass.
6. Commit `feat(agents): a session and the runs it started point at each other on the tree`.

### Task 7: Handoff wording and docs

**Depends on:** Task 2
**Files:** `AGENTS.md`, `skills/cockpit-runs/SKILL.md`, `docs/guide/orchestrator.md`

**Where:**
- Modify: `AGENTS.md` ("A finished plan offers the engine first" under Design docs), `skills/cockpit-runs/SKILL.md`
  (the start section), `docs/guide/orchestrator.md` (a short "Queued starts" section).

- `AGENTS.md`: the handoff's choices become, in order: **Arc engine** (start now); **Arc engine, queued**
  (`wsh runs start --plan <file> --queue`, or `--after <run>` when another run touches the same files; recommended when
  `wsh runs list --all` shows `runs:maxactive` runs active or more); **Inline in this session**; **Subagent-driven**.
  Picking either engine choice is the yes the fan-out cost rule asks for.
- `cockpit-runs` skill: `--queue`, `--after`, `start-now`, `run-next`, `dequeue`, and that a queued start reads the
  plan and takes the base when it starts, not when it is queued.
- `orchestrator.md`: the queue, the cap, `--after`, blocked entries in Needs you, and the message the starting session
  gets when the run lands (`runs:wakeorigin`).

**Steps:**
1. Edit the three files.
2. Run `node -e "require('fs').readFileSync('skills/cockpit-runs/SKILL.md','utf8')"` and `go test ./skills` (the
   embed test) — pass.
3. Commit `docs(runs): queued engine starts in the handoff, the skill and the guide`.
