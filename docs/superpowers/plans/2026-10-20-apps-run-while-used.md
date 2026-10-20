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

**Final:** `node scripts/cdp/final-verify.mjs services-states services-tree services-rail services-setup machine-servers`

---

### Task 1: Supervisor: one idle state, one minute, never in the middle of work

**Depends on:** none
**Files:** `pkg/services/model.go`, `pkg/services/model_test.go`, `pkg/services/supervisor.go`, `pkg/services/supervisor_test.go`, `pkg/services/real.go`

What changes where: `model.go` (states, `IdleSleep`, new `BusyMaxAge`, new pure `Busy`); `supervisor.go`
(`Remembered`, `Deps`, `idleState`, `startsNowLocked`, `startService`, `SetTools`, `sleepTick`, `stop`, `OnExit`,
`OnBlockClosed`); `real.go` (`realDeps`: the real `Procs`).

**Step 1: Write the failing test for `Busy`** (append to `pkg/services/model_test.go`)

```go
func TestBusy(t *testing.T) {
	up := int64(1_000_000) // when the page first answered
	now := up + int64(5*time.Minute/time.Millisecond)
	cases := []struct {
		name  string
		procs []Proc
		want  bool
	}{
		{"nothing runs", nil, false},
		{"only what was there when the page answered", []Proc{{Pid: 1, StartMs: up - 2000}, {Pid: 2, StartMs: up - 10}}, false},
		{"a run the server started after", []Proc{{Pid: 1, StartMs: up - 2000}, {Pid: 9, StartMs: now - 30_000}}, true},
		{"a helper older than BusyMaxAge is the server's own", []Proc{{Pid: 9, StartMs: now - BusyMaxAge.Milliseconds() - 1}}, false},
	}
	for _, c := range cases {
		if got := Busy(c.procs, up, now); got != c.want {
			t.Errorf("%s: Busy = %v, want %v", c.name, got, c.want)
		}
	}
	if Busy([]Proc{{Pid: 9, StartMs: now}}, 0, now) {
		t.Error("a service that never answered is never busy")
	}
}
```

**Step 2: Run it to see it fail**

Run (Git Bash): `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/services -run '^TestBusy$'`
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
// answered (upMs) and is younger than BusyMaxAge. A service that never answered (upMs 0) is never busy.
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

`TestStopIsRememberedAndNotRetried` and `TestRemovedToolForgetsTheStop` test the old model: rewrite the first as
"Stop sleeps it and is not retried" (state `StateSleeping`, no new start after `h.advance(time.Minute)` while not
shown) and delete the second. Every test that advances a fixed number of minutes against the ten-minute
`IdleSleep` (the `5*time.Minute`, `20*time.Minute`, `2*time.Minute` arithmetic around lines 900–1110, and
`TestUnseenServiceSleepsAfterTenMinutes`, renamed `…AfterAMinute`) is rewritten in terms of `IdleSleep` and seconds.
Every `StateStopped` in the tests becomes `StateSleeping`, and every `.Stopped` check goes.

**Step 6: Run the package's tests to see them fail.**
Run: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/services`
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
  time it is shown.
- `OnExit`'s clean exit and `OnBlockClosed` set `StateSleeping` and remember nothing.
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

**Step 8: The real `Procs` in `pkg/services/real.go`**

```go
// procs is the service block's process tree with each process's start time, read the way the Consumers panel reads
// an agent's (blockcontroller's pid, memusage's table). nil when any part cannot be read: a failed read is idle.
func procs(blockId string) []Proc {
	root := blockcontroller.GetBlockControllerPid(blockId)
	if root <= 0 {
		return nil
	}
	table, err := memusage.ReadTable()
	if err != nil {
		return nil
	}
	var out []Proc
	for _, pid := range table.Tree(int32(root)) {
		p, err := process.NewProcess(pid)
		if err != nil {
			continue
		}
		ms, err := p.CreateTime()
		if err != nil {
			continue
		}
		out = append(out, Proc{Pid: pid, StartMs: ms})
	}
	return out
}
```

Wire `Procs: procs` in `realDeps`. `process` is `github.com/shirou/gopsutil/v4/process` (check the version
`pkg/memusage` imports and use the same). If importing `blockcontroller` from `pkg/services` makes an import cycle,
take the pid through a `Deps`-style function set where `realDeps` is built instead (the package already reaches
`blockcontroller.StopLeftovers` for `Sweep`, so it should not).

**Step 9: Run the package's tests.**
Run: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/services`
Expected: PASS. Then `go vet ./pkg/services`.

