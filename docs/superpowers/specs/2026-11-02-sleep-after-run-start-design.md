# Sleep a brainstorm's agent once its run starts

**Status:** design approved in a brainstorm, 2026-11-02.

## Intent

Once a brainstorm's Approve has started its run, the agent that ran the brainstorm goes to sleep 15 seconds later.
Once the run is going, the person usually no longer cares about the old idea, so keeping that agent's process alive
only holds RAM.

## Background

### How sleep works today

`pkg/wshrpc/wshserver/wshserver_agentsleeploop.go` ticks once a minute (`sleepLoopEvery`). It puts an agent to sleep
when the agent is idle (not waiting on a permission), is not a run's own agent, is not on a tab being viewed, has had a
quiet process tree for 5 minutes, has no background tasks or subagents running, and has been idle for "After idle for"
(`agents:sleepaftermin`, default 30 min, floor 5). Below 1 GB of free RAM, the longest-idle eligible agent sleeps after
1 minute idle. Sleep ends the process and keeps the tab, the transcript and the conversation. Wake, or any message,
relaunches the agent with `--resume`.

The Sleep button goes through `AgentsSleepCommand` (`wshserver_agentsleep.go:287`). It runs `sleepRefusal`,
`sleepAfterCompaction` (which compacts a big warm Claude context first) and `sleepAgent` (`:220`). `sleepAgent` refuses
when there is no session to resume, and returns `Background` without sleeping when background work runs and `force` is
false.

`SLEEP_TIMEOUT_MS = 15_000` in `frontend/app/view/agents/agentsleep.ts` is only the RPC timeout of the manual Sleep.
It is unrelated to this design.

### How a brainstorm starts its run

`approveAndOpenRun` sends `brainstorm: approved`. `openRunLauncher` (`frontend/app/view/agents/brainstormsend.ts:102`)
then opens the launcher with a handback. On a successful `CreateRun`, `handBack` (`launcherrun.ts:51`) calls
`handback.started(runId)`. That marks the starting run and sends `brainstorm: run <id>` to the agent (`notifyRun`,
`brainstormsend.ts:95`). The agent spends one turn writing the id into its `brainstorm.json`. A message to a sleeping
agent wakes it (`sendBrainstorm`), so later lines still reach it.

### Where agent status passes through wavesrv

Every `agent:status` event goes through `publishEvent` (`pkg/wshrpc/wshserver/wshserver.go:188`). After the publish,
`publishEvent` hands the event to per-block hooks (`noteAgentTurnEnded`, `noteAgentInTurn`, the orchestrator's hooks).
`statusBlockId` maps the event's ORef to its block.

## Design

### Which agents

Only the agent whose brainstorm started the run from its approve bar goes to sleep. That covers both Approve and the
**Change** link (`brainstormcheck.tsx:383`), which open the same launcher through `openRunLauncher` (builder question
2). Every other agent, including one that runs `wsh runs start` itself, keeps the normal 30-minute rule.

### Where the countdown lives

The countdown lives in a server timer that the handback arms.

1. In `openRunLauncher`'s `handback.started`, the frontend first calls a new wshrpc command and waits for it. The
   command names the agent's tab (as `AgentsSleepCommand` does), the run id and the brainstorm.json path (for example
   `AgentsSleepAfterRunCommand { tab, runid, path }`). Only after that does `notifyRun` send `brainstorm: run <id>`, so
   the arm is in place before the run-id turn begins. A failed arm is logged and goes no further: the run-id line is
   still sent, and the run's start is unaffected.
2. wavesrv resolves the tab to its row and records an armed entry `{ blockId, runId, path, armedAt }` in memory. The
   natural home is next to the sleep loop's pending compactions in `wshserver_agentsleeploop.go`.
3. `publishEvent` hands each `agent:status` event to the armed-entry check after the publish, as it does for
   `noteAgentTurnEnded`. The countdown follows the turn that records the run, not just any turn end (Agent's call,
   builder question 1). For an armed block, the check works like this:
   - At each `idle` whose hook is not `SessionStart`, wavesrv reads `path`. Once its `run` field holds `runId`, a
     15-second timer starts. An earlier turn that ends without it does not start the timer: for example the
     `brainstorm: approved` turn, or a message typed while the launcher was open.
   - A `working` while the 15-second timer runs (the person typed to the agent) cancels the timer and drops the entry.
     The 30-minute rule takes over.
   - If the agent has already recorded the run and gone idle when the arm lands, the 15 seconds start at once. The arm
     reads the block's latest status and the file.
4. When the timer fires, wavesrv rereads the roster and checks the setting, `sleepRefusal` and the background work
   (below). If all of these pass, it calls `sleepAgent(ctx, row, false)` directly.

If the run id is not recorded within 10 minutes of arming, the entry is dropped. A wavesrv restart drops every armed
entry, and the 30-minute rule covers that agent.

If the agent was asleep when `brainstorm: run <id>` was sent, the wake runs a turn, and that turn arms and fires the
countdown the same way.

### On screen or not

The agent sleeps when its 15 seconds are up, whether or not its tab or brainstorm pane is on screen. The viewing rule
does not apply.

### No compaction

This sleep never compacts first. It calls `sleepAgent` directly, not `sleepAfterCompaction`. The agent sleeps with
its conversation as it is.

### What still stops the sleep

These are the same checks as the Sleep button's, with no `force`:

- `sleepRefusal`. The agent is not slept if it is already asleep, works for a run, runs a harness that cannot resume,
  or is not idle (for example, it is waiting on a permission).
- `sleepAgent` refuses when the agent has no session to resume.
- `sleepAgent` returns `Background` (and does not sleep) when background tasks or subagents still run.

In each case the entry is dropped, wavesrv logs why, and the 30-minute rule takes over. The person sees nothing.

### The on/off switch

This sleep follows Sleep idle agents (`agents:sleepidle`, read through `currentSleepSettings().Enabled`). When that
setting is off, the agent stays awake after its run starts, and the check happens both at arm time and at fire time.
There is no new setting.

### What the person sees

When the agent sleeps, its row shows the moon as for any sleep, and wavesrv raises the same info notice as the sleep
loop: title `Put <name> to sleep`, message `freed N MB` (`formatFreed`). A sleep that was skipped shows nothing and
only logs why.

## Left to the builder

- The new wshrpc command's name and data type. Run `task generate` after adding it.
- Where the armed map lives, and how `publishEvent` hands it each `agent:status` event.
- How the timer fire reaches `publishNotice`. The sleep loop receives its notifier from `cmd/server/main-server.go:565`,
  so this needs a similar seam.
- The 15-second and 10-minute constants.
- Go tests that drive the arm → idle-with-run-recorded → timer path on a fake clock. These cover: an idle before the
  run is recorded is ignored, an arm that lands after the run is recorded and the agent is idle, cancel on `working`
  inside the 15 seconds, the 10-minute drop, the setting off, a `SessionStart` idle ignored, and background work
  skipped.
- A vitest that checks `handback.started` arms once, and before `brainstorm: run <id>` is sent.
- A `CHANGELOG.md` line under `Changed`.
