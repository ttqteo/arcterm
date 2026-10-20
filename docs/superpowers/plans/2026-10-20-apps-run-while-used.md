# Apps run while used: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A held service runs only while it is used in arcterm: opening it starts it, leaving it stops it after one
minute unless it is busy, Setup → Tools manages apps, the footer shows what runs, and the app bar's Services chip and
popover go.

**Architecture:** The Go supervisor (`pkg/services`) loses the `stopped` state and the remembered Stop, sleeps one
minute after a service leaves the screen, and asks a new `Deps.Procs` whether the service's process tree has work in
progress before it sleeps. The frontend drops what only the stopped state and the Services popover used, filters the
Agent tree's services to the ones up or in trouble, and moves Pin and Stop into Setup → Tools and the footer's Servers
popover.

**Tech Stack:** Go (wavesrv), React 19 + jotai + Tailwind, vitest, the CDP scenario harness.

Spec: `docs/superpowers/specs/2026-10-20-apps-run-while-used-design.md`. Read it first.

**Verify:** `node scripts/verify.mjs ./pkg/services`

**Final:** `node scripts/cdp/final-verify.mjs services-states services-tree services-rail services-setup services-busy machine-servers jobqueue-chip consumers-popover`

---

### Task 1: Supervisor: one idle state, one minute, never in the middle of work

**Depends on:** none
**Files:** `pkg/services/model.go`, `pkg/services/model_test.go`, `pkg/services/supervisor.go`, `pkg/services/supervisor_test.go`, `pkg/services/statefile_test.go`, `pkg/services/real.go`, `pkg/services/real_test.go`, `pkg/services/procs_test.go`, `pkg/services/procs_windows_test.go`

What changes where: `model.go` (states, `IdleSleep`, new `BusyMaxAge`, new pure `Busy`); `supervisor.go`
(`Remembered`, `Deps`, `idleState`, `startsNowLocked`, `startService`, `SetTools`, `sleepTick`, `stop`, `OnExit`,
`OnBlockClosed`); `real.go` (`realDeps`: the real `Procs`); the tests named below.

All `go` commands here run in Git Bash with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front
(written `$GOENV` below), or every test that opens the sqlite store panics.

**Step 1: Write the failing test for `Busy`** (append to `pkg/services/model_test.go`)

```go
func TestBusy(t *testing.T) {
	up := int64(1_000_000) // when the page first answered
	now := up + int64(5*time.Minute/time.Millisecond)
	late := up + 2*BusyMaxAge.Milliseconds() // long enough after up that an old helper still started after it
	cases := []struct {
		name  string
		procs []Proc
		now   int64
		want  bool
	}{
		{"nothing runs", nil, now, false},
		{"only what was there when the page answered", []Proc{{Pid: 1, StartMs: up - 2000}, {Pid: 2, StartMs: up - 10}}, now, false},
		{"a run the server started after", []Proc{{Pid: 1, StartMs: up - 2000}, {Pid: 9, StartMs: now - 30_000}}, now, true},
		{"a helper started after up but older than BusyMaxAge is the server's own", []Proc{{Pid: 9, StartMs: late - BusyMaxAge.Milliseconds() - 1}}, late, false},
		{"one younger than BusyMaxAge at the same late time is work", []Proc{{Pid: 9, StartMs: late - BusyMaxAge.Milliseconds() + 1000}}, late, true},
	}
	for _, c := range cases {
		if got := Busy(c.procs, up, c.now); got != c.want {
			t.Errorf("%s: Busy = %v, want %v", c.name, got, c.want)
		}
	}
	if Busy([]Proc{{Pid: 9, StartMs: now}}, 0, now) {
		t.Error("a service that never answered is never busy")
	}
}
```

**Step 2: Run it to see it fail**

Run: `$GOENV go test ./pkg/services -run '^TestBusy$'`
Expected: FAIL to compile, `undefined: Proc` / `undefined: Busy`.

**Step 3: Implement in `pkg/services/model.go`**

- `IdleSleep = time.Minute` (its comment: how long a service without Keep running runs with its page off screen
  before it sleeps, unless it is busy; as `APP_FRAME_IDLE_MS`).
- Add `BusyMaxAge = 30 * time.Minute` with a comment: a process the server started this long ago is its own helper,
  not work in progress, so a false busy cannot keep a service up for good.
- Delete `StateStopped`.
- Add:

```go
// Proc is one process of a service's tree: its pid and when it started, in unix ms.
type Proc struct {
	Pid     int32
	StartMs int64
}

// Busy reports whether a service has work in progress: a process of its tree that started after its page first
// answered (upMs, the status's StartedMs) and is younger than BusyMaxAge. A service that never answered (upMs 0) is
// never busy.
func Busy(procs []Proc, upMs, nowMs int64) bool {
	if upMs <= 0 {
		return false
	}
	for _, p := range procs {
		if p.StartMs > upMs && nowMs-p.StartMs < BusyMaxAge.Milliseconds() {
			return true
		}
	}
	return false
}
```

