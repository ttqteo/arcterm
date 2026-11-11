# Brainstorm bench, round 2: the skill and its judge against Council Brainstorm, on keys that need the code

Brainstorm: `.superpowers/brainstorm/brainstorm-bench-round2/brainstorm.json` (2026-11-11).

## Goal

Find out whether Arc's brainstorm skill, with its judge choosing between approaches, designs better than a Council in
Brainstorm mode, and whether either one reaches the mechanisms a design depends on in the code rather than only naming
the idea. Round 2 runs both on 4 design cases, 2 runs each, after the bench is made fair and its keys deep.

## What round 1 showed (harness 2026-11-06.1)

- `run-pause`, the only design case both ran on. The brainstorm skill scored 2/6 (K1, K4) in both of its runs, with 3
  wrong items out of 9 decisions, 5.5M tokens and about 12 minutes. The Brainstorm council (`760d8bcb79b8ee58`) scored
  1/6 (K1 at rank 3), with 1 wrong item ("Paused frees the run slot", against K4), 2.3M tokens and about 8 minutes.
- Four of run-pause's six key lines (K2, K3, K6, and the "unless memory is tight" half of K5) rest on one preference,
  that arcterm pauses runs by itself, which the question never states. K3 also holds numbers nobody can derive (skip
  runs under 1 GB, stop after two pauses). In round 1 the brainstorm asked exactly that question and the bench's person,
  which takes the agent's own pick, answered "Only by hand".
- `launcher-declutter`'s six key lines are layout taste (the Agent column folds into a chip, the 1–9 keycaps hide…).
  No variant can derive them without a person, and stating them in the question gives the key away.
- The judge does not score the two sides alike. `JudgeDesign` (`pkg/council/bench/judge.go`) scores every decision of
  the brainstorm. A council is cut at `TopBrainstorm` = 3 (`judge.go:24`, `judgedItems` at `judge.go:85`), and its
  wild ideas kept aside are judged apart, in a `kept` column outside recall.

## Decisions

### No person in the loop

Both sides choose on their own, as the bench runs today. The brainstorm's simulated person always takes the option
the agent or the skill's judge marks as the pick (`nextStep` in `pkg/council/bench/brainstormdriver.go`). The council
is a bench council (`Bench: true`, `benchCouncil` in `pkg/council/bench/run.go`), which never pauses after round 1. No
simulated person holds the key.

### The keys hold what only reading the code finds

Every key line of every Brainstorm case is a mechanism or an edge case that shows only when the code is read: like
run-pause's K4, "a paused run still counts against `runs:maxactive`, so the queue does not start another run in its
place", which follows from `runqueue.Active` (`pkg/runqueue/rules.go`). A general line ("let a run be paused") is not
a key line. Each key line names, in the key file, the `path:line` of the case's project copy that shows it, so a
reviewer can check that the line is derivable. There is no separate depth score, and neither the skill nor the council
changes in this round.

### Cases

- **run-pause:** the question states the preference: arcterm frees a run's memory by itself when memory runs short,
  and manual Pause and Resume are a fallback. The key is rewritten as code-derived mechanisms, and the numbers no code
  derives (1 GB, two pauses) leave it.