**Step 10: Commit**

```bash
git add pkg/services
git commit -m "feat(services): a service sleeps a minute after it leaves the screen, never in the middle of work"
```

---

### Task 2: Frontend model: no stopped state, the tree's services, the menu, the frame

**Depends on:** none
**Files:** `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `frontend/app/view/agents/railapps.ts`, `frontend/app/view/agents/railapps.test.ts`, `frontend/app/view/agents/servicemenu.tsx`, `frontend/app/view/agents/appmodel.ts`, `frontend/app/view/agents/appmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/appsurface.tsx`

What changes where: `appmodel.ts` (`APP_FRAME_IDLE_MS`, and its test if it pins the value); `agenttree.tsx` (the
`services` memo near line 2540); `appsurface.tsx` (the card's Start branch).

**Step 1: Failing tests**

In `servicesmodel.test.ts`, add tests for a new pure `treeServices`:

```ts
describe("treeServices", () => {
    const svc = (id: string, state: string, tabid?: string) => ({ id, name: id, state, tabid }) as ServiceStatus;
    it("lists a service only while it is up or in trouble", () => {
        const list = [svc("a", "running", "t1"), svc("b", "sleeping", "t2"), svc("c", "crashed", "t3"), svc("d", "sleeping")];
        expect(treeServices(list, null).map((s) => s.id)).toEqual(["a", "c"]);
    });
    it("keeps the sleeping service whose tab is selected, so Stop does not pull its row away", () => {
        expect(treeServices([svc("b", "sleeping", "t2")], "t2").map((s) => s.id)).toEqual(["b"]);
    });
});
```

Change the existing expectations: no row words, header line or `canStart` for `"stopped"` (the state no longer
exists; an unknown state reads as sleeping). Delete nothing yet that Task 3 deletes (`servicesChip`, `popoverOrder`,
`canStartFromPopover` stay until Task 3).

In `railapps.test.ts`: `appSurfaceBody` of a sleeping service is `"waiting"` (already), and there is no stopped card;
`appCard` covers crashed, retrying, porttaken and nopage with `action: "restart"` where `canRestart` holds, else
`"start"` for porttaken (Start probes again).

**Step 2: Run** `npx vitest run frontend/app/view/agents/servicesmodel.test.ts frontend/app/view/agents/railapps.test.ts`.
Expected: FAIL (`treeServices` is not exported).

**Step 3: Implement**

- `servicesmodel.ts`: drop `"stopped"` from `STARTABLE`; `serviceRowWords` and `serviceHeaderLine` lose their
  `"stopped"` wording: the `default` branch reads as `sleeping` does. Add:

```ts
/** Pure: the services the Agent tree lists: every one that is up or in trouble (any state but sleeping), and the one
 *  whose tab is the selected row, so Stop on the row in view does not pull it out from under the pointer. A project
 *  folder left with nothing else is then not drawn (projectTree draws folders from what it is given). */
