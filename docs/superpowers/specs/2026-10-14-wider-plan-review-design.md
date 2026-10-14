# Wider round-1 plan review, slim round 2

Effort: `c840ce9b-71a5-449b-be87-3f2d8212500c`, chunks 1 to 3 (the evidence and the decisions), chunk 4 (this build).

## Why

Round 1 runs one reviewer on the whole checklist. Across 67 finished runs, 26 of 59 failed both rounds and were
accepted. Round 2 is a fresh full review that cannot see what round 1 found, and it usually found new defects in
text round 1 had already passed. The 10-14 probes on runs 2ced4697 and 009152b3 found that each reviewer pass
surfaces a different subset of the defects, and that the gain comes from more independent passes, not from the lens
structure or the model. The decision has two parts:

- Round 1 keeps today's reviewer and adds four cheaper lens reviewers that run in parallel with it.
- Round 2 becomes one cheap reviewer. It confirms round 1's findings against the lead's diff and checks only the
  lines that changed.

Expected cost per run: a round-1 pass ~2.5M tokens (today 1.27M); the fail path ~3.8-4.5M (today 3.7-4.4M); round 2
~1 min instead of 2-3.

## Reviewers

Each plan-review session is a **reviewer**. Its key (`lens`) and title:

| lens | title | round | checks |
|---|---|---|---|
| `full` | Full review | 1 | the whole checklist, the spec-gap line, and model picks: today's prompt, unchanged |
| `spec` | Spec coverage | 1 | every requirement has a task; spec gaps and spec/plan contradictions |
| `order` | Task order and files | 1 | Files/Depends overlap (what Files lines leave out); names consistent across tasks |
| `tests` | Tests and commands | 1 | acceptance criteria and named tests; the named commands exist |
| `final` | Final coverage | 1 | the Final/scenario-step item and, with a Prototype, the board item |
| `followup` | Round-2 follow-up | 2 | see Round 2 |

**The checklist has one source.** `planreview.go` keeps each item once, tagged with its lens. The full reviewer's
prompt lists every item in today's order and wording, and today's prompt text does not change. A lens prompt lists
only its own items. The follow-up prompt lists every item as the standard for the changed lines. The spec-gap
sentence ("Also report gaps in the spec, and places where the spec and the plan contradict each other") is the
`spec` lens's item; the full and follow-up prompts keep it.

A lens prompt follows the probe prompts (`/tmp/prprobe/2ced/p-*.txt`), minus their run-specific parts. Same opening
and doc lines as the full prompt, then: "You are one of five plan reviewers working at the same time. Yours is
<title>. Check that: <items>. Report only problems in your area; the full reviewer and the other lens reviewers
cover <the other titles>. A plan with no problem in your area passes." Then the same read-only line, and the same
verdict command without `--pick`, under the same `MaxReviewNoteLen` limit.

Every reviewer ends with the existing `wsh jarvis dag planreview pass|fail "<text>"`. The engine finds the reviewer
by its run id among the round's reviewers. Only `full` (round 1) and `followup` (round 2) may send `--pick`; any
other reviewer that sends one is refused: "only the full reviewer picks models; send the verdict without --pick".

## Routes

- `full` runs on the reviewer route (`reviewerRoute`), as today.
- The four lenses and `followup` run on a new run setting, **Light reviewers**: `LightReviewerRoute *RoutePin`
  (`lightreviewerroute`). Nil means claude/sonnet (`LightPickRoute`), the measured setup, on every runtime. The human
  sets it to any route, claude or pi. This replaces deciding a pi equivalent in code: there is no mapping from a pi
  model to "its Sonnet", so the human names one.
- The setting follows the Reviewers setting through every layer. It is on the profile (global default and project
  override, `Light reviewers route` in the profile view, nil override = inherit). It is on create-run (both launch
  surfaces: `newruncontrol.tsx` and `runlauncher.tsx`, a `Light reviewers` model row beside `Reviewers`). It is on the
  run, carried onto the group at submit like `ReviewerRoute`. It is on run settings (the run sheet's edit row and its
  read-only summary, `SetRunSettings` applies it to run and group). The server validates it with
  `validateRoute("lightReviewerRoute", …)`. `routemigrate.go` is not involved: the field is born in the current pin
  format. `wsh runs` gets no flag (YAGNI: agents that start runs take the default).
