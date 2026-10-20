# Held services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wavesrv holds every pinned app's server as a service: it starts them, gives them a port, restarts them when
they crash, starts them again when arcterm opens, and the cockpit shows their state in the Agent tree, the page header
and a Services chip in the app bar.

**Architecture:** A new Go package `pkg/services` owns a supervisor with injected dependencies (pure state machine,
tested with fakes) and a real wiring onto `blockcontroller` and `wcore`: each service is one `cmd`-controller terminal
block in a tab wavesrv creates. Status goes to the frontend through four wshrpc commands and a `services:changed`
event; the frontend derives rows, the header line and the chip from one pure model.

**Tech Stack:** Go (wavesrv, wshrpc, tsgen), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-20-held-services-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/services/... ./pkg/blockcontroller/... ./pkg/arctools/... ./pkg/wconfig/... ./pkg/wshrpc/... ./pkg/tsgen/...`

**Final:** `node scripts/cdp/final-verify.mjs services-tree services-chip`

The design canvas is `.superpowers/design/held-services/project` (boards `Main`, `AppBarServices`, `RowStates`). It is
gitignored, so the run gets it with `wsh runs start --prototype <absolute path>` rather than a Prototype line here.

## Global Constraints

- A service is a tool with a page: `url` (fixed port, must pass `arctools.AppURL`: http on 127.0.0.1 with a port) or `"port": "auto"`. `url` wins if both are set.
- `autostart` defaults to **true** for a service; a service the person stopped stays stopped across restarts until Start or Restart.
- Crash retry: 1 s, 2 s, 4 s, 8 s, 16 s; after 5 crashes within 10 minutes it gives up; a run that stayed up 10 minutes resets the count.
- Readiness: HTTP GET of the page, any response counts, 1.5 s timeout, every 500 ms, up to 30 s, only while starting. Nothing polls while a service runs.
- Boot starts are staggered 300 ms, like `RestoreLiveAgents` (`pkg/blockcontroller/agentrestore.go:54`).
- The remembered port and the "stopped by the person" flag live in arcterm's own state file, never in `tools.json`.
- A service's folder is its `dir`, else `~` (a service has no focused agent to take a folder from).
- Colors only from `@theme` tokens (`frontend/tailwindsetup.css`); every state is a dot plus words, never color alone; Inter everywhere except commands, which are `font-mono`.
- Exact copy: the row words in Task 5's table; header `Running on 127.0.0.1:8386 · up 2h 14m`; popover footer `A tool with a page is a service. Add one in Setup → Tools.`
- The Mac is the target; Windows keeps compiling (`leftovers_other.go` stays a no-op) but is not tested.
- Never hand-edit generated files: run `task generate` after changing a wshrpc, waveobj or wconfig type.
- Commit messages carry no co-author trailer.

## Review Focus

- A dev server that listens only on `::1` (some `localhost` binds): the row must reach `nopage` after 30 s, never spin on `starting`. Test: `TestIPv6OnlyEndsNoPage` (Task 3).
- Two services given the same fixed port: the second must read `porttaken` naming the first service, never `elsewhere` showing the first one's page. Test: `TestSamePortAsAnotherService` (Task 3).
- arcterm restarting while a service is `retrying`: the next boot starts it again (it was not stopped by the person). Test: `TestBootStartsARetryingService` (Task 3).
- The service's tab closed some other way (a terminal close key): counts as Stop, the row stays, the next Start makes a new tab. Test: `TestBlockClosedCountsAsStop` (Task 3).
- A command that is not on PATH (exit 127): five retries, then `crashed · exit 127`. Test: `TestCommandNotFoundGivesUp` (Task 3).

---

### Task 1: Service config and the pure model

**Depends on:** none
**Files:** `pkg/wconfig/settingsconfig.go`, `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`, `pkg/services/model.go`, `pkg/services/model_test.go`, `pkg/waveobj/wtypemeta.go`, `pkg/waveobj/metaconsts.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `wconfig.ToolKeywords.Port string` (`json:"port,omitempty"`, only `"auto"` means anything) and `Autostart *bool` (`json:"autostart,omitempty"`).
- Produces: `arctools.Tool.Port string` (`json:"port,omitempty"`), `Autostart bool` (`json:"autostart,omitempty"`), `const arctools.PortAuto = "auto"`, `func arctools.IsService(t Tool) bool`.
- Produces: block meta `tool:service` (`MetaKey_ToolService`, bool): the block is a held service's.
- Produces in `pkg/services/model.go`: state constants `StateStopped = "stopped"`, `StateStarting = "starting"`, `StateRunning = "running"`, `StateElsewhere = "elsewhere"`, `StateRetrying = "retrying"`, `StateCrashed = "crashed"`, `StatePortTaken = "porttaken"`, `StateNoPage = "nopage"`; constants `MaxCrashes = 5`, `CrashWindow = 10 * time.Minute`, `StartTimeout = 30 * time.Second`, `ProbeInterval = 500 * time.Millisecond`, `ProbeTimeout = 1500 * time.Millisecond`, `BootStagger = 300 * time.Millisecond`; `func Backoff(crash int) time.Duration`; `type CrashLog struct`, `func (c *CrashLog) Add(t time.Time) int`, `func (c *CrashLog) Reset()`; `func ExitIsStop(exitCode int, interrupted bool) bool`; `func ScanLocalURL(output string) (int, bool)`; `func NeedsRestart(old, cur arctools.Tool) bool`; `func ServiceDir(t arctools.Tool) string`.

