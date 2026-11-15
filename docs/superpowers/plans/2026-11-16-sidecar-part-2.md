# Sidecar, part 2 of 2: scrollback, the strain band, CPU per agent, the small form and the S button

**Effort:** effort:3aa2811d-7c3b-4014-89cf-e431a43bd3dc
**Spec:** `docs/superpowers/specs/2026-11-13-sidecar-design.md` (section 1a, section 3 Scrollback, section 4; the amendments below)
**Verify:** `node scripts/verify.mjs ./pkg/agentcpu ./pkg/wshrpc/wshserver`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sidecar-wall`
**Prototype:** D:/work/arcterm/.superpowers/design/cockpit-window/project/E-strain-band.dc.html

Part 2 builds initiative chunks 5-9 on top of part 1 (run c1a8243c, on `main`): the window and its reopen
(`src-tauri/src/sidecar.rs`), the slim page (`frontend/tauri/sidecar.tsx`, `sidecartitlebar.tsx`), the bridge
(`sidecarbridge.tsx`, `sidecarbridgemodel.ts`), the snapshot (`sidecarsnapshot.ts`), the wall (`sidecarwall.tsx`,
`sidecarwallmodel.ts`) and the `sidecar-wall` CDP scenario (`scripts/cdp/scenarios-sidecar.mjs`). **Extend these;
rebuild none of them.** The Prototype folder `project/` holds boards D (part 1's, still covered by the scenario's
existing steps), E (the strain band) and F (the small form); every board has scenario steps below. The release-build
RAM measurement against the 100 MB budget is the person's after the run: Task 9 leaves the hand-check and RAM-watch
lines for it.

## Decisions made beyond the spec and the boards (with why)

1. **The S button and the pin are one host command, not page window calls.** `sidecar_form` in `sidecar.rs` (decision
   12) shrinks, restores and pins, and keeps the small form, the frame S returns to and the pin in `Remembered`, which
   the reopen already persists. Why: reopen must restore "small form + pinned + the frame S returns to" (spec 1), and
   only the host can persist it; one owner of the window's frame is the single source of truth. Consequences (spec
   amendments, Task 9 writes them into the spec): the S button's frame memory is tested in Rust, not vitest; the
   capability drops `allow-set-position` and `allow-set-always-on-top`, which nothing calls any more. `allow-set-size`
   and `allow-inner-size` stay: part 1's scenario step 2 calls `plugin:window|set_size` and reads the size from the
   page (`scenarios-sidecar.mjs:244`). Tauri app commands need no capability entry (`build.rs` declares no app
   manifest), as `open_sidecar` shows. **Relaunch restoring small + pinned** is covered by Task 8's Rust tests of the
   reopen decision (`launch_place` of a small pinned `Remembered`); no scenario can relaunch the app, so it also gets
   a hand-check line.
2. **The small frame:** 340×440 logical, keeping the window's top-right corner where it was, clamped into the work
   area of the screen holding the window's centre (board F shows the float at a screen's right edge; a maximized
   Sidecar shrinks to that screen's top-right corner). Before shrinking the host leaves full screen and unmaximizes,
   remembering `{frame, fullscreen}` as the frame S returns to. S pressed again: pin off, the frame put back (maximized
   if it was, then full screen if it was). Dragging the small window wider keeps the host's `small` flag (the S
   button stays pressed and still restores); only the layout follows the width.
3. **Layout by width:** `window.innerWidth >= 1100` (CSS px) shows the wall, narrower the small form; one pure
   function, no hysteresis (a drag across the line just switches; nothing reloads). The pin button shows in the small
   layout only; the S button always. **The title bar at small width** follows board F: "Sidecar", then only the S,
   pin and close buttons; minimize, maximize and full screen hide, the counts move into the small form's head (board
   F draws them there), and the machine readout shortens to the numbers (`2.1 GB · 93%`). Nothing overflows
   (`scrollWidth <= clientWidth` on the bar at 340 px).
4. **The small form's keys:** arrows up/down select a card, 1-9 answers the selected card's ask (when `canAnswer`
   allows), Enter opens the selected agent in the main window; the first card starts selected. Cards are the asking
   tiles, oldest ask first (smallest `since`; the snapshot's own order is longest blocked first, so the same order).
5. **Scrollback cursor is an opaque string** the bridge mints and reads: `m:<row index>` into the rows the main window
   holds for an agent, i.e. any agent with entries from `entriesToShow(live, previousInfo)` (`agentrowmodel.ts`, as
   part 1's snapshot reads them: a streamed agent's live entries or a fixture's `previousInfo`; index from the start,
   so new rows at the bottom do not move it), `f:<line index>` into the transcript file for one with no entries in
   memory (`GetAgentTranscriptCommand` `before`). `before: null` asks for
   the page above the snapshot's own rows. Each answer returns rows oldest first and `next` (null: nothing earlier).
   A cursor that no longer fits (the agent moved from file to memory, the 4,000-line cap trimmed the front) answers
   `rows: [], next: null`, never an error loop. **Scrolling past what the main window holds (4,000 lines): stop
   there** (spec "Left to the builder"): no tile needs more, and a file read per scroll would cost an RPC per page for
   a rare case. A file-backed page reads 400 lines.
6. **The tile scrolls its own rows first:** a tile's message list holds all of the snapshot's rows (up to 8), scrolled
   to the bottom so the newest `msgs` show; scrolling up reveals the rest, and reaching the top sends `older` (10 rows).
   Loaded rows render above the snapshot's, marked `data-sidecar-older`; scrolling back to the bottom drops them. A
   tile shows "Start of what arcterm holds" when `next` is null.
7. **The tail read (spec 3, part 2's share):** once per (agent id, transcript path), for a tile that still has no rows
   after the part-1 `kept` fallback, is not streamed, and has a `transcriptPath`: `GetAgentTranscriptCommand` last 200
   lines, projected with `projectorFor(agent, path)` (`transcriptregistry.ts`), `messageRows(entries, 2)`. Reads go
   one at a time; a failure is logged once and not retried this session (no retry storm over 40 asleep agents). The
   rows join the bridge's `kept` map, which the snapshot already falls back to, so they never vanish. A Pi session read
   from a 200-line tail can miss its active branch; accepted for two preview rows (a Pi agent the main window streams
   reads the whole file as before).
8. **Machine figures while Sidecar is live:** the bridge subscribes to `memorypressure` (level, memory available) and
   reads `GetMachineStatsCommand` at hello and every 5 s while a page is live (for `cpupct` and `memtotal`). Spec 4
   says the title bar's figures come from what the main window already polls; nothing in the main window polls CPU
   outside the tray popover, and wavesrv samples CPU once a second anyway (`machinestats.RunCPU`), so the read costs a
   cached value plus the disk sizes. Nothing polls while no page is live. The snapshot carries the figures rounded
   (memory free and swap used to 0.1 GiB, CPU to a whole percent), so jitter does not re-emit a snapshot every 5 s.
9. **Strain rules (spec 4, pure in `sidecarstrainmodel.ts`):** RAM high = pressure `high` or `critical`; red =
   `critical`; CPU hot = every reading for the last 120 s over 90% with no gap between readings over 15 s (a gap
   restarts the streak: no data is not proof); amber = RAM high or CPU hot. A higher level shows at once; a lower one
   only after the raw level has stayed below the shown one for 30 s, stepping down one level at a time. "Since" is the
   start of the RAM-high or CPU-hot streak. The × hides the band until the level differs from the one it was hidden at
   (page-local state). **Heaviest by RAM when RAM is high (both up: RAM, the one that kills processes), else by CPU.**
   At most 3 agents, only agents with a reading above 0, heaviest first.
10. **Per-agent CPU is one RPC with one shape on both platforms:** `AgentCpuCommand` → `AgentCpuData`
    (decision 13). Windows fills it from `resmon.Snapshot` (the group's CPU of each group whose owner kind is
    `agenttab` or `runworker` and whose `OwnerId` is a roster agent's block: `resolveResMonOwner` labels orchestrator
    leads and workers `runworker`, and a plain terminal tab is `agenttab` but no roster agent; the same sampler the
    Consumers panel reads); macOS from a new sampler `pkg/agentcpu`; elsewhere `supported: false`. Why not fill
    resmon's own snapshot on macOS as spec 4 words it: its `supported` flag turns on the Resource Manager readout,
    which would then show half-filled groups; a small shape the band reads is the same "one figure per agent" without
    that. The top process is the agent's descendant with the most CPU, by the rule `GetConsumersCommand` uses for its
    heaviest (`memusage.AgentPid` then descendants only), so `StopProcessCommand` accepts it.
11. **Stop and Sleep from the band:** Stop asks in place on the row ("Stop `<command>`? The agent's build ends; the
    agent keeps running." Stop / Cancel; page-local state), then sends `stop {id, pid}`; the bridge runs
    `StopProcessCommand {blockid, pid}` and a refusal becomes the row's `note` (kept until the band's level changes or
    the agent leaves the band). Sleep sends `sleep {id}`; the bridge calls `sleepWithConfirm`, which now returns what
    happened (`"slept" | "compacting" | "asked" | "failed" | "busy"`, `"busy"` for `sleepNow`'s early return when
    the agent is already falling asleep: note "Already going to sleep"); on `"asked"` (background work runs under it, and the
    confirm modal opened in the main window) the bridge raises the main window (`showMain`) and the row's note says
    "Confirm in the main window". No Skip, no band-wide action (spec 4).
12. **Host command:** `sidecar_form(change: Option<FormChange>) -> Result<SidecarForm, String>`, async (a window call
    from a sync command runs on the main thread), registered in `main.rs`. `FormChange { small: Option<bool>,
    pinned: Option<bool> }`, `SidecarForm { small: bool, pinned: bool }` (serde lower-case field names). No change reads
    the form; `small: true` shrinks and pins (decision 2); `small: false` restores and unpins; `pinned` sets
    always-on-top only. A change on a missing window is an error string. `Remembered` gains `small: Option<Back>` (`Back
    { frame: Frame, fullscreen: bool }`) and `pinned: bool`, serde-defaulted, so a part-1 file reads as not small and not
    pinned. A reopen of a small or pinned Sidecar places it at its (small) frame, then sets always-on-top when pinned,
    with S still able to return to `Back`.
13. **Wire shapes** (Task 1 lands them; Go is the source of truth for the RPC):
    ```go
    // pkg/wshrpc/wshrpctypes_machine.go, in MachineCommands
    AgentCpuCommand(ctx context.Context) (*AgentCpuData, error) // each agent's CPU, sampled only while asked
    type AgentCpuData struct {
        Supported bool            `json:"supported"` // false where no sampler exists (Linux)
        Ready     bool            `json:"ready"`     // false until a second sample gives deltas
        Agents    []AgentCpuAgent `json:"agents"`
    }
    type AgentCpuAgent struct {
        BlockId string           `json:"blockid"`
        Cpu     float64          `json:"cpu"`           // percent of the whole machine, 0-100, as resmon's groups
        Top     *AgentCpuProcess `json:"top,omitempty"` // its busiest descendant; absent when it runs nothing but itself
    }
    type AgentCpuProcess struct {
        Pid     int32   `json:"pid"`
        Command string  `json:"command"` // memusage.ShortCommand of its command line
        Cpu     float64 `json:"cpu"`
    }
    ```
    ```ts
    // frontend/app/cockpit/sidecartypes.ts, added beside part 1's types
    export const SIDECAR_OLDER_EVENT = "sidecar:older"; // main → sidecar window: the answer to an older act
    export type StrainLevel = "amber" | "red";
    export interface SidecarMachine {
        memFree: number; memTotal: number; swapUsed?: number;  // bytes, rounded (decision 8)
        cpuPct?: number;                                       // whole percent; none before a reading
        platform: "windows" | "macos" | "other";               // names the OS in the red band's last part
    }
    export interface SidecarHeavy {
        id: string; name: string;                  // the agent tile's id and name
        ramBytes?: number; cpuPct?: number;        // its weight by the band's measure
        process?: { pid: number; command: string; ramBytes?: number; cpuPct?: number }; // what Stop ends; none: Sleep only
        note?: string;                             // the last Stop or Sleep outcome to show on the row
    }
    export interface SidecarStrain {
        level: StrainLevel;
        by: "ram" | "cpu";
        ram?: { since: number; critical: boolean }; // RAM high (or critical) since, UnixMilli
        cpu?: { since: number; pct: number };       // CPU over 90% since
        working: number; heavyJobs: number;         // "7 agents working, 2 heavy jobs running"
        heavy: SidecarHeavy[];                      // 0-3, heaviest first; empty while the reading is not in yet
    }
    // SidecarSnapshot gains: machine?: SidecarMachine; strain?: SidecarStrain
    export interface SidecarOlder { id: string; before: string | null; rows: SidecarMessage[]; next: string | null }
    // SidecarAct gains:
    //   | { kind: "older"; id: string; before: string | null; count: number }   // count 1..50
    //   | { kind: "stop"; id: string; pid: number }                              // must match a heavy row's process
    //   | { kind: "sleep"; id: string }                                          // must be a heavy row
    ```
    The form command's TS side lives in the page (`invoke<SidecarForm>("sidecar_form", { change })`), typed in
    `sidecartypes.ts` as `export interface SidecarForm { small: boolean; pinned: boolean }`.
14. **DEV test seams, compiled out of production** (`import.meta.env.DEV`), on the main page, declared in
    `sidecarbridge.tsx`'s `Window` interface beside part 1's: `__sidecarMachine` (a `MachineStatsData`: used in place of
    the machine read and the `memorypressure` event while set), `__sidecarHeavy` (`{ consumers?:
    CommandGetConsumersRtnData; agentcpu?: AgentCpuData }`: used in place of those polls while set; with it set, a
    `stop` or `sleep` act is logged in `__sidecarActs` and not run, and the row's note reads "Not run (fixture)"), and
    `__sidecarRefresh()` (re-read the seams and rebuild now, so the scenario needs no 5 s wait), and
    `__sidecarFeed(readings: MachineReading[])` (push these readings through `trackStrain` in order, then rebuild: the
    scenario feeds 27 readings 5 s apart ending now, CPU 95%, to reach the 120 s CPU streak without waiting; later
    seam readings at `Date.now()` continue the streak while `__sidecarMachine` keeps CPU at 95).
15. **Nothing new animates** (part 1's rule 14): the band, the confirm, the small form and the loaded rows appear and
    go without transitions. Colors from `@theme` tokens only: the band's amber is the `warning` family the wall's
    WAITING ON YOU band uses (`bg-warning`, `border-warning`, `text-on-warning`, `sidecarwall.tsx:33,230,253`), its red
    the `error` family; no raw hex (board E's hex values are the mockup's).
16. **DOM hooks** the scenario reads (in addition to part 1's): title bar `[data-sidecar-machine]` with
    `data-ram-tone` and `data-cpu-tone` (`normal|amber|red`), `[data-sidecar-btn="small"]` and
    `[data-sidecar-btn="pin"]` with `aria-pressed`; `[data-sidecar-band]` with `data-level="amber|red"`,
    `[data-sidecar-band-close]`, `[data-sidecar-heavy="<id>"]` rows with `[data-sidecar-heavy-stop]`,
    `[data-sidecar-heavy-sleep]`, `[data-sidecar-confirm]` (with its Stop `[data-sidecar-confirm-stop]` and Cancel
    `[data-sidecar-confirm-cancel]`) and `[data-sidecar-heavy-note]`; a tile's scroll list `[data-sidecar-msgs]`, loaded
    rows `[data-sidecar-msg][data-sidecar-older]`, `[data-sidecar-history-start]`; the small form `[data-sidecar-small]`
    with `[data-sidecar-card="<id>"]` (`data-selected`), its options `[data-sidecar-option]` (part 1's hook, reused),
    `[data-sidecar-elsewhere]` (reused) and `[data-sidecar-small-empty]` when nothing waits.
17. **The RAM budget is measured after the run lands, by the person (spec 5 amended).** The goal of this run says the
    release-build measurement against the 100 MB budget is the person's, after the run; a release build
    (`task tauri:build`) and a day on screen do not fit a run's Final. Part 1's release measurement read ~48 MB, half
    the budget, and part 2 adds no long-lived renderer state beyond the snapshot fields and a tile's loaded rows
    (dropped at the bottom). Task 9 amends spec 5 and Testing: "measure before merging" becomes "measure the release
    build after the part-2 run lands; over budget is a defect to fix before the next release", and leaves the
    hand-check line and the RAM-watch placeholder.

### Task 1: The contract: wire types, the RPC stub, the new acts
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_machine.go`, `pkg/wshrpc/wshserver/wshserver_agentcpu.go`, `pkg/agentcpu/agentcpu.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/app/cockpit/sidecartypes.ts`, `frontend/app/cockpit/sidecarbridgemodel.ts`, `frontend/app/cockpit/sidecarbridgemodel.test.ts`