**Step 4: Run `TestBusy`.** Expected: PASS.

**Step 5: Write the failing supervisor tests** (in `pkg/services/supervisor_test.go`)

Add a `procs map[string][]Proc` field to `harness` (block id → its tree) and `Procs: func(blockId string) []Proc {
return h.procs[blockId] }` to `deps()`; initialise the map in `newHarness`. Then add:

```go
func TestBusyServicePostponesItsSleep(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.seen("portfolio")
	h.answer("portfolio", dashURL)
	up := h.status("portfolio").StartedMs

	h.seen()
	h.procs["blk-portfolio"] = []Proc{{Pid: 7, StartMs: up + 1000}} // a claude -p the dashboard started
	h.advance(IdleSleep)
	h.wantState("portfolio", StateRunning)
	h.advance(IdleSleep)
	h.wantState("portfolio", StateRunning)

	h.procs["blk-portfolio"] = nil // the run ended
	h.advance(IdleSleep)
	h.wantState("portfolio", StateSleeping)
}

func TestStopIsNotRemembered(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.seen("portfolio")
	h.answer("portfolio", dashURL)
	if err := h.sup.Stop(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	h.wantState("portfolio", StateSleeping)
	h.seen()
	h.seen("portfolio") // shown again: it starts
	h.wantState("portfolio", StateStarting)
}
```

Then bring the existing tests to the new model, by name:

- `TestStopIsRememberedAndNotRetried` (~311): rewrite as `TestStopSleepsAndIsNotRetried`: state `StateSleeping`,
  no new start after `h.advance(time.Minute)` while not shown.
- `TestRemovedToolForgetsTheStop` (~631): delete (nothing is remembered).
- `TestStoppedServiceDoesNotStartWhenSeen` (~976): delete; `TestStopIsNotRemembered` states the opposite rule.
- `TestBootLeavesOnDemandSleeping` (~1046): drop the `h.state.m["c"] = Remembered{Stopped: true}` line and service
  `c`'s expectation is `StateStarting` (a Keep running service starts at boot); the `starts` check then wants a's and
  c's.
- `TestStartOffScreenSleeps` (~993): drop the `.Stopped` check.
- `TestUnseenServiceSleepsAfterTenMinutes` (~891): rename `…AfterAMinute`. Every test that advances a fixed number
  of minutes against the ten-minute `IdleSleep` (the `5*time.Minute`, `20*time.Minute`, `2*time.Minute` arithmetic
  around lines 900–1110) is rewritten in terms of `IdleSleep` and seconds, keeping what it checks.
- Every remaining `StateStopped` becomes `StateSleeping` and every `.Stopped` check goes, test by test, reading what
  each asserts (a test whose point was the remembered Stop is rewritten or deleted as above, never flipped blindly).
- `pkg/services/statefile_test.go` (lines 18, 25): `Remembered{Port: 8386}` with no `Stopped`.
- `pkg/services/real_test.go` (darwin only, line 94): the state after Stop is `StateSleeping`; its comments say
  sleeping, not stopped.

**Step 6: Run the package's tests to see them fail.**
Run: `$GOENV go test ./pkg/services`
Expected: FAIL (no `Procs` in `Deps`, `StateStopped` undefined, and so on).

**Step 7: Implement in `pkg/services/supervisor.go`**

- `Remembered` keeps `Port` only. An old `services.json` entry with `"stopped": true` still parses (encoding/json
  ignores the unknown key).
- `Deps` gains `Procs func(blockId string) []Proc // the service's process tree; nil when it cannot be read (counts as idle)`.
- `idleState` goes: every place that called it uses `StateSleeping`.
- `startsNowLocked(v)` is `v.tool.Autostart || s.shown[v.tool.Id]`.
- `startService`: drop the `s.remember(... r.Stopped = false)` line; the FreePort failure settles `StateSleeping`.
- `SetTools`: drop the `remember(... r.Stopped = false)` in the removal closure (keep the Stop and CloseTab).
- `stop(id, remember bool)` becomes `stop(id string)`: it sets `StateSleeping` and never remembers. Update
  `Stop`, `Restart` and any other caller. Rewrite `Stop`'s doc comment: Stop stops it now; it starts again the next
  time it is shown (a Seen that newly shows it).
