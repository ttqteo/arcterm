# Held services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wavesrv holds every pinned app's server as a service: it starts them, gives them a port, restarts them when
they crash, starts them again when arcterm opens, and the cockpit shows their state in the Agent tree, the page header
and a Services chip in the app bar.

**Architecture:** A new Go package `pkg/services` owns a supervisor with injected dependencies (pure state machine,
tested with fakes, plus one test on the real wiring) and a real wiring onto `blockcontroller` and `wcore`: each
service is one `cmd`-controller terminal block in a tab wavesrv creates. Status goes to the frontend through five
wshrpc commands and a `services:changed` event, defined first in a small wire task so the frontend is built beside
the supervisor; the frontend derives rows, the header line and the chip from one pure model.

**Tech Stack:** Go (wavesrv, wshrpc, tsgen), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-20-held-services-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/services/... ./pkg/blockcontroller/... ./pkg/arctools/... ./pkg/wconfig/... ./pkg/wshrpc/... ./pkg/tsgen/... ./pkg/waveobj/... ./pkg/wps/... ./cmd/server/...`

**Final:** `node scripts/cdp/final-verify.mjs services-states services-tree services-chip services-setup tools-app`

The design canvas is `.superpowers/design/held-services/project` (boards `Main`, `AppBarServices`, `RowStates`). It is
gitignored; this run carries its absolute path on the run record (`wsh runs show <run> --json` → `prototype`), which
the engine uses in place of a plan line, so this plan has no Prototype line (the pre-push hook refuses a `/Users/…`
path).

## Decisions taken with the person at plan review (2026-10-20, written into the spec)

- The tree menu keeps its "Start with arcterm" check, written through `ToolsSetUserCommand`: the anti-goal is arcterm
  writing `tools.json` on its own, not the person's own click.
- A service running elsewhere keeps Start offered: Start probes again; while the page answers nothing changes, once it
  does not arcterm starts the service. Nothing probes on its own.
- A click on a service never starts it. A service that never ran gets its tab and block at the click (a new
  `ServiceOpenCommand`), not started, and the header offers Start.
- A service added while arcterm runs, with `autostart` on, starts at once.

## Global Constraints

- A service is a tool with a page: `url` (fixed port, must pass `arctools.AppURL`: http on 127.0.0.1 with a port) or `"port": "auto"`. `url` wins if both are set.
- `autostart` defaults to **true** for a service; a service the person stopped stays stopped across restarts until Start or Restart.
- Crash retry: 1 s, 2 s, 4 s, 8 s, 16 s; after 5 crashes within 10 minutes it gives up; a run that stayed up 10 minutes resets the count.
- Readiness: HTTP GET of the page, any response counts, 1.5 s timeout, every 500 ms, up to 30 s, only while starting. Nothing polls while a service runs, and nothing re-probes an elsewhere service except a Start.
- Boot starts are staggered 300 ms, like `RestoreLiveAgents` (`pkg/blockcontroller/agentrestore.go:54`).
- The remembered port and the "stopped by the person" flag live in arcterm's own state file, never in `tools.json`.
- A service's folder is its `dir`, else `~`: with no focused agent and no project, that is where `opensin` resolves (`toolCwd`, `frontend/app/view/agents/toolsmodel.ts:78`).
- A service's project is computed once, in Go: the registered project whose path holds its folder (longest match, as `registeredProjectFor` in `frontend/app/view/agents/projectlabel.ts:24`), else `Home` (`HOME_NAME`, `launcher.ts:172`). It travels in `ServiceStatus.project` and on the tab as `session:project`; the frontend never recomputes it.
- A service block never starts unless the supervisor forces it: its meta carries `cmd:runonstart: false`, because a pane that mounts the log resyncs unforced (`frontend/app/view/term/termwrap.ts:836`) and `runonstart` defaults true (`pkg/blockcontroller/shellcontroller.go:307`).
- Generated TS fields are the json tags, lowercase: `startedms`, `retryatms`, `exitcode`, `tabid`, `blockid`, `project`, `autostart`. Frontend code and tests use those names.
- Colors only from `@theme` tokens (`frontend/tailwindsetup.css`); every state is a dot plus words, never color alone; Inter everywhere except commands, which are `font-mono`.
- Exact copy: the row words and header lines in Task 6's tables; popover footer `A tool with a page is a service. Add one in Setup → Tools.`
- The Mac is the target; Windows keeps compiling (`leftovers_other.go` stays a no-op) but is not tested.
- Never hand-edit generated files: run `task generate` after changing a wshrpc, waveobj or wconfig type.
- Commit messages carry no co-author trailer.

## Review Focus

- A dev server that listens only on `::1` (some `localhost` binds): the row must reach `nopage` after 30 s, never spin on `starting`. Tests: `TestIPv6OnlyEndsNoPage` (Task 4), `services-states` step `svc-v6 reads no page`.
- Two services given the same fixed port: the second must read `porttaken` naming the first service, never `elsewhere` showing the first one's page. Test: `TestSamePortAsAnotherService` (Task 4).
- arcterm restarting while a service is `retrying`: the next boot starts it again (it was not stopped by the person). Test: `TestBootStartsARetryingService` (Task 4).
- arcterm restarting at all: the service keeps its one tab and block, never a second. Tests: `TestBootReusesExistingBlock`, `TestBootClosesOrphanServiceTab` (Task 4).
- Showing a stopped or crashed service's log must not start it. Tests: `TestBlockMeta` and the unforced resync in `TestRealServiceStopsWithItsChild` (Task 4), `services-tree` step `a never-run service shows its log, not started`.
- Stop takes the server's child with it (`npm` → `node`). Tests: `TestRealServiceStopsWithItsChild` (Task 4), `services-tree` step `Stop frees svc-fixed's port`.
- A command that is not on PATH (exit 127): five retries, then `crashed · exit 127`. Test: `TestCommandNotFoundGivesUp` (Task 4).

---

### Task 1: Service config and the pure model