Decision 13's shapes, exactly.

- Go: `AgentCpuCommand` in `MachineCommands` and the three types in `wshrpctypes_machine.go`; a stub
  `WshServer.AgentCpuCommand` in the new `wshserver_agentcpu.go` returning `&AgentCpuData{Supported: false, Agents:
  []AgentCpuAgent{}}` with a `TODO(Task 2)`. Run `task generate`; never hand-edit the generated files (if it also
  rewrites a generated file not listed here, commit it and say so). A package stub `pkg/agentcpu/agentcpu.go` (the
  package clause and its doc comment only) so Verify's `./pkg/agentcpu` pattern resolves from the first merge.
- TS: decision 13's additions to `sidecartypes.ts` (`SidecarSnapshot` gains the two optional fields; `SidecarAct` the
  three kinds; `SidecarOlder`, `SidecarForm`, `SIDECAR_OLDER_EVENT`).
- `validateAct` in `sidecarbridgemodel.ts` accepts the new kinds against the last snapshot sent: `older` needs a tile
  with that id, `before` a string or null, `count` a whole number 1..50; `stop` needs `last.strain` with a heavy row of
  that id whose `process.pid` equals `pid`; `sleep` a heavy row of that id. Each refusal has a reason naming what was
  wrong (the existing style). `sameSnapshot` today compares only `counts` and `tiles` (`sidecarbridgemodel.ts:107`):
  extend it to `machine` and `strain` too (still not `now`), so their changes re-emit; the bridge rounds the machine
  figures before they go in (decision 8), so this does not re-emit on jitter.