export function treeServices(list: readonly ServiceStatus[], selectedTab: string | null): ServiceStatus[] {
    return list.filter((s) => s.state !== "sleeping" || (selectedTab != null && s.tabid === selectedTab));
}
```

- `agenttree.tsx`: build `services` from `treeServices(serviceList ?? [], focusId)` (`focusId` is already read at the
  top of `AgentTree`), then map as now.
- `railapps.ts`: the `default` card (`is stopped`, "Start it to see its page.") goes; a state with no card of its own
  reads as waiting through `appSurfaceBody`. Keep `appCard` total over what `appSurfaceBody` sends to `"card"`.
- `appsurface.tsx`: no change beyond what the card model gives; check its Start button still renders for porttaken.
- `servicemenu.tsx`: drop the Start item (showing a service starts it). Keep Stop, Restart, Open in the browser,
  Keep running, Pin to the rail, Edit in Setup → Tools.
- `appmodel.ts`: `APP_FRAME_IDLE_MS = 60_000`, comment: as wavesrv's `IdleSleep`, so a page is not kept over a server
  that went to sleep.

**Step 4: Run** the two test files and `npx vitest run frontend/app/view/agents/appmodel.test.ts`. Expected: PASS.

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
- Modify: `scripts/cdp/scenarios.mjs`: delete the `services-chip` scenario (from its leading comment through its
  closing `},`, near line 43195)

**Step 1:** Before deleting each file, grep every import of it (`import type` and re-exports included):
`grep -rn "serviceschip\|servicespanel\|servicespopoverstore" frontend scripts`. Every hit is in the list above.

**Step 2:** Delete the three files, remove each reference. Where a closer set `servicesOpenAtom` to false beside
another popover's open, just drop that line. In `dispatcher.ts`, drop the `globalStore.get(servicesOpenAtom) ||`
clause and its comment line; in `dispatcher.test.ts`, drop the case that opened it.

**Step 3:** Run `grep -rn "servicesOpenAtom\|toggleServices\|ServicesChip\|ServicesPanel\|servicesChip\|popoverOrder\|canStartFromPopover" frontend scripts`.
Expected: no hits.

**Step 4:** Run `npx vitest run frontend/app/view/agents/servicesmodel.test.ts frontend/app/store/keybindings/dispatcher.test.ts frontend/app/cockpit`.
Expected: PASS. Then `task check:ts` (about 2 minutes; give it a 5-minute timeout). Expected: exit 0.

**Step 5: Commit**

```bash
git add -A frontend/app/cockpit frontend/app/view/agents frontend/app/store/keybindings scripts/cdp/scenarios.mjs
git commit -m "feat(services): drop the app bar's Services chip and popover; the footer shows what runs"
```

---

### Task 4: Setup → Tools manages an app

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`, `scripts/cdp/scenarios.mjs`

`toolslibrary.tsx`'s `ToolDetail` is lines 404–630; `toolslibrarymodel.ts` only if a pure part is needed.

**What it does:** On a tool with a page (`hasPage`), the detail page shows the service's state and its controls,
next to the existing Keep running row:

- A **Status** row (`SettingRow label="Status"`): the service's `serviceRowWords` words in their tone (or the port
  while running), and, while `canStop`, **Stop** and **Restart** buttons (`BTN_SECONDARY`, `data-tool-service-stop` /
  `data-tool-service-restart`) calling `stopService` / `restartService` from `servicesstore.ts`. Read the service
  from `servicesAtom` by `tool.id`; call `ensureServicesFeed()` in an effect, as `AgentTree` does. A sleeping one
  reads `sleeping · starts when opened` and has no button: **Open {name}** in the header already opens and starts it.
- An **On the rail** row (`SettingRow label="On the rail" sub="Up to three apps, under Radar"`) with a `Toggle`
  (`data-tool-rail-pin`) bound to whether `railPins(railPinsAtom, services)` holds the tool, calling
  `setRailPinned(tool.id, on)`. When the rail is full and this tool is not on it, the toggle is disabled with
  `RAIL_FULL_TITLE` as its title. Pinning does not depend on the service's state.

Keep the existing Keep running row and its sub line.

**Step 1:** If a word or a choice needs logic beyond `serviceRowWords` and `railFull` (for example the status line of a
sleeping service), put it in `toolslibrarymodel.ts` as a pure function with a vitest case first, run it to see it
fail, then implement.

**Step 2:** Implement the two rows.

**Step 3:** Run `npx vitest run frontend/app/view/agents/toolslibrarymodel.test.ts`; Expected: PASS.

**Step 4:** Extend the `services-setup` CDP scenario (`scripts/cdp/scenarios.mjs`, near line 43328) with a step that
opens a tool with a page in Setup → Tools and asserts the Status row, Stop on a running one (the state turns
`sleeping`) and the On the rail toggle (the rail shows the app; toggling off removes it). Shoot the detail page.

**Step 5: Commit**

```bash
git add frontend/app/view/agents scripts/cdp/scenarios.mjs
git commit -m "feat(tools): Setup → Tools shows an app's state, Stop, Restart and its rail pin"
```

---

### Task 5: The footer's Servers popover names a service's server as the app

**Depends on:** Task 3, Task 4
**Files:** `frontend/app/view/agents/machineservers.ts`, `frontend/app/view/agents/machineservers.test.ts`, `frontend/app/view/agents/machineserverspanel.tsx`, `frontend/app/view/agents/machineserverschip.tsx`, `scripts/cdp/scenarios.mjs`