- `StageSession` gains a `Route` pin. A zero pin keeps `reviewerRoute(owner, g)`, so the final verifier is
  unchanged. `spawnStageSession` resolves and validates whichever pin it is given, and the child run records it.
  Every plan-review child keeps `StageRole = plan-reviewer`, so usage attributes all five to the plan-reviewer
  role.

## Stage state

`waveobj.PlanReviewStage` becomes:

```go
type PlanReviewStage struct {
	State     string          `json:"state"`              // reviewing | passed | failed | accepted (unchanged)
	Round     int             `json:"round"`
	Findings  string          `json:"findings,omitempty"` // the round's merged text: findings on a fail, summary on a pass
	Reviewers []PlanReviewer  `json:"reviewers,omitempty"`  // this round's sessions; empty until the round's first tick
	PlanText  string          `json:"plantext,omitempty"`   // the plan as this round's reviewers read it
	SpecText  string          `json:"spectext,omitempty"`   // the spec likewise (empty with no spec file)
	Prior     *PlanReviewPrior `json:"prior,omitempty"`     // round 2: what round 1 found, read and picked
}

type PlanReviewer struct {
	Lens      string `json:"lens"`                // full | spec | order | tests | final | followup
	State     string `json:"state"`               // reviewing | passed | failed | lost
	Text      string `json:"text,omitempty"`      // its verdict text, or why it was lost
	RunID     string `json:"runid,omitempty"`
	StartedTs int64  `json:"startedts,omitempty"`
	Respawns  int    `json:"respawns,omitempty"`
}

type PlanReviewPrior struct {
	Findings string          `json:"findings"`         // round 1's merged findings
	PlanText string          `json:"plantext,omitempty"`
	SpecText string          `json:"spectext,omitempty"`
	Picks    []PlanReviewPriorPick `json:"picks,omitempty"` // round 1's picks, by task id and title
}

type PlanReviewPriorPick struct{ TaskId, Title, Model, Reason string } // json: taskid, title, model, reason (not PlanReviewPick: runtimeline.ts exports that name)
```

The top-level `RunID`, `StartedTs` and `Respawns` move into `Reviewers`, and every reader moves with them:
`childRunIDs` (cancel stops every reviewer), the `dag status` line, and the frontend. The generated files are
regenerated with `task generate`.

**A stage stored before this change** has `RunID` set and no `Reviewers`. On its next tick the round's reviewers
start as for a fresh round. The old session's verdict is then refused as "not reviewing", and it is not stopped.
This is acceptable for the one upgrade window.

**Doc capture.** On the round's first tick, `advancePlanReview` reads the plan and spec (`DocPath` in the landing
tree) into `PlanText`/`SpecText` before it starts the reviewers. That is the text the reviewers read, and the text
round 2 diffs against. A read error is logged and leaves the text empty: the reviewers fail on the same missing file
and report it. On pass or accept, `PlanText`, `SpecText` and `Prior` are cleared: they only serve round 2. A failed
round 1 keeps them so the resubmit can carry them over.

## Round 1

1. The first tick creates five reviewers in `reviewing`, captures the docs, and tends each reviewer with the
   existing `tendStageSession`, which gets pointers into that reviewer's fields. Each reviewer gets the one respawn
   every stage session gets, and the same `ReviewTimeout`.
2. **A verdict** (`RecordPlanReviewVerdict`) is recorded on its reviewer: its state and its text, still refused over
   `MaxReviewNoteLen`. The full reviewer's picks are validated and applied with its verdict, as today. A pass needs a
   pick per pickable task; a fail may carry some. The round settles if this was the last reviewer outstanding.
3. **A lost reviewer** (`tendStageSession` gives up) becomes `lost`, and its `Text` says why. **A lost lens does not
   fail the round**: the round is judged on the others, and the merged text and the event name it. The full
   reviewer covers its area, so the round keeps at least today's coverage. A lost `full` fails the round, as a lost
   reviewer does today.