**Depends on:** none
**Files:** `pkg/wconfig/settingsconfig.go`, `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`, `pkg/services/model.go`, `pkg/services/model_test.go`, `pkg/waveobj/wtypemeta.go`, `pkg/waveobj/metaconsts.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `wconfig.ToolKeywords.Port string` (`json:"port,omitempty"`, only `"auto"` means anything) and `Autostart *bool` (`json:"autostart,omitempty"`).
- Produces: `arctools.Tool.Port string` (`json:"port,omitempty"`), `Autostart bool` (`json:"autostart,omitempty"`), `const arctools.PortAuto = "auto"`, `func arctools.IsService(t Tool) bool`. `arctools.ToolStatus` embeds `Tool`, so the generated `ToolStatus` gains `port` and `autostart` too.
- Produces: block meta `tool:service` (`MetaKey_ToolService`, bool): the block is a held service's.
- Produces in `pkg/services/model.go`: state constants `StateStopped = "stopped"`, `StateStarting = "starting"`, `StateRunning = "running"`, `StateElsewhere = "elsewhere"`, `StateRetrying = "retrying"`, `StateCrashed = "crashed"`, `StatePortTaken = "porttaken"`, `StateNoPage = "nopage"`; constants `MaxCrashes = 5`, `CrashWindow = 10 * time.Minute`, `StartTimeout = 30 * time.Second`, `ProbeInterval = 500 * time.Millisecond`, `ProbeTimeout = 1500 * time.Millisecond`, `BootStagger = 300 * time.Millisecond`, `HomeProject = "Home"`; `func Backoff(crash int) time.Duration`; `type CrashLog struct`, `func (c *CrashLog) Add(t time.Time) int`, `func (c *CrashLog) Reset()`; `func ExitIsStop(exitCode int, interrupted bool) bool`; `func ScanLocalURL(output string) (int, bool)`; `func NeedsRestart(old, cur arctools.Tool) bool`; `func ServiceDir(t arctools.Tool) string`; `func ProjectFor(dir string, projects map[string]string, home string) string` (`projects` is name → path; `home` expands a leading `~` in both).

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
- `TestProjectFor`: with `projects {"arcterm": "/h/dev/arcterm", "dev": "/h/dev"}` and home `/h`: `~/dev/arcterm/app` → `arcterm` (longest match); `/h/dev/other` → `dev`; `/h/dev/arcterm2` → `dev` (a sibling with a shared prefix is not inside); `~` → `Home`; `/tmp/x` → `Home`.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/arctools ./pkg/services -run 'TestMergeService|TestBackoff|TestCrashLogWindow|TestExitIsStop|TestScanLocalURL|TestNeedsRestart|TestServiceDir|TestProjectFor'`
Expected: FAIL (undefined: IsService, Backoff, …)

- [ ] **Step 3: Implement**

`ToolKeywords` and `Tool` gain the fields above. `override` (`pkg/arctools/catalog.go:200`) copies `Port` only when it is `"auto"`, and sets `Autostart` to `*u.Autostart` when given, else `true` when the merged tool `IsService`. `IsService(t) = AppURL(t.Url) || t.Port == PortAuto`. Add `ToolService bool json:"tool:service,omitempty"` beside `ToolAppOwned` in `pkg/waveobj/wtypemeta.go:54`. `ScanLocalURL` strips ANSI escapes, then matches `http://(127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)`.

- [ ] **Step 4: Regenerate and run the tests**

Run: `task generate && go test ./pkg/arctools ./pkg/services -run 'TestMergeService|TestBackoff|TestCrashLogWindow|TestExitIsStop|TestScanLocalURL|TestNeedsRestart|TestServiceDir|TestProjectFor'`
Expected: PASS; `git diff --stat` shows `pkg/waveobj/metaconsts.go` and `frontend/types/gotypes.d.ts` changed.

- [ ] **Step 5: Commit**

`git commit -m "feat(services): service config keys and the pure model"`

### Task 2: The services wire interface

**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshrpctypes_services.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_services.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

The types, commands and event every later task builds on, with stub server methods, so the frontend (Tasks 6-10)
runs beside the supervisor (Tasks 3-5) instead of waiting for it. It depends on Task 1 only because both regenerate
`gotypes.d.ts`.

**Interfaces:**
- Produces in `pkg/wshrpc/wshrpctypes_services.go` (wshrpc, not `pkg/services`: wshrpc may not import a package that imports blockcontroller):
  `type ServiceStatus struct { Id string "id"; Name string "name"; Command string "command"; Dir string "dir"; Project string "project"; State string "state"; Port int "port,omitempty"; Url string "url,omitempty"; TabId string "tabid,omitempty"; BlockId string "blockid,omitempty"; StartedMs int64 "startedms,omitempty"; ExitCode int "exitcode,omitempty"; RetryAtMs int64 "retryatms,omitempty"; Holder string "holder,omitempty"; Autostart bool "autostart" }` (json tags as quoted; `Command` is the command line, command plus args), `type ServicesData struct { Services []ServiceStatus "services" }`, `type CommandServiceData struct { Id string "id" }`.
- Produces: `type ServicesCommands interface { ServicesStatusCommand(ctx) (*ServicesData, error); ServiceOpenCommand(ctx, CommandServiceData) (*ServiceStatus, error); ServiceStartCommand(ctx, CommandServiceData) error; ServiceStopCommand(ctx, CommandServiceData) error; ServiceRestartCommand(ctx, CommandServiceData) error }`, embedded in `WshRpcInterface` (`pkg/wshrpc/wshrpctypes.go:43`, after `ToolsCommands`). `ServiceOpenCommand` makes sure the service has its tab and block without starting it and returns its status. Frontend: `RpcApi.ServicesStatusCommand(TabRpcClient)`, `RpcApi.ServiceOpenCommand(TabRpcClient, { id })`, `…StartCommand`, `…StopCommand`, `…RestartCommand`; wsh/CDP command names `servicesstatus`, `serviceopen`, `servicestart`, `servicestop`, `servicerestart`.
- Produces: `wps.Event_ServicesChanged = "services:changed" // type: wshrpc.ServicesData`, in the valid list (`pkg/wps/wpstypes.go:50-78`) and `WaveEventDataTypes` (`pkg/tsgen/tsgenevent.go:23`).
- Produces: stub server methods in `pkg/wshrpc/wshserver/wshserver_services.go`: `ServicesStatusCommand` returns `&ServicesData{Services: []ServiceStatus{}}`; the other four return `errors.New("services are not running yet")`. Task 5 replaces them.

- [ ] **Step 1: Implement** the types, the interface, the event and the stubs.
- [ ] **Step 2: Regenerate and build**: `task generate && go build ./... && go vet ./pkg/wshrpc/... ./pkg/wps/...` → exit 0; `frontend/types/waveevent.d.ts` has `"services:changed"` typed `ServicesData`, `frontend/app/store/wshclientapi.ts` has the five commands, `frontend/types/gotypes.d.ts` has `ServiceStatus` with `startedms`.
- [ ] **Step 3: Commit**: `git commit -m "feat(services): the services wire types, commands and event"`

### Task 3: Controller hooks for services

**Depends on:** none
**Files:** `pkg/blockcontroller/servicehooks.go`, `pkg/blockcontroller/servicehooks_test.go`, `pkg/blockcontroller/blockcontroller.go`, `pkg/blockcontroller/shellcontroller.go`

**Interfaces:**
- Produces: `var ServiceExitHook func(blockId string, exitCode int)` and its getter `func serviceExitHook() func(blockId string, exitCode int)`, which returns nil while `shuttingDown` (`blockcontroller.go:388`), exactly as `exitHook()` does for `AgentOutcomeHook` (`blockcontroller.go:391`), so a quit is never a crash. Called beside `AgentOutcomeHook` wherever `exitHook()` runs (`shellcontroller.go:357`, `:595`).
- Produces: `func StopLeftovers(blockId string)`: an exported one-line wrapper of `stopLeftovers` (`leftovers_darwin.go:33`; `leftovers_other.go` already defines the no-op), in `servicehooks.go`. The existing `TestStopLeftovers` (`leftovers_darwin_test.go:56`) already proves the sweep takes a detached child, so this task adds no sweep test.
- Produces: `const InterruptWindow = 3 * time.Second`; `func noteInput(blockId string, data []byte, now time.Time)` (unexported: records `now` for the block when `data` holds byte `0x03`), called from `sendInput` (`blockcontroller.go:378`) with `inputUnion.InputData`; `func InterruptedWithin(blockId string, d time.Duration, now time.Time) bool`.