- `OnExit`'s clean exit and `OnBlockClosed` set `StateSleeping` and remember nothing.
- `armSleepLocked`'s comment: "its minute is not pushed back".
- `sleepTick`: once it has decided to sleep (same guards as now), read the tree outside the lock before stopping:

```go
	blockId, upMs := v.blockId, v.startedMs
	s.mu.Unlock()
	var procs []Proc
	if blockId != "" && s.d.Procs != nil {
		procs = s.d.Procs(blockId)
	}
	s.mu.Lock()
	v = s.svcs[id]
	if v == nil || v.sleepTok != tok || v.tool.Autostart || s.shown[id] || !sleepable(v.state) {
		s.mu.Unlock()
		return
	}
	if Busy(procs, upMs, s.d.Now().UnixMilli()) {
		v.sleepCancel = nil
		s.armSleepLocked(v) // ask again in IdleSleep
		s.mu.Unlock()
		return
	}
```

  Keep `v.sleepCancel = nil` before the read so a Seen that arrives meanwhile is handled by the token check, and
  keep the rest of the sleep (ignoreExits, cancel, gen++, `StateSleeping`, publish, Stop) as it is.
- Grep the package for `StateStopped` and `Stopped` until none is left outside comments that describe history.

**Step 8: The real `Procs` in `pkg/services/real.go`** (spec model 3)

The tree is the block's job object members where the block has a job (Windows: `shellexec.MakeCmdWrap` registers
each block shell's job with `jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: blockId}`, and `LiveJobs` lists
every member, an orphaned grandchild included), else `memusage` `Table.Tree` of the block controller's pid
(`jobobject.LiveJobs` returns nil off Windows, so no OS switch is needed):

```go
// blockJobPids is the members of the jobs registered for a block, nil when it has none. Pure: jobs is LiveJobs().
func blockJobPids(jobs []jobobject.LiveJob, blockId string) []int32

// procs is the service block's process tree with each process's start time: the block's job members, else the tree
// under the block controller's pid. nil when it cannot be read: a failed read is idle.
func procs(blockId string) []Proc
```

`procs` takes `blockJobPids(jobobject.LiveJobs(), blockId)`; when that is empty, `blockcontroller.GetBlockControllerPid`
(≤ 0 → nil) and `memusage.ReadTable()` (error → nil) then `table.Tree(root)`. For each pid,
`process.NewProcess(pid)` and `CreateTime()`; skip a pid that fails either. `process` is
`github.com/shirou/gopsutil/v4/process` (the version `pkg/memusage` imports). Wire `Procs: procs` in `realDeps`.
`pkg/services` already imports `blockcontroller`; `pkg/util/jobobject` and `pkg/memusage` must not import
`pkg/services` (check: no cycle).

**Step 9: Tests of the real `Procs`**

- `pkg/services/procs_test.go` (every OS): `blockJobPids` over a hand-built `[]jobobject.LiveJob`: the members of
  the block's job (two jobs for one block are both counted), nothing from another block's job or a `runcmd` job, nil
  for a block with none.
- `pkg/services/procs_windows_test.go` (`//go:build windows`): start a child process (`ping -n 30 127.0.0.1`),
  attach it with `jobobject.Attach(cmd.Process)` and `jobobject.Register(job, pid, jobobject.Owner{Kind:
  jobobject.OwnerKind_Block, Id: "blk-procs-test"})`, and in Cleanup `jobobject.KillTree(job)` then
  `jobobject.Close(job)`; `procs("blk-procs-test")` holds the
  child's pid with a `StartMs` within a minute of now, and `Busy(procs(...), startMs-1000, now)` is true, where
  `startMs` is taken just before the child starts.
- `pkg/services/real_test.go` (darwin): add `TestRealProcsSeesWorkInProgress`: a tool whose command keeps starting
  short children after the server is up (`sh -c 'trap "" HUP; ARC_TEST_SERVE=1 "<self>" & while :; do sleep 1; done'`,
  modelled on `TestRealServiceStopsWithItsChild`); once `running`, `procs(status().BlockId)` is non-empty with every
  `StartMs > 0`, and within 5 s `Busy(procs(...), status().StartedMs, now)` turns true.

**Step 10: Run the package's tests.**
Run: `$GOENV go test ./pkg/services`
Expected: PASS (the windows file runs here; the darwin one compiles only on a Mac). Then `$GOENV go vet ./pkg/services`.

**Step 11: Commit**

```bash
git add pkg/services
git commit -m "feat(services): a service sleeps a minute after it leaves the screen, never in the middle of work"
```

---

### Task 2: Frontend model: no stopped state, the tree's services, the menu, the frame