- [ ] **Step 1: Write the failing tests**

`pkg/arctools/catalog_test.go`:
- `TestMergeService`: a user entry `{command: "npm", args: "run dash", url: "http://127.0.0.1:8386/"}` merges to `IsService == true`, `Autostart == true`; with `Autostart: &false` → `Autostart == false`; `{port: "auto"}` → `IsService == true`, `Port == "auto"`; `{port: "8080"}` → `Port == ""`, `IsService == false`; `{url: "http://localhost:8386/"}` → `IsService == false` (AppURL drops it); a built-in like `lazygit` → `IsService == false`.

`pkg/services/model_test.go`:
- `TestBackoff`: `Backoff(1..5)` = 1 s, 2 s, 4 s, 8 s, 16 s; `Backoff(6)` = 16 s.
- `TestCrashLogWindow`: five `Add` at t0..t0+4 min return 1..5; an `Add` at t0+11 min returns 4 (t0 fell out); after `Reset`, `Add` returns 1.
- `TestExitIsStop`: `(0,false)` true, `(1,false)` false, `(130,true)` true, `(127,false)` false.
- `TestScanLocalURL`: `"  ➜  Local:   http://localhost:5173/"` → 5173; `"\x1b[32mhttp://127.0.0.1:41207\x1b[0m"` → 41207; `"on http://0.0.0.0:3000"` → 3000; `"https://example.com:443"` → false; `"no url here"` → false; two URLs → the first.
- `TestNeedsRestart`: a changed name, purpose or autostart → false; a changed command, args, dir, url or port → true.
- `TestServiceDir`: `Dir: "~/Workspaces/dev/portfolio-journal"` → that; empty → `"~"`.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/arctools ./pkg/services -run 'TestMergeService|TestBackoff|TestCrashLogWindow|TestExitIsStop|TestScanLocalURL|TestNeedsRestart|TestServiceDir'`
Expected: FAIL (undefined: IsService, Backoff, …)

- [ ] **Step 3: Implement**

`ToolKeywords` and `Tool` gain the fields above. `override` (`pkg/arctools/catalog.go:200`) copies `Port` only when it is `"auto"`, and sets `Autostart` to `*u.Autostart` when given, else `true` when the merged tool `IsService`. `IsService(t) = AppURL(t.Url) || t.Port == PortAuto`. Add `ToolService bool json:"tool:service,omitempty"` beside `ToolAppOwned` in `pkg/waveobj/wtypemeta.go:54`. `ScanLocalURL` strips ANSI escapes, then matches `http://(127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)`.

- [ ] **Step 4: Regenerate and run the tests**

Run: `task generate && go test ./pkg/arctools ./pkg/services`
Expected: PASS; `git diff --stat` shows `pkg/waveobj/metaconsts.go` and `frontend/types/gotypes.d.ts` changed.

- [ ] **Step 5: Commit**

`git commit -m "feat(services): service config keys and the pure model"`

### Task 2: Controller hooks for services

**Depends on:** none
**Files:** `pkg/blockcontroller/servicehooks.go`, `pkg/blockcontroller/servicehooks_test.go`, `pkg/blockcontroller/blockcontroller.go`, `pkg/blockcontroller/shellcontroller.go`, `pkg/blockcontroller/leftovers_darwin.go`, `pkg/blockcontroller/leftovers_other.go`, `pkg/blockcontroller/leftovers_darwin_test.go`

**Interfaces:**
- Produces: `var ServiceExitHook func(blockId string, exitCode int)`, called beside `AgentOutcomeHook` wherever `exitHook()` runs (`shellcontroller.go:357`, `:595`) and, like it, never while `shuttingDown` (`blockcontroller.go:388`), so a quit is never a crash.
- Produces: `func StopLeftovers(blockId string)` (exported wrapper of `stopLeftovers`, a no-op off darwin).
- Produces: `const InterruptWindow = 3 * time.Second`; `func InterruptedWithin(blockId string, d time.Duration, now time.Time) bool`, fed by `sendInput` (`blockcontroller.go:378`): when `inputUnion.InputData` holds byte `0x03`, record the time for that block.

- [ ] **Step 1: Write the failing tests**