- [ ] **Step 1: Write the failing tests** (`servicehooks_test.go`):
  - `TestInterruptedWithin`: `noteInput("b1", []byte{3}, t0)`; `InterruptedWithin("b1", 3*time.Second, t0.Add(2*time.Second))` true; at `t0.Add(4*time.Second)` false; `noteInput("b2", []byte("abc"), t0)` leaves `b2` false.
  - `TestServiceExitHookSilentOnShutdown`: with `ServiceExitHook` set, `serviceExitHook()` is non-nil; with `shuttingDown.Store(true)`, it is nil (restore both in `t.Cleanup`, as `TestExitHookIsSilentDuringShutdown` does at `blockcontroller_test.go:63`).
- [ ] **Step 2: Run them to see them fail**: `go test ./pkg/blockcontroller -run 'TestInterruptedWithin|TestServiceExitHookSilentOnShutdown'` → FAIL (undefined).
- [ ] **Step 3: Implement** the interfaces above in `servicehooks.go`, with the two call sites and the `sendInput` line.
- [ ] **Step 4: Run**: `go test ./pkg/blockcontroller -run 'TestInterruptedWithin|TestServiceExitHookSilentOnShutdown|TestStopLeftovers|TestExitHookIsSilentDuringShutdown'` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(blockcontroller): exit hook, interrupt marker and sweep for held services"`

### Task 4: The supervisor

**Depends on:** Task 1, Task 2, Task 3
**Files:** `pkg/services/supervisor.go`, `pkg/services/supervisor_test.go`, `pkg/services/statefile.go`, `pkg/services/statefile_test.go`, `pkg/services/real.go`, `pkg/services/real_test.go`, `pkg/services/maintest_test.go`

**Interfaces:**
- Consumes: Task 1's model, `arctools.IsService`, `MetaKey_ToolService`; Task 2's `wshrpc.ServiceStatus`, `wshrpc.ServicesData`, `wps.Event_ServicesChanged`; Task 3's `ServiceExitHook`, `StopLeftovers`, `InterruptedWithin`, `InterruptWindow`.
- Produces in `pkg/services`: `type Def struct { Tool arctools.Tool; Port int; Project string; TabId, BlockId string }`; `func BlockMeta(d Def) waveobj.MetaMapType`; `func TabMeta(d Def) waveobj.MetaMapType`; `type BlockRef struct { ToolId, TabId, BlockId string }`; `type Deps struct` (`Now() time.Time`, `After(d, f) (cancel func())`, `Probe(ctx, url) bool`, `FreePort() (int, error)`, `PortHolder(ctx, port) (string, bool)`, `ServiceBlocks(ctx) ([]BlockRef, error)`, `Ensure(ctx, Def) (tabId, blockId string, err error)`, `Start(ctx, tabId, blockId) error`, `Stop(blockId)`, `Sweep(blockId)`, `ReadLog(blockId) string`, `CloseTab(ctx, tabId) error`, `Publish(wshrpc.ServicesData)`, `State StateStore`); `func New(d Deps) *Supervisor`; methods `SetTools(ctx, tools []arctools.Tool, projects map[string]string, home string)`, `Boot(ctx)`, `Open(ctx, id) (wshrpc.ServiceStatus, error)`, `Start(ctx, id) error`, `Stop(ctx, id) error`, `Restart(ctx, id) error`, `OnExit(blockId string, exitCode int, interrupted bool)`, `OnBlockClosed(blockId string)`, `Status() []wshrpc.ServiceStatus` (never nil); `var Default *Supervisor`; `func Init(ctx context.Context)`; `func OnConfig(fc wconfig.FullConfigType)`.
- Produces: `type StateStore interface { Get(id string) Remembered; Set(id string, r Remembered) error }`, `type Remembered struct { Port int "port,omitempty"; Stopped bool "stopped,omitempty" }`, file `filepath.Join(wavebase.GetWaveDataDir(), "services.json")`, written atomically (temp file + rename).

