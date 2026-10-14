# Run handoff lifecycle implementation plan

**Spec:** `docs/superpowers/specs/2026-10-14-run-handoff-lifecycle-design.md` (read it first)

**Verify:** `node scripts/verify.mjs ./pkg/runqueue ./pkg/jarvis ./pkg/wshrpc/... ./pkg/wconfig ./pkg/waveobj ./pkg/wps ./pkg/tsgen ./cmd/wsh/cmd`

**Check:** `go vet ./pkg/runqueue/... ./pkg/wshrpc/... ./pkg/jarvis/... && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs run-queue`

**Goal:** A session can hand a plan to the engine as a queued start (`wsh runs start --plan X --queue [--after <id>]`)
that wavesrv starts when fewer than `runs:maxactive` runs are active (and its `--after` run has landed); queued entries
show on the Agent tree with Start now / Run next / Remove; a session and the runs it started point at each other on the
tree; and when a run lands, the session that started it gets one prompt to review the result.

**Architecture:** A new Go package `pkg/runqueue` keeps an ordered list of `wshrpc.RunQueueEntry` (each the
`CommandCreateRunData` a start would have sent) in `runqueue.json`, plus pure functions that decide which entry is
ready, which is blocked, and whether a run has a final outcome. A loop in wavesrv (`wshserver_runqueue.go`) ticks every
15s and on pokes: it starts the ready entry through `CreateRunCommand`, and it messages the origin session of each run
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
    (`pending | landed | held`); `waveobj.RunLand` is `pkg/waveobj/wtype.go:326` (`Dirty` = a hold that lands by
    itself once the checkout is clean).
  - A run is a child, not top-level, when `ParentLeadORef != ""`, `TaskId != ""`, `StageRole != ""` or `Review`.
  - `wstore.GetRunsByStatus` and `GetRunsByLandState` are `pkg/wstore/wstore_channel.go:374-385`.
  - The job queue's startup wiring and `wconfig.ConfigHook` poke are `cmd/server/main-server.go:169-200` and `:388`.
  - The live-agent roster is `loadAgentRosterFacts` / `buildAgentRoster` (`wshserver_agentmsg.go:65,183`); a row has
    `TabId`, `State` (`wshrpc.AgentsState_*`), `blockId`; `wakeAgent` (`wshserver_agentsleep.go:314`) wakes a sleeping
    one with a message; `deliverAgentMessage` (`wshserver_agentmsg.go:68`) sends to a live one.
  - Settings pattern: `JobsSlots` / `JobsMode` in `pkg/wconfig/settingsconfig.go:128-129`.
  - Store pattern: `pkg/claudeaccount/claudeaccount.go:46` (`storePath` var over `wavebase.GetWaveDataDir()`) and
    `fileutil.AtomicWriteFile`.

### Task 1: `pkg/runqueue`: the store and the pure rules