- `TestInterruptedWithin` (`servicehooks_test.go`): `noteInput("b1", []byte{3}, t0)`; `InterruptedWithin("b1", 3*time.Second, t0.Add(2*time.Second))` true; at `t0.Add(4*time.Second)` false; `noteInput("b2", []byte("abc"), t0)` leaves `b2` false.
- `TestServiceExitHookSilentOnShutdown`: with `shuttingDown` set, the hook getter returns nil.
- `TestStopLeftoversTakesTheChild` (`leftovers_darwin_test.go`, darwin build tag): start `sh -c 'sleep 60 & echo $!; wait'` with `WAVETERM_BLOCKID=<random uuid>` in its env, read the child pid from its first stdout line, call `StopLeftovers(uuid)`, then both the `sh` pid and the child pid are gone within 3 s (`syscall.Kill(pid, 0)` returns `ESRCH`). Shorten `leftoverStopWait` in the test.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/blockcontroller -run 'TestInterruptedWithin|TestServiceExitHookSilentOnShutdown|TestStopLeftoversTakesTheChild'`
Expected: FAIL (undefined)

- [ ] **Step 3: Implement** the three interfaces above in `servicehooks.go`, with the two call sites and the `sendInput` line. If `/bin/sleep` hides its environment from the sweep (the comment at `leftovers_darwin.go:19` says platform binaries do), use a `sh -c 'while :; do sleep 1; done'` child instead, whose `sh` carries the variable.

- [ ] **Step 4: Run the tests**

Run: `go test ./pkg/blockcontroller -run 'TestInterruptedWithin|TestServiceExitHookSilentOnShutdown|TestStopLeftoversTakesTheChild'`
Expected: PASS

- [ ] **Step 5: Commit**

`git commit -m "feat(blockcontroller): exit hook, interrupt marker and sweep for held services"`

### Task 3: The supervisor

**Depends on:** Task 1, Task 2
**Files:** `pkg/services/supervisor.go`, `pkg/services/supervisor_test.go`, `pkg/services/statefile.go`, `pkg/services/statefile_test.go`, `pkg/services/real.go`, `pkg/wshrpc/wshrpctypes_services.go`

**Interfaces:**
- Consumes: Task 1's model, `arctools.IsService`, `MetaKey_ToolService`; Task 2's `ServiceExitHook`, `StopLeftovers`, `InterruptedWithin`, `InterruptWindow`.
- Produces in `pkg/wshrpc/wshrpctypes_services.go` (wshrpc, not `pkg/services`: wshrpc may not import a package that imports blockcontroller):
  `type ServiceStatus struct { Id string "id"; Name string "name"; Command string "command"; Dir string "dir"; State string "state"; Port int "port,omitempty"; Url string "url,omitempty"; TabId string "tabid,omitempty"; BlockId string "blockid,omitempty"; StartedMs int64 "startedms,omitempty"; ExitCode int "exitcode,omitempty"; RetryAtMs int64 "retryatms,omitempty"; Holder string "holder,omitempty"; Autostart bool "autostart" }` (json tags as quoted) and `type ServicesData struct { Services []ServiceStatus "services" }`.
- Produces in `pkg/services`: `type Deps struct` (`Now`, `After(d, f) (cancel func())`, `Probe(ctx, url) bool`, `FreePort() (int, error)`, `PortHolder(ctx, port) (string, bool)`, `Ensure(ctx, Def) (tabId, blockId string, err error)`, `Start(ctx, tabId, blockId) error`, `Stop(blockId)`, `Sweep(blockId)`, `ReadLog(blockId) string`, `CloseTab(ctx, tabId) error`, `Publish(wshrpc.ServicesData)`, `State StateStore`); `func New(d Deps) *Supervisor`; methods `SetTools(ctx, []arctools.Tool)`, `Boot(ctx)`, `Start(ctx, id) error`, `Stop(ctx, id) error`, `Restart(ctx, id) error`, `OnExit(blockId string, exitCode int, interrupted bool)`, `OnBlockClosed(blockId string)`, `Status() []wshrpc.ServiceStatus`; `var Default *Supervisor`; `func Init(ctx context.Context)`; `func OnConfig(fc wconfig.FullConfigType)`.
- Produces: `type StateStore interface { Get(id string) Remembered; Set(id string, r Remembered) error }`, `type Remembered struct { Port int "port,omitempty"; Stopped bool "stopped,omitempty" }`, file `filepath.Join(wavebase.GetWaveDataDir(), "services.json")`, written atomically (temp file + rename).

Behaviour the tests pin (spec "Lifecycle", "Port", "States"):
- Start, fixed `url`: probe first; answers → `elsewhere`, nothing started. Else `PortHolder` finds a holder → `porttaken` with `Holder` (a held service's name when the holder is another service's block, else the program name, else `another program`). Else `Ensure`, `Start`, `starting`, probe every `ProbeInterval` until `StartTimeout`: an answer → `running` with `StartedMs`; none → `nopage` (the process keeps running).
- Start, `port: "auto"`: the remembered port if `PortHolder` says it is free, else `FreePort()`, remembered at once. While starting, a probe miss followed by `ScanLocalURL(ReadLog(blockId))` naming another port switches the probe to it and remembers it.
- `Ensure` writes block meta every time: `view: "term"`, `controller: "cmd"`, `cmd` (command + args), `cmd:cwd` (`ServiceDir`), `cmd:env: {"PORT": "<port>"}`, `tool:id`, `tool:service: true`; the real one creates the tab with `wcore.CreateTab(ctx, wsId, name, false, true)` (no default block) and `wcore.CreateBlock`, in the workspace of the client's first window (`wcore.GetClientData`, `wcore.GetWindow`), and sets tab meta `session:label` to the service name. The real `Start` is `blockcontroller.ResyncController(ctx, tabId, blockId, &waveobj.RuntimeOpts{TermSize: {Rows: 30, Cols: 120}}, true)`.
- Stop: mark stopped, `Remembered.Stopped = true`, `Stop(blockId)` (real: `DestroyBlockController` then `StopLeftovers`); the exit that follows is ignored. Start and Restart clear `Stopped`. Restart = Stop then Start.
- `OnExit` of a service block not being stopped: `ExitIsStop` → `stopped` with `Remembered.Stopped = true`; else crash: if it ran ≥ `CrashWindow`, `Reset` the log; `n := Add(now)`; `n < MaxCrashes` → `retrying`, `RetryAtMs = now + Backoff(n)`, timer to Start; else `crashed`, `ExitCode` set, no timer.
- `OnBlockClosed` of a service block: like Stop (remembered), `TabId`/`BlockId` cleared.
- `SetTools`: a new service is added `stopped`; `NeedsRestart` on a running one → Restart; a removed one → Stop and `CloseTab`.
- `Boot`: for each service whose block exists, `Sweep(blockId)` first; then start every one with `Autostart && !Remembered.Stopped`, `BootStagger` apart.
- Every state change calls `Publish` with the full `Status()`.
- `Init` builds the real deps, sets `blockcontroller.ServiceExitHook` (it computes `interrupted` with `InterruptedWithin(blockId, InterruptWindow, time.Now())`), subscribes to `wps.Event_BlockClose` the way `InitBlockController` does (`blockcontroller.go:191-194`), loads services from `arctools.Merge(arctools.Builtin(), fc.Tools)` filtered by `IsService`, then `Boot`. `OnConfig` calls `SetTools`. The real `PortHolder` tries `net.Listen("tcp", "127.0.0.1:<port>")`; on failure it names the holder from `devservers.ListAll` by port when it can. The real `ReadLog` reads the last 64 KB of the block's `wavebase.BlockFile_Term` from `filestore.WFS`.

- [ ] **Step 1: Write the failing tests** in `supervisor_test.go` with fake deps (a manual clock whose `After` records callbacks the test fires, a scripted `Probe`, an in-memory `StateStore`, recorded `Ensure`/`Start`/`Stop`/`Sweep`/`CloseTab`/`Publish` calls):
  - `TestStartProbesThenRunning`: state `starting`, then `running` on the second probe with `Port == 8386`, `StartedMs` set.
  - `TestCrashRetriesWithBackoffThenGivesUp`: five `OnExit(b, 1, false)` within 10 min give `retrying` with `RetryAtMs` now+1s, +2s, +4s, +8s, then `crashed` with `ExitCode == 1` and no timer.
  - `TestLongRunResetsCrashCount`: running 11 min, then a crash → `retrying` at +1s.
  - `TestStopIsRememberedAndNotRetried`: Stop → `stopped`, `Stopped == true`; a following `OnExit(b, 143, false)` changes nothing; `Boot` does not start it; `Start` clears `Stopped`.
  - `TestInterruptCountsAsStop`: `OnExit(b, 130, true)` → `stopped`, `Stopped == true`, no timer. `TestExitZeroIsStop`: `OnExit(b, 0, false)` → same.
  - `TestElsewhere`: the page answers before start → `elsewhere`, `Ensure` and `Start` never called; `Stop` returns an error and stops nothing.
  - `TestPortTaken`: no answer, `PortHolder` → `("python3", true)` → `porttaken`, `Holder == "python3"`, `Start` never called.
  - `TestSamePortAsAnotherService`: services `a` and `b` both on 8386, `a` running; starting `b` → `porttaken` with `Holder == "a"`.
  - `TestAutoPortRemembered`: `FreePort` → 41207, remembered; Stop, Start → 41207 again without calling `FreePort`; when `PortHolder(41207)` is held → a new `FreePort`.
  - `TestLogFallback`: auto port 41207 never answers; `ReadLog` returns `"Local: http://localhost:5173/"`; `Probe` answers on 5173 → `running`, `Port == 5173`, remembered 5173.
  - `TestNoPageAfterTimeout` and `TestIPv6OnlyEndsNoPage` (the log names `http://localhost:5173` but 127.0.0.1:5173 never answers): after 30 s → `nopage`, `Stop` never called.
  - `TestConfigChangeRestarts`: `SetTools` with changed `Args` on a running service → Stop then Start; a changed `Name` → neither. `TestRemovedToolStopsAndClosesTab`.
  - `TestBootSweepsAndStartsAutostart`: `Sweep` for each existing block; autostart services started 300 ms apart; `Autostart == false` never started. `TestBootStartsARetryingService`: a service left `retrying` (not `Stopped`) is started at boot.
  - `TestBlockClosedCountsAsStop`: `OnBlockClosed(b)` → `stopped`, `Stopped == true`, `TabId == ""`; the next `Start` calls `Ensure` again.
  - `TestCommandNotFoundGivesUp`: five `OnExit(b, 127, false)` → `crashed`, `ExitCode == 127`.
  - `TestStateFileRoundTrip` (`statefile_test.go`): `Set("portfolio", {Port: 8386, Stopped: true})` in a temp dir, a fresh store reads it back; a missing file reads empty.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/services`
Expected: FAIL (undefined: New, Deps, …)

- [ ] **Step 3: Implement** `supervisor.go` (one mutex around the services map; timers through `Deps.After`), `statefile.go`, `real.go` (the real deps, `Init`, `OnConfig`), and the two types in `wshrpctypes_services.go`.

- [ ] **Step 4: Run the tests**

Run: `go test ./pkg/services && go build ./...`
Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit**

`git commit -m "feat(services): the supervisor that holds pinned apps' servers"`

### Task 4: RPC, event and boot wiring

**Depends on:** Task 3
**Files:** `pkg/wshrpc/wshrpctypes_services.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_services.go`, `pkg/wshrpc/wshserver/wshserver_services_test.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `cmd/server/main-server.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

**Interfaces:**
- Consumes: `services.Default`, `Init`, `OnConfig`, `wshrpc.ServiceStatus`, `wshrpc.ServicesData`.
- Produces: `type ServicesCommands interface { ServicesStatusCommand(ctx) (*ServicesData, error); ServiceStartCommand(ctx, CommandServiceData) error; ServiceStopCommand(ctx, CommandServiceData) error; ServiceRestartCommand(ctx, CommandServiceData) error }`, `type CommandServiceData struct { Id string "id" }`, embedded in `WshRpcInterface` (`pkg/wshrpc/wshrpctypes.go:43`, after `ToolsCommands`). Frontend: `RpcApi.ServicesStatusCommand(TabRpcClient)`, `RpcApi.ServiceStartCommand(TabRpcClient, { id })`, `…StopCommand`, `…RestartCommand`.
- Produces: `wps.Event_ServicesChanged = "services:changed" // type: wshrpc.ServicesData`, in the valid list (`wpstypes.go:50-78`) and `WaveEventDataTypes` (`pkg/tsgen/tsgenevent.go:23`). The real `Deps.Publish` publishes it with no scope.