**Depends on:** none
**Files:** `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `frontend/app/view/agents/railapps.ts`, `frontend/app/view/agents/railapps.test.ts`, `frontend/app/view/agents/servicemenu.tsx`, `frontend/app/view/agents/appmodel.ts`, `frontend/app/view/agents/appmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/activenav.ts`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/appsurface.tsx`, `frontend/app/view/agents/toolsstore.test.ts`

What changes where: `appmodel.ts` (`APP_FRAME_IDLE_MS`); `agenttree.tsx` (the `services` memo near line 2540);
`activenav.ts` (`activeNavOrder`'s `services`, line ~44); `agentsidebarmodel.ts` (`projectTree`'s input);
`appsurface.tsx` (`WaitingCard`); `servicemenu.tsx` (reads its choices from the model).

**The tree's services.** A sleeping service keeps its tab, and `projectTree` hides a terminal on a service's tab only
when that service is in its `services` input. So the input gains `serviceTabs?: ReadonlySet<string>`: every held
service's tab, never a terminal row whatever the filter (left out, it is the `services` input's tabs, as today). The
rows come from `services`, which callers filter. One helper builds both, so the tree and `activeNavOrder` (j/k,
Ctrl+Tab, Alt+1..9, whose digits must match the rows) cannot drift:

```ts
/** Pure: the services the Agent tree lists, every one that is up or in trouble (any state but sleeping) and the one
 *  whose tab is the selected row, so Stop on the row in view does not pull it out from under the pointer; and every
 *  service's tab, which is never a terminal row. projectTree then draws no folder that holds nothing else. */
export function treeServiceInput(
    list: readonly ServiceStatus[],
    selectedTab: string | null
): { services: { id: string; name: string; project: string; tabId?: string }[]; serviceTabs: Set<string> }
```

**Step 1: Failing tests**

- `servicesmodel.test.ts`, `treeServiceInput`: running, crashed listed; sleeping not; a sleeping one whose tab is
  `selectedTab` listed; `serviceTabs` holds every tab (sleeping ones included), none for a service with no tab.
- `agentsidebarmodel.test.ts`, `projectTree`: with `treeServiceInput` of a project's only (sleeping) service and its
  tab's terminal in `terminals`: no folder for that project and no terminal row for the tab; the same service running:
  its folder with the service row.
- `servicesmodel.test.ts`, a new pure `serviceMenuChoices(s, { pinned, railFull })`: the ordered menu entries as
  `{ key, label, enabled, checked?, title? }` with keys `stop`, `restart`, `browser` (only with a url), `keepRunning`,
  `pin`, `edit`, and separators where the menu has them. No `start` entry for any state; `stop` enabled per `canStop`,
  `restart` per `canRestart`; `keepRunning` checked per `autostart`; `pin` reads "Pin to the rail" / "Unpin from the
  rail", disabled with `RAIL_FULL_TITLE` when the rail is full and it is not pinned.
- Existing `servicesmodel.test.ts` expectations: delete the `"stopped"` row-words test (~40) and header-line test
  (~152); `canStart`'s list (~289) loses `"stopped"`; a test of an unknown state reads as `sleeping` (row words) and
  `Sleeping…` header as `sleeping` reads. In the tests of what Task 3 deletes (`servicesChip`, `popoverOrder`,
  `canStartFromPopover`, ~179–330), change only what this task's `STARTABLE` change breaks (e.g. `"stopped"` out of
  `canStartFromPopover`'s list); Task 3 deletes them.
- `railapps.test.ts`: `"stopped"` leaves `STATES` (~28) and the per-state maps (~156 `railDot`, ~207
  `appSurfaceBody`); the `"stopped: Start"` `appCard` test (~232) goes. `appSurfaceBody` sends `retrying`, `crashed`,
  `porttaken` and `nopage` to `"card"`, `running` and `elsewhere` to `"page"`, and anything else (`starting`,
  `sleeping`, an unknown state) to `"waiting"`. `appCard` keeps a total `default` for a state no card names:
  `{ title: \`${s.name} is ${s.state}\`, line: serviceHeaderLine(s, nowMs), action }` (unreachable from
  `appSurfaceBody`; one test). A new pure `appWaitTitle(s)`: `"Starting <name>"` for `starting`; for `sleeping`,
  `"<name> is asleep"` (after a Stop with the app on screen nothing starts it until it is shown again or its header's
  Start is pressed, so the card must not say Starting).
- `appmodel.test.ts` line 132: `b: now - 60_000` becomes `b: now - APP_FRAME_IDLE_MS / 2` (with a one-minute limit,
  60 s is past it).
- `toolsstore.test.ts` (~196–241): `svc("stopped")` becomes `svc("sleeping")` (and the first test's name says
  sleeping); `openApp` still starts it because `sleeping` stays in `STARTABLE`.

