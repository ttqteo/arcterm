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
