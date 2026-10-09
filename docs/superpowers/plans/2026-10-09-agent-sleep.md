# Agent sleep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** an idle agent idle for 30 minutes (or the longest-idle one when free RAM drops under 1 GiB) is put to
sleep: its process ends and its RAM is freed, but its row, terminal output and conversation stay. **Wake**, or a
message sent to it, relaunches it with `--resume`. Manual **Sleep** in the Consumers panel and the row's menu.

**Architecture:** a pure Go package `pkg/agentsleep` decides who may sleep (idle tracker, CPU ring, background-task
scan, `Pick`). `wshserver` owns the side effects: `sleepAgent` writes `agent:sleeping` + resume `cmd:args` into
block meta and destroys the controller; `AgentsWakeCommand` clears it, restarts with force and, given a message,
delivers it once the agent reports in. A once-a-minute loop started from `main-server.go` drives it. The roster
keeps a sleeping agent (state `sleeping`); the frontend reads the meta into `AgentVM.sleeping` and draws the moon,
the card over the terminal, the Consumers panel's Sleeping group and two settings.

**Tech Stack:** Go (wavesrv, gopsutil), React 19 + jotai, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-09-agent-sleep-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/agentsleep ./pkg/wshrpc/... ./pkg/blockcontroller ./pkg/wconfig ./pkg/waveobj ./cmd/server/...`

**Check:** `task check:ts && go vet ./pkg/agentsleep ./pkg/wshrpc/... ./pkg/blockcontroller ./cmd/server/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: agent-sleep needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs agent-sleep surface-smoke`

## Notes for every worker (read before your task)

Facts the spec does not state, found in the code:

- **The roster drops a tab whose shell is not running** (`buildAgentRoster`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go:142`, the `!tf.ShellRunning` skip). A slept agent has no controller, so Task 3 must load block meta for those tabs and keep a tab whose block has `agent:sleeping` set, with state `sleeping`.
- **Raw state, not `row.State`.** `agentsState` folds `waiting` (a permission prompt) into idle. Eligibility uses `row.status.State == baseds.AgentState_Idle`.
- **`status.Ts` is not idle-since.** Claude's `idle_prompt` re-reports idle about a minute after Stop, and a destroyed controller's exit (`emitAgentIdleOnExit`, `pkg/blockcontroller/shellcontroller.go:595`) publishes a bare idle with no transcript path or cwd. The loop keeps its own first-idle time per block (`agentsleep.IdleTracker`). Read the transcript path and session **before** destroying.
- **Harnesses:** the roster's `agentHarnesses` is claude, pi and agy. opencode is not in the roster, so it is never slept (the spec listed it; the roster already rules it out). codex is never slept.
- **Resume args:** `agentResumeFlags` (`pkg/blockcontroller/agentrestore.go:39`). Session key: claude = transcript path stem (`--resume <stem>`), pi = transcript path (`--session <path>`), agy = `status.SessionID` (`--conversation <id>`). Base args come from block meta `agent:baseargs` (untyped; may be missing → base args empty).
- **Meta from Go:** `wstore.UpdateObjectMeta(ctx, oref, meta, false)`; a nil value deletes a key; follow it with `wcore.SendWaveObjUpdate(oref)` when changed, or the frontend never sees it.
- **Controllers from Go:** `blockcontroller.DestroyBlockController(blockId)`; `blockcontroller.ResyncController(ctx, tabId, blockId, &waveobj.RuntimeOpts{}, true)` restarts (as `jarvis.ResumeRunWorker` does, `pkg/jarvis/runexec.go:110`).
- **Delivering a message:** `deliverAgentMessage(blockId, text)` (`wshserver_agentmsg.go:64`) has no confirmation and no wait-for-ready. A resumed Claude fires SessionStart `source:"resume"` → a retained `agent:status` with a fresh `Ts`; `orchestrate.LatestAgentStatus(blockId, tabId)` reads it. `agentctl.Has(blockId)` turns true when the mod attaches. Ready = either, with `Ts` after the wake time.
- **Notices:** a Go `wps.Event_Notify` (`publishNotice`, `cmd/server/main-server.go:152`) shows in the pet bubble when the window is focused and as an OS notification when not; that is the auto-sleep notice. Manual actions toast from the frontend with `pushToast`.
- **The frontend composer types raw PTY input** (`ControllerInputCommand`, `frontend/app/view/agents/agentcomposer.tsx:53-64`); into a slept block it fails silently. Task 5 routes it through wake.
- Generated files: run `task generate` after changing any wshrpc / waveobj / wconfig type; never hand-edit the outputs.
- Commit with paths (`git commit -- <paths>`); the tree is shared.