**Step 2: Run** `npx vitest run frontend/app/view/agents/servicesmodel.test.ts frontend/app/view/agents/railapps.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts`.
Expected: FAIL (`treeServiceInput`, `serviceMenuChoices`, `appWaitTitle` are not exported).

**Step 3: Implement**

- `servicesmodel.ts`: drop `"stopped"` from `STARTABLE`; `serviceRowWords` and `serviceHeaderLine` lose their
  `"stopped"` wording: the `default` branch reads as `sleeping` does. Add `treeServiceInput` and
  `serviceMenuChoices`.
- `agentsidebarmodel.ts`: `projectTree`'s `serviceTabs` input as above.
- `agenttree.tsx`: the `services` memo becomes `treeServiceInput(serviceList ?? [], focusId)` (`focusId` is already
  read at the top of `AgentTree`); pass both `services` and `serviceTabs`.
- `activenav.ts`: the same, with `globalStore.get(model.focusIdAtom)`.
- `servicemenu.tsx`: maps `serviceMenuChoices` to `ContextMenuItem`s (icon and click per key); no Start item.
- `railapps.ts`: `appSurfaceBody` and `appCard` as tested, the stopped card goes; add `appWaitTitle`.
- `appsurface.tsx`: `WaitingCard`'s title is `appWaitTitle(service)`; its wait line shows only while `starting`. The
  header's Start (`canStart`, sleeping included) stays: it is how a stopped app on screen comes back.
- `appmodel.ts`: `APP_FRAME_IDLE_MS = 60_000`, comment: as wavesrv's `IdleSleep`, so a page is not kept over a server
  that went to sleep.

**Step 4: Run** the three test files above plus `npx vitest run frontend/app/view/agents/appmodel.test.ts frontend/app/view/agents/toolsstore.test.ts`. Expected: PASS.

**Acceptance on screen** (Task 6 writes these steps; Final runs them): `services-tree`: a sleeping service has no row
and its emptied project folder is gone; Stop on the selected row keeps it (sleeping) while selected; the row's menu has
no Start. `services-rail`: a sleeping pin opens to the waiting card, then its page; Stop on screen shows
`<name> is asleep` and no stopped card.

**Step 5: Commit**

```bash
git add frontend/app/view/agents
git commit -m "feat(services): the tree lists a service only while it is up; no stopped state or card"
```

---

### Task 3: Remove the app bar's Services chip and popover

**Depends on:** Task 2
**Files:** `frontend/app/cockpit/serviceschip.tsx`, `frontend/app/cockpit/servicespanel.tsx`, `frontend/app/cockpit/servicespopoverstore.ts`, `frontend/app/cockpit/app-bar.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/cockpit/jobqueuestore.ts`, `frontend/app/view/agents/consumersstore.ts`, `frontend/app/view/agents/machineserverschip.tsx`, `frontend/app/store/keybindings/dispatcher.ts`, `frontend/app/store/keybindings/dispatcher.test.ts`, `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `scripts/cdp/scenarios.mjs`

What changes where:
- Delete: `frontend/app/cockpit/serviceschip.tsx`, `frontend/app/cockpit/servicespanel.tsx`,
  `frontend/app/cockpit/servicespopoverstore.ts`
- Modify: `frontend/app/cockpit/app-bar.tsx` (import line 31, `<ServicesChip />` line 145),
  `frontend/app/cockpit/cockpit-root.tsx` (import line 61, `<ServicesPanel model={model} />` line 225),
  `frontend/app/cockpit/jobqueuestore.ts` (lines 16, 27), `frontend/app/view/agents/consumersstore.ts` (7, 51),
  `frontend/app/view/agents/machineserverschip.tsx` (4, 46), `frontend/app/store/keybindings/dispatcher.ts` (4, 143)
  and `dispatcher.test.ts` (4, 291–293)
- Modify: `frontend/app/view/agents/servicesmodel.ts` (+ test): delete `servicesChip`, the `ServicesChip` type,
  `popoverOrder`, `orderGroup`, `canStartFromPopover`, `upFor` if nothing else uses it, and their tests
- Modify: `scripts/cdp/scenarios.mjs`: delete the `services-chip` scenario (the `const servicesChip = {` object from
  its leading comment through its closing `};`, near line 43194) **and its registration, the `servicesChip,` entry in
  the exported scenario list near line 50919**: left behind, it throws a ReferenceError when the module loads and no
  scenario runs, Final's included.

**Step 1:** Before deleting each file, grep every import of it (`import type` and re-exports included):
`grep -rn "serviceschip\|servicespanel\|servicespopoverstore" frontend scripts`. Every hit is in the list above.

**Step 2:** Delete the three files, remove each reference. Where a closer set `servicesOpenAtom` to false beside
another popover's open, just drop that line (the Jobs and Consumers popovers keep closing each other as they do). In
`dispatcher.ts`, drop the `globalStore.get(servicesOpenAtom) ||` clause and its comment line; in `dispatcher.test.ts`,
drop the case that opened it.

**Step 3:** Run `grep -rn "servicesOpenAtom\|toggleServices\|ServicesChip\|ServicesPanel\|servicesChip\|popoverOrder\|canStartFromPopover" frontend scripts`.
Expected: no hits. Then `node -e "import('./scripts/cdp/scenarios.mjs').then(() => console.log('ok'))"`: prints `ok`
(the module loads).

**Step 4:** Run `npx vitest run frontend/app/view/agents/servicesmodel.test.ts frontend/app/store/keybindings/dispatcher.test.ts frontend/app/cockpit`.
Expected: PASS. Then `task check:ts` (about 2 minutes; give it a 5-minute timeout). Expected: exit 0.

**Acceptance on screen** (Task 6 writes it): `services-states` asserts no `[data-services-chip]` in the app bar and no
`[data-services-panel]`; `jobqueue-chip` and `consumers-popover` (unchanged) still pass, since their popovers' close
wiring changed.

**Step 5: Commit**

```bash
git add -A frontend/app/cockpit frontend/app/view/agents frontend/app/store/keybindings scripts/cdp/scenarios.mjs
git commit -m "feat(services): drop the app bar's Services chip and popover; the footer shows what runs"
```

---

### Task 4: Setup → Tools manages an app

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`