- [ ] **Step 1: Write the failing test** `TestServiceCommandUnknownId` (`wshserver_services_test.go`): with `services.Default` built from fakes holding no services, `ServiceStartCommand(ctx, {Id: "nope"})` returns an error containing `no service "nope"`; `ServicesStatusCommand` returns an empty list, not nil.
- [ ] **Step 2: Run it to see it fail**: `go test ./pkg/wshrpc/wshserver -run '^TestServiceCommandUnknownId$'` → FAIL (undefined).
- [ ] **Step 3: Implement** the interface, the server methods (each delegates to `services.Default`), the event, and in `cmd/server/main-server.go`: `services.Init(context.Background())` right after `RestoreLiveAgents` (`:526`), and `services.OnConfig(fc)` inside `wconfig.ConfigHook` (`:489`). Point `Deps.Publish` at `wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_ServicesChanged, Data: data})`.
- [ ] **Step 4: Regenerate and run**: `task generate && go test ./pkg/wshrpc/... ./pkg/services && go build ./...` → PASS; `frontend/types/waveevent.d.ts` has `services:changed`, `wshclientapi.ts` has the four commands.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): wshrpc commands, services:changed event, start at boot"`

### Task 5: Frontend services store and model

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `frontend/app/view/agents/servicesstore.ts`