---

### Task 1: Types, meta keys, settings and RPC stubs

**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/waveobj/wtypemeta.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/defaultconfig/settings.json`, `pkg/wshrpc/wshserver/wshserver_agentsleep.go`, `pkg/waveobj/metaconsts.go`, `pkg/wconfig/metaconsts.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `schema/settings.json`

**Step 1: RPC types** in `pkg/wshrpc/wshrpctypes_agents.go`:

- Add `AgentsState_Sleeping = "sleeping"` beside the other `AgentsState_*` constants.
- Add to `AgentInfo`: `SleptAt int64 \`json:"sleptat,omitempty"\`` (unix ms) and `FreedBytes uint64 \`json:"freedbytes,omitempty"\``.
- Add to `AgentCommands`, next to `AgentsSetModelCommand`:

```go
AgentsSleepCommand(ctx context.Context, data CommandAgentsSleepData) (*CommandAgentsSleepRtnData, error)    // put an idle agent to sleep: its process ends, its tab and conversation stay
AgentsWakeCommand(ctx context.Context, data CommandAgentsWakeData) error                                   // relaunch a sleeping agent with --resume; with Message, deliver it once the agent reports in
AgentsSetViewingCommand(ctx context.Context, data CommandAgentsSetViewingData) error                      // the frontend's agents on screen, which the sleep loop never sleeps
```

```go
type CommandAgentsSleepData struct {
	Tab   string `json:"tab"`
	Force bool   `json:"force,omitempty"` // stop its background tasks too (the person confirmed)
}

type CommandAgentsSleepRtnData struct {
	FreedBytes uint64   `json:"freedbytes,omitempty"`
	Background []string `json:"background,omitempty"` // set, and nothing slept, when it has running background work and Force is false
}

type CommandAgentsWakeData struct {
	Tab     string `json:"tab"`
	Message string `json:"message,omitempty"`
}

type CommandAgentsSetViewingData struct {
	TabIds []string `json:"tabids"`
}
```

**Step 2: Meta keys** in `pkg/waveobj/wtypemeta.go`, beside the other `agent:` keys: `AgentSleeping int64 \`json:"agent:sleeping,omitempty"\`` (unix ms it slept; 0 or absent = awake) and `AgentSleepFreed int64 \`json:"agent:sleepfreed,omitempty"\`` (bytes freed).

**Step 3: Settings** in `pkg/wconfig/settingsconfig.go`, a new group following the `ClaudeClear` pattern:

```go
AgentsClear         bool   `json:"agents:*,omitempty"`
AgentsSleepIdle     *bool  `json:"agents:sleepidle,omitempty"`
AgentsSleepAfterMin *int64 `json:"agents:sleepaftermin,omitempty"`
```

and in `pkg/wconfig/defaultconfig/settings.json`: `"agents:sleepidle": true, "agents:sleepaftermin": 30`.

**Step 4: Stubs** — create `pkg/wshrpc/wshserver/wshserver_agentsleep.go` with the three `WshServer` methods returning `fmt.Errorf("not implemented")` so the build stays green (Task 3 fills them).