`toolslibrary.tsx`'s `ToolDetail` is lines 404–630 (`hasPage` at 417, the Keep running row near 588).

**What it does:** On a tool with a page (`hasPage`), the detail page shows the service's state and its controls,
next to the existing Keep running row:

- A **Status** row (`SettingRow label="Status"`, the words in an element with `data-tool-service-status`): the
  service's words in their tone, from a pure `toolServiceStatus(s, nowMs)` in `toolslibrarymodel.ts` built on
  `serviceRowWords` (the port while running; `sleeping · starts when opened` while sleeping; `not started yet` when
  wavesrv has no status for it). While `canStop`, **Stop** and **Restart** buttons (`BTN_SECONDARY`,
  `data-tool-service-stop` / `data-tool-service-restart`) call `stopService` / `restartService` from
  `servicesstore.ts`. Read the service from `servicesAtom` by `tool.id`; call `ensureServicesFeed()` in an effect, as
  `AgentTree` does. A sleeping one has no button: **Open {name}** in the header already opens and starts it.
- An **On the rail** row (`SettingRow label="On the rail" sub="Up to three apps, under Radar"`) with a `Toggle`
  (`data-tool-rail-pin`) bound to whether `railPins(railPinsAtom, services)` holds the tool, calling
  `setRailPinned(tool.id, on)`. When the rail is full and this tool is not on it, the toggle is disabled with
  `RAIL_FULL_TITLE` as its title. Pinning does not depend on the service's state.

Keep the existing Keep running row and its sub line.

**Step 1:** Failing vitest cases for `toolServiceStatus` in `toolslibrarymodel.test.ts` (running, sleeping, crashed,
none). Run `npx vitest run frontend/app/view/agents/toolslibrarymodel.test.ts`; Expected: FAIL.

**Step 2:** Implement `toolServiceStatus`, then the two rows.

**Step 3:** Run the test; Expected: PASS. Then `task check:ts` (5-minute timeout); Expected: exit 0.

**Acceptance on screen** (Task 6 writes the `services-setup` steps; Final runs them): the Status row with its words,
Stop on a running one (it turns `sleeping`, the row reads `sleeping · starts when opened` with no button), Restart
(the port answers again), Keep running toggled (the tools.json entry's `autostart`), the On the rail toggle (the rail
shows the app; off removes it), and the toggle disabled with `RAIL_FULL_TITLE` when three others are pinned.

**Step 4: Commit**

```bash
git add frontend/app/view/agents
git commit -m "feat(tools): Setup → Tools shows an app's state, Stop, Restart and its rail pin"
```

---

