# Orchestrator run efficiency

Status: shipped 2026-10-05, at a much smaller scope than first written. The first version (Writes declarations
with an ownership preflight, a routing preview RPC with per-task fingerprints, new cockpit states, a shared CDP
fixture module) was reviewed against run history before any of it was built and cut down to the four changes
below. "What was cut" records why.

## Goal

Stop orchestrator runs losing time and money to things the engine can prevent, without weakening plan review,
task review, merge Verify or Final. No speedup is promised: the evidence is run history, not a benchmark.

## Evidence

From the plan-reviewed events of the 26 runs in the packaged Arc store, 2026-09-25 to 2026-10-05:

| Outcome of plan review                    | Runs |
| ----------------------------------------- | ---: |
| Passed in round 1                         |    7 |
| Failed round 1, passed round 2            |   10 |
| Failed both rounds, accepted by the human |    9 |

- 10 of those runs had workers on Reviewer picks. The 4 accepted after a failed review got no reviewer-picked
  model on any task, because a fail could carry no picks and an accept applied none.
- 7 of the 19 round-1 failures cited two parallel tasks editing one file. In every one it was one of two to five
  findings, so the review would have failed without it.
- The only merge failures recorded (3 events, one task) came from uncommitted changes in the main checkout, not
  from overlapping tasks.
- In the baseline run `13284ff4` (66 minutes), the CDP scenario worker spent about 7.6 minutes working out fixture
  setup. The helper it needed, `arrangeSheetDagRun`, already existed. Why it was not used was not established.

## What changed

### 1. A failed plan review keeps its model picks

On a Reviewer picks run the reviewer now picks models whatever its verdict. A pass still needs a pick for every
task without a Model line. A fail may pick for only the tasks it can judge.

A fail's picks are applied to the tasks in the same write, like a pass's. This is safe because a failed review
holds every worker:

- A resubmit replaces the task list, so the old picks go with it and the next round's reviewer picks again.
- `planreview accept` changes only the review's state, so dispatch starts on the picks already on the tasks.
- A task the fail left out stays on the lead's route.
- The owner can still change any waiting task's model from the banner, before or after the accept.

There is no freshness check. The lead amends tasks with the findings it accepts before it runs accept; a pick
that went stale on every amend would be dropped for most tasks of exactly the runs this is for (the baseline's
lead amended five of its six). A finding carried into a task rarely changes whether the task is mechanical.

`accept` takes no picks. The model-picks banner no longer says the review passed.

Code: `pkg/orchestrate/planreview.go` (`RecordPlanReviewVerdict`, `validatePicks`, `planReviewPrompt`),
`cmd/wsh/cmd/wshcmd-jarvisdag.go`. Guide: "Model picks" in `docs/orchestrator-guide.md`.

### 2. The plan format states the one-owner rule

The plan reviewer already fails a plan in which two tasks with no Depends between them edit one file. The plan
format (`jarvis.PlanFormat`) never told the lead that. It now does, generated files included.

### 3. The CDP run fixture recipe is written down

`docs/reference/cdp-run-fixtures.md` describes the existing arrange, seed and teardown helpers and their rules,
and `AGENTS.md` links it from the visual-verification section. No code was extracted.

### 4. A scenario teardown that throws fails the run

`scripts/cdp/verify.mjs` logged a thrown teardown and still exited 0. It now records a failed `teardown` step,
which reaches the table, `shots.json` and the exit code through the existing report code.

## What was cut

- **Writes declarations and ownership preflight.** The reviewer already catches the overlap, it was never the
  only finding, and no merge failed because of it. Item 2 is the cheap part of the idea.
- **Routing preview RPC, preview ids, input fingerprints.** They guarded picks against amendments, which is the
  case item 1 has to serve.
- **New cockpit states** for ownership coverage, proposals and fallback sources. There is no new state left to
  show. Their design canvas was deleted.
- **A shared `run-fixtures.mjs` module.** The helpers exist; what was missing was a pointer to them.

## Not done

- `teardownFixtureRun` still logs its own failed steps instead of throwing, so a leaked channel or temp dir from
  that helper does not fail the scenario. Making it throw could turn a locked temp dir on Windows into a red
  Final, so it wants a run of the affected scenarios first.
- Nothing here addresses the largest cost in the table above: 19 of 26 plans fail their first review, mostly on
  contradictions between spec and plan and on acceptance steps no scenario shows. That needs its own look.
- Whether item 3 shortens fixture setup is unmeasured. Check the next run whose plan adds a run-sheet scenario.