Behaviour the tests pin (spec "Lifecycle", "Port", "States"):
- `BlockMeta(d)`: `view: "term"`, `controller: "cmd"`, `cmd`: the command line (command, then args as the person wrote them, like `toolCommandLine` in `toolsmodel.ts`), `cmd:shell: true` (the controller runs the line through the shell and ignores `cmd:args`, `shellcontroller.go:780`), `cmd:runonstart: false`, `cmd:cwd: ServiceDir(t)`, `cmd:env: {"PORT": "<port>"}`, `tool:id`, `tool:service: true`; never `cmd:args`, `cmd:runonce` or `cmd:closeonexit`. `TabMeta(d)`: `tool:id`, `session:project: d.Project`, `session:label: <name>`.
- `SetTools`: computes each service's `Project` with `ProjectFor(ServiceDir(t), projects, home)`. Before `Boot` it only records the services. After `Boot`, a new service with `Autostart && !Remembered.Stopped` starts at once; one with `Autostart` off is added `stopped`. `NeedsRestart` on a running one → Restart; a removed one → Stop and `CloseTab`.
- `Boot`: `ServiceBlocks` once; each block whose `ToolId` is a service is attached to it (`TabId`, `BlockId`) and swept (`Sweep(blockId)`), so the service keeps that one tab; a block whose `ToolId` is no longer a service has its tab closed (`CloseTab`). Then it starts every service with `Autostart && !Remembered.Stopped`, `BootStagger` apart.
- `Open`: `Ensure` with the attached ids (no `Start`); the state is unchanged; returns the status with `TabId`/`BlockId`.
- Start, fixed `url`: probe first; answers → `elsewhere`, nothing started. Else `PortHolder` finds a holder → `porttaken` with `Holder` (a held service's name when the holder is another service's block, else the program name, else `another program`). Else `Ensure` (with the attached ids, so an existing block is reused), `Start`, `starting`, probe every `ProbeInterval` until `StartTimeout`: an answer → `running` with `StartedMs`; none → `nopage` (the process keeps running). Start on an `elsewhere` service runs the same path, so it probes again.
- Start, `port: "auto"`: the remembered port if `PortHolder` says it is free, else `FreePort()`, remembered at once. While starting, a probe miss followed by `ScanLocalURL(ReadLog(blockId))` naming another port switches the probe to it and remembers it.
- Stop: refused with an error for `elsewhere` (nothing of arcterm's runs); else mark stopped, `Remembered.Stopped = true`, `Stop(blockId)`; the exit that follows is ignored. Start and Restart clear `Stopped`. Restart = Stop then Start, refused for `elsewhere`.
- `OnExit` of a service block not being stopped: `ExitIsStop` → `stopped` with `Remembered.Stopped = true`; else crash: if it ran ≥ `CrashWindow`, `Reset` the log; `n := Add(now)`; `n < MaxCrashes` → `retrying`, `RetryAtMs = now + Backoff(n)`, timer to Start; else `crashed`, `ExitCode` set, no timer.
- `OnBlockClosed` of a service block (closed some other way, not by the supervisor's own `CloseTab`): like Stop (remembered), `TabId`/`BlockId` cleared; the next `Start` or `Open` calls `Ensure` with no ids, which makes a new tab.
- Every state change calls `Publish` with the full `Status()`.
- Real deps (`real.go`): `Ensure` reuses `Def.TabId`/`Def.BlockId` while that block still exists, rewriting its meta with `BlockMeta` and the tab's with `TabMeta` (`wstore.UpdateObjectMeta`); otherwise it creates the tab with `wcore.CreateTab(ctx, wsId, name, false, true)` (no default block) in the workspace of the client's first window (`wcore.GetClientData`, `wcore.GetWindow`; `wcore.EnsureInitialData` at `cmd/server/main-server.go:456` has made one by then), then `wcore.CreateBlock(ctx, tabId, &waveobj.BlockDef{Meta: BlockMeta(d)}, nil)` and `TabMeta`. It wraps the context with `waveobj.ContextWithUpdates` and always sends what it collected with `wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx))`, even on a part-way failure, as `pkg/jarvis/runexec.go:296-300` does, or the frontend never sees the new tab. `ServiceBlocks` scans `wstore.DBGetAllObjsByType[*waveobj.Block]` for `tool:service` and takes each tab from `wstore.DBFindTabForBlockId`. `Start` is `blockcontroller.ResyncController(ctx, tabId, blockId, &waveobj.RuntimeOpts{TermSize: {Rows: 30, Cols: 120}}, true)`. `Stop` is `DestroyBlockController` then `StopLeftovers`; `Sweep` is `StopLeftovers`. `PortHolder` tries `net.Listen("tcp", "127.0.0.1:<port>")`; on failure it names the holder from `devservers.ListAll` by port when it can. `ReadLog` reads the last 64 KB of the block's `wavebase.BlockFile_Term` from `filestore.WFS`. `Publish` is `wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_ServicesChanged, Data: data})`, no scope.
- `Init` builds the real deps, sets `blockcontroller.ServiceExitHook` (it computes `interrupted` with `InterruptedWithin(blockId, InterruptWindow, time.Now())`), subscribes to `wps.Event_BlockClose` the way `InitBlockController` does (`blockcontroller.go:191-194`) and calls `OnBlockClosed`, loads services from `arctools.Merge(arctools.Builtin(), fc.Tools)` filtered by `IsService` with `fc.Projects`' paths, then `Boot`. `OnConfig` calls `SetTools` and is a no-op until `Init` ran (`wconfig.ConfigHook` is set before it, `main-server.go:489`).

- [ ] **Step 1: Write the failing tests** in `supervisor_test.go` with fake deps (a manual clock whose `After` records callbacks the test fires, a scripted `Probe`, an in-memory `StateStore`, recorded `ServiceBlocks`/`Ensure`/`Start`/`Stop`/`Sweep`/`CloseTab`/`Publish` calls):
  - `TestBlockMeta`: `BlockMeta` of `{command: "npm", args: "run dash", dir: ""}` on port 8386 has `cmd == "npm run dash"`, `cmd:shell == true`, `cmd:runonstart == false`, `cmd:cwd == "~"`, `cmd:env == {"PORT": "8386"}`, `tool:service == true`, and no `cmd:args`; `TabMeta` has `tool:id`, `session:project`, `session:label`.
  - `TestStartProbesThenRunning`: state `starting`, then `running` on the second probe with `Port == 8386`, `StartedMs` set.
  - `TestCrashRetriesWithBackoffThenGivesUp`: five `OnExit(b, 1, false)` within 10 min give `retrying` with `RetryAtMs` now+1s, +2s, +4s, +8s, then `crashed` with `ExitCode == 1` and no timer.
  - `TestLongRunResetsCrashCount`: running 11 min, then a crash → `retrying` at +1s.
  - `TestStopIsRememberedAndNotRetried`: Stop → `stopped`, `Stopped == true`; a following `OnExit(b, 143, false)` changes nothing; `Boot` does not start it; `Start` clears `Stopped`.
  - `TestInterruptCountsAsStop`: `OnExit(b, 130, true)` → `stopped`, `Stopped == true`, no timer. `TestExitZeroIsStop`: `OnExit(b, 0, false)` → same.
  - `TestElsewhere`: the page answers before start → `elsewhere`, `Ensure` and `Start` never called; `Stop` and `Restart` return an error and stop nothing.
  - `TestStartOnElsewhereProbesAgain`: an `elsewhere` service whose page still answers → `Start` leaves it `elsewhere`, no `Ensure`; once the probe fails → `Start` calls `Ensure` and `Start`, state `starting`.
  - `TestPortTaken`: no answer, `PortHolder` → `("python3", true)` → `porttaken`, `Holder == "python3"`, `Start` never called.
  - `TestSamePortAsAnotherService`: services `a` and `b` both on 8386, `a` running; starting `b` → `porttaken` with `Holder == "a"`.
  - `TestAutoPortRemembered`: `FreePort` → 41207, remembered; Stop, Start → 41207 again without calling `FreePort`; when `PortHolder(41207)` is held → a new `FreePort`.
  - `TestLogFallback`: auto port 41207 never answers; `ReadLog` returns `"Local: http://localhost:5173/"`; `Probe` answers on 5173 → `running`, `Port == 5173`, remembered 5173.
  - `TestNoPageAfterTimeout` and `TestIPv6OnlyEndsNoPage` (the log names `http://localhost:5173` but 127.0.0.1:5173 never answers): after 30 s → `nopage`, `Stop` never called.
  - `TestConfigChangeRestarts`: `SetTools` with changed `Args` on a running service → Stop then Start; a changed `Name` → neither. `TestRemovedToolStopsAndClosesTab`.
  - `TestNewAutostartServiceStartsAtOnce`: after `Boot`, `SetTools` adding a service with `Autostart` → `Ensure` and `Start` called, `starting`; adding one with `Autostart == false` → `stopped`, no `Start`. `TestSetToolsBeforeBootStartsNothing`: `SetTools` before `Boot` calls no `Start`.
  - `TestBootSweepsAndStartsAutostart`: `Sweep` for each existing service block; autostart services started 300 ms apart; `Autostart == false` never started. `TestBootStartsARetryingService`: a service left `retrying` (not `Stopped`) is started at boot.
  - `TestBootReusesExistingBlock`: `ServiceBlocks` returns `{portfolio, tab-1, blk-1}` → `Sweep("blk-1")`, then the boot start's `Ensure` gets `TabId == "tab-1"`, `BlockId == "blk-1"`, and the status carries them. `TestBootClosesOrphanServiceTab`: a block whose `ToolId` is no longer a service → `CloseTab("tab-x")`, no `Sweep` start.
  - `TestOpenMakesTheTabWithoutStarting`: `Open` of a `stopped` service with no tab → `Ensure` called, `Start` never, state `stopped`, the returned status has the tab id.
  - `TestBlockClosedCountsAsStop`: `OnBlockClosed(b)` → `stopped`, `Stopped == true`, `TabId == ""`; the next `Start` calls `Ensure` with no ids.
  - `TestCommandNotFoundGivesUp`: five `OnExit(b, 127, false)` → `crashed`, `ExitCode == 127`.
  - `TestStateFileRoundTrip` (`statefile_test.go`): `Set("portfolio", {Port: 8386, Stopped: true})` in a temp dir, a fresh store reads it back; a missing file reads empty.
  - `TestRealServiceStopsWithItsChild` (`real_test.go`, `//go:build darwin`): `maintest_test.go`'s `TestMain` points the data dir at a temp dir and runs what wavesrv runs first (`filestore.InitFilestore`, `wstore.InitWStore`, `shellutil.InitCustomShellStartupFiles`, `wcore.EnsureInitialData`, as `cmd/server/main-server.go:421-456`); when `ARC_TEST_SERVE=1` it instead serves HTTP on `127.0.0.1:$PORT` and never returns, the way `pkg/blockcontroller/maintest_test.go` stands in for a daemon. The test builds a supervisor on the real deps (an in-memory `StateStore` and a recording `Publish` are fine) with one service `{id: "svc-real", command: "sh", args: "-c 'ARC_TEST_SERVE=1 \"<this test binary>\" & wait'", port: "auto"}`, so the listener is the PTY's grandchild as `npm`'s `node` is; `Start` → `running` within 15 s with a port; `Stop` → within 3 s a TCP connect to `127.0.0.1:<port>` is refused; then `blockcontroller.ResyncController(ctx, tabId, blockId, rtopts, false)` (what a pane mount sends) and after 2 s the port still refuses; `Start` again → `running` on the same port. If the real controller cannot run under `go test` at all, say so in the report's Found not fixed rather than fake it; the `services-tree` step `Stop frees svc-fixed's port` covers the same path in the app.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/services -run 'TestBlockMeta|TestStart|TestCrash|TestLongRun|TestStop|TestInterrupt|TestExitZero|TestElsewhere|TestPortTaken|TestSamePort|TestAutoPort|TestLogFallback|TestNoPage|TestIPv6|TestConfigChange|TestRemovedTool|TestNewAutostart|TestSetToolsBeforeBoot|TestBoot|TestOpen|TestBlockClosed|TestCommandNotFound|TestStateFile|TestRealService'`
Expected: FAIL (undefined: New, Deps, …)

- [ ] **Step 3: Implement** `supervisor.go` (one mutex around the services map; timers through `Deps.After`), `statefile.go`, and `real.go` (the real deps, `Init`, `OnConfig`).

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `go build ./...`
Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit**

`git commit -m "feat(services): the supervisor that holds pinned apps' servers"`

### Task 5: Server methods and boot wiring

**Depends on:** Task 4
**Files:** `pkg/wshrpc/wshserver/wshserver_services.go`, `pkg/wshrpc/wshserver/wshserver_services_test.go`, `cmd/server/main-server.go`

**Interfaces:**
- Consumes: `services.Default`, `services.Init`, `services.OnConfig`, Task 2's `ServicesCommands`.
- Produces: the five server methods, each delegating to `services.Default` (an error `services are not running yet` while it is nil), in place of Task 2's stubs.

- [ ] **Step 1: Write the failing test** `TestServiceCommandUnknownId` (`wshserver_services_test.go`): with `services.Default` built from fakes holding no services, `ServiceStartCommand(ctx, {Id: "nope"})` and `ServiceOpenCommand(ctx, {Id: "nope"})` return an error containing `no service "nope"`; `ServicesStatusCommand` returns an empty list, not nil.
- [ ] **Step 2: Run it to see it fail**: `go test ./pkg/wshrpc/wshserver -run '^TestServiceCommandUnknownId$'` → FAIL.
- [ ] **Step 3: Implement** the methods, and in `cmd/server/main-server.go`: `services.Init(context.Background())` right after `RestoreLiveAgents` (`:526`), and `services.OnConfig(fc)` inside `wconfig.ConfigHook` (`:489`).
- [ ] **Step 4: Run**: `go test ./pkg/wshrpc/wshserver -run '^TestServiceCommandUnknownId$' && go build ./...` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): wshrpc server methods, start services at boot"`