**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/runqueue/runqueue.go`, `pkg/runqueue/rules.go`, `pkg/runqueue/runqueue_test.go`, `pkg/runqueue/rules_test.go`

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

Rules (`rules.go`), pure, on `[]*waveobj.Run` passed in:

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
5. Run `go test ./pkg/runqueue` — passes; `gofmt -l pkg/runqueue pkg/wshrpc/wshrpctypes_runqueue.go` prints nothing.
6. Commit `feat(runqueue): an ordered queue of run starts and the rules that start them`.

### Task 2: RPC, settings, the scheduler loop and `wsh runs --queue`

**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wconfig/settingsconfig.go`, `cmd/server/main-server.go`, `cmd/wsh/cmd/wshcmd-runs.go`, `cmd/wsh/cmd/wshcmd-runs_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `pkg/wconfig/metaconsts.go`

**Where:**
- Modify: `pkg/wshrpc/wshrpctypes_runqueue.go` (add the interface and data types), `pkg/wshrpc/wshrpctypes.go:46`
  (embed `RunQueueCommands` beside `RunCommands`), `pkg/wps/wpstypes.go` (constant + `AllEvents`),
  `pkg/tsgen/tsgenevent.go` (`WaveEventDataTypes` entry), `pkg/wconfig/settingsconfig.go:128` (two settings beside
  `jobs:*`), `cmd/server/main-server.go` (start the loop after `startJobQueue()` at `:380`; poke it from the
  `ConfigHook` at `:388`), `cmd/wsh/cmd/wshcmd-runs.go`
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
- The loop: `StartRunQueue(ctx)` runs `evaluate` at start, every 15s, and on `PokeRunQueue()` (a buffered channel of
  1). `evaluate` reads the entries and every run named by an `After` plus all runs not done/cancelled
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
   plan that does not parse and an unknown `After`. Write `wshcmd-runs_test.go` cases: `--after` implies queue; the
   queued line's wording.
2. Run them — they fail.
3. Add the types, settings, event, server, wiring and commands; run `task generate`.
4. Run `go test ./pkg/wshrpc/... ./pkg/tsgen ./pkg/wconfig ./cmd/wsh/cmd -run 'RunQueue|Runs|Event'` and
   `go build ./cmd/...` — pass.
5. Commit `feat(runqueue): wsh runs start --queue/--after, and wavesrv starts queued runs as room frees`.

### Task 3: A blocked queue entry in Needs you

**Depends on:** Task 2
**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `pkg/wshrpc/wshrpctypes_channels.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/jarvis/attentionact.ts`, `frontend/app/view/jarvis/attentionact.test.ts`, `frontend/app/view/jarvis/attentionrun.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/cockpit/command-palette.tsx`, `frontend/app/view/jarvis/briefingmodel.ts`

**Where:**
- Modify: `pkg/jarvis/attention.go` (kind constant beside `AttentionRunLandHeld` at `:41`; `Queue` on
  `AttentionInput` at `:79`; items in `BuildAttention` at `:281`; `GatherAttentionFromLedger` at `:796` fills `Queue`
  from `runqueue.List()`), `pkg/wshrpc/wshrpctypes_channels.go:95` (`QueueId string \`json:"queueid,omitempty"\``
  on `AttentionItem`), `attentionact.ts` (an optional `queueId` on `AttentionActInput`; act `{label: "Start now",
  kind: "start-queued"}`), `attentionrun.ts` (`call` runs `RunQueueStartNowCommand`; done text `Started · <source>`),
  `needsyoustripmodel.ts:15` (`"run-queue-blocked": "Run to start"`), `command-palette.tsx:194`
  (`"run-queue-blocked": "not started"`), and wherever `briefingmodel.ts` / `needsyoustripmodel.ts` build an
  `AttentionActInput` from an item: pass `queueId: item.queueid`.

Item: `Kind: "run-queue-blocked"`, `Key: "run-queue-blocked:" + id`, `QueueId: id`, `Source: entry.Title`, `Text:
"Did not start: " + entry.Reason`, `Action: "Start"`, `WaitingSince: entry.QueuedTs`, `Why: "Start now starts it
anyway; wsh runs dequeue <id> drops it."`. Waiting entries make no item.

**Steps:**
1. Add to `attention_test.go`: a blocked entry makes one item with those fields; a waiting entry makes none. Add to
   `attentionact.test.ts`: `run-queue-blocked` with a queue id → Start now; without one → Open.
2. Run `go test ./pkg/jarvis -run Attention` and `npx vitest run frontend/app/view/jarvis/attentionact.test.ts` —
   fail.
3. Implement; run `task generate` for the new field.
4. Run them again — pass.
5. Commit `feat(runqueue): a queued run that cannot start waits in Needs you with Start now`.

### Task 4: The origin session hears how its run ended

**Depends on:** Task 2
**Files:** `pkg/waveobj/wtype.go`, `pkg/wstore/wstore_channel.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_originnotify.go`, `pkg/wshrpc/wshserver/wshserver_originnotify_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `frontend/types/gotypes.d.ts`, `docs/open-issues.md`

**Where:**
- Modify: `pkg/waveobj/wtype.go:262-267` (beside `OriginTabId`), `wshserver_runs.go:483` (set `OriginNotify`),
  `wshserver_runqueue.go` (`evaluate` also calls `notifyOrigins`)
- Create: `wshserver_originnotify.go`, `wshserver_originnotify_test.go`

Run fields: `OriginNotify bool \`json:"originnotify,omitempty"\`` (set at create when `OriginTabId != ""`, so runs from
before this change are never messaged) and `OriginNotifiedTs int64 \`json:"originnotifiedts,omitempty"\``.

`notifyOrigins(ctx)`:
- Return when `runs:wakeorigin` is false.
- Candidates: runs with `originnotify` true and no `originnotifiedts` (a `selectRuns` query on those two JSON fields,
  added beside `GetRunsByLandState` in `pkg/wstore/wstore_channel.go`).
- For each with `runqueue.Outcome` final and not cancelled: find the origin in the roster by `TabId == OriginTabId`.
  Gone → stamp `OriginNotifiedTs` and skip (nothing to tell). `AgentsState_Working` or `Asking` → leave it for a later
  tick. `Sleeping` → `wakeAgent(ctx, row, msg, false)`. Otherwise `deliverAgentMessage(row.blockId, msg)`. Stamp
  `OriginNotifiedTs` with `wstore.UpdateRun` after a send.
