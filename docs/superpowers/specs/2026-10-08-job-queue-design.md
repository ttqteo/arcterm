# Job queue — design

Status: design settled 2026-10-08.

## Problem

Three orchestrator runs on one machine each run their heavy commands whenever they reach them. On
2026-10-08 a worker's `final-verify` (a whole dev app: `go build` wavesrv, `cargo tauri dev`, Vite,
WebView2) ran beside the other runs' Verify stages and agents' typechecks, and the machine stalled: the
engine's own `git rev-parse` and `git worktree add` hit `context deadline exceeded` (waveapp.log 16:03,
16:08), and Code's file listing timed out with "Could not list files: EC-TIME: timeout waiting for
response" — a listing that takes under 2 s on an idle machine.

What exists today does not queue:

- `final-verify.mjs` takes a machine-wide build lock (a named pipe), but gives up after 10 minutes and
  reports unverified, and nothing else takes it.
- `wsh memgate` sees every agent shell command and knows the heavy ones (`pkg/memgate`), but only asks
  the person when RAM is short; with RAM free, any number run at once.
- The engine's Setup/Verify/Final stages run whenever their run reaches them.

Wanted: every heavy job on the machine waits its turn in one queue, a fixed number at a time (1 by
default), and a footer button shows the queue and lets the person reorder, remove, stop, and change the
number of slots.

Out of scope: queueing by RAM budget (the slot count is the policy; the RAM gate stays as it is);
background commands and dev servers; persisting the queue across a wavesrv restart; priorities beyond
"move to front".

## Decisions

### 1. The queue: `pkg/jobqueue`, in wavesrv, in memory

A lease is one heavy job: its name (the memgate job name, e.g. `final-verify`, `task check:ts`), its
owner (an agent's block oref, or a run id and task id for an engine stage), the PIDs its holder reported
(below), and when it queued and when it was granted. The queue is FIFO over waiting leases and grants
while running leases are fewer than the slot count.

- Slots come from the setting `jobqueue:slots` (1–4, default 1; `*int64`, the only integer kind
  `SetConfigCommand` converts; machine-local, since another machine's CPU is not this one's). Raising it
  grants at once; lowering it stops nothing running and grants nothing until the running count is under
  the new number. The queue reads it through `wconfig.ConfigHook`.
- A dev server is not a job: memgate classifies `task dev` as heavy for the RAM gate, but it never ends,
  so it gets no lease.
- Every change publishes the `jobqueue` event with the whole queue (running and waiting, in order).
- `JobQueueListCommand` returns the same snapshot; `JobQueueActionCommand` takes `front`, `remove`,
  `stop` (each with a lease id) and `slots` (with a number).

### 2. Three doors in, one queue

**Agent shell commands (Claude).** The Claude mod's `tool.call` hook for Bash and PowerShell runs
`wsh jobs hold -- <command>` after the RAM gate. `hold` classifies the command with memgate's table; a
light command, a background command (`run_in_background`) or a dev server (`task dev`) gets `run` at
once and no lease. A heavy one opens a lease and prints hold lines (`waiting: 2nd, behind final-verify
of Settings Redesign · Task 5`), which the mod logs as it does memgate's, then `granted`. The mod then
calls `next(e)` — the command runs, and Claude's Bash timeout starts only now — and when `next(e)`
settles it ends the `hold` process, which releases the slot.

**Agent shell commands (pi).** The tools extension does the same around a bash call: `hold` starts in
`tool_call` and ends in `tool_result` for that tool call id.

**Engine stages.** Verify (at a merge, in a bisect, and in the final stage), Check and Final
(`pkg/orchestrate`) take a lease in-process before their command runs, owned by the run and task. Their
timeouts already start when the command starts (`execPlanCommandEnv`), so they start at the grant. The
watchdog's Verify clock (`landing.since`, `overdueVerifies`) is reset at the grant, or a Verify that
waited 20 minutes in the queue would be reported stuck. The project's landing claim stays held while its
Verify waits: the merges it guards cannot proceed anyway.

`hold` is one streaming RPC, `JobQueueHoldCommand`: the server streams the position, then the grant, and
the lease lives as long as the handler's context. A `hold` that exits for any reason (the mod ends it,
the agent dies, its stdin pipe closes because the parent is gone) releases the slot. Engine leases
release by `defer`.

That needs a fix underneath: today a `wsh` that dies does **not** end its request contexts. Its domain
socket teardown (`handleDomainSocketClient`, `pkg/wshutil/wshutil.go`) only unregisters the link; only a
websocket teardown calls `CancelRequestsForLink` (`pkg/web/ws.go`). So the domain socket teardown also
cancels the link's requests, through a hook `main-server.go` sets (wshutil cannot import wshserver). This
also ends the leak where a dead `wsh ask --wait` or `wsh agentctl` kept its handler alive until its
timeout.

The wire types live in `pkg/wshrpc` (`wshrpctypes_jobqueue.go`): the generated Go client imports only
`wshrpc` and its siblings.

`final-verify.mjs` joins memgate's table (as heavy as `task dev`), so a worker that runs it itself waits
like any other heavy command. Its own build lock stays: with more than one slot, two Finals still must
not share the cargo target dir at once.