### Task 6: Frontend services store and model

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `frontend/app/view/agents/servicesstore.ts`

**Interfaces:**
- Consumes: the generated `ServiceStatus`, `ServicesData`, the five RPCs, event `services:changed`; `addUserTool` (`toolsstore.ts:479`).
- Produces in `servicesmodel.ts` (pure): `type ServiceDot = "solid" | "hollow" | "pulse"`, `type ServiceTone = "working" | "error" | "warning" | "muted"`; `serviceRowWords(s: ServiceStatus, nowMs: number): { words: string; port?: string; tone: ServiceTone; dot: ServiceDot; action?: "start" | "restart" }`; `serviceHeaderLine(s: ServiceStatus, nowMs: number): string`; `upFor(ms: number): string`; `servicesChip(list: ServiceStatus[]): { hidden: boolean; label: string; tone: "error" | "warning" | "muted"; title: string }`; `popoverOrder(list: ServiceStatus[]): ServiceStatus[]`; `canStop(s)` (running, starting, retrying, nopage), `canStart(s)` (stopped, crashed, porttaken, elsewhere: Start probes again), `canRestart(s)` (running, starting, retrying, nopage, crashed).
- Produces in `servicesstore.ts`: `servicesAtom: PrimitiveAtom<ServiceStatus[] | null>`; `ensureServicesFeed(): void` (idempotent: the first call reads `ServicesStatusCommand` and subscribes to `services:changed` with `waveEventSubscribeSingle`, as `jobqueuestore.ts:42-48` does; no unmount); `serviceByTabAtom` (a derived `Record<tabId, ServiceStatus>`); `openService(id): Promise<ServiceStatus | null>` (the Open RPC; never starts); `startService(id)`, `stopService(id)`, `restartService(id)`: the RPCs; `setServiceAutostart(id: string, on: boolean)`: reads the entry from the full config's `tools`, writes it back with `autostart: false` (off) or without the key (on) through `addUserTool`, every other key unchanged.

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

The header lines (`serviceHeaderLine`):

| state | line |
|---|---|
| running | `Running on 127.0.0.1:8386 · up 2h 14m` |
| starting | `Starting… waiting for 127.0.0.1:41207` |
| elsewhere | `Not started by arcterm · 127.0.0.1:8386` |
| retrying | `Crashed · retry in 8s` |
| crashed | `Crashed · exit 1` |
| porttaken | `8386 is held by python3` |
| nopage | `Running, no page after 30s` |
| stopped | `Stopped` |