- Tests (`npx vitest run frontend/app/cockpit/sidecarbridgemodel.test.ts`): each new kind accepted with good fields,
  refused with a missing tile, a bad count (0, 51, 1.5), a pid that is not the row's process, a sleep of an agent not in
  the band, and no strain in the snapshot; `sameSnapshot` false when only `strain.level` or `machine.cpuPct` differs.
  `go build ./...` passes.

### Task 2: CPU per agent: resmon on Windows, a new sampler on macOS
**Depends on:** Task 1
**Model:** sonnet
**Chunk:** CPU per agent: reuse pkg/resmon on Windows, new sampler on macOS, only while the band shows
**Files:** `pkg/wshrpc/wshserver/wshserver_agentcpu.go`, `pkg/wshrpc/wshserver/wshserver_agentcpu_test.go`, `pkg/agentcpu/agentcpu.go`, `pkg/agentcpu/agentcpu_test.go`, `pkg/agentcpu/sample_darwin.go`, `pkg/agentcpu/sample_other.go`

Spec 4 "Who is heaviest" and decision 10. Replace Task 1's stub.

- `pkg/agentcpu`: the pure core, `Compute(prev, cur map[int32]uint64 /* cpu time, 100 ns or ns, one unit, say which */,
  wall time.Duration, cores int, t memusage.Table, roots map[string]int32 /* block id → root pid */, command func(pid
  int32) string) []wshrpc.AgentCpuAgent` (or an equivalent you name; keep it pure): each agent's CPU is the sum over its
  tree (`t.Tree(root)`) of the CPU-time delta over wall × cores, in percent of the machine; `Top` is the busiest process
  among the descendants of `memusage.AgentPid(t, root, isShell)` (pass the shell test in, as `GetConsumersCommand`
  passes `isShellProcess`), absent when there is none with CPU above 0. A process new since the last sample counts from
  0, one gone is skipped.
