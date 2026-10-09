# Heavy job queue — design

Status: design settled 2026-10-09.

## Problem

With two or three orchestrator runs going at once, their builds, typechecks and whole test suites start
together and the machine stalls. `wsh memgate` (`pkg/memgate`) already sees every heavy shell command an
agent runs, but it only compares one command's RAM peak with the RAM free at that moment; it knows nothing
of the heavy commands already running, so concurrent runs pass the gate side by side. The engine's own
Setup / Verify / Final commands (`pkg/orchestrate/plancmd.go`, `verify.go`, `final.go`) do not pass it at all.

RAM is not what stalls this machine. On the 32 GB, 6-core Windows box the chip read 6.3 GB free (the reading
is fresh: `ullAvailPhys`, polled every 5 s) while disk time stood at 515% and paging at ~670 pages/s:
`go build`, `cargo`, `tsc` and vitest each take every core and hammer the disk, and Defender scans what they
write. Two of them at once is enough. memgate's peaks were measured for an 8 GB Mac and rarely bind here.

Wanted: heavy jobs from every source wait in one queue and start one at a time (a setting), and the person
can see the queue — what runs, what waits, why, for whom — from the app bar, beside the version pill and the
RAM chip.

Out of scope: commands the person types in a terminal (no hook sees them); long-running dev servers
(`task dev`, `tauri dev`), which would hold a slot forever; CPU-load-based admission.

## Decisions

### 1. One queue in wavesrv: `pkg/jobqueue`

Every heavy job asks wavesrv for a slot before it starts. FIFO. The head of the queue starts when both hold:

1. running jobs < `jobs:slots` (new setting, default **1**, range 1–4) — the gate that matters, for CPU and disk;
2. free RAM ≥ the job's peak + `memgate.Headroom` (`memgate.Fits`) — kept for small-RAM Macs.

The queue is re-evaluated whenever a slot is released and on a 5 s RAM reading. Admission is a pure
function, `admit(queue, running, slots, available)`, so it is table-tested apart from the plumbing.

What counts as heavy: `memgate.Classify`, unchanged, minus the dev-server jobs (`task dev`, `tauri dev`).
The engine's Setup, Verify and Final always count, with the peak of `scripts/verify.mjs` for Verify and of
`task dev` for Final (it starts a dev app). The job carries its source: agent block id and name, or run id,
task and step.

### 2. A slot belongs to a live process

| Source | Where it asks | When it releases |
|---|---|---|
| Claude agent, Bash / PowerShell | the arc mod's `tool.call` hook, which wraps `next(e)` | when `next(e)` settles |
| pi agent, bash | `tool_call` in `pi/extensions/waveterm-tools.ts` | on the `tool_result` with the same tool call id |
| Engine Setup / Verify / Final | in Go, around the command | `defer release()`; a cancelled ctx leaves the queue |

The hooks spawn `wsh jobslot -- <command>` and keep it alive while the command runs. It prints one JSON line
per state — `{"queued":2,"behind":"task check:ts","for":"run 700db4"}` while it waits, `{"run":true}` when
granted, `{"run":false,"reason":…}` when skipped — and stays alive until the hook kills it. wavesrv ties the
slot to that wsh's RPC connection: when the process dies (the command finished, the agent crashed, the tab
closed) the slot comes back. As a backstop an agent slot held over 60 min is reclaimed and logged; engine
slots live by their ctx and are never reclaimed.

A Claude command started with `run_in_background` returns from `next(e)` at once, so its slot is released
early. Accepted for the first version.

### 3. No Low RAM card

The Low RAM card goes. A waiting job waits with no time limit; the agent's transcript shows
`Queued #2 — waiting behind task check:ts (run 700db4)` (Claude via `$.ui.log`, pi via its status line). The
person can Run now or Skip from the popover. A skipped agent command is refused with memgate's existing
wording: do not retry, carry on, say in the report that it was skipped.

### 4. The Jobs chip and popover

The chip sits in `app-bar.tsx` between `VersionMismatchPill` and `WorkerCapacityChip`, styled like the RAM
chip. It shows only when something runs or waits: `1 running`, or `1 · 2 queued`; warning tone once a job
has waited over 5 min.

A click opens a popover in the manner of the Consumers panel: running jobs first, then the queue in order.
Each row shows the job name, its RAM peak, elapsed or waited time, its source, and while waiting the reason
(`slot busy`, or `needs 3 GB, 1.8 GB free`). ↗ opens the agent or run through `openTarget`
(`frontend/app/view/jarvis/openref.ts`). A queued row has **Run now** (starts it past both gates) and
**Skip**; an engine Verify / Final row has Run now only, since skipping Verify would break the merge.
A Slots picker (1–4) in the header writes `jobs:slots`, effective at once.

Data: wavesrv publishes a `jobqueue` event on every change; `jobqueuestore.ts` (always-mounted shell, not a
surface) loads it once with `GetJobQueueCommand` and follows the event. `JobQueueRunNowCommand` and
`JobQueueSkipCommand` act on a job. Labels, reasons and ordering live in a pure `jobqueue.ts`.

### 5. Failure stays open

As with memgate, a broken queue never blocks an agent: if `wsh jobslot` fails (an older wavesrv, no
connection) the hook lets the command run and logs at debug. A wavesrv restart empties the queue; waiting
`wsh jobslot` processes lose their connection and let their commands run.

## Files

- New: `pkg/jobqueue/`, `cmd/wsh/cmd/wshcmd-jobslot.go`, `pkg/wshrpc/wshrpctypes_jobqueue.go` and its
  server handler, `frontend/app/cockpit/jobqueue{.ts,.test.ts,store.ts,chip.tsx,popover.tsx}`.
- Changed: `claude/arc-mod/hooks/register.ts` (`memgate-core.ts` becomes `jobslot-core.ts`),
  `pi/extensions/waveterm-tools{,-core}.ts`, `pkg/orchestrate/{plancmd,verify,final}.go`,
  `frontend/app/cockpit/app-bar.tsx`, `pkg/wconfig` (`jobs:slots`), then `task generate`.
- Removed: `cmd/wsh/cmd/wshcmd-memgate.go`, `pkg/memgate/card.go` and its test; the ask's `Hold` flag goes if
  nothing else uses it.
- Docs: the memgate gotcha in `AGENTS.md`, a line in `CHANGELOG.md`.

## Testing

- `pkg/jobqueue`: table tests of `admit` (FIFO, slots, RAM, Run now, Skip); a slot returns when its
  connection drops; reclaim after 60 min on a fake clock; a cancelled engine ctx leaves the queue.
- Hooks: `jobslot-core.ts` line parsing and refusal text, vitest, in both the Claude mod and pi.
- Frontend: `jobqueue.test.ts` for the chip label, wait reasons and the warning threshold.
- UI: a `jobqueue-chip` scenario in `scripts/cdp/scenarios.mjs` seeds a queue and shoots the chip and popover.