**Interfaces:**
- Consumes: the generated `ServiceStatus`, `ServicesData`, the four RPCs, event `services:changed`; `appProjectName` (`appmodel.ts`).
- Produces in `servicesmodel.ts` (pure): `type ServiceDot = "solid" | "hollow" | "pulse"`, `type ServiceTone = "working" | "error" | "warning" | "muted"`; `serviceRowWords(s: ServiceStatus, nowMs: number): { words: string; port?: string; tone: ServiceTone; dot: ServiceDot; action?: "start" | "restart" }`; `serviceHeaderLine(s: ServiceStatus, nowMs: number): string`; `upFor(ms: number): string`; `servicesChip(list: ServiceStatus[]): { hidden: boolean; label: string; tone: "error" | "warning" | "muted"; title: string }`; `popoverOrder(list: ServiceStatus[]): ServiceStatus[]`; `serviceProject(s: ServiceStatus, projects: Record<string, { path?: string }>, home: string, homeName: string): string`; `canStop(s): boolean` (running, starting, retrying, nopage), `canStart(s): boolean` (stopped, crashed, porttaken).
- Produces in `servicesstore.ts`: `servicesAtom: PrimitiveAtom<ServiceStatus[] | null>`; `ensureServicesFeed(): void` (idempotent: the first call reads `ServicesStatusCommand` and subscribes to `services:changed` with `waveEventSubscribeSingle`, as `jobqueuestore.ts:42-48` does; no unmount); `serviceByTabAtom` (a derived `Record<tabId, ServiceStatus>`); `startService(id)`, `stopService(id)`, `restartService(id)`: the RPCs; `setServiceAutostart(id: string, on: boolean)`: reads the entry from the full config's `tools`, writes it back with `autostart` (`false`) or without it (`true`) through `addUserTool` (`toolsstore.ts:479`).