**Step 5:** `task generate`, then `go build ./...` and `go test ./pkg/wconfig -run 'Sync|Key'` (the settings-key sync test). Expected: PASS.

**Step 6: Commit** — `git commit -m "feat(agents): sleep types, meta keys and settings" -- <the Files above>`.

---

### Task 2: `pkg/agentsleep`: who may sleep

**Depends on:** none
**Files:** `pkg/agentsleep/agentsleep.go`, `pkg/agentsleep/agentsleep_test.go`, `pkg/agentsleep/background.go`, `pkg/agentsleep/background_test.go`

Pure: no wavesrv imports, no clocks read (time is passed in), no process calls.

**Step 1: Write the failing tests** (`agentsleep_test.go`), one per rule:

```go
func TestPickSleepsOnlyAfterTheIdleTime(t *testing.T)        // idle 29m: none; 30m: picked
func TestPickNeverSleepsAgentsThatDoNotQualify(t *testing.T) // table: not idle, run-owned, no session, viewing, background, subagents, busy CPU, unsupported harness → never picked
func TestPickRAMTriggerSleepsTheLongestIdleOne(t *testing.T) // free < LowRAM: one agent, the longest idle (≥ 1m), even under 30m
func TestPickRAMTriggerOnlyWhenTimeTriggerPickedNone(t *testing.T)
func TestPickDisabledPicksNone(t *testing.T)
func TestIdleTrackerKeepsFirstIdleTime(t *testing.T)         // idle at t0, idle again at t1 → since t0; working resets; Forget drops gone blocks
func TestCPURingIdleOnlyOverAFullWindow(t *testing.T)        // < 5m of samples: not idle; 5m at < 5% share: idle; a falling total: busy
func TestManualBlocksOnlyOnBackgroundWork(t *testing.T)      // Manual ignores idle time and viewing, still reports background/subagents
```

**Step 2:** `go test ./pkg/agentsleep` → FAIL (undefined).

**Step 3: Implement** `agentsleep.go`:

```go
// Package agentsleep decides which idle agents may be put to sleep: their process ended to free RAM, their
// tab and conversation kept, resumed on demand. Pure; wshserver gathers the facts and does the sleeping.
package agentsleep

const LowRAM uint64 = 1 << 30                 // below this free RAM, the longest-idle agent sleeps early
const RAMTriggerMinIdle = time.Minute         // the RAM trigger still never sleeps an agent that just finished
const CPUWindow = 5 * time.Minute
const IdleCPUShare = 0.05                     // the share of one core under which a tree counts as idle

var Harnesses = map[string]bool{"claude": true, "pi": true, "agy": true}

type Candidate struct {
	TabId, BlockId, Harness string
	Idle              bool      // raw status idle (not waiting, not asking)
	IdleSince         time.Time // from IdleTracker
	RunOwned          bool
	SessionKnown      bool
	Viewing           bool
	BackgroundRunning bool
	SubagentsRunning  bool
	CPUIdle           bool // CPURing.Idle over CPUWindow
}

type Settings struct {
	Enabled bool
	After   time.Duration
}

// Pick returns the tab ids to sleep this check: every eligible agent idle for Settings.After, or, when none is
// and free RAM is under LowRAM, the one eligible agent idle longest (at least RAMTriggerMinIdle).
func Pick(cands []Candidate, now time.Time, s Settings, freeBytes uint64) []string

// Blocker says why the person's own Sleep must ask first ("" when nothing stands in the way): background
// tasks or subagents still running. It ignores idle time and Viewing; the person chose this agent.
func Blocker(c Candidate) string

type IdleTracker struct{ since map[string]time.Time }
func NewIdleTracker() *IdleTracker
func (t *IdleTracker) Observe(blockId string, idle bool, now time.Time) time.Time // the first idle time of the current idle stretch; zero when not idle
func (t *IdleTracker) Forget(keep map[string]bool)                              // drop blocks no longer in the roster

type CPURing struct{ samples map[string][]cpuSample } // per block, cumulative CPU ms at a time
func NewCPURing() *CPURing
func (r *CPURing) Add(blockId string, now time.Time, cumulativeMs float64)
func (r *CPURing) Idle(blockId string, now time.Time) bool // true only with samples spanning CPUWindow and a delta share < IdleCPUShare; a falling total is busy
func (r *CPURing) Forget(keep map[string]bool)
```