### 3. Nested jobs do not deadlock

A job holding a slot can start another heavy command (a lead running `claude -p` whose Bash runs the
typecheck). With one slot that would wait forever on its own parent. `hold` sends its chain of ancestors
as (PID, create time) pairs, nearest first, and each agent lease records its root (the `hold`'s parent:
the claude or pi process) and its grant time. A new job is a lease's child when the lease's root appears
in its chain **and some ancestor between the two was created at or after that lease's grant** — that
ancestor is a process the leased command started. It runs at once and takes no slot.

The second condition matters: Claude runs parallel Bash calls from one agent, and a second heavy call
from the same agent has the same root in its chain, but nothing between it and the root was started by
the leased command, so it queues. Engine leases have no root and never parent a job (an engine stage's
commands never pass through a hook).

### 4. The footer button

A chip in `FooterStatus` (`frontend/app/cockpit/footerstatus.tsx`) between the RAM chip and the
version, so both hints bars show it. Idle it is a muted icon; busy it reads `▶1 · 2 waiting` and takes
the accent tone while anything waits. A click opens a popover anchored above it, like the Consumers
panel:

- Header: `Job queue · slots [−] 1 [+]`, writing `jobqueue:slots`.
- Running rows: job name, owner (the agent's name, or `run title · Task N`), elapsed, **Stop**.
- Waiting rows: position, job name, owner, time waited, **↑ Front**, **✕ Remove**.
- The owner opens its agent or run through `openTarget` (`view/jarvis/openref.ts`). The server sends an
  agent owner as its block oref and an engine owner as run id, task id and a label (`<goal> · Task N`);
  the frontend names an agent from its roster (`agents.find((a) => a.blockId === blockId)`), which also
  gives the tab id `openTarget` needs, and shows "agent" for one no longer in the roster.

Elapsed and waited times tick in the frontend from the event's timestamps.

### 5. What each action does

| Action | Agent command | Engine stage |
|---|---|---|
| Front | runs next | runs next |
| Remove (waiting) | the hook denies the command: "the person removed this command from the job queue; don't retry it — carry on and report it skipped" | Final and Check report unverified with that reason; a merge's Verify leaves its tip `verify-failed` with the reason `removed from the job queue`, **without** waking the lead (nothing is wrong with the code), and Continue merge (`ContinueMerge` → `rerunVerify`) runs it again; a final-stage Verify reports unverified |
| Stop (running) | wavesrv kills the processes the lease's root started at or after the grant, deepest first, except the `hold` itself (gopsutil, with the PID-reuse guard of `devservers.Stop`; never by image name). The agent sees the command fail; the mod logs why. It can also catch something else the agent started in that window, which Stop's confirm says | the stage's context is cancelled with a queue error, so the outcome is Remove's, not a failure |

A cancelled stage reads as a failure today (`execPlanCommandEnv` wraps a cancel as a killed command), so
Remove and Stop end the stage's context with a cause the stage checks (`jobqueue.ErrRemoved`,
`ErrStopped`) before treating it as a failure.

### 6. Failure: a broken gate blocks nobody

As with memgate, `hold` failing to reach wavesrv exits nonzero and the hook lets the command run. A
wavesrv restart drops the queue; waiting `hold`s lose their connection and their commands run, so a
restart can let a few heavy jobs start together. Restarts are rare enough to accept that.

No wait is capped: an agent's command waits as long as the queue does, with its hold lines in the
transcript; an engine stage likewise, its timeout starting at the grant.

### 7. `wsh jobs`

`wsh jobs list` prints the queue (for agents and the terminal); `wsh jobs hold -- <command>` is the hook
door above. Both are thin over the RPCs.

## Testing

- `pkg/jobqueue`: FIFO, slot count up and down, front, remove, stop, release on context end, a nested
  job taking no slot — pure Go, no processes.
- Stop's process kill: a Go test builds a real process tree, stops it, and checks a process outside the
  tree survives.
- `pkg/orchestrate`: Verify and Final wait for a slot, their timeouts start at the grant
  (`finalCommandTimeout`), and Remove/Stop give the outcomes in the table.
- `wsh jobs hold`: a test in the style of `wshcmd-memgate-decide_test.go`.
- Hooks: the pure parts in `claude/arc-mod/hooks/jobqueue-core.ts` and the pi tools core, under vitest.
- Frontend: `jobqueue.ts` (chip label, row order, which actions a row offers) with `jobqueue.test.ts`.
- CDP scenario `job-queue`: type `wsh jobs hold -- "task check:ts"` into three terminal tabs of the dev
  app (a script outside the app has no `WAVETERM_JWT`; a terminal's shell does). One runs, two wait;
  `hold` runs nothing itself, so the scenario costs nothing. Shoot the chip and the popover, then Front,
  Remove and Stop, and assert the queue after each through `jobqueuelist`.

## Related

Code's "Could not list files: EC-TIME" is a symptom of the same overload; the queue removes the cause,
and `docs/open-issues.md` keeps an entry for Code reporting a stalled backend more plainly.