- Cancelled runs are stamped without a message.

`originMessage(run, dag) string`, pure. The plain text starts with `[arc]` (never a slash) and is not an
`agentmsg.Envelope` (it is not from an agent and has no reply channel). Landed:

```
[arc] Run <id8> "<goal>" landed: merged into <BaseBranch or "the checkout"> (<done>/<total> tasks<, Final passed|failed><, N files +A/-D>).
Plan: <PlanPath relative to ProjectPath>
Review it as the session that wrote the plan: check the result against the spec, record anything that still needs a hand check, make sure user-facing changes have their CHANGELOG line, tick the initiative chunk if one is linked, then report to the user in a few lines. Do not start another run.
```

Held: first line `… was not merged: <Land.Reason>.`, then `Plan: …`, then `Diagnose with wsh runs show <id8>. Do not
force the land; propose the fix to the user.` Leave out a part whose data is missing (no dag → no task count; no
evidence → no file count). `PlanPath` is not on the run: read `TaskGroup.PlanPath` (`pkg/waveobj/wtype.go:541`) from
the run's dag (`DagORef`), and leave the line out when there is none.

**Steps:**
1. Write `wshserver_originnotify_test.go` with scripted roster and runs: landed → one message to the idle origin, run
   stamped; a second call sends nothing; working origin → nothing yet, then idle → sent; sleeping → `wakeAgent`;
   gone → stamped, no message; held dirty → nothing; held → the held text; `runs:wakeorigin` false → nothing; a run
   without `OriginNotify` → nothing. Table-test `originMessage` for landed with and without evidence, held, and no dag.
2. Run them — they fail.
3. Implement; `task generate` for the two Run fields.
4. Run `go test ./pkg/wshrpc/wshserver -run 'Origin|RunQueue' ./pkg/wstore` — pass.
5. Add under "0 · Waiting on a hand check" in `docs/open-issues.md`: `- [ ] (arcterm) Run handoff: a run started with
   wsh runs start from a Claude session messages that session once it lands, and waits while you are mid-turn with it.`
6. Commit `feat(runs): the session that started a run is told how it landed`.

### Task 5: Queued rows on the Agent tree

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/runqueuemodel.ts`, `frontend/app/view/agents/runqueuemodel.test.ts`, `frontend/app/view/agents/runqueuestore.ts`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Where:**
- Create: `runqueuemodel.ts` (+ test), `runqueuestore.ts`, a `QueuedRow` component in `agenttree.tsx`
- Modify: `agentsidebarmodel.ts:299-410` (`ProjectTreeRow` gains `{kind: "queued"; project; entry; place: number |
  null; afterTitle?: string}`; `projectTree` takes `queue`), `agenttree.tsx` (the `case "run":` at `:2354` area renders
  rows by kind: add `case "queued":`), `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

`runqueuemodel.ts`, pure:
- `queueProject(entry)`: the last path segment of `entry.projectpath` (the same rule `runlineagestore.ts:87`
  `lastPathSegment` uses for a run's project; export and reuse it rather than copying).
- `queuedRows(entries, runTitles: Record<string,string>)`: per project, in queue order, `place` = 1-based place among
  all waiting entries (global, since the cap is global), `null` for a blocked one; `afterTitle` from `runTitles` or
  the after-entry's title.
- `queuedMeta(row)`: `"Queued #2"`, `"After Learned additions"` (when `after` is set and still unmet), or
  `"Blocked · <reason>"`.

`projectTree`: each project's queued rows go right after its agent body rows and before its divider/terminals; a
project with only queued rows still gets a folder (after the agents' projects, before Home). A collapsed project hides
them; its group row does not count them as agents.

`runqueuestore.ts`: `runQueueAtom` loaded with `RpcApi.RunQueueListCommand` on first use and replaced from
`runqueue:changed` (`waveEventSubscribeSingle`, as `runlineagestore.ts:253` subscribes).

`QueuedRow`: Clock glyph (lucide `Clock`) in the row's `Slot`, title, the meta line (`text-warning`-family token for
blocked, as a held land is drawn); hover shows two icon buttons, Start now (`Play`) and Remove (`X`); the context menu
has Start now, Run next (not on the entry with `place === 1`) and Remove; Remove asks with the app's confirm modal (as
`confirmCloseRun` does). Click does nothing but select nothing; the `title` attribute holds plan path, lead route
(`data.runtime` / `data.model`) and the queued time. `data-run-queue-row={entry.id}` on the row for the scenario.