Eligible (inside `Pick`) = `Harnesses[c.Harness] && c.Idle && !c.RunOwned && c.SessionKnown && !c.Viewing && !c.BackgroundRunning && !c.SubagentsRunning && c.CPUIdle`. Sort RAM-trigger choice by `IdleSince` ascending, tie by `TabId`.

**Step 4: Background scan** (`background.go`): `func BackgroundRunning(lines []string) []string` returns the labels of background shell tasks still running in a Claude transcript. Port `extractBackgroundTasks` (`frontend/app/view/agents/transcriptprojection.ts:470`) with its `SHELL_TOOLS`, `BG_ID_TEXT`, `BG_OUTPUT_TEXT` and completion handling, keeping only tasks whose status ends `running`. Mirror its cases from `frontend/app/view/agents/transcriptprojection.test.ts` in `background_test.go` (started → running; KillShell/TaskStop → stopped; completion notice → done; unparsable lines skipped).

**Step 5:** `go test ./pkg/agentsleep` → PASS.

**Step 6: Commit** — `git commit -m "feat(agentsleep): who may sleep: idle tracker, CPU ring, background scan, Pick" -- pkg/agentsleep`.

---

### Task 3: Sleep and wake in wavesrv; the roster keeps a sleeping agent

**Depends on:** Task 1, Task 2
**Files:** `pkg/wshrpc/wshserver/wshserver_agentsleep.go`, `pkg/wshrpc/wshserver/wshserver_agentsleep_test.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/blockcontroller/agentrestore.go`, `pkg/blockcontroller/blockcontroller.go`

**Step 1: Write the failing tests** (`wshserver_agentsleep_test.go`), using the package's existing seams (`loadAgentRosterFacts`, `deliverAgentMessage`, `consumerBlockPid`) and new seams for the side effects (`destroyBlock`, `resyncBlock`, `updateBlockMeta`, `latestStatus`, `wakeReadyTimeout`, `wakePoll`):

```go
func TestRosterKeepsASleepingAgent(t *testing.T)            // shell not running + agent:sleeping → row with State sleeping, SleptAt, FreedBytes
func TestRosterStillDropsAnEndedAgent(t *testing.T)         // shell not running, no agent:sleeping → no row
func TestSleepWritesResumeArgsThenDestroys(t *testing.T)    // claude: cmd:args = baseargs + --resume <stem>; agent:sleeping set; destroy called after the meta write
func TestSleepRefusesWithoutASession(t *testing.T)
func TestSleepReportsBackgroundWorkUnlessForced(t *testing.T)
func TestSleepClearsMetaWhenDestroyFails(t *testing.T)
func TestWakeClearsMetaAndRestartsWithForce(t *testing.T)
func TestWakeDeliversTheMessageOnceTheAgentReportsIn(t *testing.T) // a status Ts after the wake → delivered once
func TestWakeTimesOutWithoutDelivering(t *testing.T)               // no report within the timeout → error, nothing delivered
func TestSendToASleepingAgentWakesIt(t *testing.T)                 // AgentsSendCommand on a sleeping target goes through wake with the envelope
func TestSetViewingExpires(t *testing.T)                           // a push older than 3 minutes counts as none
```

`go test ./pkg/wshrpc/wshserver -run 'Sleep|Wake|SetViewing|RosterKeeps|RosterStillDrops'` → FAIL.

