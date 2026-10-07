# Agent restore after an app restart

Status: design agreed 2026-10-07. Not built.

## Problem

Quitting arcterm, most often to install an update, leaves every hand-launched agent to be brought back one by one:

- **Only the agents on screen come back.** Resume-on-reopen (`session-models/agentresumestore.ts`) bakes
  `--resume <id>` (claude, opencode) or `--session <path>` (pi) into a block's `cmd:args`, but the relaunch fires from
  `termwrap.ts`'s first real fit (`resyncController("initial resize")`). A pane that is `hidden` has no size, so
  `handleResize` skips it and the agent stays dead until the user clicks it.
- **A resumed agent sits idle.** The turn it was in was cut off; the user types `continue` (the rail's Resume) into
  each one.
- **State hangs on "working".** `agent:status` is retained only in wavesrv's memory (`wps.PersistMap`), so nothing
  records what an agent was doing when the app went down, and an agent can read "working" after a restart with no
  process behind it.

`doShutdown` cannot be relied on to record anything: `task install` closes the app abruptly.

## Scope

Hand-launched claude, pi and opencode agents. Orchestrator workers (blocks with `agent:runid`) keep their own
recovery: a Quick run, or an orchestrator run before `dag submit`, comes back Blocked with **Interrupted by
restart** and a per-run **Resume**; after `dag submit` the engine marks the task Stalled and retries it
(`docs/orchestrator-guide.md`, "The app restarted mid-run"). The banner below only points at those runs.

Out of scope, filed in `docs/open-issues.md`: a DAG task retried after a restart starts its task over instead of
resuming the worker's session.

## Design

### 1. Last state, written on transition

- A new block meta key `agent:laststate` (Go definition, then `task generate`).
- `EventPublishCommand` (`pkg/wshrpc/wshserver/wshserver.go`) gains a third `agent:status` hook beside
  `retireAskOnResume` and `NoteLeadStatus`: `noteLastState`.
- States fold into two groups: **in turn** (`working`, `waiting`, `asking`) and **turn over** (`idle`). An in-memory
  map holds each block's current group; only a change of group writes `agent:laststate` to the block's meta, so a run
  of `PreToolUse` events costs no store writes.
- Writing on transition, not at shutdown, survives a killed app. A crash mid-turn records the agent as interrupted
  too.
- The process-exit `idle` (`shellcontroller.go`, `AgentStatusEvent`) is published straight to `wps.Broker`, not
  through `EventPublishCommand`, so killing processes at shutdown never overwrites the last state. A test pins this.
- Blocks with `agent:runid` are skipped.

### 2. Boot: seed state, reattach

- `AgentState_Interrupted = "interrupted"` in `pkg/baseds/baseds.go`.
- At wavesrv boot, before the frontend reads anything, for each agent block still in the workspace without
  `agent:runid`: an in-turn `agent:laststate` publishes a retained `agent:status` of `interrupted`; `idle` publishes
  `idle`. The roster has every agent from the first frame (today an agent not yet mounted has no status and drops out
  of it), and no restart can seed `working`.
- **Interrupted holds until a new turn.** While a block is interrupted, an incoming `idle` (claude's
  `SessionStart(resume)`, or any harness's equivalent) is published as `interrupted`, keeping the title and model it
  carries. Only `working` (a new turn: the user, or Continue, typed `continue`) or an explicit dismiss clears it.
- **Eager reattach.** The same boot pass calls `ResyncController` for each block that is claude, pi or opencode, has a
  resume key in its `cmd:args` (`--resume` or `--session`), and has no `agent:runid`, one at a time about 300 ms apart.
  The PTY starts at the block's stored term size; when its pane mounts, xterm fits and sends a resize as it does now.
- A block with no resume key (codex, or "Remember flags" off) is not started: a relaunch would replay its original
  task prompt. It still waits to be opened, as today.

### 3. UI

- `interrupted` gets its own badge, warning token, label "interrupted", no spinner, not counted as working.
- The rail footer's Resume (`railAction`) also applies to `interrupted`; it types `NUDGE_INPUT` as it does for idle.
- **Restore strip** in the always-mounted shell (`cockpit-root`), under the app bar, on every surface:
  *"3 agents interrupted · 2 runs blocked by restart"* with **Continue all** · **Show** · **Runs** · **Dismiss**.
  - **Show** focuses the first interrupted agent on the Agent surface, through `openref`.
  - **Runs** opens Runs on the runs Blocked by **Interrupted by restart**.
  - **Dismiss** calls a new RPC that clears every interrupted agent to `idle` (status and `agent:laststate`).
  - The strip hides once nothing is interrupted and no run is blocked by a restart.
- **Continue all** sends `continue` to each interrupted agent once it is ready: its controller is running and it has
  emitted a status since boot. One not ready is queued; past 20 s the strip says it could not come up and it stays
  interrupted. An agent with no resume key gets no Continue.
- A palette command: "Continue interrupted agents".
- The strip's derivation (counts, Continue targets, readiness) is a pure `restorebanner.ts` with tests beside it.

## Errors

- A failed `agent:laststate` write is logged. The worst case is the next restart showing that agent idle, today's
  behavior.
- A block whose resume fails (its session file is gone, the harness exits) stays interrupted; Continue skips it and the
  strip says the session is gone.

## Testing

- Go: a write only on a group change; `idle` while interrupted stays interrupted, `working` clears; the exit-path idle
  bypasses the hook; the boot pass picks the right blocks (skips `agent:runid`, skips no resume key) and staggers them.
- Vitest: `restorebanner.test.ts` (counts, Continue targets, readiness gate); the `interrupted` badge and rail action
  in `agentrailmodel.test.ts`.
- CDP: a new `agent-restore` scenario on a fixture with interrupted agents and a run blocked by restart, shooting the
  strip and the badge.
- Once by hand in the dev app: an agent mid-turn, kill the dev app by PID, reopen, confirm interrupted, the strip, and
  Continue.