### Task 5: The footer's Servers popover names a service's server as the app

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/machineservers.ts`, `frontend/app/view/agents/machineservers.test.ts`, `frontend/app/view/agents/machineserverspanel.tsx`, `frontend/app/view/agents/machineserverschip.tsx`

`machineserverspanel.tsx`: badge render lines 71–95, `stopServer` near line 56. `machineserverschip.tsx` passes the
services in (Task 3 edits it too, hence the dependency).

**Step 1: Failing test** in `machineservers.test.ts`: `buildMachineServers` takes a fourth argument, the held
services (`{ id, name, tabid }[]`). A server whose owner is `terminal` with a `tabid` equal to a service's `tabid`
gets `badge: { kind: "service", text: "app · <name>", tabId, serviceId }` and `stopConfirm: "Stop <name>?"`; any
other row is unchanged.

**Step 2:** Run `npx vitest run frontend/app/view/agents/machineservers.test.ts`. Expected: FAIL.

**Step 3: Implement**

- `machineservers.ts`: `BadgeKind` gains `"service"`; `MachineBadge` gains `serviceId?: string`; `resolveRow` checks
  the services before the `terminal` case's badge. Document the new argument in `buildMachineServers`.
- `machineserverschip.tsx` and the panel: read `servicesAtom` (`ensureServicesFeed` in an effect) and pass
  `(servicesAtom value ?? []).map((s) => ({ id: s.id, name: s.name, tabid: s.tabid }))`.
- `machineserverspanel.tsx`: a `service` badge renders like a terminal badge (a click opens its tab); `stopServer`
  calls `stopService(row.badge.serviceId)` for a `service` row instead of `StopDevServerCommand`: killing it from
  outside reads as a crash and restarts it. Pin as app is hidden on a `service` row (it is one already).

**Step 4:** Run the test; Expected: PASS. Then `task check:ts` (5-minute timeout); Expected: exit 0.

**Acceptance on screen** (Task 6 writes the `machine-servers` step; Final runs it): with a held service running, its
row's badge reads `app · <name>`, the badge's click opens it, Pin as app is not on the row, the Stop confirm reads
`Stop <name>?`, and the Stop leaves the service `sleeping`, not `retrying`.

**Step 5: Commit**

```bash
git add frontend/app/view/agents
git commit -m "feat(servers): a held service's server reads as the app, and its Stop goes through wavesrv"
```

---

### Task 6: CDP scenarios follow the new model

**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5
**Files:** `scripts/cdp/scenarios.mjs`

The scenarios to change: `services-states` (near 42374), `services-tree` (near 42506), `services-rail` (near 42854),
`services-setup` (near 43327), `machine-servers` (near 34014), the shared helpers `svcStopByPerson` and `svcTeardown`
(near 42213 and 42267), and a new `services-busy`, registered in the exported scenario list beside the others.

**Helpers.** `svcStopByPerson` waits for the supervisor to hold the service (`sleeping` or up), stops it and waits for
`sleeping`; its comment loses "remembered". `svcTeardown` loses the "forget the person's Stop" step (nothing is
remembered) and its comment says so.

**`services-states`:** no `stopped` service (`"svc-off"` is staged sleeping by its Stop and then has no row in the
tree); its sleeping words are read from its Setup → Tools page (`[data-tool-service-status]` reads `sleeping · starts
when opened`), not the tree; the other states' rows keep their checks. Add a step: no `[data-services-chip]` in the app
bar and no `[data-services-panel]` in the page.

**`services-tree`:**
- step 2 (hover): Restart on a crashed row, nothing on a sleeping one (only a selected sleeping row is drawn); the
  "Start on a stopped service" half goes.
- step 4: Stop on the selected `svc-fixed` row leaves it `sleeping` with its row still drawn (it is selected) and the
  port freed; selecting another row removes the row.
- step 5: Start in the service's pane header (`canStart` holds for sleeping) brings it back.
- step 8 ("a stopped service shows its log") goes; step 8b: `svc-never` (sleeping) has no row and no project folder of
  its own; **Open** on its Setup → Tools page starts it and its row appears. Shoot the tree with one running and one
  sleeping service.
- step 9 (the menu, near 42741): the labels are Stop, Restart, Open in the browser, Keep running, Pin to the rail,
  Edit in Setup → Tools, and **no** Start item.

**`services-rail`:** step 4 (near 42996): Stop on the app surface (`[data-app-stop]`) leaves the service `sleeping`;
the surface shows `[data-app-waiting]` reading `<name> is asleep`, no `[data-app-card]`; the header's Start brings the
page back. A pinned sleeping app opened from the rail shows the waiting card, then its page.

**`services-setup`:** a step that opens a running tool with a page in Setup → Tools and asserts: the Status row
(`[data-tool-service-status]`) with its port; Restart (`[data-tool-service-restart]`; the service goes through
`starting` back to `running` and the port answers); Stop (`[data-tool-service-stop]`; `sleeping`, the row reads
`sleeping · starts when opened`, no Stop button); the Keep running toggle (the tools.json entry gains then loses
`autostart`); the On the rail toggle (`[data-tool-rail-pin]`: the rail shows the app; off removes it); with three other
fixture services pinned, the toggle is disabled with `RAIL_FULL_TITLE`. Shoot the detail page. Arrange saves
localStorage `apps.rail` and teardown restores it.

**`machine-servers`:** arrange also stages a real held service (`svcArrange` with one demand tool, opened so it runs)
and adds a fixture row to the mock's list owned by `{ kind: "terminal", tabid: <the service's tabid>, ... }` (built
where the other fixture rows are, from `ctx`); teardown also runs `svcTeardown`. A step: that row's badge reads
`app · <name>`, the badge's click opens the service's tab, the row has no Pin as app, the Stop confirm reads
`Stop <name>?`, and confirming leaves the service `sleeping` (read through `servicesstatus`), not `retrying`. The
existing steps keep their checks. Shoot the popover.