4. **The round settles** once no reviewer is `reviewing`, in either the verdict RPC or the tick (whichever records
   the last outcome), through one function:
   - **pass**: `full` passed and every lens passed or was lost. State `passed`, `Findings` = the full reviewer's
     summary plus "Did not finish: <title> (<why>)" for each lost lens. The quiet line is posted ("plan review
     passed; workers are starting: …"), then the lead handoff (below).
   - **fail**: otherwise. State `failed`, `Findings` = the merged list. The lead gets `planReviewFailedWake(merged)`.
     When no reviewer failed and only `full` was lost, there are no findings, so the lead gets
     `planReviewLostWake` instead (submit the same plan again).
   - Either way, exactly one `plan-reviewed` run event goes out for the round: `{state, round, findings: <merged>,
     reviewers: [{lens, state, text}], picks}`. `picks` lists the tasks whose model the reviewer set
     (`ModelSource == reviewer`).

**The merged list** is attributed, in lens-table order, blocks separated by a blank line:

```
[Full review] <its findings>

[Tests and commands] <its findings>

[Full review] did not finish: <why>          (only when full was lost)
Passed: Spec coverage, Task order and files, Final coverage.
Did not finish: <title> (<why>).             (only when a lens was lost)
```

No total cap applies. Each verdict is still capped at `MaxReviewNoteLen`, and the merged list is never clipped:
five reviewers come to roughly 10k characters at most. The wake flattens it to one line as today; the `[title]`
markers keep the attribution readable. The engine does no dedup across reviewers: the lead does that.

**Handoff.** The lead's compaction handoff after a cleared review moves from the RPC handler (today
`handOffAfterPlanReview` on any non-fail action) into orchestrate. It now runs where the round settles as passed,
and where `AcceptPlanReview` accepts. Both call `PostHandoff` when the run has a lead worker. A lone lens pass that
leaves others reviewing hands nothing off.

## Round 2

`ReplacePlanReviewProposal` opens round 2 with `Prior` = {round 1's merged `Findings`, its `PlanText`/`SpecText`,
and round 1's picks read off the old tasks before they are replaced (`ModelSource == reviewer`: task id, label,
`sonnet` if its route is `LightPickRoute`, else `lead`, and `PickReason`)}. Round 2 has one reviewer, `followup`, on
the Light reviewers route. Its first tick captures the round-2 docs the same way.

The follow-up prompt adapts `p-r2slim.txt`:

- the same opening and doc lines;
- "This is round 2. Round 1 failed with these findings, and the lead revised the plan to answer them:" + the merged
  findings;
- the plan's changes as a unified diff, `Prior.PlanText` → `PlanText`, and the spec's, or "The spec did not
  change.". The diff comes from `git diff --no-index --no-color` over the two texts written to a temp dir (exit 1
  means they differ; git is the engine's existing dependency). A diff error fails that spawn, which counts toward its
  respawn;
- the two duties: confirm each round-1 finding is fixed or explicitly and soundly declined, since one that is
  neither is a finding again; and check only the changed lines against the full checklist (every item), plus the
  spec-gap line. Do not re-review unchanged text;
- on a Reviewer picks run, the pick block as today, with each task's round-1 pick and reason listed beside it: "keep
  it unless the diff changed that task; a task round 1 did not pick needs a fresh pick". Validation is unchanged: a
  pass needs a pick per pickable task;
- the verdict is the same `planreview pass|fail` command. Its text has one line per round-1 finding (fixed /
  declined / not fixed, and why), then any new findings, under `MaxReviewNoteLen`.

Round 2 settles like round 1 with one reviewer. A pass or fail goes as today, with `[Round-2 follow-up]`
attribution; a lost follow-up fails the round, as a lost reviewer does today. `MaxPlanReviewRounds = 2` stays, and
so do the human and autonomous paths after a second fail and accept.

A round 2 whose round 1 predates this change has an empty `Prior`. The diff is then the whole plan against empty, so
the follow-up reviews every line, with no findings to confirm. There is no separate fallback path.

## Cockpit