**Step 2: Roster.** In `readAgentRosterFacts`, for a tab whose shell is not running, load its block (`wstore.DBGet[*waveobj.Block]`) and record `Sleeping`/`SleepFreed` from meta, plus `agent:transcriptpath` (the exit event carried none). In `buildAgentRoster`, keep such a tab when `Sleeping > 0` with `State = AgentsState_Sleeping`, `SleptAt`, `FreedBytes`, its harness from the block's `cmd` meta. Live tabs are unchanged.

**Step 3: Resume args.** In `pkg/blockcontroller/agentrestore.go` export `func ResumeArgs(harness, session string, baseArgs []string) ([]string, bool)` built on `agentResumeFlags` (false when the harness has no flag or the session is empty).

**Step 4: Guard the server relaunch.** In `ResyncController` (`pkg/blockcontroller/blockcontroller.go:211`), when `!force` and the block's meta has `agent:sleeping` > 0, return nil without starting it. Add a test beside the existing blockcontroller tests if one fits; otherwise Step 1's wake test covers the force path.

**Step 5: Implement** in `wshserver_agentsleep.go`:

- `sessionKey(row, transcriptPath)` → claude: stem of the path; pi: the path; agy: `status.SessionID`.
- `func sleepAgent(ctx, row *agentRow, force bool) (*wshrpc.CommandAgentsSleepRtnData, error)`: read the transcript path (`agentTranscriptPath`); if not forced, `agentsleep.BackgroundRunning(readTranscriptTail(path, 2000))` and `listSubagents(path)` (any not `Done`) → return them in `Background`, sleep nothing. Measure the tree's bytes first (`consumerBlockPid` + the consumers sampler). Write meta `cmd:args`, `agent:sleeping = now ms`, `agent:sleepfreed`, then `SendWaveObjUpdate`, then destroy. On a destroy error, delete the two sleep keys and return the error.
- `AgentsSleepCommand`: resolve the tab (roster), refuse unless raw state idle (or the `waiting` prompt is refused too) and the harness is in `agentsleep.Harnesses`, then `sleepAgent`.
- `AgentsWakeCommand`: resolve the tab; refuse unless sleeping; delete the sleep keys, `SendWaveObjUpdate`, `ResyncController(..., true)`. With a `Message`, poll `latestStatus` every `wakePoll` (500 ms) until a status `Ts` after the wake time or `agentctl.Has(blockId)`, then `deliverAgentMessage(blockId, Message)`; after `wakeReadyTimeout` (60 s) return `fmt.Errorf("%s did not come back within 60s; your message was not sent", name)`.
- `AgentsSetViewingCommand`: keep the tab ids and the time in a mutex-guarded package var; `viewingTabs(now)` returns them, or none when older than 3 minutes.
- In `AgentsSendCommand`, after resolving the target: if `target.State == AgentsState_Sleeping`, call the wake path with the envelope as Message and return.

**Step 6:** the Step 1 tests → PASS.

**Step 7: Commit** — `git commit -m "feat(agents): sleep and wake an agent; the roster keeps a sleeping one" -- <the Files above>`.

---

### Task 4: The once-a-minute sleep loop

**Depends on:** Task 3
**Files:** `pkg/wshrpc/wshserver/wshserver_agentsleeploop.go`, `pkg/wshrpc/wshserver/wshserver_agentsleeploop_test.go`, `cmd/server/main-server.go`

**Step 1: Write the failing tests**:

```go
func TestSleepTickSleepsAnAgentIdleFor30Minutes(t *testing.T)   // drive tick() over 31 fake minutes with an idle row and a flat CPU total → sleepAgent called once
func TestSleepTickLeavesAViewedAgentAlone(t *testing.T)
func TestSleepTickRAMTriggerSleepsOneEarly(t *testing.T)        // free 800 MB, two idle agents idle 6m and 9m → the 9m one only
func TestSleepTickOffWhenTheSettingIsOff(t *testing.T)
func TestSleepTickNotifiesOncePerTick(t *testing.T)            // two slept → one notice "Put 2 agents to sleep · freed 520 MB"
```