CDP scenario `run-queue` (in `scenarios.mjs`; `scenarios.mjs:1605-1625` creates a channel and a run held by
`deferstart` that spawns nothing, and `:9655` restores a `setconfig` in teardown):
- arrange: `setconfig {"runs:maxactive": 1}`; create a channel on `ctx.cwd`; `createrun` a quick run with
  `deferstart: true` (it stays in planning, spawns nothing, and counts as active); write a tiny valid plan file to a
  temp dir; `runqueueadd` it twice (entry A plain, entry B `after` A's id); write a second plan, `runqueueadd` it, then
  delete that file and call `runqueuestartnow` on it so it blocks with "plan file … not found".
- goto the Agent surface; shot the project's rows.
- assert: rows `data-run-queue-row` for all three; texts `Queued #1`, `After`, `Blocked ·`.
- teardown: `runqueueremove` the three, `cancelrun` the deferred run, restore `runs:maxactive`, remove the temp files.

CHANGELOG (Added): one line saying a plan can be queued with `wsh runs start --queue` (or `--after` another run) and
starts by itself when fewer than `runs:maxactive` runs are going, with the tree's Start now / Run next / Remove.

**Steps:**
1. Write `runqueuemodel.test.ts` (places across projects, blocked has no place, the three meta texts) and add
   `projectTree` cases to `agentsidebarmodel.test.ts` (queued rows after the body and before the divider; a
   queue-only project gets a folder; collapsed hides them).
2. Run `npx vitest run frontend/app/view/agents/runqueuemodel.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts`
   — fails.
3. Implement the model, store, tree input and row; add the scenario and the CHANGELOG line.
4. Run the vitest files again — pass; typecheck passes.
5. Commit `feat(agents): queued runs on the tree, with Start now, Run next and Remove`.

### Task 6: A session and its runs point at each other

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/runorigin.ts`, `frontend/app/view/agents/runorigin.test.ts`, `frontend/app/view/agents/donesuggest.ts`, `frontend/app/view/agents/donesuggest.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `CHANGELOG.md`, `docs/open-issues.md`

**Where:**
- Create: `runorigin.ts` (+ test)
- Modify: `donesuggest.ts:17-33` (a `queued` argument), `agenttree.tsx` (`ParentRow` at `:685` gets the `→` line and
  passes the queue to `doneSuggestion` at `:732`; `RunRow` at `:1026` and a lead's `ParentRow` get the `from` line via
  `RunSubline` at `:618`)

`runorigin.ts`, pure:
- `originLinks(agentId, runs: Record<string, RunInfo>, queue: RunQueueEntry[])`: the runs whose `originId` is the agent
  and the waiting/blocked entries whose `data.origintabid` is the agent's tab id (`AgentVM.id` is the tab id, as
  `donesuggest.ts:31` compares). One link → `{text: "→ <title> · 3/5" | "→ Queued #2" | "→ merged" | "→ held",
  target}` (progress from `runProgress`, `runlineage.ts:337`; merged/held from `run.land`); two or more →
  `{text: "→ N runs", target: <the newest>}`; none → null.
- `originName(run, agents)`: the origin agent's name when its tab is in the roster, else null.

`ParentRow`: under the name line, when `originLinks` is not null, one `text-[11px]` muted line; clicking it focuses
the target (`selectAgentRow` on the run's focus agent for a run; for a queued entry, scroll its `data-run-queue-row`
into view). `RunRow` and a lead's row: `from <name>` appended to the subline; a click selects the origin agent.
Rows never move and are not dimmed.

`doneSuggestion(agent, unreadCount, runs, backgroundRunning, queued)`: false also while any entry in `queued` has
`data.origintabid === agent.id`.

CHANGELOG (Added): a session that started a run shows where the run is (`→ … 3/5`, queued, merged, held) and the
run names the session it came from; a click on either goes to the other.

**Steps:**
1. Write `runorigin.test.ts` (one run with progress, a queued entry, a landed run, a held run, two links, no link,
   the origin gone) and add a `donesuggest.test.ts` case for a queued entry.
2. Run `npx vitest run frontend/app/view/agents/runorigin.test.ts frontend/app/view/agents/donesuggest.test.ts` —
   fails.
3. Implement, then wire the rows.
4. Run the vitest files — pass; typecheck passes.
5. Add under "0 · Waiting on a hand check" in `docs/open-issues.md`: `- [ ] (arcterm) Run handoff: a session that ran
   wsh runs start shows "→ <run> · n/m" and the run row shows "from <session>"; each click goes to the other.`
   (No CDP scenario can stage an origin session without launching a real agent.)
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
