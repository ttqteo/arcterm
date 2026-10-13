# CDP run and DAG fixtures

How a `scripts/cdp/scenarios.mjs` scenario gets a run with a DAG on screen. The helpers already exist in that
file; reuse them instead of working the setup out again. The runner is `scripts/cdp/verify.mjs`
(arrange → goto → shot → assert → teardown).

## The recipe

`run-timing` is the smallest complete example: copy its shape.

```js
const myScenario = {
  name: "my-scenario",
  surface: "jarvis",
  async arrange(h) {
    const ctx = await arrangeSheetDagRun(h, "my-scenario", RUN_SHEET_POLISH_TASKS);
    if (ctx.arrangeError != null) return ctx;
    // wait here for the element the scenario is about, and record whether it showed
    return ctx;
  },
  async assert(h, ctx) {
    const steps = [];
    steps.push({
      step: "0. the run's sheet opened",
      ok: ctx.arrangeError == null && ctx.opened?.ok === true,
      detail: ctx.arrangeError,
    });
    await h.shot("cdp-shots/my-scenario-state.png");
    return steps;
  },
  async teardown(h, ctx) {
    await teardownFixtureRun(h, ctx, "my-scenario");
  },
};
```

Add the scenario to `SCENARIOS`, or `verify.mjs` and a plan's Final never run it.

## What each helper does

- **`arrangeSheetDagRun(h, label, tasks)`** makes a temp dir, a channel on it, a deferred orchestrator run
  (`deferstart: true`, so no lead starts) and a DAG from `tasks` (`dagsubmit`, parallelism 1). It reloads the page,
  because the Brief reads a boot-primed snapshot, and opens the run sheet through `window.__openAddress("run:<id>")`.
  It returns `ctx` with `cwd`, `channelId`, `runId` and `opened`. A throw lands in `ctx.arrangeError` and `ctx` is
  still returned, so teardown removes whatever was made. `RUN_SHEET_POLISH_TASKS` is a chain of three no-op tasks:
  only `t-1` dispatches a worker.
- **`waveService(h, service, method, args, uicontext)`** calls `/wave/service` with the page's auth key, for what
  no wshrpc command does (`object.GetObject`, `object.UpdateObject`). `UpdateObject` refuses a call without a
  `uicontext`.
- **`seedFinalShots(h, ctx, state)`** is the pattern for putting a stored DAG into a state the engine has not
  reached: read the DAG, write it, read it back, and retry a bounded number of times, since the watchdog ticks a
  running DAG and a tick that read it first lands over the write. It then bumps a meta key with `setmeta`:
  `UpdateObject` publishes nothing, and a meta write sends the whole stored DAG to the page.
- **`teardownFixtureRun(h, ctx, name, restore?)`** cancels the run, deletes its worker blocks and the channel,
  reloads onto the live roster and removes the temp dir. It attempts every step even when one fails. Pass
  `restore` (`{ what, fn }`) for UI state the scenario changed.

## A run with a final stage

`final-stage` is the example. Two things in the engine decide how such a fixture is built (`pkg/orchestrate/final.go`).

1. **The engine acts on a dag that is `finalizing`.** Every tick starts the stage's commands when none are running,
   and tends a real verifier session while the stage is `verifying`, or `checking` with `final.tree` set. A seeded
   finalizing dag is run, not left alone, and a seeded `final.tree` on one spawns a verifier.
2. **A run's events cannot be written through an RPC.** The page appends every `run:event` wave event it receives
   to that run's list (`runeventstore.ts`), so `eventpublish` with a `RunEventData` payload stands in for a
   `final-step` event until the next reload. The first load of the run's history replaces the list, so publish
   again until the step's time shows (`fstUntil`'s `nudge`).

So there are two fixtures, and `final-stage` uses both on one run.

- **A state the engine has not reached** (`fstShow`): seed `final`, `pastfinals` and the plan's commands with
  `seedDag` on a dag that still has a task at work, as `final-shots` does. That dag is never finalizing, so the
  engine never touches its `final`, and the cockpit draws the stage from its state alone. Publish the round's step
  events for the times. A verifier's session is a deferred quick run with `stagerole` and `dagoref` written through
  `object.UpdateObject` (`fstWriteRun`, which also sends the stored run to the page), and a roster agent whose
  `runId` is that run's id.
- **A stage the engine really runs** (`fstStartLive`): the temp dir is a git repository with one commit before the
  run is created, since the stage needs a tree. Seed every task `done` and `merged` with its `runid` removed (a
  tick derives a task's state from its child run), `status: "finalizing"`, a `verify` that keeps writing, a
  `finalcmd`, and no `final`. The next watchdog tick (30 seconds at most) starts round 1: the Tree step and its
  `final-step` event, then Verify with `final.step`, `stepts` and `output`. With a Final command the stage records
  no tree until its commands end, so no verifier is tended. The run lands on its own branch by default, so the
  stage's tree is that landing tree. It runs on the dev app's wavesrv, not under a Go test, so the tree is under
  the real `%LOCALAPPDATA%\arc-wt\<first 8 of run id>` (the full id if another run owns the prefix), not in the
  temp dir, and t-1's lane tree sits beside it as `<8>-t-1`. Removing the temp dir does not remove them, and
  neither does `cancelrun`: `Cancel` (`pkg/orchestrate/mutation.go`) removes only the dag's task trees, and only a
  land (`removeLandedTree` in `land.go`) removes the landing tree. So `teardownFixtureRun` removes the run's
  `landpath` (recorded by `arrangeFixtureRun`) and every linked worktree of the temp repo before it removes the
  temp dir, and throws if any is left. `final-stage`'s step 0b checks the landing tree is under the arc-wt root.
  - The output tail is published from the command's own writes: the first write at once, which carried one line of
    a three-line `printf`, then at most every 10 seconds, and a publish that finds the dag lock held is skipped. A
    command that prints and then sleeps shows its first line and nothing more: keep it writing, and wait for the
    line the scenario reads.
  - The seed's fingerprint must leave out `status` and `final`, which the engine owns from its first tick.
  - Ending the stage as unverified makes the dag done. A run with no lead is then completed by the engine and no
    lead is launched; ending it as failed launches one. Do it last: the run is over afterwards, so teardown's run
    cancel has nothing to cancel, and the child run of the task the seed unlinked is cancelled on its own, or its
    worker keeps the lane's tree and the temp dir cannot be removed.

## Rules

- **Wait for what is visible, not for the write.** A finished RPC, a reload or a fixed sleep is not readiness.
  Poll for the element and record the outcome in `ctx`, then assert it as step 0 with what was observed.
- **Clean up only what the scenario made.** Record ids and paths in `ctx` as they are created. Never find a
  fixture by its label.
- **A teardown that throws fails the scenario** as a `teardown` step, in the table and in `shots.json`.
  `teardownFixtureRun` still logs its own failed steps without throwing.
- **Fixture images stay out of `cdp-shots/`.** A scenario that needs PNGs as data writes them to a temp dir.
  Only shots under `cdp-shots/` enter the manifest (`shotsUnder` in `report.mjs`).
- **A seeded DAG proves the UI, not the engine.** It shows how the cockpit draws that state. Engine behaviour
  (dispatch, ingestion, restart) needs a Go test on the real store and scheduler.