The row words (spec "States"; `nowMs` drives the retry seconds):

| state | words | port | tone | dot | action |
|---|---|---|---|---|---|
| stopped | `stopped` | | muted | hollow | start |
| starting | `starting…` | | working | pulse | |
| running | | `:8386` | working | solid | |
| elsewhere | `not started by arcterm` | `:8386` | working | hollow | |
| retrying | `crashed · retry in 8s` | | error | solid | |
| crashed | `crashed · exit 1` | | error | solid | restart |
| porttaken | `8386 is held by python3` (`another program` without a holder) | | warning | solid | |
| nopage | `running, no page after 30s` | | warning | solid | |

- [ ] **Step 1: Write the failing tests** (`servicesmodel.test.ts`, vitest, style of `appmodel.test.ts`): one `it` per table row with the exact strings; `serviceHeaderLine` of running `{port: 8386, startedMs: now - 8_040_000}` → `Running on 127.0.0.1:8386 · up 2h 14m`, of starting auto 41207 → `Starting… waiting for 127.0.0.1:41207`, of crashed → `Crashed · exit 1`; `upFor`: 40_000 → `40s`, 300_000 → `5m`, 8_040_000 → `2h 14m`; `servicesChip([])` → `hidden: true`; three running + one crashed → `label: "3 · 1 crashed"`, `tone: "error"`; one nopage and two running → `label: "2"`, `tone: "warning"`; `popoverOrder` puts crashed, then porttaken/nopage, then running/starting/elsewhere, then stopped, by name inside each; `serviceProject` with `dir: "~/Workspaces/dev/portfolio-journal"` and a registered `portfolio-journal` at that path → `portfolio-journal`, an unregistered dir → the home name.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/servicesmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run**: `npx vitest run frontend/app/view/agents/servicesmodel.test.ts` → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0 (about 2 min).
- [ ] **Step 5: Commit**: `git commit -m "feat(services): frontend store and the pure row, header and chip model"`

### Task 6: Service rows in the Agent tree

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/activenav.ts`, `frontend/app/view/agents/servicemenu.tsx`

**Interfaces:**
- Consumes: `servicesAtom`, `ensureServicesFeed`, `serviceRowWords`, `serviceProject`, `startService`, `stopService`, `restartService`, `setServiceAutostart`.
- Produces: `projectTree` input gains `services?: readonly { id: string; name: string; project: string; tabId?: string }[]`; `ProjectTreeRow` gains `{ kind: "service"; project: string; serviceId: string; tabId?: string }`. `showServiceMenu(model, s: ServiceStatus, e: React.MouseEvent)` in `servicemenu.tsx`.

Board `Main` (Prototype) is the look. A project's service rows come after its divider and before its terminal rows; a terminal whose tab is a service's tab is never a terminal row; a folder holding only services still shows; the filter matches a service's name; `j`/`k` (`activenav.ts`) reach a service row through its tab id. The row copies `TerminalRow`'s classes (`agenttree.tsx:2039-2042`), the app-window icon, then `serviceRowWords`: the words (`text-[11px]`, tone token), the port (`text-[11px] text-muted tabular-nums`), the 6 px dot; on hover the action button in the Jobs row-button style (`jobqueuepanel.tsx:83`): `Start` or `Restart`. A click on a service with a tab selects its tab (`selectAgentRow`); one with no tab yet starts it, and its tab is selected once the status carries one. The menu: Start, Stop, Restart (each enabled by `canStart`/`canStop`), Open in the browser (when it has a url), Start with arcterm (checked by `autostart`), Edit in Setup → Tools.

- [ ] **Step 1: Write the failing tests** (`agentsidebarmodel.test.ts`): `TestServicesAfterDivider`: a project with one agent, one service and one terminal gives `group, <agent rows>, divider, service, terminal`; `service tab is not a terminal row`: a terminal whose id equals the service's `tabId` appears once, as the service row; `folder with only a service`: a project with no agent and one service gives `group, service`; `filter matches a service name`.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** the model change, the `case "service"` in `agenttree.tsx` (beside `case "terminal"` at `:2544`, passing the services into the `projectTree` call at `:2410` after `ensureServicesFeed()`), the same input in `activenav.ts:37`, and `servicemenu.tsx` (items in the `terminalMenuItems` style, `terminalsrail.tsx:91-108`).
- [ ] **Step 4: Run**: the vitest file → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0. The row is shown by the `services-tree` scenario (Task 10).
- [ ] **Step 5: Commit**: `git commit -m "feat(services): service rows in the Agent tree's project folders"`

### Task 7: The page header and the app pane run on service state

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/appmodel.ts`, `frontend/app/view/agents/appmodel.test.ts`, `frontend/app/view/agents/appstore.ts`, `frontend/app/view/agents/apppane.tsx`, `frontend/app/view/agents/toolsstore.ts`, `frontend/app/view/agents/terminalpaneheadview.tsx`, `frontend/app/view/agents/agentsurface.tsx`