`go test ./pkg/wshrpc/wshserver -run SleepTick` → FAIL.

**Step 2: Implement** `wshserver_agentsleeploop.go`:

- `type sleepLoop struct { idle *agentsleep.IdleTracker; cpu *agentsleep.CPURing; now func() time.Time; settings func() agentsleep.Settings; notify func(wshrpc.NotifyCommandData) }`
- `func (l *sleepLoop) tick(ctx context.Context)`: return when `!settings().Enabled`; load the roster facts; for each live row in `agentsleep.Harnesses`: `idle.Observe(blockId, status.State == baseds.AgentState_Idle, now)`; sample the tree's cumulative CPU ms (gopsutil `Times()` User+System summed over `memusage.ProcessTree` of `blockcontroller.GetBlockControllerPid`, the same sum as `sampleChildTree` in `pkg/orchestrate/liveness.go:206`, behind a seam `treeCPUms`) into `cpu.Add`; build a `Candidate` (RunOwned = `RunId != ""`, SessionKnown from `sessionKey`, Viewing from `viewingTabs`, Background/Subagents from the transcript as in Task 3, CPUIdle from `cpu.Idle`). Read free RAM with `virtualMemory` (`wshserver_workercap.go:18`). `agentsleep.Pick` → `sleepAgent(ctx, row, false)` for each; sum the freed bytes; when any slept, one `notify` (`Title: "Put N agent(s) to sleep"`, `Message: "freed X"`, level info). Forget gone blocks from both trackers.
- `func StartAgentSleepLoop(ctx context.Context, notify func(wshrpc.NotifyCommandData))`: a goroutine with a one-minute ticker and panic recovery (`panichandler`, as the other loops), settings from `wconfig.GetWatcher().GetFullConfig().Settings` (`AgentsSleepIdle` default true, `AgentsSleepAfterMin` default 30, floor 5).