`machineserverspanel.tsx`: badge render lines 71–95, `stopServer` near line 56. `machineserverschip.tsx` passes the
services in.

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

**Step 4:** Run the test; Expected: PASS.

**Step 5:** Extend the `machine-servers` CDP scenario (near line 34015) with a step: with a held service running, its
row's badge reads `app · <name>`, and its Stop leaves the service `sleeping` (read through the services RPC the
`services-*` scenarios already use), not `retrying`. Shoot the popover.

**Step 6: Commit**

```bash
git add frontend/app/view/agents scripts/cdp/scenarios.mjs
git commit -m "feat(servers): a held service's server reads as the app, and its Stop goes through wavesrv"
```

---

### Task 6: CDP scenarios follow the new model

**Depends on:** Task 1 (the scenarios assert its single idle state and one-minute sleep), Task 2 (they assert its tree filter and cards), Task 5
**Files:** `scripts/cdp/scenarios.mjs`

The scenarios to rewrite: `services-states` (near 42375), `services-tree` (near 42507), `services-rail` (near 42855).

The three scenarios stage services in states that include `stopped` (`"svc-off": "stopped"`, a Stop that stays
stopped, a stopped card with Start). Rewrite them for the new model, keeping each scenario's other checks:

- `services-states`: no `stopped` row; a sleeping service's words read `sleeping`.
- `services-tree`: a sleeping service has no row in the tree and its project folder is not drawn when it holds
  nothing else; a running one has a row with no Start on hover; Stop on the selected row keeps the row (sleeping)
  until another row is selected; opening a sleeping service from Setup → Tools starts it. Shoot the tree with one
  running and one sleeping service.
- `services-rail`: Stop on the app surface shows the waiting card on the next open, not a stopped card; a pinned
  sleeping app opens to the waiting card and then its page.

Every expectation that read a 10-minute sleep reads one minute (the scenarios that wait on the sleep can shorten it
the way they do today, if they do; else assert the timer's length through the status, not by waiting).

**Step 1:** Run each scenario against the dev app: `task verify:ui -- services-states services-tree services-rail services-setup machine-servers`
(start the dev app first with `task dev`, or let `node scripts/cdp/final-verify.mjs <names>` start its own).
Expected: PASS for all five.

**Step 2: Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(services): the CDP scenarios follow apps that run while used"
```

---

### Task 7: Docs

**Files:** `AGENTS.md`, `docs/guide/agent.md`, `docs/guide/cockpit.md`, `docs/guide/settings.md`, `CHANGELOG.md`, `docs/open-issues.md`

- Modify: `AGENTS.md` (the service paragraph, lines ~203–210): "starts it when it shows … and stops it a minute after
  it leaves the screen once nothing it started is still working (`services.Busy`), unless it is set to Keep running";
  the Services chip and popover are gone; Setup → Tools manages apps.
- Modify: the guide pages that describe services, the Services chip or pinned apps: `grep -rn -i "service\|Keep running\|pinned app" docs/guide/agent.md docs/guide/cockpit.md docs/guide/settings.md` (the guide is in Vietnamese; write in it the way it is written).
- Modify: `CHANGELOG.md`, `## Unreleased` → `### Changed`: one line for the user, e.g. "A pinned app runs only while
  you use it: it starts when you open it and stops a minute after you leave it, never while it is still working
  (a chat answer, a script it started). Setup → Tools shows its state, Stop and its rail pin; the app bar's Services
  chip is gone, and the footer's Servers names an app's server."
- Modify: `docs/open-issues.md` "RAM watch" rows for held services and pinned apps (the 10 min reads 1 min, the busy
  read once a minute per service off screen), and a `- [ ] (arcterm)` hand-check line under "0 · Waiting on a hand
  check": open the portfolio app, ask its chat something long, switch to Agent: it is still running a minute later
  and sleeps a minute after the answer ends.

**Step 1:** Make the edits. **Step 2:** `git diff --stat` shows only these files.

**Step 3: Commit**

```bash
git add AGENTS.md docs/guide CHANGELOG.md docs/open-issues.md
git commit -m "docs: apps run while used"
```