| where | today | after |
|---|---|---|
| DAG graph stage line (`taskroute.ts` `stageEntries`, `daggraph.tsx`) | `plan review · <state> · <model>` | `plan review · <state> · round <n>`, then one chip per reviewer `<title> · <state> · <short model>`, with `data-plan-reviewer="<lens>"` and `data-plan-reviewer-state="<state>"`. The model is the reviewer route for `full` and the Light reviewers route for the others. |
| Timeline `stage-session-started` (`runtimeline.ts`) | "Plan reviewer started" | "Plan reviewer started · <title>"; the event detail gains `lens` |
| Timeline `plan-reviewed` (`runtimelineview.tsx`) | the row plus pick sub-rows | the row, one sub-row per reviewer `<title> · <state>` (`data-plan-review-reviewer="<lens>"`), then the pick sub-rows |
| Agent tree stage rows (`agenttreemodel.ts` `stageOutcome`, `agenttree.tsx`) | one row, outcome from `planreview.runid` | one row per reviewer session, outcome from the reviewer with that run id (`lost` reads as failed). A run id not in the current round reads failed when round > 1, as today. The row's title names the lens. |
| `wsh jarvis dag status` (`planReviewLine`) | state, round, age, findings head | while reviewing, adds `reviewers: Full review reviewing · Spec coverage passed · …` |
| `wsh … planreview pass` ack | "the engine dispatches the first tasks" | "the round passes once every reviewer has; ending this session" |
| Peek "Plan review" phase | state | unchanged |

The frontend keeps one lens-to-title map (`runtimeline.ts`), which the graph, timeline and tree all read.

## Testing

Go (`pkg/orchestrate`), behavior-level, with the stubbed spawn the existing plan-review tests use:

- round 1 starts five reviewers, `full` on the reviewer route and four on the Light reviewers route (nil → claude
  sonnet), all with role plan-reviewer;
- the round passes only after all five pass, and a lone pass does not clear the hold;
- one lens fail fails the round, and the lead's wake and the one `plan-reviewed` event carry the attributed merged
  list whole, longer than `MaxReviewNoteLen`;
- a lost lens (respawn spent) is dropped: the round passes on the other four and names it; a lost `full` fails it;
  only-`full`-lost sends the lost wake;
- `--pick` from a lens is refused; the full reviewer's picks apply as today;
- a resubmit keeps the merged findings, the round-1 docs and the picks in `Prior`; the follow-up prompt carries the
  findings, a diff of exactly the changed lines, "The spec did not change." when it did not, and the round-1 picks;
- round 2 starts one reviewer on the Light reviewers route; its pass clears the hold and hands off; its fail on
  round 2 gives today's last-round wake;
- cancel stops every reviewer's run; the docs are cleared on pass and accept;
- a stage stored with the old shape (top-level runid, no reviewers) starts five reviewers on its next tick.

Server: `SetRunSettings` and create-run carry `lightreviewerroute` to the run and group, and validate it. Frontend
(vitest): `stageEntries` reviewer chips, the reviewer sub-rows, `stageOutcome` per reviewer, and the run-settings and
profile model rows for the new field.

CDP (the Final line runs these):

- `model-picks`: its arrange waits for the five round-1 reviewers and records each one's verdict in its own name
  (lenses pass, `full` passes with the picks). It sets both reviewer routes to haiku to keep the real sessions
  cheap. A new step: the graph's stage line shows five reviewer chips, each passed, and the timeline's Plan reviewed
  row lists five reviewers.
- new `plan-review-rounds`: round 1 with one lens failing and the others passing. Its steps: the graph shows four
  passed and one failed reviewer chip, and the Plan reviewed row lists five with that verdict. Then a resubmit opens
  round 2, and a step shows one `Round-2 follow-up` chip reviewing.
- `new-run-window`: a step shows the Light reviewers row and that picking a route there reaches the created run's
  `lightreviewerroute`. A run-sheet step shows the row on an existing run.
- `brief-profile`: a step shows the Light reviewers route row.

## Out of scope

Lenses in round 2; dedup or ranking of findings across reviewers; lens reviewers for task review; a `wsh runs` flag
for the new setting; the Depends-line check (effort chunk 5).