**`services-busy` (new):** arrange writes a fixture server of its own beside `SVC_SERVER_SOURCE`: it answers `/` with
a page, `/work` starts a child (`node -e "setTimeout(() => {}, 600000)"`, kept in a variable), and `/done` kills it.
Two demand services, `svc-busy` (this server) and `svc-plain` (the plain fixture server). Steps: show both (open each,
wait `running`); `GET /work` on `svc-busy`; select a row that is neither, so both leave the screen; wait
`IdleSleep` + 15 s (75 s): `svc-plain` is `sleeping`, `svc-busy` still `running`; `GET /done`; within another
`IdleSleep` + 20 s, `svc-busy` is `sleeping`. Teardown is `svcTeardown`. This scenario waits on the real minute (about
2.5 min): give its steps timeouts that fit.

**Step 1:** Load check: `node -e "import('./scripts/cdp/scenarios.mjs').then(() => console.log('ok'))"` prints `ok`.

**Step 2:** Run the scenarios against a dev app of this tree:
`node scripts/cdp/final-verify.mjs services-states services-tree services-rail services-setup services-busy machine-servers jobqueue-chip consumers-popover`
(it starts and stops its own dev app). Expected: PASS for all eight.

**Step 3: Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(services): the CDP scenarios follow apps that run while used"
```

---

### Task 7: Docs

**Depends on:** none
**Files:** `AGENTS.md`, `docs/guide/agent.md`, `docs/guide/cockpit.md`, `docs/guide/settings.md`, `CHANGELOG.md`, `docs/open-issues.md`

- `AGENTS.md` (the service paragraph, lines ~203–210): "starts it when it shows … and stops it a minute after it
  leaves the screen once nothing it started is still working (`services.Busy`), unless it is set to Keep running";
  the Services chip and popover are gone; Setup → Tools manages apps; the footer's Servers names a service's server.
- The guide pages that describe services, the Services chip or pinned apps:
  `grep -rn -i "service\|Keep running\|pinned app\|dịch vụ" docs/guide/agent.md docs/guide/cockpit.md docs/guide/settings.md`
  (the guide is in Vietnamese; write in it the way it is written).
- `CHANGELOG.md`: the `## Unreleased` → `### Added` line about pinned apps' servers (~line 34, "lets it sleep ten
  minutes … the new Services chip", ending `<!-- big -->`) is rewritten, keeping `<!-- big -->`: arcterm looks after
  your pinned apps' servers: it gives each a port, starts it when you open the app, restarts it when it crashes, and
  stops it a minute after you leave it, never while it is still working (a chat answer, a script it started); Setup →
  Tools shows each app's state with Stop, Restart, Keep running and its rail pin, and the footer's Servers names an
  app's server. Keep running starts it with arcterm and never stops it. No separate Changed line (the feature is
  unreleased).
- `docs/open-issues.md`:
  - delete the "Services chip" hand-check line(s) (~38–40): the chip is gone;
  - rewrite the "Pinned app" hand-check (~104–111): it sleeps until opened, its row shows in the Agent tree only
    while it runs (or is selected), Setup → Tools shows its Status, Stop and rail pin, and the footer's Servers
    lists it as `app · <name>`; drop the Services chip;
  - the "RAM watch" rows for pinned apps and held services (~1275–1277): 10 min reads 1 min, and the busy read runs
    once a minute per service off screen;
  - add a `- [ ] (arcterm)` line under "0 · Waiting on a hand check": with Keep running off, open the portfolio app,
    ask its chat something long, switch to Agent: it is still running a minute later and sleeps about a minute after
    the answer ends. Then turn Keep running on for the portfolio entry (Setup → Tools; it is your `tools.json`,
    outside the repo; spec model 4) so its ~15:05 build-macro runs.

**Step 1:** Make the edits. **Step 2:** `git diff --stat` shows only these files.

**Step 3: Commit**

```bash
git add AGENTS.md docs/guide CHANGELOG.md docs/open-issues.md
git commit -m "docs: apps run while used"
```