- `sample_darwin.go`: a sampler that reads the process table (`memusage.ReadTable`) and each tracked pid's CPU time
  every 2 s, started by the first read and stopped 10 s after the last (resmon's `idleStop` pattern), so it runs only
  while the band asks. It must compile with `GOOS=darwin CGO_ENABLED=0 go vet ./pkg/agentcpu` (no cgo: read CPU
  times through gopsutil). `sample_other.go`: `Supported = false`, no goroutine. Choose and state the interval in the
  file's header (spec "Left to the builder").
- `wshserver_agentcpu.go`: roots as `GetConsumersCommand` builds them (`loadAgentRosterFacts`, `buildAgentRoster`,
  `consumerBlockPid`; reuse, do not copy). On Windows convert `resmon.Snapshot(ctx, resolveResMonOwner)`'s
  `ResMonGroup`s of owner kind `agenttab` or `runworker` whose `OwnerId` (the block id) is a roster agent's block
  (decision 10: leads and workers are `runworker`; a plain terminal tab is `agenttab` but not on the roster) into
  `AgentCpuAgent`s through a pure function you test; its `Top` is the busiest row whose pid is a descendant of the agent's `AgentPid`, read from one
  `memusage.ReadTable`. On macOS use `pkg/agentcpu`. Elsewhere `Supported: false`. `Ready` follows the sampler's.
- Tests: `go test ./pkg/agentcpu -run 'TestCompute'` on a fake table like `pkg/memusage/heaviest_test.go` (two agents,
  a shell skipped for Top, a process born mid-interval, one gone, 8 cores scaling, no CPU → no Top);
  `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/wshrpc/wshserver -run 'TestAgentCpuFromResMon'`
  (the conversion: an `agenttab` agent and a `runworker` agent both kept, a terminal tab's `agenttab` group and the
  `arc` group dropped, Top a descendant only, not-ready passes through). `GOOS=darwin CGO_ENABLED=0 go vet
  ./pkg/agentcpu` passes.

### Task 3: The strain model (pure)
**Depends on:** Task 1 (uses the SidecarStrain, SidecarHeavy and SidecarMachine types)
**Model:** sonnet
**Chunk:** Strain band: RAM and CPU thresholds model, heaviest 2-3 agents, Stop (with confirm) and Sleep agent
**Files:** `frontend/app/cockpit/sidecarstrainmodel.ts`, `frontend/app/cockpit/sidecarstrainmodel.test.ts`

Spec 4's rules and decision 9, as pure functions the bridge (Task 5) and the page (Tasks 6, 7) import. No store, no
RPC, no React: the page imports it, and the page boots no store. Signatures (other tasks rely on these names):

```ts
export const CPU_HOT_PCT = 90, CPU_HOT_MS = 120_000, CPU_GAP_MS = 15_000, CLEAR_MS = 30_000, MAX_HEAVY = 3;
export interface MachineReading { at: number; pressure: string; memFree: number; memTotal: number; cpuPct?: number }
export interface StrainTrack { /* yours: streak starts, last reading time, shown level, below-since */ }
export const EMPTY_TRACK: StrainTrack;
export function trackStrain(t: StrainTrack, r: MachineReading): StrainTrack;
/** null when the band does not show. */
export function strainNow(t: StrainTrack): { level: StrainLevel; ram?: { since: number; critical: boolean }; cpu?: { since: number; pct: number } } | null;
export function strainBy(s: NonNullable<ReturnType<typeof strainNow>>): "ram" | "cpu";
export function heavyAgents(by: "ram" | "cpu", tiles: Pick<SidecarTile, "id" | "name">[],
    consumers: CommandGetConsumersRtnData | null, cpu: AgentCpuData | null,
    blockOf: (tileId: string) => string | undefined, notes: Record<string, string>): SidecarHeavy[];
export function nextHidden(hidden: StrainLevel | null, level: StrainLevel | null): StrainLevel | null; // × memory
export function bandShows(level: StrainLevel | null, hidden: StrainLevel | null): boolean;
export function bandTitle(s: SidecarStrain): string;            // board E's two titles
export function bandWhy(s: SidecarStrain, m: SidecarMachine | undefined, now: number): string;
export function machineReadout(m: SidecarMachine | undefined, s: SidecarStrain | undefined):
    { ram: string; cpu: string; ramTone: "normal" | "amber" | "red"; cpuTone: "normal" | "amber" | "red" };
export function formatBytes(n: number): string;                 // "2.1 GB", "640 MB"
```

`bandWhy` reads like board E. Amber: `RAM high for 3 min (2.1 GB free of 32 GB) · CPU over 90% for 2 min · 7 agents
working, 2 heavy jobs running`. Red: `RAM critical (0.6 GB free, swap 9.2 GB) · CPU at 98% for 4 min · Windows may
start killing processes` (the swap part only with `swapUsed` above 0; the OS named from `machine.platform`: "Windows",
"macOS", else "The system"). A part that does not apply is left out (no "0 heavy jobs"). Ages use the wall's
`formatTileAge` words where they fit. `heavyAgents` matches the generated (lower-case) wire fields: `ConsumerAgent.tabid`
to the tile id for RAM (`rambytes`; `heaviest` `{pid, command, bytes}` as the process) and `AgentCpuAgent.blockid`
through `blockOf` for CPU (`cpu`; `top` `{pid, command, cpu}`), drops agents with no reading or 0, keeps tiles' agents
only, takes `MAX_HEAVY`, attaches `notes[id]`.

Tests (`npx vitest run frontend/app/cockpit/sidecarstrainmodel.test.ts`): `high` → amber at once, `critical` → red at
once, red → amber only after 30 s under it, then off after 30 s more; a dip shorter than 30 s keeps the band; CPU at
95% for 119 s → nothing, 120 s → amber with `since` the streak start; one reading at 85% restarts the streak; a 20 s
gap restarts it; both up → `by: "ram"`; `heavyAgents` picks the top 3 by RAM and by CPU, skips terminals (ids not in
tiles), zeros and missing readings, carries the process or none; `nextHidden`/`bandShows`: hidden at amber stays hidden
at amber, shows at red, shows again back at amber, clears when the band goes; `bandWhy` for the board's two examples
and with parts missing (no swap, no CPU, platform "other"); `machineReadout` tones (RAM amber when `ram` is up, red when critical; CPU amber when `cpu` is
up) and the no-reading case ("—").

### Task 4: Scrollback paging and the transcript-tail read
**Depends on:** Task 1 (uses SidecarOlder and the older act's shape)
**Model:** sonnet
**Chunk:** Recent messages on each tile and lazy scrollback, with a one-time tail read for agents the main window no longer streams
**Files:** `frontend/app/cockpit/sidecarhistory.ts`, `frontend/app/cockpit/sidecarhistory.test.ts`

Spec 3 "Scrollback", decisions 5 and 7. One module the bridge (Task 5) calls; pure functions plus two thin RPC
readers, tested with a mocked `RpcApi` the way `agentsessionstore.test.ts` mocks it.

```ts
export const OLDER_FILE_LINES = 400, TAIL_LINES = 200, TAIL_ROWS = 2;
/** The page above `before` from rows the main window holds (all rows of the agent, oldest first). */
export function olderFromMemory(all: SidecarMessage[], shownCount: number, before: string | null, count: number):
    { rows: SidecarMessage[]; next: string | null };
/** One file page: reads OLDER_FILE_LINES lines before the cursor (or the tail for null), projects, rows. */
export function readOlderFromFile(path: string, agent: string | undefined, before: string | null, shown: SidecarMessage[]):
    Promise<{ rows: SidecarMessage[]; next: string | null }>;
/** The one-time tail read: the last TAIL_ROWS rows, [] when the file has none. Rejects on an RPC error. */
export function readTail(path: string, agent: string | undefined): Promise<SidecarMessage[]>;
/** Which tiles need a tail read now: no rows, not streamed, a transcript path, not tried before. */
export function tailsToRead(tiles: { id: string; rows: number; streamed: boolean; path?: string }[], tried: ReadonlySet<string>): { id: string; path: string }[];
export function tailKey(id: string, path: string): string;
```

Rows come from part 1's `messageRows` (`sidecarsnapshot.ts`) with no cap (`Infinity`) over the projected entries
(`projectorFor(agent, path).project(lines)`), so a page and a tile read the same row rule. Cursors per decision 5;
`olderFromMemory(before: null)` starts just above the last `shownCount` rows; a file read for `null` drops the rows
already shown at its tail (compare by value with `shown`). Cursors that do not parse or point past the data answer
`{ rows: [], next: null }`.

Tests (`npx vitest run frontend/app/cockpit/sidecarhistory.test.ts`): memory paging from null, then by cursor, to the
start (`next` null), a cursor past the end, a bad cursor; a file page with a mocked `GetAgentTranscriptCommand` asserting
`before`/`maxlines`, `next` from the answer's `start` (null at 0), the tail-dedupe for null; `readTail` returns the
last 2 rows of a Claude-format fixture (user text, assistant text, a tool_use and its result), `[]` for an empty file,
and rejects on an RPC error; `tailsToRead` skips streamed, has-rows, no-path and tried tiles.

### Task 5: The bridge feeds the band, scrollback and tail rows; Stop and Sleep
**Depends on:** Task 3 (uses the strain model), Task 4 (uses the history module)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarbridge.tsx`, `frontend/app/cockpit/sidecarbridgemodel.ts`, `frontend/app/cockpit/sidecarbridgemodel.test.ts`, `frontend/app/view/agents/agentsleep.ts`, `frontend/app/view/agents/agentsleep.test.ts`

Spec 2 and 4 "The bridge in the main window reads the machine and the per-agent figures"; decisions 7, 8, 9, 11, 14.
Extend part 1's bridge; keep its throttle, last-sent memory, hello and hold behaviour.

- **Machine and strain**, only while a page is live: one `GetMachineStatsCommand` at hello, then every 5 s, plus
  `memorypressure` events (`waveEventSubscribeSingle`, as `traybridge.tsx` does); each reading goes through
  `trackStrain`, and the snapshot carries `machine` (rounded per decision 8; `swapUsed` from `swapused`, `platform`
  from `isWindows()`/`isMacOS()`) and, when `strainNow` is not null, `strain` (with `working` from the snapshot's
  counts and `heavyJobs` the running jobs in `jobQueueAtom`). Stop every timer and subscription on
  `sidecar:closed` and unmount. A reading that changes nothing visible must not re-emit (the existing `sameSnapshot`).
- **Heavy agents**, only while the band shows: by RAM, `loadConsumers()` every `CONSUMERS_POLL_MS` (the shared
  `consumersReadingAtom`, `consumersstore.ts`); by CPU, `RpcApi.AgentCpuCommand` every 2 s. Neither runs while the band
  is down. `heavyAgents(...)` fills `strain.heavy` (`blockOf` from the roster's `blockId`).
- **Acts:** `stop` → `StopProcessCommand {blockid, pid}`, a rejection's text into the row's note, then
  `loadConsumers()`; `sleep` → `sleepWithConfirm(agent)`, its outcome into the note (decision 11; on `"asked"` raise the
  main window with `showMain`). Notes clear when the band's level changes or the agent leaves the band. `older` →
  `olderFromMemory` for an agent with entries in memory (`entriesToShow(live, previousInfo)`, as part 1's snapshot
  reads them, so a fixture agent with `previousInfo` only pages from memory too (decision 5); `shownCount`
  = the rows the last snapshot sent for that tile), else `readOlderFromFile` when it has a `transcriptPath`, else
  `{rows: [], next: null}`; answer with `emitTo("sidecar", SIDECAR_OLDER_EVENT, SidecarOlder)`. Keep nothing after.
- **Tail reads:** after each build, `tailsToRead` over the tiles (streamed = has live entries in
  `liveEntriesByIdAtom`); read one at a time; rows into a bridge-held `tails` map passed into the snapshot's `kept`
  argument so they persist; mark tried before the read; log a failure once (`[sidecar]` via `getApi().sendLog`), never
  silently.
- **`agentsleep.ts`:** `sleepWithConfirm` resolves to `"slept" | "compacting" | "asked" | "failed" | "busy"` (what
  `sleepNow` already decides; `"busy"` for its early return when the agent is already falling asleep); behaviour for
  its existing callers is unchanged (they ignore the value).
- **Seams** (decision 14): `__sidecarMachine`, `__sidecarHeavy`, `__sidecarRefresh`, `__sidecarFeed`, dev only,
  declared on `Window`.
- Pure additions to `sidecarbridgemodel.ts` where the wiring has a rule worth a test (for example which polls run for a
  given strain, or when a note clears), with tests in `sidecarbridgemodel.test.ts`. In the existing
  `agentsleep.test.ts`: "toasts the server's error and never throws" (line ~334) now expects
  `resolves.toBe("failed")`, "does not send a second Sleep while one is under way" expects the second call to resolve
  `"busy"`, and add one assertion per remaining outcome (`"slept"`, `"compacting"`, `"asked"`).
- Acceptance (each a step of the `sidecar-wall` scenario Task 9 adds): with `__sidecarMachine` at `high` the band
  shows amber with the fixture's 3 heavy agents; at `critical` red; Stop → confirm → Stop logs the act and shows the
  fixture note; Sleep logs its act; the fed CPU streak adds the CPU part; scrolling a tile to its top loads older
  rows; the asleep fixture agent with a transcript path shows its tail's 2 rows. Focused tests:
  `npx vitest run frontend/app/cockpit/sidecarbridgemodel.test.ts frontend/app/view/agents/agentsleep.test.ts`.

### Task 6: The band and tile scrollback on the wall
**Depends on:** Task 3 (uses bandShows, nextHidden, bandTitle, bandWhy)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarwall.tsx`, `frontend/app/cockpit/sidecarband.tsx`, `frontend/app/cockpit/sidecarwallmodel.ts`, `frontend/app/cockpit/sidecarwallmodel.test.ts`

Board E and spec 3 "Scrollback"; decisions 6, 11, 15, 16. The page stays storeless: import only the types, the pure
models and the Tauri event API.

- `sidecarband.tsx`: board E's band at the top of the wall when `snap.strain` exists and `bandShows`: the title and
  `bandWhy` (aged from `snap.now` + `clock - receivedAt`, as the tiles age), the × (`nextHidden` held in the wall's
  state), then one row per heavy agent: name, weight (`formatBytes` or `cpuPct`%), its process and that process's
  weight, and **Stop** (only with a process) and **Sleep agent**. Stop swaps the row's buttons for the in-place confirm
  (decision 11 wording, `command` in mono); confirm sends `stop`, Cancel goes back. The row's `note` shows under it.
  No band-wide action, no sound, nothing animates. Amber and red from `@theme` tokens (decision 15). While `heavy` is
  empty it says "Finding the heaviest agents…".
- `sidecarwall.tsx`: the band takes its height from the wall area before `wallShape` runs (the tiles still fit what
  is left, no page scroll); each tile's message list becomes `[data-sidecar-msgs]`, holding all snapshot rows and
  scrolled to the bottom on mount and when new rows arrive while it sits at the bottom; reaching the top sends `older`
  (`before` the tile's cursor, `count` 10) once per cursor while one is in flight; `SIDECAR_OLDER_EVENT` answers
  (`listen` in the wall, dropped when the id or `before` does not match what is in flight) prepend rows marked
  `data-sidecar-older`, keeping the scroll position; `next: null` shows `[data-sidecar-history-start]` ("Start of what
  arcterm holds"); scrolling back to the bottom drops the loaded rows and the cursor. Arrows, Enter, 1-9 and F11 keep
  working (the scroll list takes no focus).
- `sidecarwallmodel.ts`: whatever of the above is a rule (the band height taken off before the shape; when a scroll
  position counts as top or bottom; merging an older answer into a tile's loaded rows, ignoring a stale one) as pure
  functions with tests in `sidecarwallmodel.test.ts` (`npx vitest run frontend/app/cockpit/sidecarwallmodel.test.ts`).
- Acceptance: scenario steps (Task 9) "band finding the heaviest", "band amber", "band amber with CPU", "band red",
  "band ×", "Stop confirm and Cancel", "Stop and its note", "Sleep", "scroll a tile up to its start and back"; part 1's
  steps for 4/12/20/40 agents still pass with no band.

### Task 7: The small form, the S and pin buttons, and the machine readout
**Depends on:** Task 3 (uses machineReadout)
**Model:** sonnet
**Files:** `frontend/tauri/sidecar.tsx`, `frontend/app/cockpit/sidecartitlebar.tsx`, `frontend/app/cockpit/sidecarsmall.tsx`, `frontend/app/cockpit/sidecarlayout.ts`, `frontend/app/cockpit/sidecarlayout.test.ts`, `frontend/tauri/browsershim/core.ts`, `frontend/tauri/browsershim/browsershim.test.ts`

Board F and spec 1a; decisions 2, 3, 4, 12, 16. Page side only: Task 8 builds the host command.

- `sidecarlayout.ts`: `SMALL_BREAK_PX = 1100`, `layoutFor(width: number): "wall" | "small"`, `smallAsks(snap):
  SidecarTile[]` (asking tiles, oldest ask first), and the small form's key rule (arrows up/down over the cards, 1-9,
  Enter; reuse `wallKey` and `canAnswer` from `sidecarwallmodel.ts`, import them, do not copy).
- `sidecar.tsx`: picks the layout from `window.innerWidth` (a resize listener; the same snapshot feeds both, nothing
  reloads); reads the form once at load with `invoke<SidecarForm>("sidecar_form", { change: null })`, logs a failure
  and treats it as `{ small: false, pinned: false }`; passes `machine`/`strain` and the form to the title bar.
- `sidecarsmall.tsx`: board F: the counts at its head (decision 3); one card per ask, oldest first: name, project,
  age, the question, its options as 1-9 buttons, or for an ask the tile cannot answer "Enter answers it in the main
  window" (`[data-sidecar-elsewhere]`); Sent shows the way the wall shows it. Build the card's ask block here, in
  `sidecarsmall.tsx`: the wall's `AskBlock` is private to `sidecarwall.tsx`, which Task 6 edits at the same time, so
  leave that file alone (reuse only the exported pure helpers of `sidecarwallmodel.ts`). With nothing waiting, one
  line: "Nothing waits on you." No band, no working or idle tiles. Selected card outlined; keys per decision 4.
- `sidecartitlebar.tsx`: the readout `RAM <free> free · CPU <pct>` from `machineReadout` with its tones (amber/red
  tokens), shown once a snapshot carries `machine`; the S button in part 1's empty slot (`data-sidecar-btn="small"`,
  `aria-pressed` = form.small, label "Small form, pinned on top" / "Back to the full Sidecar"); the pin button
  (`data-sidecar-btn="pin"`, `aria-pressed` = form.pinned) in the small layout only. Each press invokes
  `sidecar_form` with its change and takes the returned form; a rejection is logged and the state left as it was.
  In the small layout the bar follows decision 3: "Sidecar", the short readout, then S, pin and close only (minimize,
  maximize and full screen hidden, counts moved to the small form's head); nothing overflows at 340 px.
- Browser shim: `core.ts` answers `sidecar_form` (rejects "Sidecar is a window of the Tauri host", as `open_sidecar`
  does), so `browsershim.test.ts`'s every-invoke-answered check holds; extend that test if it lists names.
- Tests: `npx vitest run frontend/app/cockpit/sidecarlayout.test.ts frontend/tauri/browsershim/browsershim.test.ts`
  (1099 → small, 1100 → wall; ask order; keys: arrows clamp, 1-9 only when answerable, Enter opens the selected).
- Acceptance: scenario steps (Task 9) "title bar readout", "narrow by width shows the small form unpinned", "S shrinks
  and pins" (with the title bar's no-overflow check), "small form keys", "pin off and on", "S restores", and the small
  form's empty line.

### Task 8: The host's small form: shrink, restore, pin, and reopen as last time
**Depends on:** none
**Model:** sonnet
**Files:** `src-tauri/src/sidecar.rs`, `src-tauri/src/main.rs`, `src-tauri/capabilities/sidecar.json`, `docs/reference/architecture.md`, `AGENTS.md`

Spec 1 ("in the small form and pinned if it was") and 1a; decisions 1, 2 and 12.

- `sidecar.rs`: `Remembered` gains `small: Option<Back>` and `pinned: bool` (serde defaults); `Change` gains what
  shrinking, restoring and pinning do; the pure rules as functions with Rust unit tests: the small frame (340×440
  logical at the scale, top-right corner kept, clamped into the work area of the screen holding the window's centre),
  the `Back` captured from the kept frame and full-screen state, restore returning exactly that, pin independent of
  small. The `sidecar_form` command (decision 12) does the window calls in order (leave full screen, unmaximize, set
  size and position, always-on-top; restore: always-on-top off, position, size, maximize, full screen), never holding
  `KEPT` across a window call (the file's existing rule). `open_window`'s placing sets always-on-top after show when
  `pinned`. A `log_line` for each change, as the file does.
- `main.rs`: register `sidecar::sidecar_form` in `generate_handler!`.
- `capabilities/sidecar.json`: drop `allow-set-position` and `allow-set-always-on-top` (decision 1); keep
  `allow-set-size` and `allow-inner-size`, which part 1's scenario step 2 uses; update the description and the test
  that pins the permission list (`sidecar.rs` ~line 1036).
- Docs: `docs/reference/architecture.md` command list and count, `AGENTS.md` "Eighteen Tauri commands" → "Nineteen".
- Tests: `cargo test --manifest-path src-tauri/Cargo.toml sidecar` (round trip with the new fields, a part-1 file read
  as not small and not pinned, small frame on one and two screens and at scale 1.5, clamp at a screen edge, shrink then
  restore returns the first frame and full screen, a maximized frame comes back maximized, and **the relaunch case**:
  `launch_place` of a saved small pinned `Remembered` places it at its small frame, pinned, with `Back` kept for S;
  this test is what covers relaunch-restores-small-and-pinned in the run, decision 1). `cargo check --manifest-path src-tauri/Cargo.toml` clean.
- Acceptance: scenario steps (Task 9) "S shrinks and pins", "pin off and on", "S restores".

### Task 9: The scenario: the band at amber and red, scrollback, the tail read, the small form after S and back
**Depends on:** Task 5 (drives its seams, acts, tail read and older answers), Task 6 (reads the band's and the scroll list's DOM hooks), Task 7 (reads the small form's and the title bar's hooks), Task 8 (presses S and pin, which call its host command)
**Model:** sonnet
**Chunk:** CDP scenario (host: true) for 4/12/20 agents and the band; measure a release build against the 100 MB budget and log it in RAM watch
**Chunk:** Small form and S button: free resizing down to 340x440, the layout follows the width (wall from ~1100 px, else what waits on you), the S button shrinks to 340x440 and pins on top, pressed again retur…
**Files:** `scripts/cdp/scenarios-sidecar.mjs`, `scripts/cdp/fixtures/sidecar-tail.jsonl`, `docs/hand-checks.md`, `docs/open-issues.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-13-sidecar-design.md`

Spec "Testing"; decisions 14 and 16. Extend part 1's `sidecar-wall` scenario (`host: true`); keep its steps 1-13
passing and its teardown (which must also clear the new seams, unpin and leave the small form if a step failed).

- **Part 1's rosters and steps 1-13 stay as they are** (step 6 still asserts `fx-sc-sleep1` shows
  `[data-sidecar-nomsgs]`; step 2 still uses `set_size`, whose permission stays). The new steps run after step 13 on a
  **new roster of their own** (`part2`): part 1's 4-agent roster plus a scroll agent with 14 message rows in
  `previousInfo` (the snapshot carries 8, one older page of 10 returns the other 6 and `next: null`) and a second asleep
  agent `fx-sc-sleep2` with no entries and `transcriptPath` = the absolute path of the checked-in
  `scripts/cdp/fixtures/sidecar-tail.jsonl` (a short Claude transcript, 4+ messages with a tool call, the last two
  distinctive), so the real tail read runs in the app. `__sidecarHeavy` with consumers naming 3 of its agents (RAM and
  a heaviest process each) and an `agentcpu` reading for them; a second roster with no asks for the empty line.
- **New steps**, each with a Sidecar screenshot pushed into `h.shots` (part 1's pattern):
  1. band finding the heaviest: `__sidecarHeavy` = consumers with no agents, `__sidecarMachine` pressure `high`,
     `__sidecarRefresh()` → `[data-sidecar-band][data-level="amber"]` saying "Finding the heaviest agents…";
  2. band amber: the fixture `__sidecarHeavy` → 3 `[data-sidecar-heavy]` rows, title readout `data-ram-tone="amber"`;
  3. band amber with CPU: `__sidecarFeed` 27 readings 5 s apart ending now at CPU 95% (and `__sidecarMachine` CPU 95)
     → the band's text has the "CPU over 90% for 2 min" part (board E's amber line), `data-cpu-tone="amber"`;
  4. Stop confirm and Cancel; 5. Stop → confirm → the act in `__sidecarActs` and the "Not run (fixture)" note;
  6. Sleep → its act; 7. band × hides it; 8. `critical` shows it red (`data-level="red"`, `data-ram-tone="red"`, the
     text names the OS as board E's red line does); 9. back to `normal` (and CPU 20) clears it after its 30 s hold
     (wait for it, ≤ 40 s);
  10. scroll the scroll agent's `[data-sidecar-msgs]` to the top → `[data-sidecar-older]` rows appear, then
      `[data-sidecar-history-start]`; back to the bottom → both gone;
  11. `fx-sc-sleep2`'s tile shows the fixture tail's last 2 messages;
  12. narrow by width (`Emulation.setDeviceMetricsOverride` 900×800) → `[data-sidecar-small]` with the asking cards
      oldest first and no pin pressed;
  13. clear the override, press S → the window reads 340×440 (`innerWidth`/`innerHeight`, ±2 px for the scale), small
      form shown, S and pin `aria-pressed="true"`, `invoke("sidecar_form", {change: null})` from the page says
      `{small: true, pinned: true}`, and the title bar does not overflow (`scrollWidth <= clientWidth`, minimize,
      maximize and full screen not shown);
  14. small form keys: ArrowDown selects the second card, `1` on an answerable card logs an `answer` act for that id
      with option 0, Enter logs an `open` act for the selected id;
  15. pin off and on (aria and the form follow); 16. S again → back to the size read before S, the wall shown, form
      `{small: false, pinned: false}`; 17. the empty line (`[data-sidecar-small-empty]`) with the no-asks roster at a
      narrow width. The main window's size and focus stay untouched.
- **Docs:** `docs/hand-checks.md` `- [ ] (arcterm)` lines: **the release-build RAM measurement against the 100 MB
  budget** (`task tauri:build`, 12 agents, Sidecar open a day, its renderer plus the GPU process it adds, with the band
  showing for part of it); S and pin across a relaunch (quit small and pinned → it reopens small, pinned, and S returns
  to the old frame); the band on a real strained machine; the macOS CPU sampler on a Mac (compiled, not run).
  `docs/open-issues.md` "RAM watch": update part 1's Sidecar row's last column or add a part-2 row with the figures
  marked "to measure (release build, the person's)". `CHANGELOG.md` top `Unreleased` section: Added lines for the
  strain band, scrollback and the small form with the S button, for the user (the scenario task owns the file so
  parallel tasks do not collide on it). The spec: amend section 1 (capability), 1a and 4 with decisions 1, 8 and 10
  in a sentence each, Testing's "the S button's frame memory" to Rust tests, and **section 5 and Testing's "Measure
  RAM as above before merging"** per decision 17.
- Acceptance: `node scripts/cdp/final-verify.mjs sidecar-wall` passes on Windows with every new step PASS; the
  contact sheet shows boards D, E and F's states (wall, band amber, band red, small form).