- [ ] **Step 1: Write the failing tests** (`servicesmodel.test.ts`, vitest, style of `appmodel.test.ts`; fixtures use the generated lowercase fields `startedms`, `retryatms`, `exitcode`): one `it` per row of each table with the exact strings (running `{port: 8386, startedms: now - 8_040_000}`); `upFor`: 40_000 → `40s`, 300_000 → `5m`, 8_040_000 → `2h 14m`; `servicesChip([])` → `hidden: true`; three running + one crashed → `label: "3 · 1 crashed"`, `tone: "error"`; one nopage and two running → `label: "2"`, `tone: "warning"`; one running, one stopped → `label: "1"`, `tone: "muted"`; `popoverOrder` puts crashed and retrying, then porttaken/nopage, then running/starting/elsewhere, then stopped, by name inside each; `canStart`/`canStop`/`canRestart` per state, with elsewhere `canStart` true and `canStop`/`canRestart` false.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/servicesmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run**: `npx vitest run frontend/app/view/agents/servicesmodel.test.ts` → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0 (about 2 min).
- [ ] **Step 5: Commit**: `git commit -m "feat(services): frontend store and the pure row, header and chip model"`

### Task 7: Service rows in the Agent tree

**Depends on:** Task 6
**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/activenav.ts`, `frontend/app/view/agents/servicemenu.tsx`

**Interfaces:**
- Consumes: `servicesAtom`, `ensureServicesFeed`, `serviceRowWords`, `canStart`, `canStop`, `canRestart`, `openService`, `startService`, `stopService`, `restartService`, `setServiceAutostart`; `openSetupTool(model, toolId)` (`frontend/app/view/agents/setupstore.ts:391`); `getApi().openExternal(url)` (as the header's Open in the browser, `terminalpaneheadview.tsx:234`).
- Produces: `projectTree` input gains `services?: readonly { id: string; name: string; project: string; tabId?: string }[]` (the project is the status's `project`); `ProjectTreeRow` gains `{ kind: "service"; project: string; serviceId: string; tabId?: string }`. `showServiceMenu(model, s: ServiceStatus, e: React.MouseEvent)` in `servicemenu.tsx`.

Board `Main` (Prototype) is the look. A project's service rows come after its divider and before its terminal rows; a terminal whose tab is a service's tab (the status's `tabid`) is never a terminal row (Task 4's Boot reuses each service's block and closes orphan service tabs, so every service tab is in the status); a folder holding only services still shows; the filter matches a service's name; `j`/`k` (`activenav.ts`) reach a service row (with a tab, by its tab id). The row copies `TerminalRow`'s classes (`agenttree.tsx:2039-2042`), the app-window icon, then `serviceRowWords`: the words (`text-[11px]`, tone token), the port (`text-[11px] text-muted tabular-nums`), the 6 px dot; on hover the action button in the Jobs row-button style (`jobqueuepanel.tsx:83`): `Start` or `Restart`. Rows carry `data-service-row=<id>` and `data-service-state=<state>` for the scenarios. A click never starts a service: one with a tab selects its tab (`selectAgentRow`); one with no tab calls `openService(id)` and selects the tab it returns, so the centre shows its log. The menu: Start (enabled by `canStart`), Stop (`canStop`), Restart (`canRestart`), Open in the browser (when it has a url), Start with arcterm (checked by `autostart`, toggled with `setServiceAutostart`), Edit in Setup → Tools (`openSetupTool`).

- [ ] **Step 1: Write the failing tests** (`agentsidebarmodel.test.ts`): `services after divider`: a project with one agent, one service and one terminal gives `group, <agent rows>, divider, service, terminal`; `service tab is not a terminal row`: a terminal whose id equals the service's `tabId` appears once, as the service row; `folder with only a service`: a project with no agent and one service gives `group, service`; `service without a tab still has a row`; `filter matches a service name`.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** the model change, the `case "service"` in `agenttree.tsx` (beside `case "terminal"` at `:2544`, passing the services into the `projectTree` call at `:2410` after `ensureServicesFeed()`), the same input in `activenav.ts:37`, and `servicemenu.tsx` (items in the `terminalMenuItems` style, `terminalsrail.tsx:91-108`).
- [ ] **Step 4: Run**: the vitest file → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): service rows in the Agent tree's project folders"`

Shown by (Task 11): `services-states` step `each row reads its state`; `services-tree` steps `rows sit after the divider`, `hover shows Start or Restart`, `the row menu`, `j/k reach a service row`, `a never-run service shows its log, not started`.

### Task 8: The page header and the app pane run on service state

**Depends on:** Task 6
**Files:** `frontend/app/view/agents/appmodel.ts`, `frontend/app/view/agents/appmodel.test.ts`, `frontend/app/view/agents/appstore.ts`, `frontend/app/view/agents/apppane.tsx`, `frontend/app/view/agents/toolsstore.ts`, `frontend/app/view/agents/toolsstore.test.ts`, `frontend/app/view/agents/terminalpaneheadview.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `pkg/waveobj/wtypemeta.go`, `pkg/waveobj/metaconsts.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Consumes: `serviceByTabAtom`, `serviceHeaderLine`, `canStart`, `canStop`, `canRestart`, `openService`, `startService`, `stopService`, `restartService`, `ensureServicesFeed`.
- Produces: `serviceAppState(s: ServiceStatus, view: AppView, reloads: number): AppState` in `appmodel.ts` (running or elsewhere → phase `open` with `url = s.url`; starting → `starting`; every other state → `failed`, which shows the log; `owned = s.state !== "elsewhere"`). `appStatesAtom` keeps its shape (keyed by tab id) but is derived from `serviceByTabAtom` plus a per-tab view and reload count, so `apppane.tsx` and `agentsurface.tsx:157-162` keep working; `setAppView(tabId, view)` keeps its signature.

