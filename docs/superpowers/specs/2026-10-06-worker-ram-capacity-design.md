# Worker RAM capacity — how many more workers fit — design

## Problem

An orchestrator run spawns up to 8 workers (`orchestrate.MaxParallelism`), and the width is picked by hand in
three steppers. Nothing tells the user whether the machine can hold that many. On an 8 GB Mac a `claude`
process alone sits around 350 MB RSS, and a worker's children (`tsc` with a 4 GB heap, `go test`, vite) push
its tree well past 1 GB. Picking 4 workers on a machine with 1.3 GB free swaps the whole system to a crawl,
and the user only finds out after the fact.

The user wants to see how much RAM is free and how many more workers it can hold, and to be warned when the
width they pick is more than that.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Show and warn; never block. The engine's scheduling is unchanged, and Start / Save stay enabled when over. | Chosen by the user over engine-side gating. The estimate is a heuristic; the user decides. |
| 2 | The per-worker cost is **measured**: the highest process-tree peak RSS among live workers and the last 10 finished ones. With no reading yet it is a default of **1.5 GiB**. | Chosen by the user. The peak, not the average, because a worker idles at ~400 MB and spikes during a build; the max, not a percentile, because on an 8 GB machine an underestimate is the expensive mistake. |
| 3 | RSS is read on the engine's existing per-worker process-tree walk (`sampleChildCPUTime`), not by a new walk. | The walk is the costly part (on darwin `Children()` lists every process); it already runs at most once per worker per 20 s. RSS adds one `proc_pidinfo` per node. |
| 4 | Live workers reserve room to grow: `reserve = Σ max(0, perWorker − rss_i)`; `more = floor((available − reserve) / perWorker)`, never below 0. | A worker sampled at its prompt will still run its build; free RAM alone would count that room twice. |
| 5 | `more` is not capped at `MaxParallelism`. | It is information about the machine; the steppers cap themselves. |
| 6 | Backend computes; one wshrpc command (`GetWorkerCapacityCommand`) serves every reader. | One formula, in Go, reusable later by `wsh` or by the engine. |
| 7 | Samples live in memory only. A wavesrv restart falls back to the default until a worker is sampled. | Workers do not survive a restart either; persisting peaks is not worth a file. |
| 8 | The lead agent is not counted. | It runs no builds; the workers are what the user sizes. |
| 9 | UI is minimal: an icon + `+N` chip on the app bar with the detail in its tooltip, and on the steppers nothing at all until the picked width is over capacity. | Chosen by the user over a labelled pill and an always-on hint line under each stepper ("too much on screen"). |
| 10 | The chip polls every 5 s; a failed or missing reading hides the chip and the warning instead of showing a stale number. | `mem.VirtualMemory()` is a `host_statistics` call on darwin, cheap at that rate. A stale "+2" is worse than none. |

## Backend

### `pkg/workercap` (new)

A small package with no dependency on `pkg/orchestrate` (which imports it).

```go
const DefaultPerWorker = 1536 << 20 // 1.5 GiB
const RecentPeaks = 10

// Observe records a live worker's process-tree RSS, keeping its peak. A zero reading (no node of the tree
// could be read) or an empty block id is dropped, so the estimate can never become 0.
func Observe(blockId string, rss uint64)

// Snapshot retires every live entry whose block is no longer running (its peak joins the ring of the last
// RecentPeaks finished workers, oldest dropped first) and returns the live workers' current RSS and the
// per-worker estimate: the max over live peaks and the ring, or DefaultPerWorker with measured=false.
func Snapshot(isRunning func(blockId string) bool) (liveRSS []uint64, perWorker uint64, measured bool)

// Compute is the pure formula of decision 4; a zero perWorker means DefaultPerWorker.
func Compute(total, available, perWorker uint64, liveRSS []uint64) Capacity

// Read is Snapshot + Compute, with Measured set: what the RPC calls.
func Read(total, available uint64, isRunning func(blockId string) bool) Capacity

type Capacity struct {
    Total, Available, PerWorker, Reserve uint64
    Measured                             bool
    LiveWorkers, More                    int
}
```

The tracker is package-level state behind a mutex (`live map[string]sample{rss, peak}` and the ring).

### Sampling in `pkg/orchestrate/liveness.go`

- `childCPUTime` / `sampleChildCPUTime` become `childTreeSample` / `sampleChildTree`, returning
  `treeSample{CPUMs int64; RSS uint64}` from the one `processTree(root)` walk: CPU from `Times()` as today,
  RSS summed from `MemoryInfo().RSS`. A node whose reading fails is skipped, as for CPU.
- `sampleWorkerCPU` uses `.CPUMs` as before and calls `observeWorkerRSS(blockId, s.RSS)` after a successful
  reading. `observeWorkerRSS` is a `var` defaulting to `workercap.Observe`, so tests can capture it.
- The throttle (`cpuSampleEvery`, 20 s) and the call sites are unchanged. A spike shorter than the gap between
  two samples is missed; builds and test runs last minutes, so the peak still lands.

### RPC

In `pkg/wshrpc/wshrpctypes_dag.go`, then `task generate`:

```go
GetWorkerCapacityCommand(ctx context.Context) (*CommandGetWorkerCapacityRtnData, error) // free RAM and how many more workers fit

type CommandGetWorkerCapacityRtnData struct {
    TotalBytes     uint64 `json:"totalbytes"`
    AvailableBytes uint64 `json:"availablebytes"` // gopsutil Available: darwin free+inactive, Windows ullAvailPhys
    PerWorkerBytes uint64 `json:"perworkerbytes"`
    Measured       bool   `json:"measured"`       // false: PerWorkerBytes is the default, no worker sampled yet
    LiveWorkers    int    `json:"liveworkers"`
    ReserveBytes   uint64 `json:"reservebytes"`   // room the live workers may still grow into
    MoreWorkers    int    `json:"moreworkers"`
}
```

`pkg/wshrpc/wshserver/wshserver_workercap.go` calls `mem.VirtualMemory()`, then `workercap.Snapshot` (via `Read`) with an
`isRunning` built on `blockcontroller.GetBlockControllerRuntimeStatus(id)` (running when its
`ShellProcStatus` is `Status_Running`) through `workercap.Read`, and maps the result. A `VirtualMemory`
error is returned as the RPC error.

## Frontend

### Pure logic — `frontend/app/view/agents/workercapacity.ts`

- `formatGB(bytes)` → `"1.3 GB"` (one decimal, GiB).
- `extraWorkers` — how many new workers a pick adds: the launcher's width as is; on the lead card
  `max(0, picked − runningCount(vm.rows))`.
- `overCapacity(cap, extra)` → `extra > cap.moreworkers`; always `false` when `cap` is `null`.
- `capacityTitle(cap)` — the chip's tooltip, one fact per line:
  `1.3 GB free of 8 GB` / `~1.5 GB per worker (measured|default)` / `2 running · ~2 more fit`.
- `capacityWarnTitle(cap)` — the stepper warning's tooltip: `~1 more fits in RAM (1.3 GB free)`
  (`~0 more fit…` when none).

### Store — `frontend/app/view/agents/workercapacitystore.ts`

`workerCapacityAtom` (`CommandGetWorkerCapacityRtnData | null`, `null` until the first load) and
`useWorkerCapacity()`, which reference-counts its users so the whole app runs one 5 s poll. A failed load sets
the atom to `null`.

### App bar chip

`WorkerCapacityChip` in `frontend/app/cockpit/app-bar.tsx`, before `HeaderUsageMeters`: a memory icon and
`+N`, `text-[11.5px] text-muted`, no border, `title={capacityTitle(cap)}`. At `+0` the icon becomes
`TriangleAlert` and the text `text-warning`. Renders nothing while the atom is `null`. Token colors only.

### Stepper warning

Shared `CapacityWarn({ cap, extra })`: renders nothing unless `overCapacity(cap, extra)`; when over, a 12 px `TriangleAlert`
in `text-warning` with `title={capacityWarnTitle(cap)}`. On each stepper, when over, the picked number also
turns `text-warning`:

- `WorkerStepper` (`runlauncher.tsx`) gains a `warn` prop, used by `ShapeCards` and by "Workers at once" in
  `frontend/app/view/jarvis/newruncontrol.tsx`; `CapacityWarn` sits after its `+` button.
- The lead card's "Worker parallelism" panel (`leadcard.tsx`) draws its own stepper; it gets the same number
  color and `CapacityWarn`, with `extra` from the running-task count.

## Testing

- **Go** — `pkg/workercap/workercap_test.go`: `Compute` as a table (no live workers; live workers below the
  estimate reserve room; `available < reserve` gives 0; the floor). Tracker: `Observe` keeps the peak;
  `Snapshot` retires a stopped block into the ring, the ring holds 10 and drops the oldest; the estimate is
  the max; no readings give the default and `measured=false`. `pkg/orchestrate/liveness_test.go`: its three
  `childCPUTime` uses move to `childTreeSample`, plus one test that `sampleWorkerCPU` passes the block and
  RSS to `observeWorkerRSS`. Run `go test ./pkg/workercap ./pkg/orchestrate`.
- **Frontend** — `workercapacity.test.ts` (vitest): `extraWorkers` for both pickers, `overCapacity` including
  `null`, `formatGB`, both tooltip strings. `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`.
- **UI** — a `worker-capacity` scenario in `scripts/cdp/scenarios.mjs` asserts the app bar chip renders. The
  over-capacity state depends on the machine's real RAM, so the scenario does not force it; vitest covers
  that logic. The CDP harness needs WebView2 (Windows). On macOS (WKWebView, no CDP) the change is checked
  by running `task dev` and screenshotting the live app with `screencapture`.
- **Docs** — `docs/orchestrator-guide.md` gains a short paragraph where it covers parallelism: what the chip
  and the warning mean, and the formula.

## Out of scope

- The engine refusing or delaying a spawn on low memory.
- Persisting measured peaks across restarts.
- A `wsh` command for the capacity (the RPC makes it a thin addition later).
- Counting the lead agent or non-orchestrator agents in the estimate.
