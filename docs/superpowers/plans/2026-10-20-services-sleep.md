# Services sleep when not in use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a held service without Keep running stops ten minutes after its tab leaves the screen (or ten minutes after a
start while off screen) and starts again when it comes back on screen, so services no one looks at hold no RAM.

**Architecture:** One wire command, `ServiceSeenCommand(ctx, { ids })`, carries the whole set of services on screen;
the supervisor (`pkg/services/supervisor.go`) keeps that set, gains a `sleeping` state and a per-service sleep timer
kept apart from its other timers. `autostart` turns into Keep running with a default of false. The frontend works out
which services are on screen with a pure function in `serviceseen.ts`, reports the set from the always-mounted
`AgentSurface`, and words the new state.

**Tech Stack:** Go (wavesrv, wshrpc), React 19 + jotai, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-20-services-sleep-design.md` (on top of
`docs/superpowers/specs/2026-10-20-held-services-design.md`)

**Verify:** `node scripts/verify.mjs ./pkg/services/... ./pkg/arctools/... ./pkg/wshrpc/... ./pkg/tsgen/...`

**Final:** `node scripts/cdp/final-verify.mjs services-states services-tree services-setup services-chip`

The design canvas is `.superpowers/design/held-services/project` (board `RowStates` has the Sleeping row; board
`AppBarServices` is the chip and its popover). It is gitignored, so the run gets it with
`wsh runs start --prototype <absolute path>`.

## Global Constraints

- Idle time: ten minutes (`IdleSleep = 10 * time.Minute` in `pkg/services/model.go`, the same ten minutes as `APP_FRAME_IDLE_MS` in `frontend/app/view/agents/appmodel.ts`).
- On screen: the service's tab shows on the Agent surface while that surface is the one showing: in the centre (page, waiting card or log), in a visible grid cell, or in the panel under the agent when it is not folded. History, a session or a subagent's interior in the centre count as off screen, as does a folded panel or another surface.
- The wire carries the whole on-screen set; each report replaces the last. The frontend sends it on every change and when `AgentSurface` mounts, an empty set included.
- `autostart` keeps its key and becomes Keep running, default **false**. On: starts with arcterm, never sleeps.
- A sleep is not the person's Stop: `Remembered.Stopped` is untouched, and the remembered port is kept. A service the person stopped never starts when shown.
- Running elsewhere never sleeps; a `retrying` service off screen sleeps when its timer fires and its retries end.
- Exact copy: row words `sleeping` (hollow muted dot, no hover action, in the tree and in the popover); header `Sleeping · starts when shown`; label `Keep running`; Setup detail sub `Run it even when its page is not on screen, and start it with arcterm`; Setup switch aria-label `` `Keep ${tool.name} running` ``; popover subtitle `held by arcterm`.
- Never hand-edit generated files: `task generate` after a wshrpc change. No co-author trailer in commits.

## Review Focus

- Switching from a service to another surface and back within ten minutes: the timer is cancelled and the service never stops. Test: `TestSeenAgainCancelsSleep` (Task 2).
- The frontend reloading while a service is on screen: it reports the set again, which must not restart a running service, and a service the old page showed but the new one does not must get its timer. Tests: `TestSeenRunningDoesNothing`, `TestNewSetArmsTheOnesThatLeft` (Task 2).
- A Keep-running service toggled off while off screen: it must arm the timer then, not wait for another hide. Test: `TestKeepRunningOffArmsTimer` (Task 2).
- A service started from the popover or the menu and never shown: it sleeps ten minutes after that start. Test: `TestStartOffScreenSleeps` (Task 2).
- The sleep timer survives a crash and its retries (it is not one of `v.cancels`): `TestRetryingSleepsAndRetriesEnd` (Task 2).
- The report landing before Boot: Boot starts the shown service. Test: `TestBootStartsShownOnDemand` (Task 2).
- A service in an unfocused grid cell or the unfolded panel is on screen; History in the centre is not. Tests in `serviceseen.test.ts` (Task 3).

---

### Task 1: Wire: ServiceSeenCommand

**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_services.go`, `pkg/wshrpc/wshserver/wshserver_services.go`, `pkg/wshrpc/wshserver/wshserver_services_test.go`, `pkg/services/model.go`, `pkg/services/supervisor.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: ``CommandServiceSeenData struct { Ids []string `json:"ids"` }`` and `ServiceSeenCommand(ctx context.Context, data CommandServiceSeenData) error` in `ServicesCommands` (doc comment: the whole set of services on screen; each report replaces the last).
- Produces: `services.StateSleeping = "sleeping"` beside the other states in `model.go`.
- Produces: `func (s *Supervisor) Seen(ctx context.Context, ids []string)` in `supervisor.go`. In this task it only records the set (a `shown map[string]bool` on the `Supervisor`, replaced under the lock on each call; ids it does not know are kept). Task 2 adds what the set does.
- Produces: frontend `RpcApi.ServiceSeenCommand(TabRpcClient, { ids })` (generated).

The handler follows its neighbours: `errServicesNotRunning` when `services.Current()` is nil, else `sup.Seen(ctx, data.Ids)` and nil. A nil `Ids` is an empty set.

- [ ] **Step 1: Write the failing test** `TestServiceSeenCommand` in `wshserver_services_test.go`: before `services.Default` is set, `ServiceSeenCommand(ctx, {Ids: []string{"nope"}})` errors with `services are not running yet`; with `services.New(services.Deps{State: memState{}})` it returns nil for an unknown id and for an empty set, and `ServicesStatusCommand` still returns an empty non-nil list.
- [ ] **Step 2: Run it to see it fail**: `go test ./pkg/wshrpc/wshserver -run '^TestServiceSeenCommand$'` → FAIL (does not compile).
- [ ] **Step 3: Implement** the type, the command, the handler, `StateSleeping` and the recording `Seen`.
- [ ] **Step 4: Regenerate and run**: `task generate && go test ./pkg/wshrpc/wshserver -run '^TestServiceSeenCommand$' && go build ./...` → PASS; `frontend/app/store/wshclientapi.ts` has `ServiceSeenCommand` and `frontend/types/gotypes.d.ts` has `CommandServiceSeenData`.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): ServiceSeenCommand carries the services on screen"`