- **launcher-declutter:** retired (in the case list's retired set, as Phase 0b's cases are).
- **Three new cases**, drafted from shipped specs whose decisions rest on code that already existed. Proposed sources
  (Agent's call): `2026-10-20-held-services-design.md` (a service runs with no tab open and restarts after a crash;
  added in `33d3bc63a`), `2026-10-09-heavy-job-queue-design.md` (heavy commands queue by RAM; `5ed9cdb6b`),
  `2026-10-27-goalpost-guard-design.md` (a worker's check-lowering edit reaches its reviewer; `90db6e666`).
  - Each case's project copy is a `git archive` of the commit just before the feature, taken before the spec's own
    commit, so neither the spec nor its plan is in the copy; any other doc naming the feature's commits is scrubbed,
    and the leak check passes, as `scripts/council-bench-cases.mjs` does for the Review cases.
  - The question says what the person wants and any preference a key line rests on, never how to build it.
  - `files` names the code a designer would start reading from. It may hold a file the key cites (builder question
    2): it is chosen for where a designer starts, never built from the key's citations, and the key still needs the
    code read closely. run-pause's list stays as it is.
  - Each key has 4–6 lines.
- **The person approves every question and key before any run.** The drafts are shown with each line's `path:line`.

### Both sides are scored the same way

On a Brainstorm case, every variant's whole report is judged in one list:
- a council's directions, then its wild ideas kept aside;
- the brainstorm's decisions, in the design's part order.

Each row records three numbers:
- **recall@3**: key lines matched by an item ranked 1–3;
- **recall@all**: key lines matched by any item;
- **wrong rate**: items the judge called wrong, out of items judged.

`wsh council bench results` shows all three in its Brainstorm table, beside tokens, recall@all per million tokens,
and the brainstorm's decisions and questions. The `kept` column goes away for Brainstorm rows, since kept ideas are now
in the list. Review cases keep today's scoring.

Rescoring the reports already saved: a council's report is in `councils/<id>.json` and can be judged again on the new
scoring, but the brainstorm's design items were never saved (its temp copy is deleted after the run), so its old rows
cannot be. Round 2 also changes run-pause's key, so an old row would be judged against a key it never saw. The rows
of earlier harnesses therefore stay as they are. From this round on, each brainstorm row saves the items it was judged
on, beside the results file, so a later key or scoring change can rejudge it (Agent's call).

### Round 2

4 cases (run-pause and the 3 new ones), each run by the brainstorm skill and by the Brainstorm council, 2 runs each:
16 runs, about 62M tokens, about 2 hours. The work bumps `council.HarnessVersion`, so the table never adds round 2's
scores to round 1's.

### How it runs

**The merged build is installed first** (builder question 1). The council side runs inside the installed app's wavesrv
(`wsh council bench`), where `Judge` scores it and the row takes its harness from the council's record
(`pkg/council/bench/run.go:250`), while the brainstorm side runs from the checkout (`go run
./cmd/council-bench-brainstorm`). So the plan ends with a handoff: the merged build is built
(`task tauri:build`), the person runs `! task install` once (an agent never runs it), and only then does the driver
start. From then until the report the person installs nothing. Before its first bench, the driver checks that the
running wavesrv's harness is the checkout's `council.HarnessVersion`, and stops with "install the new build first"
when it is not (Agent's call).

A driver runs the bench from start to end and can be started again at any point (today's
`<data dir>/council-bench/work/bench-all.mjs`, moved into the repo as `scripts/council-bench-all.mjs` and given the
round-2 plan):
- It runs detached from arcterm (`wsh detach`), so a restart or install does not take it down.
- It starts each bench only when at least 8 GB of RAM is free.
- It reads the results file before every step, so a second start runs only the cells still missing their scored runs,
  at most 3 starts per bench.
- It never stops a bench itself.
- Its status, pid and final table files stay in the data dir's `council-bench/work/`.

The person allows the Token burn cards, and holds `task install` until the report. Nothing runs before the cases are
approved.

## Left to the builder

- The judge prompt's wording for scoring a whole list while still reporting the rank of each match.
- The names and order of the new columns in `wsh council bench results` and on the wire
  (`CouncilBenchResultsRtnData`), with the TS types regenerated by `task generate`.
- How the Brainstorm cases' snapshots, scrubbing and keys are installed (a `BRAINSTORM_CASES` table beside `CASES` in
  `scripts/council-bench-cases.mjs`, or a second script).
- Tests: the scoring of a whole list (rank cut at 3, wrong rate) in `judge_test.go` and `results_test.go`; the driver's
  plan of missing cells from a results file.

## Out of scope

- Review cases (`spec-live-agents`, `bugs-orchestrate`) and their cut at `TopReview` = 5, which hides a council's
  findings past its five directions (`judgedItems`). In round 1, K4 of bugs-orchestrate sat at rank 7–8 in both council
  runs and was not counted. Logged for a later round.
- A depth score per item, and any change to the brainstorm skill or to the council.

## Builder's decisions (2026-11-12, autonomous run)

Made without the person, as the run's contract asks; each with why.

- **One judge prompt for both sides.** On a Brainstorm case a council is judged through the same input as a design:
  its directions, then its wild ideas kept aside, as one numbered list, with no answer or summary text ahead of it
  (a design has none, and the spec asks that both sides be scored the same way). Every item is judged; nothing is cut.
  The judge maps each key line to the rank of the *first* item that names it; the parser also takes the lowest rank
  among the items whose verdict is `key:Kn`, so a reply whose map and item list disagree still counts the earliest
  match. The judge's separate `kept` answer, `Verdict.Kept` and `KeptMatched` go: nothing asks for them any more.
- **Row fields.** A Brainstorm row from this harness on: `recall` is recall@all, the new `recall3` is recall@3 (a
  match ranked 1–3), the new `judged` is the items judged (the denominator of the wrong rate), and `kept` /
  `keptmatches` are no longer written. They stay in `CouncilBenchResult` so a row of an earlier harness still reads
  back whole. A Review row is unchanged. `CouncilBenchRow` sums `recall3` and `judged` and drops `kept`; the Review
  table's kept column goes too, since a Review was never judged with a kept list and the column only ever read 0.
- **Table.** The Brainstorm section prints `harness, variant, skill, scored/runs, recall@3, recall@all, recall@done,
  wrong, decisions, questions, tokens, recall@all/M tokens`; `wrong` is `<wrong>/<judged>`. A row with no `judged`
  (written before harness 2026-11-12.1) prints `-` for recall@3 and its wrong count alone; the note under the table
  says such rows were scored the old way (a council cut at 3).
- **The running wavesrv's harness.** `CouncilBenchResultsRtnData` gains `harness`: the `council.HarnessVersion` of the
  wavesrv that answers. The driver reads it from `wsh council bench results --json`; an older wavesrv answers without
  it, which reads as a mismatch. `HarnessVersion` becomes `2026-11-12.1`.
- **Saved items.** A brainstorm run that is done writes `<data dir>/council-bench-items/<session>.json`
  (`case`, `harness`, `session`, `final`, `done`: the two lists of items its marks were judged on) before its row is
  appended. A write that fails is logged and the row still goes in: the score is the result, the file only allows a
  rejudge.
- **Cases.** One file per case, `scripts/council-bench-brainstorm-cases/<id>.json`, read by a new installer
  `scripts/council-bench-brainstorm-cases.mjs` (beside, not inside, the Review script, which keeps its own `CASES`).
  Each key line carries `at` (`path:line` in the project copy) and `shows` (text that line holds); the installer
  archives the snapshot, checks every `at` / `shows` against the copy, scrubs, runs the leak check, writes the key file
  with each cite on an indented line under its `Kn:` line (which `parseKey` ignores, so the judge never sees it), and
  marks `launcher-declutter` retired. Snapshots: run-pause `d04210830^` (the commit its round-1 copy matches),
  held-services `33d3bc63a^`, heavy-job-queue `5ed9cdb6b^`, goalpost-guard `90db6e666^`. The council panel stays
  `ui-feature` / `solo-ui` for all four, as round 1's run-pause case had it, so round 2 changes the cases and the
  scoring and nothing of the council.
- **Approval.** Nobody is at the cockpit to approve the drafts. Each case task's reviewer checks every key line against
  its cite and the spec's rule (a mechanism or edge case only reading the code finds; the question states the wants and
  preferences, never the build). The person reads them in the installer's `--dry-run` listing before the install that
  starts round 2.
- **Driver.** `scripts/council-bench-all.mjs` counts a cell's rows by harness (`harness` = the checkout's
  `HarnessVersion`), not by a date: a row of round 1 never fills a round-2 cell. Its pure planning (cells missing,
  what to start next, the harness check) is exported and unit-tested; the process side stays thin. It is started with
  `wsh detach -- node scripts/council-bench-all.mjs` after the install.