**Step 3: Start it** in `cmd/server/main-server.go`, after `RestoreLiveAgents` (line ~379): `wshserver.StartAgentSleepLoop(ctx, publishNotice)` (adapt to `publishNotice`'s signature).

**Step 4:** `go test ./pkg/wshrpc/wshserver -run SleepTick` → PASS; `go build ./cmd/server/...`.

**Step 5: Commit** — `git commit -m "feat(agents): idle agents sleep after 30 minutes, or early when RAM runs low" -- <the Files above>`.

---

### Task 5: Frontend model: `AgentVM.sleeping`, no relaunch, wake on send, viewing push

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/agentsleep.ts`, `frontend/app/view/agents/agentsleep.test.ts`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/liveagents.ts`, `frontend/app/view/agents/session-models/agentresumestore.ts`, `frontend/app/view/agents/session-models/agentresumestore.test.ts`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/term/term-model.ts`, `frontend/app/view/agents/agentcomposer.tsx`, `frontend/app/view/agents/agents.tsx`

**Step 1: Write the failing tests**:

- `agentresumestore.test.ts`: `shouldRelaunchWorker` (or a new `relaunchBlockedBy(meta, runStatus)`) returns a reason for `{"agent:sleeping": 1700000000000}` and null when it is 0 or absent.
- `agentsleep.test.ts`: `sleepingOf(meta)` → `{since, freedBytes}` or undefined; `sleepingAge(vm, now)` → `"sleeping 2h"`; `viewingTabIds(...)` from the focused id and the shown grid panes (pure inputs).

`npx vitest run frontend/app/view/agents/agentsleep.test.ts frontend/app/view/agents/session-models/agentresumestore.test.ts` → FAIL.

**Step 2: Implement**

- `agentsleep.ts` (pure helpers + thin actions): `sleepingOf`, `sleepingAge`, `viewingTabIds`; `wakeAgent(tabId, message?)` → `RpcApi.AgentsWakeCommand(TabRpcClient, {tab, message}, {timeout: 70_000})`; `sleepAgent(tabId, force?)` → `AgentsSleepCommand`; `useViewingSync(model)` pushes `AgentsSetViewingCommand` when the viewed set changes and once a minute (viewed = `focusIdAtom` plus the panes the Agent grid shows; reuse what `unreadagents.ts:81` calls viewing).
- `agentsviewmodel.ts`: add `sleeping?: { since: number; freedBytes: number }` to `AgentVM`, set in `agentVMFromInput` from the input; `AgentState` stays three states (the maps keyed by it are untouched).
- `liveagents.ts`: pass `sleepingOf(block.meta)` into the input the way `blockLoginEmail` is passed (`liveagents.ts:75`).
- `agentresumestore.ts` + `termwrap.ts:695-726`: the pane-mount resync skips a block with `agent:sleeping`.
- `term-model.ts:477-481`: the Enter-restarts-a-done-terminal path does nothing for a sleeping block.
- `agentcomposer.tsx`: when the block's agent is sleeping, send through `wakeAgent(tabId, text)` instead of `ControllerInputCommand`; on error keep the text in the box and `pushToast` the error.
- `agents.tsx`: call `useViewingSync(model)` in the always-mounted shell.

**Step 3:** the Step 1 tests → PASS.

**Step 4: Commit** — `git commit -m "feat(agents): the cockpit knows a sleeping agent and wakes it on send" -- <the Files above>`.

---

### Task 6: Sidebar row and the card over the terminal

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/sleepingcard.tsx`, `frontend/app/view/agents/agentsurface.tsx`

- `agenttree.tsx` `ParentRow`: when `agent.sleeping`, a lucide `Moon` (size 10, `text-muted`, `aria-label="sleeping"`, `data-agent-sleeping`) replaces the `StatusDot` (line ~572), and the age column reads `sleepingAge(agent, now)`. The name keeps its normal color. In `onContextMenu` (456-475), before the separator: **Wake** for a sleeping agent, **Sleep** for an idle one (calls `sleepAgent`; when the result lists `background`, open a `ConfirmModal` naming them and retry with `force`). Toast the result (`Put X to sleep · freed 330 MB`).
- `sleepingcard.tsx`: `SleepingCard({ agent })` renders null unless `agent.sleeping`; otherwise a bar in the `HeldAskBar` style (`heldaskbar.tsx`, `data-sleeping-card`): Moon, **Sleeping since 14:20 · freed 330 MB**, and a **Wake** button (`wakeAgent`; while pending it reads "Waking…"; on error the card shows the reason with **Start fresh** (wake after clearing `cmd:args` resume, via `SetMetaCommand` then `AgentsWakeCommand`) and **Close** (`confirmCloseSession`)).
- `agentsurface.tsx:515`: mount `<SleepingCard agent={focused} />` beside `<HeldAskBar/>`. Do not change the terminal grid (AGENTS.md: the grid parent is always rendered).
- Colors and radii from `@theme` tokens only (DESIGN.md).

**Acceptance:** the `agent-sleep` scenario's steps "sidebar row shows the moon and sleeping age", "the card over the terminal shows Sleeping since … and Wake" and "Sleep in the row menu" (Task 8) pass.

**Commit** — `git commit -m "feat(agents): a sleeping agent's row shows a moon; its terminal a Wake card" -- <the Files above>`.

---

### Task 7: Consumers panel and Settings

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/consumers.ts`, `frontend/app/view/agents/consumers.test.ts`, `frontend/app/view/agents/consumerspanel.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingspages/agents.tsx`

**Step 1: Failing tests** in `consumers.test.ts`: a row whose `vm.sleeping` is set lands in a last group `{key: "sleeping", label: "Sleeping"}` with `ramBytes` undefined; `canSleep` is true only for an awake idle row on claude/pi/agy with no run; `canSonnet` is false for a sleeping row. `settingsmodel.test.ts`: the wconfig-backed key list gains `agents:sleepidle` and `agents:sleepaftermin`.

**Step 2: Implement**

- `consumers.ts`: `ConsumerRow` gains `sleeping: boolean` and `canSleep: boolean`; `buildConsumers` puts sleeping rows in the Sleeping group last (kept by `holdOrder`).
- `consumerspanel.tsx` `Row`: a sleeping row shows a Moon instead of the dot and **Wake** + **Stop**; an awake row with `canSleep` shows **Sleep** beside **→ Sonnet** (the same confirm-on-background flow as Task 6; toast the freed bytes). Data attributes `data-consumer-sleep`, `data-consumer-wake`.
- `settingsmodel.ts` "agents" section: a **Sleep idle agents** card with rows `agents.sleepidle` (Toggle, `key: "agents:sleepidle"`, `config: true`, desc "End an idle agent's process to free RAM; Wake or a message resumes it") and `agents.sleepaftermin` (`key: "agents:sleepaftermin"`, `config: true`, "After idle for", minutes).
- `settingspages/agents.tsx`: render them with `<Toggle>` and `<Stepper>` (step 5, min 5, max 240; example `settingspages/terminal.tsx:31`), reading with `getSettingsKeyAtom` and writing with `writeConfig`.

**Step 3:** `npx vitest run frontend/app/view/agents/consumers.test.ts frontend/app/view/agents/settingsmodel.test.ts` → PASS.

**Acceptance:** the `agent-sleep` scenario steps "Consumers panel shows a Sleeping group with Wake" and "Settings → Agents shows Sleep idle agents" (Task 8) pass.

**Commit** — `git commit -m "feat(consumers): Sleep and Wake in the panel; Sleep idle agents settings" -- <the Files above>`.

---

### Task 8: CDP scenario `agent-sleep` and the changelog

**Depends on:** Task 4, Task 6, Task 7
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

- Add `agentSleep` to `scripts/cdp/scenarios.mjs`, modelled on `consumersPopover` (~21209) and `agentTreeRail` (~8792), and register it in `SCENARIOS` (~25085). Arrange: write a fixture (`TREE_RAIL_FIXTURE` pattern, `public/cockpit-fixtures/active.json`) with one awake idle agent and one sleeping agent (`sleeping: {since: now - 2h, freedBytes: 330 * 2**20}`), `ahReload`; mock `getconsumers` with `installConsumersMock`, plus `agentssleep` / `agentswake` returning success. Steps, each with a screenshot:
  1. sidebar row shows the moon and sleeping age (`[data-agent-row="<id>"] [data-agent-sleeping]`, text `sleeping 2h`);
  2. focus the sleeping agent: the card over the terminal shows "Sleeping since" and Wake (`[data-sleeping-card]`);
  3. Sleep in the row menu: right-click the awake row, the menu has **Sleep**;
  4. Consumers panel shows a Sleeping group with Wake (`[data-consumer-wake]`) and Sleep on the awake row (`[data-consumer-sleep]`);
  5. Settings → Agents shows Sleep idle agents (toggle and the minutes stepper).
  Teardown removes the fixture and the mocks, `ahReload`.
- `CHANGELOG.md`, top section `### Added`: one line — "An agent idle for 30 minutes goes to sleep: its process ends and its RAM is freed, but its row and conversation stay; **Wake**, or a message to it, picks it up where it was. When RAM runs low the longest-idle one sleeps early. Settings → Agents → **Sleep idle agents** sets the time or turns it off; **Sleep** is also in the RAM panel and the row's menu."

**Commit** — `git commit -m "test(cdp): agent-sleep scenario; changelog" -- scripts/cdp/scenarios.mjs CHANGELOG.md`.