### Task 2: Sleeping in the supervisor

**Depends on:** Task 1
**Files:** `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`, `pkg/wconfig/settingsconfig.go`, `pkg/services/model.go`, `pkg/services/model_test.go`, `pkg/services/supervisor.go`, `pkg/services/supervisor_test.go`

**Interfaces:**
- Consumes: `Supervisor.Seen` and its recorded set, `StateSleeping` (Task 1).
- Produces: `services.IdleSleep = 10 * time.Minute` in `model.go`; `Seen` acting on the set as below.
- Changes: `arctools` `override` sets `Autostart` to `*u.Autostart` when given, else **false**. The comments on `arctools.Tool.Autostart` and `wconfig`'s `Autostart *bool` say Keep running, false unless the entry says true (comments only: no field, tag or type changes, so no `task generate`).

Behaviour (spec "Decisions" and "Wire"):

- **Sleeping, not stopped.** A service with no process of arcterm's that the person did not stop reads `sleeping` where it read `stopped` for any reason other than the person's Stop: a new entry (before or after Boot) whose `Remembered.Stopped` is false, and `SetTools`' reset of an `elsewhere`, `porttaken` or `crashed` verdict when its entry changed. A tab closed some other way (`OnBlockClosed`) and a clean exit (`OnExit`) stay the person's Stop: `stopped`.
- **The sleep timer** is one field per service (`sleepCancel func()`, plus a token so a callback that already fired does nothing), never part of `v.cancels`, so `cancelLocked` in start, stop, crash and retry leaves it. Arming does nothing when it is already armed (its ten minutes are not pushed back), when the service has `Autostart`, when it is in the shown set, or when its state is not `starting`, `running`, `nopage` or `retrying`. The person's Stop, a sleep, `Autostart` turning on, joining the shown set, and removal from `SetTools` cancel it.
- **It is armed** when a service leaves the shown set, at every start of a service (person's or not) that is not shown and has no `Autostart`, and when `Autostart` turns from on to off for a service not shown.
- **It fires**: under the lock, with the token current, and the service still not shown and without `Autostart`, a service in `starting`, `running`, `nopage` or `retrying` sleeps: what `stop(id, false)` does (cancel its timers, bump `gen`, ignore its own exit, `d.Stop` the block) with the state `sleeping`. `Remembered` (`Stopped` and the port) is untouched. Any other state: nothing.
- **`Seen(ctx, ids)`** replaces the set. Before Boot it only records. After: each known service that joined the set has its timer cancelled and, when `sleeping`, starts as a start not by the person (`startService(ctx, id, false)`: `Stopped` untouched, so a `stopped` one stays stopped); each known service that left it is armed. Services in the set that are already up are left alone.
- **Boot** starts, `BootStagger` apart as today, every service the person did not stop that has `Autostart` or is in the shown set; the rest read `sleeping`, and those the person stopped read `stopped`.
- **`SetTools`**: a new entry the person did not stop starts at once (after Boot) when it has `Autostart` or is in the shown set, else it reads `sleeping`. A changed entry: `Autostart` on → off arms the timer when not shown; off → on cancels it and starts the service when `sleeping`. A verdict reset reads `sleeping` and then starts as a new entry would.
- A wake of a `"port": "auto"` service reuses its remembered port (`Remembered.Port`), as a start does today.

- [ ] **Step 1: Write the failing tests** (`supervisor_test.go`, the existing fake clock and deps):
  - `TestUnseenServiceSleepsAfterTenMinutes`: running and shown, `Seen([])`; at 9 min 59 s still `running`; at 10 min `sleeping`, `Stop` called once, `Remembered.Stopped == false`.
  - `TestSeenAgainCancelsSleep`: `Seen([])`, 5 min, `Seen([id])`, 20 min → still `running`, `Stop` never called.
  - `TestSeenSleepingStarts`: a `sleeping` service, `Seen([id])` → `starting`, `Ensure` and `Start` called, `Remembered.Stopped` untouched.
  - `TestSeenRunningDoesNothing`: running, `Seen([id])` twice → no `Start`, no `Stop`.
  - `TestNewSetArmsTheOnesThatLeft`: two running services shown, `Seen([a])` → at 10 min `b` is `sleeping` and `a` is `running`.
  - `TestStoppedServiceDoesNotStartWhenSeen`: Stop, then `Seen([id])` → `stopped`, `Start` not called.
  - `TestStartOffScreenSleeps`: a `sleeping` service never shown, `Start` (the person's) → running; at 10 min `sleeping`, `Remembered.Stopped == false`.
  - `TestKeepRunningNeverSleeps`: `Autostart: true`, `Seen([])`, 30 min → `running`.
  - `TestKeepRunningOffArmsTimer`: `Autostart: true`, off screen, `SetTools` with `Autostart: false` → `sleeping` at +10 min.
  - `TestKeepRunningOnStartsSleeping`: a `sleeping` service, `SetTools` with `Autostart: true` → `starting`.
  - `TestBootLeavesOnDemandSleeping`: boot with one Keep-running, one on-demand and one person-stopped service → the first `starting`, the second `sleeping` and never started, the third `stopped`.
  - `TestBootStartsShownOnDemand`: `Seen([id])` before `SetTools` and Boot, then both → the on-demand service starts.
  - `TestSetToolsStartsShownNewEntry`: after Boot, `Seen([id])` for an id not yet known, then `SetTools` adds it without `Autostart` → `starting`.
  - `TestElsewhereNeverSleeps`: `elsewhere`, `Seen([])`, 30 min → `elsewhere`, `Stop` never called.
  - `TestRetryingSleepsAndRetriesEnd`: running, `Seen([])`, a crash at 2 min (`retrying`, the retry starts it again before 10 min, which does not push the deadline back); at 10 min after the `Seen([])` → `sleeping`; a retry callback fired after starts nothing.
  - `TestWakeReusesRememberedPort`: a `"port": "auto"` service runs on port P, sleeps, `Seen([id])` → it starts on P.
  - `catalog_test.go` `TestMergeService`: an entry with a url and no `autostart` → `Autostart == false`; `autostart: true` → true.
- [ ] **Step 2: Run them to see them fail**: `go test ./pkg/services ./pkg/arctools -run 'Sleep|Seen|KeepRunning|Boot|SetToolsStartsShown|ElsewhereNever|Retrying|WakeReuses|TestMergeService'` → FAIL.
- [ ] **Step 3: Implement** as described; update the existing tests that assumed `autostart` defaults to true or that a service without a process reads `stopped` (they set `Autostart: true` where they test a boot start, and expect `sleeping` where nothing stopped it).
- [ ] **Step 4: Run**: the Step 2 command, the existing tests Step 3 updated by name (`-run`), and `go build ./...` → PASS. Verify runs the whole packages at the merge.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): a service without Keep running sleeps when off screen"`

### Task 3: The frontend reports what is on screen and words sleeping

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/serviceseen.ts`, `frontend/app/view/agents/serviceseen.test.ts`, `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `frontend/app/view/agents/servicesstore.ts`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/servicemenu.tsx`, `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`, `frontend/app/view/agents/appmodel.ts`, `frontend/app/view/agents/appmodel.test.ts`, `frontend/app/cockpit/servicespanel.tsx`

**Interfaces:**
- Consumes: `RpcApi.ServiceSeenCommand(TabRpcClient, { ids })` (Task 1); the state string `"sleeping"` (`ServiceStatus.state` is a plain string); `serviceByTabAtom`, `model.surfaceAtom`, and what `AgentSurface` already computes (`stackHidden`, `appMode`, `agent`, `cells`, `docked`, `dockMax`, `terminalDockFoldedAtom`).
- Produces: in `serviceseen.ts` (pure) `type ShownPanes = { surface: string; centerHidden: boolean; appTab: string | null; cells: string[]; docked: string | null; dockFolded: boolean; dockMax: boolean }` and `shownServices(p: ShownPanes, byTab: Record<string, ServiceStatus>): string[]`: `[]` when `surface !== "agent"` or `centerHidden`; else `appTab` alone when set (the page or waiting card covers the stack); else the `cells` (none when `dockMax`) plus `docked` (unless `dockFolded`); each tab mapped through `byTab` to its service id, non-services dropped, sorted, unique.
- Produces: `reportServicesSeen(ids: string[]): void` in `servicesstore.ts` (fires `ServiceSeenCommand`; a failure is logged with `console.error`, never swallowed).
- `AgentSurface` (always mounted) computes `shownServices(...)` with `centerHidden` = `stackHidden`, `appTab` = `agent.id` when `appMode`, `cells` = the visible cells' ids, `docked` = `docked?.id`, and reports it in a `useEffect` keyed on the ids joined, which also reports on mount.

Words (spec "State and words"): `serviceRowWords(sleeping)` → `{ words: "sleeping", tone: "muted", dot: "hollow" }`, no `action`; `serviceHeaderLine` of sleeping → `Sleeping · starts when shown`; `servicesChip` counts sleeping in neither running nor the tone; `popoverOrder` puts sleeping with stopped; `canStart(sleeping)` true, `canStop` and `canRestart` false. The popover (`servicespanel.tsx`): subtitle `held by arcterm`; no hover Start on a sleeping row (`canStart` still holds, for the page header and the menu); its header comment says a click opens the row in the centre, which starts a sleeping one. `serviceAppState` maps sleeping to `failed` (the log, its frame dropped) like stopped: name it in the comment. `withAutostart(entry, on)` writes `autostart: true` when on and drops the key when off; `setServiceAutostart`'s comment follows. The menu check reads `Keep running` (checked = `s.autostart`). Setup's detail row: label `Keep running`, sub and switch aria-label as in Global Constraints. `toolslibrarymodel`: `emptyForm().autostart` false; `formFromTool` reads `tool.autostart ?? false`; `formKeywords` and `keywordsFromTool` write `autostart: true` only when on (a tool with a page), never `false`.

- [ ] **Step 1: Write the failing tests**:
  - `serviceseen.test.ts`: `shownServices` gives the focused service tab in the centre (`appTab`); gives every service in `cells` and the unfolded `docked`, dropping tabs that are no service; `a service in an unfocused grid cell is on screen`; `a folded panel is off screen`; `dockMax shows only the panel`; `History in the centre counts as off screen` (`centerHidden: true` → `[]`); `another surface counts as off screen` (`surface: "cockpit"` → `[]`); the result is sorted and unique.
  - `servicesmodel.test.ts`: the sleeping row (words, tone, dot, no action), header, chip (2 running + 1 sleeping → label `2`, tone muted), order (sleeping with stopped), `canStart`/`canStop`/`canRestart`, `withAutostart` both ways.
  - `toolslibrarymodel.test.ts`: `formKeywords` with Keep running off writes no `autostart`, on writes `autostart: true`; `emptyForm().autostart === false`; `keywordsFromTool` of a service without `autostart` writes no key.
  - `appmodel.test.ts`: sleeping → `failed`.
  - Rewrite the existing assertions that expected the old default (`autostart: false` written when off).
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/serviceseen.test.ts frontend/app/view/agents/servicesmodel.test.ts frontend/app/view/agents/toolslibrarymodel.test.ts frontend/app/view/agents/appmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4: Run**: the same vitest files and `npx vitest run frontend/app/view/agents/toolsstore.test.ts` → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): report the services on screen, word sleeping, Keep running"`

### Task 4: Scenarios and docs

**Depends on:** Task 2, Task 3
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `AGENTS.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: the `services-states`, `services-tree`, `services-chip` and `services-setup` scenarios and their helpers (`svcArrange`, `svcWrite`, `svcWait`, `svcTeardown`, `SVC_MENU`), which today seed services with `autostart` unset and expect them running.

Every seeded service a scenario expects to run (`starting`, `running`, `elsewhere`, `porttaken`, `nopage`, `retrying`, `crashed`) gets `autostart: true`; grep the rest of `scenarios.mjs` for tools.json entries with `url` or `port` and do the same where a scenario expects one up. `autostart: false` entries lose the key (it is the default). The held-services comment above `SVC_SERVER_SOURCE` ("autostart is on unless the entry says false") says the new rule. `SVC_MENU`'s checkbox label becomes `Keep running`.

- `services-states` (board `RowStates`): `svc-off` is stopped by the person in arrange (`h.rpc("servicestop", { id: "svc-off" })`) and expects `stopped`; a new `svc-sleep` (no `autostart`, never shown) expects `sleeping`; step 0b's `svc-slow` and `svc-flaky` get `autostart: true`; the judge expects 9 rows; a new step `1b. svc-sleep reads sleeping: its words, a hollow dot, no hover action`.
- `services-tree` (board `Main`): step 2 also checks `svc-never` (sleeping) has no hover action, while `svc-off` (stopped by the person in arrange) shows Start; step 8 becomes `8. a stopped service shows its log, not started` on `svc-off` (header `Stopped` with Start, still `stopped` after 3 s) and `8b. a sleeping service starts when its row is clicked` on `svc-never` (its tab opens, `starting`, then `running` and the page header `Running on 127.0.0.1:`); step 9 reads `Keep running` checked on `svc-ok` (seeded `autostart: true`), a click drops the key, a second click writes `autostart: true`.
- `services-chip` (board `AppBarServices`): `svc-ok`, `svc-crash` and `svc-v6` get `autostart: true`; `svc-off` has no `autostart` and step 0 expects it `sleeping`; the chip still reads `1 · 1 crashed`; step 3's order stays `["svc-crash", "svc-v6", "svc-ok", "svc-off"]` (sleeping with the stopped); a new step `3b. the popover: subtitle held by arcterm, svc-off reads sleeping with no hover Start`.
- `services-setup`: step 2 becomes `2. the saved tool is a service: a free port, sleeping until shown, Keep running off` (the switch is `button[role="switch"][aria-label="Keep svc-new running"]`, `aria-checked="false"`, and the row reads label `Keep running` with its sub from Global Constraints); step 3 becomes `3. Keep running turns on` (the switch writes `autostart: true` and the service starts).
- The sleeping header line (`Sleeping · starts when shown`) is covered by `servicesmodel.test.ts` only: a scenario cannot hold a shown service asleep. The ten minutes are covered by the Go tests only.
- `CHANGELOG.md`: rewrite the held-services line under `Unreleased` to say arcterm starts a pinned app's server when you open it and lets it sleep ten minutes after you leave it, unless you set it to Keep running (keep `<!-- big -->`).
- `AGENTS.md` (the held-services sentence near line 205): "starts it, restarts it after a crash and starts it again with arcterm" becomes "starts it when it shows, restarts it after a crash and stops it ten minutes after it leaves the screen, unless it is set to Keep running".
- `docs/open-issues.md`: the Hóng hand check (line ~76–79: "starts at once", "starts again unless you stopped it") follows the sleep behaviour (added, it sleeps until opened; after ten minutes off screen its row reads `sleeping`; Keep running keeps it up and starts it with arcterm); the held-services RAM row (line ~1231) says a sleeping service holds 0 MB and only shown or Keep-running services run.

- [ ] **Step 1: Update the four scenarios.**
- [ ] **Step 2: Run** them in a browser build of this tree: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs services-states services-tree services-setup services-chip` → exit 0 (it starts and stops its own app on its own ports).
- [ ] **Step 3: Update the changelog line, AGENTS.md and open-issues.**
- [ ] **Step 4: Commit**: `git commit -m "test(services): sleeping in the CDP scenarios; changelog and docs"`