Board `Main` (Prototype) is the header. The frontend probe loop, `trackApp`, `adoptApp`, `probeApp`, `whileLaunching` and the `tool:appowned` write and read go (`appstore.ts:100-188`, `toolsstore.ts:293-324`, `terminalpaneheadview.tsx:71-75`), and with them `ToolAppOwned` (`pkg/waveobj/wtypemeta.go:54`; then `task generate`). A pinned-app terminal opened before this change is left as a plain terminal: nothing closes it or stops its server (the service then reads `elsewhere` or `porttaken` until the person closes it). `openApp` (`toolsstore.ts:280`) becomes: `openService(id)`; unless it is running or starting, `startService(id)` (on elsewhere that probes again); then focus the returned tab, switch to the Agent surface and `showTerminal`. It never launches a terminal. The header of a service tab keeps the name, project, Page | Log, Back, Forward, Reload (Windows), Home and Open in the browser, and adds after Page | Log the state line: a 6 px dot and `serviceHeaderLine` (`text-[11.5px] text-muted tabular-nums`, re-rendered every 30 s while running); then, at the right, a Restart icon button when `canRestart` (`RotateCw`, label `Restart <name>`, the header's `BUTTON` class) and the word button: `Stop` when `canStop`, else `Start` when `canStart` (`STOP_BUTTON` class). A service tab has no close button.

- [ ] **Step 1: Write the failing tests**: `appmodel.test.ts`: `serviceAppState` for running → `{phase: "open", url: "http://127.0.0.1:8386/", owned: true}`; elsewhere → `open`, `owned: false`; starting → `starting`; crashed, porttaken, nopage, retrying, stopped → `failed`; remove the tests of deleted functions. `toolsstore.test.ts`: rewrite the three openApp tests (`:179-221`, which pin the old probe and `tool:appowned` flow): opening a stopped service calls `ServiceOpenCommand` then `ServiceStartCommand`, focuses the returned tab, sets the surface to `agent`, calls `showTerminal`, and never calls `launchAgent`, `fetch` or `SetMetaCommand`; opening a running one calls no Start; opening an elsewhere one calls Start (it probes again).
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/appmodel.test.ts frontend/app/view/agents/toolsstore.test.ts` → FAIL.
- [ ] **Step 3: Implement** as described, then `task generate`.
- [ ] **Step 4: Run**: the two vitest files → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0; `go build ./...` → exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): the page header and app pane follow the service's state"`

Shown by (Task 11): `services-tree` steps `the page and its header`, `Stop frees svc-fixed's port`, `Start brings it back`, `Restart`, `a crashed service shows its log`, `a never-run service shows its log, not started`; `tools-app` (Open from Setup → Tools runs the service).

### Task 9: The Services chip and popover

**Depends on:** Task 6
**Files:** `frontend/app/cockpit/serviceschip.tsx`, `frontend/app/cockpit/servicespanel.tsx`, `frontend/app/cockpit/servicespopoverstore.ts`, `frontend/app/cockpit/app-bar.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/cockpit/jobqueuestore.ts`, `frontend/app/view/agents/consumersstore.ts`, `frontend/app/view/agents/machineserversstore.ts`, `frontend/app/view/agents/machineserverschip.tsx`

**Interfaces:**
- Consumes: `servicesAtom`, `ensureServicesFeed`, `servicesChip`, `popoverOrder`, `serviceRowWords`, `upFor`, `canStart`, `canStop`, `canRestart`, `openService`, the service actions; `openTarget(model, { kind: "agent", tabId })` (`frontend/app/view/jarvis/openref.ts:110`); `usePanelPlacement` (`@/app/view/agents/consumerspanel`).
- Produces: `servicesOpenAtom`, `servicesOpenerAtom`, `toggleServices(opener: Element | null): void` (closes the Jobs, Servers and Consumers popovers first); `ServicesChip()`; `ServicesPanel({ model })`.

Board `AppBarServices` (Prototype) is the look. The chip sits in `app-bar.tsx` just before `<JobQueueChip />` (`:144`), in the Jobs chip's classes (`jobqueuechip.tsx:45-48`) with the `Server` icon, `servicesChip` for label and title, the tone as `text-error` / `text-warning` / `text-muted`, `data-services-chip` and `data-tone=<tone>` for the scenarios; not rendered when `hidden`. The panel mounts in `cockpit-root.tsx` beside `<JobQueuePanel>` (`:222`) and copies its frame (`jobqueuepanel.tsx:265-296`: backdrop, `PopoverReveal`, `rounded-lg border border-edge-strong bg-surface-raised shadow-popover`); header `Services`; rows in `popoverOrder` (`data-service-row=<id>`): dot, name (`text-[12.5px] text-primary`), project (`text-[11px] text-muted`), then the words, or the port and `upFor` (`text-[12px] tabular-nums text-secondary`), and on hover the actions (`Log` for a crashed or retrying one, `Restart` by `canRestart`, `Start` by `canStart`, `Stop` by `canStop`, in the Jobs row-button class); a second line: the command in `font-mono` and ` in <folder name>`. Footer: `A tool with a page is a service. Add one in Setup → Tools.` A click or Enter on a row, and its `Log`, open it through `openTarget` (after `openService` when it has no tab; it never starts it; a crashed service shows its log); Escape closes, as at `jobqueuepanel.tsx:247-261`; ArrowUp/ArrowDown move a highlighted row (`data-highlighted`). `toggleJobQueue`, `toggleConsumers` and the Servers chip's toggle close the Services popover.

The chip and panel hold no logic of their own: their words, order and tone come from Task 6's tested model, so this
task adds no unit test.

- [ ] **Step 1: Implement** the three new files and the mounts and toggles.
- [ ] **Step 2: Run**: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 3: Commit**: `git commit -m "feat(services): Services chip and popover in the app bar"`

Shown by (Task 11): `services-chip` steps `no chip without services`, `the chip in the error tone`, `the popover's order and footer`, `hover shows Log on a crashed row`, `arrows and Enter open a service in the Agent centre`, `the chip in the warning tone`, `Escape closes it`.

### Task 10: Setup → Tools: a free port and Start with arcterm

**Depends on:** Task 6
**Files:** `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`, `frontend/app/view/agents/toolslibrary.tsx`

**Interfaces:**
- Consumes: the generated `ToolKeywords.port` / `autostart`, `ToolStatus.port` / `autostart`; `addUserTool` (`toolsstore.ts:479`); `setServiceAutostart` (Task 6).
- Produces: `ToolForm` (`toolslibrarymodel.ts:261`) gains `autoPort: boolean` and `autostart: boolean` (`emptyForm`: `false`, `true`; `formFromTool` reads `tool.port === "auto"` and `tool.autostart`). `formKeywords` (`:326`) writes `port: "auto"` and no `url` when `autoPort`, and `autostart: false` only when it is off. `validateNewTool` accepts an empty Page when `autoPort`.

In the add form, beside the Page field (`toolslibrary.tsx:959-968`), a checkbox `Pick a free port` (when checked, the Page input is disabled and empty). In the detail pane, the Page row (`:555-568`) reads `A free port, picked by arcterm` for an auto-port tool, and a tool with a page gets a `SettingRow label="Start with arcterm" sub="Run it whenever arcterm is open"` with the `element/` toggle, saving through `setServiceAutostart`.

- [ ] **Step 1: Write the failing tests** (`toolslibrarymodel.test.ts`): `formKeywords` with `autoPort: true, url: ""` → `{…, port: "auto"}` and no `url`; with `autostart: false` → `autostart: false`; with `autostart: true` → no `autostart` key; `validateNewTool({name: "docs", command: "npm run dev", url: "", autoPort: true})` → `null`; `formFromTool` of a tool with `port: "auto"` → `autoPort: true`.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/toolslibrarymodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** the model and the two controls.
- [ ] **Step 4: Run**: the vitest file → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(tools): a pinned app can take a free port and start with arcterm"`

Shown by (Task 11): `services-setup` steps `Pick a free port disables Page`, `the saved tool is a service`, `Start with arcterm turns off`.

### Task 11: CDP scenarios, changelog and the RAM row

**Depends on:** Task 5, Task 7, Task 8, Task 9, Task 10
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: everything above; the `tools-app` scenario's arrange (`scripts/cdp/scenarios.mjs:41866`) and `ttArrange` (`:40850`) as the pattern (`h.rpc("toolssetuser", …)`, `h.rpc("createproject", …)`, teardown removing the entries); `h.rpc("servicesstatus")` to wait on states.

Shared helpers: `svcArrange(h, ctx, defs)` registers a project at a temp folder, writes `server.js` there (`require("http").createServer((q, r) => r.end("<h1>" + process.argv[3] + "</h1>")).listen(+process.env.PORT, process.argv[2] || "127.0.0.1")`), writes each service with `toolssetuser` (every `dir` in that folder), and `svcWait(h, want, ms)` polls `servicesstatus` until each named service is in its state. Teardown removes every entry (which stops it and closes its tab), closes the scenario's own listeners, removes the project, and checks every port the services had now refuses a connection. Every service row and chip is found by its `data-service-row` / `data-services-chip` attribute. The CDP scenario's own polling of `servicesstatus` is the test's, not arcterm's.

Five scenarios, registered like the others:
- `services-states` (surface `agent`, board `RowStates`): the scenario itself serves HTTP on a free port P1 and holds a TCP listener that never answers on P2. Services: `svc-ok` (`node server.js 127.0.0.1 ok`, `port: "auto"`), `svc-off` (the same, `autostart: false`), `svc-else` (`url: http://127.0.0.1:P1/`), `svc-taken` (`url: http://127.0.0.1:P2/`), `svc-crash` (`sh -c 'exit 1'`, `port: "auto"`), `svc-v6` (`node server.js ::1 v6`, `port: "auto"`). Wait (up to 60 s): `svc-ok` running, `svc-off` stopped, `svc-else` elsewhere, `svc-taken` porttaken, `svc-crash` crashed (not retrying), `svc-v6` nopage. Then add `svc-slow` (`sh -c 'sleep 600'`, `port: "auto"`) and `svc-flaky` (`sh -c 'sleep 3; exit 1'`, `port: "auto"`), which start at once (they are new with autostart on), and wait until `svc-slow` is starting and `svc-flaky` retrying. Step `each row reads its state`: the project folder's eight rows read exactly `:<port>` (svc-ok), `stopped`, `not started by arcterm` with `:P1`, `P2 is held by <program>` (the scenario's own `node`, as `pkg/devservers` names it; a regex), `crashed · exit 1`, `running, no page after 30s` (step name `svc-v6 reads no page`), `starting…`, and `crashed · retry in <n>s` (a regex), each with its dot; one shot of the folder.
- `services-tree` (surface `agent`, board `Main`): services `svc-ok` (as above), `svc-fixed` (`sh -c 'node server.js 127.0.0.1 fixed & wait'`, `url` on a free port, so its `node` is the shell's child, as `npm`'s is; `& wait` keeps `sh` from exec'ing it), `svc-crash`, `svc-off`, `svc-never` (the server, `port: "auto"`, `autostart: false`, never opened). Wait: `svc-ok` and `svc-fixed` running, `svc-crash` crashed. Steps: `rows sit after the divider` (the folder holds the five service rows after the divider and before any terminal row; shot); `hover shows Start or Restart` (`svc-off` → `Start`, `svc-crash` → `Restart`; clicking that `Restart` takes `svc-crash` out of `crashed`, to starting or retrying, and the scenario waits for it to give up again); `the page and its header` (click `svc-ok`: the centre's frame shows `ok` from `http://127.0.0.1:<port>/`, the header line starts `Running on 127.0.0.1:`, Restart and Stop buttons, no close button; shot); `Stop frees svc-fixed's port` (click `svc-fixed`, header Stop: the row reads `stopped`, and within 3 s a TCP connect to its port is refused); `Start brings it back` (header Start: the row reads `:<port>` again); `Restart` (header Restart on `svc-ok`: its `startedms` in `servicesstatus` is newer and it reads running again); `a crashed service shows its log` (click `svc-crash`: the centre shows the terminal, not a frame, and the header reads `Crashed · exit 1` with Start; shot); `a never-run service shows its log, not started` (click `svc-never`: the centre shows its terminal with the header `Stopped` and Start, and 3 s later `servicesstatus` still says `stopped`); `the row menu` (right-click `svc-ok`: Start disabled, Stop, Restart, Open in the browser, Start with arcterm checked, Edit in Setup → Tools; Start with arcterm writes `autostart: false` into the entry, a second click removes the key; Edit in Setup → Tools lands on Setup → Tools with `svc-ok` selected; shot of the menu); `j/k reach a service row` (with `svc-ok` focused, `j` moves the focus to the next service row's tab).
- `services-chip` (surface `cockpit`, board `AppBarServices`): arrange first records that no chip is rendered, then adds `svc-ok`, `svc-crash`, `svc-v6`, `svc-off` and waits for running, crashed, nopage, stopped. Steps: `no chip without services` (the recorded absence); `the chip in the error tone` (reads `1 · 1 crashed`, `data-tone="error"`); `the popover's order and footer` (a click opens it: rows `svc-crash`, `svc-v6`, `svc-ok`, `svc-off` in that order, footer exactly `A tool with a page is a service. Add one in Setup → Tools.`; shot); `hover shows Log on a crashed row` (`Log` and `Restart` on `svc-crash`); `arrows and Enter open a service in the Agent centre` (ArrowDown twice highlights `svc-ok`, Enter lands on the Agent surface with `svc-ok`'s tab focused and its page shown); `the chip in the warning tone` (back on the cockpit, remove `svc-crash`: the chip reads `1`, `data-tone="warning"`; shot); `Escape closes it` (open, Escape: no popover).
- `services-setup` (surface `setup`, tab Tools): steps: `Pick a free port disables Page` (open the add form, check `Pick a free port`: the Page input is disabled and empty; shot); `the saved tool is a service` (name `svc-new`, command `node server.js 127.0.0.1 new`, folder the temp project; save: the entry has `port: "auto"` and no `url`, the detail pane reads `A free port, picked by arcterm` and `Start with arcterm` on, and `servicesstatus` shows `svc-new` starting or running; shot); `Start with arcterm turns off` (toggle it: the entry has `autostart: false`).
- `tools-app` (existing, `scripts/cdp/scenarios.mjs:41866`): its app is now a service, started when its entry is written. Update each step that relied on the old flow (the frontend probe, `tool:appowned`, the app's terminal row in the tree, closing that terminal stopping the server) to the service flow: Open from Setup → Tools shows the page through the service, the tree holds it as a service row. Keep its page, Back/Forward, Log, keep-alive, add-form and New dialog steps as they are.

`CHANGELOG.md`, top section, under `Added` (open `## Unreleased` above a dated top section): `arcterm now keeps your pinned apps' servers running: it gives each a port, restarts it when it crashes, starts it again when arcterm opens, and shows them in the Agent tree and the new Services chip.` ending `<!-- big -->`. `docs/open-issues.md` RAM table: a row for held services (arcterm's cost: one PTY and a goroutine per service, a probe only while starting; the services' own RAM is the apps'), status `pending`, dated 2026-10-20.

- [ ] **Step 1: Write the four scenarios and update `tools-app`.**
- [ ] **Step 2: Run them** the way Final does, which starts and stops its own browser app (no `task dev:browser` left running): `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs services-states services-tree services-chip services-setup tools-app` → exit 0; the contact sheet in that folder shows the rows, the header, the menu and the popover matching boards `Main`, `AppBarServices` and `RowStates`.
- [ ] **Step 3: Add the changelog line and the RAM row.**
- [ ] **Step 4: Commit**: `git commit -m "test(services): CDP scenarios for the rows, header, chip and Setup; changelog"`