**Interfaces:**
- Consumes: `serviceByTabAtom`, `serviceHeaderLine`, `canStart`, `canStop`, `startService`, `stopService`, `restartService`, `ensureServicesFeed`.
- Produces: `serviceAppState(s: ServiceStatus, view: AppView, reloads: number): AppState` in `appmodel.ts` (running or elsewhere → phase `open` with `url = s.url`; starting → `starting`; every other state → `failed`, which shows the log; `owned = s.state !== "elsewhere"`). `appStatesAtom` keeps its shape (keyed by tab id) but is derived from `serviceByTabAtom` plus a per-tab view and reload count, so `apppane.tsx` and `agentsurface.tsx:157-162` keep working.

Board `Main` (Prototype) is the header. The frontend probe loop, `trackApp`, `adoptApp`, `probeApp`, `whileLaunching` and the `tool:appowned` write go (`appstore.ts:100-188`, `toolsstore.ts:293-324`, `terminalpaneheadview.tsx:71-75`). `openApp` (`toolsstore.ts:280`) becomes: start the service unless it is running, starting or elsewhere; once its status has a tab id, focus that tab, switch to the Agent surface and `showTerminal`. The header of a service tab keeps the name, project, Page | Log, Back, Forward, Reload (Windows), Home and Open in the browser, and adds after Page | Log the state line: a 6 px dot and `serviceHeaderLine` (`text-[11.5px] text-muted tabular-nums`, re-rendered every 30 s while running); then, at the right, a Restart icon button (`RotateCw`, label `Restart <name>`, the header's `BUTTON` class) and the word button: `Stop` when `canStop`, `Start` when `canStart`, none when elsewhere (`STOP_BUTTON` class). A service tab has no close button.

- [ ] **Step 1: Write the failing tests** (`appmodel.test.ts`): `serviceAppState` for running → `{phase: "open", url: "http://127.0.0.1:8386/", owned: true}`; elsewhere → `open`, `owned: false`; starting → `starting`; crashed, porttaken, nopage, retrying, stopped → `failed`. Remove the tests of deleted functions.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/appmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4: Run**: the vitest file → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0. The header is shown by the `services-tree` scenario (Task 10).
- [ ] **Step 5: Commit**: `git commit -m "feat(services): the page header and app pane follow the service's state"`

### Task 8: The Services chip and popover

**Depends on:** Task 5
**Files:** `frontend/app/cockpit/serviceschip.tsx`, `frontend/app/cockpit/servicespanel.tsx`, `frontend/app/cockpit/servicespopoverstore.ts`, `frontend/app/cockpit/app-bar.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/cockpit/jobqueuestore.ts`, `frontend/app/view/agents/consumersstore.ts`, `frontend/app/view/agents/machineserversstore.ts`, `frontend/app/view/agents/machineserverschip.tsx`

**Interfaces:**
- Consumes: `servicesAtom`, `ensureServicesFeed`, `servicesChip`, `popoverOrder`, `serviceRowWords`, `serviceProject`, `upFor`, the service actions; `openTarget(model, { kind: "agent", tabId })` (`frontend/app/view/jarvis/openref.ts:110`); `usePanelPlacement` (`@/app/view/agents/consumerspanel`).
- Produces: `servicesOpenAtom`, `servicesOpenerAtom`, `toggleServices(opener: Element | null): void` (closes the Jobs, Servers and Consumers popovers first); `ServicesChip()`; `ServicesPanel({ model })`.

Board `AppBarServices` (Prototype) is the look. The chip sits in `app-bar.tsx` just before `<JobQueueChip />` (`:144`), in the Jobs chip's classes (`jobqueuechip.tsx:45-48`) with the `Server` icon, `servicesChip` for label and title, the tone as `text-error` / `text-warning` / `text-muted`; hidden when `hidden`. The panel mounts in `cockpit-root.tsx` beside `<JobQueuePanel>` (`:222`) and copies its frame (`jobqueuepanel.tsx:265-296`: backdrop, `PopoverReveal`, `rounded-lg border border-edge-strong bg-surface-raised shadow-popover`); header `Services`; rows in `popoverOrder`: dot, name (`text-[12.5px] text-primary`), project (`text-[11px] text-muted`), then the words, or the port and `upFor` (`text-[12px] tabular-nums text-secondary`), and on hover the actions (`Log` for a crashed one, `Restart`, `Start`, `Stop`, in the Jobs row-button class); a second line: the command in `font-mono` and ` in <folder name>`. Footer: `A tool with a page is a service. Add one in Setup → Tools.` A click or Enter on a row opens it through `openTarget` (starting it first when it has no tab); Escape closes, as at `jobqueuepanel.tsx:247-261`; ArrowUp/ArrowDown move a highlighted row. `toggleJobQueue`, `toggleConsumers` and the Servers chip's toggle close the Services popover.

The chip and panel hold no logic of their own: their words, order and tone come from Task 5's tested model, and the
`services-chip` scenario (Task 10) shows them, so this task adds no unit test.

- [ ] **Step 1: Implement** the three new files and the mounts and toggles.
- [ ] **Step 2: Run**: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 3: Commit**: `git commit -m "feat(services): Services chip and popover in the app bar"`

### Task 9: Setup → Tools: a free port and Start with arcterm

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`, `frontend/app/view/agents/toolslibrary.tsx`

**Interfaces:**
- Consumes: the generated `ToolKeywords.port` / `autostart`, `ToolStatus.port` / `autostart`; `addUserTool` (`toolsstore.ts:479`).
- Produces: `ToolForm` (`toolslibrarymodel.ts:261`) gains `autoPort: boolean` and `autostart: boolean` (`emptyForm`: `false`, `true`; `formFromTool` reads `tool.port === "auto"` and `tool.autostart`). `formKeywords` (`:326`) writes `port: "auto"` and no `url` when `autoPort`, and `autostart: false` only when it is off. `validateNewTool` accepts an empty Page when `autoPort`.

In the add form, beside the Page field (`toolslibrary.tsx:959-968`), a checkbox `Pick a free port` (when checked, the Page input is disabled and empty). In the detail pane, the Page row (`:555-568`) reads `A free port, picked by arcterm` for an auto-port tool, and a tool with a page gets a `SettingRow label="Start with arcterm" sub="Run it whenever arcterm is open"` with the `element/` toggle, saving through `addUserTool` with the entry's other keys unchanged.

- [ ] **Step 1: Write the failing tests** (`toolslibrarymodel.test.ts`): `formKeywords` with `autoPort: true, url: ""` → `{…, port: "auto"}` and no `url`; with `autostart: false` → `autostart: false`; with `autostart: true` → no `autostart` key; `validateNewTool({name: "docs", command: "npm run dev", url: "", autoPort: true})` → `null`; `formFromTool` of a tool with `port: "auto"` → `autoPort: true`.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/toolslibrarymodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** the model and the two controls.
- [ ] **Step 4: Run**: the vitest file → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(tools): a pinned app can take a free port and start with arcterm"`

### Task 10: CDP scenarios, changelog and the RAM row

**Depends on:** Task 6, Task 7, Task 8, Task 9
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: everything above; the `tools-app` scenario's arrange (`scripts/cdp/scenarios.mjs:41866`) and `ttArrange` (`:40850`) as the pattern (`h.rpc("toolssetuser", …)`, `h.rpc("createproject", …)`, teardown removing the entries).

Two scenarios, registered like the others:
- `services-tree` (surface `agent`): arrange registers a project at a temp folder and writes four services through `toolssetuser`, all with `dir` in that folder: `svc-ok` (`command: "node"`, `args` an inline `http.createServer(...).listen(process.env.PORT, "127.0.0.1")` server, `port: "auto"`), `svc-fixed` (the same server, `url: "http://127.0.0.1:<a free port>/"`), `svc-crash` (`command: "sh"`, `args: "-c 'exit 1'"`, `port: "auto"`), `svc-off` (the server, `port: "auto"`, `autostart: false`); waits until `servicesstatus` shows `svc-ok` running, `svc-crash` retrying or crashed, `svc-off` stopped. Steps: the project folder holds four service rows after the divider, with `:<port>` and a green dot on `svc-ok`, `crashed` words on `svc-crash`, `stopped` on `svc-off`; hovering `svc-off` shows `Start`; clicking `svc-ok` shows the page in the centre with the header line starting `Running on 127.0.0.1:` and Restart and Stop buttons; Stop turns its row to `stopped`; a shot of each. Teardown removes the four entries (which stops them) and the project.
- `services-chip` (surface `cockpit`): the same arrange; steps: the chip reads `<n> · 1 crashed` in the error tone; a click opens the popover with `svc-crash` first and the footer text exactly; Escape closes it; a shot with it open.

`CHANGELOG.md`, top section, under `Added` (open `## Unreleased` above a dated top section): `arcterm now keeps your pinned apps' servers running: it gives each a port, restarts it when it crashes, starts it again when arcterm opens, and shows them in the Agent tree and the new Services chip.` ending `<!-- big -->`. `docs/open-issues.md` RAM table: a row for held services (arcterm's cost: one PTY and a goroutine per service, a probe only while starting; the services' own RAM is the apps'), status `pending`, dated 2026-10-20.

- [ ] **Step 1: Write the two scenarios.**
- [ ] **Step 2: Run them** against a browser build: `task dev:browser` in the background, then `node --experimental-websocket scripts/cdp/verify.mjs services-tree services-chip` → both PASS; `cdp-shots/index.html` shows the rows, the header and the popover matching boards `Main`, `AppBarServices` and `RowStates`.
- [ ] **Step 3: Add the changelog line and the RAM row.**
- [ ] **Step 4: Commit**: `git commit -m "test(services): CDP scenarios for the tree, header and chip; changelog"`
