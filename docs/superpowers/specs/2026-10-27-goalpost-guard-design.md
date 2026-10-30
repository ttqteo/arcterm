# Goalpost guard for run workers

Status: design approved in brainstorm (`.superpowers/brainstorm/goalpost-guard/brainstorm.json`).

## Intent

Stop an engine worker from getting its task through by weakening the checks that judge it: deleting,
skipping or loosening tests, rewriting expected values, suppressions, relaxed lint/type config,
softened CI, lowered coverage, skipped git hooks. A passing Verify and a passing review should still
mean the work is right.

This is a precaution, not a response to a repeated incident. The task reviewer already looks for
weakened or deleted tests by judgment (`pkg/orchestrate/review.go`, `reviewPrompt`: "no corners cut
(stubs, skipped cases, weakened or deleted tests, TODOs)"). The guard adds a deterministic list of what
changed in the checks, so catching it no longer depends on the reviewer noticing.

## Goals

- Every check-lowering edit a Claude Code run worker makes reaches the task reviewer as an explicit
  item it must pass or fail.
- Outside a run, Claude is told what it lowered, so it tells the user in its reply.

## Non-goals

- Pi workers. This is a Claude Code mod; pi is out of scope.
- goalpost-guard's own UI: its band, panes, `/goalposts` command, `Goalpost-Change` commit trailers,
  per-file exceptions, profiles and its `emcc-core` dependency.
- Collision guard (another chat editing the same file). It is separate work with its own brainstorm.

## Anti-goals

- **No wall-clock cost.** No worker, and no run, ever waits on a decision about a finding. The edit
  always goes through. The guard's cost shows up only when a review fails over a finding that was
  actually wrong, and that round would be owed anyway.
- No new question to the human or the lead per finding.

## Design

### What counts as lowering a check

All of goalpost-guard's detection rules (Xabilimon1/emcc-claude-code-mods, `mods/goalpost-guard`
v0.2.2, MIT):

- **Tests:** `tests.removed`, `tests.assertions`, `tests.skipped`, `tests.focused`, `tests.expected`
  (an assertion's literal rewritten in place), `tests.retargeted` (an import pointed at another
  module, or the imported code copied into the test), `tests.loosened`, `tests.snapshots`,
  `tests.narrowed` (a test runner run with a filter).
- **Everything else:** `suppressions`, `config` (tsconfig, eslint or pyproject strictness lowered),
  `ci` (`continue-on-error`, `|| true` on a check), `coverage` (a threshold lowered), `bypass`
  (`--no-verify`, `HUSKY=0`), and `shell-edit` (a test file edited through sed and the like).

A false alarm costs one reviewer sentence, because the reviewer passes what is justified (below).

Its `hooks/detect.ts` (pure: `inspectChange({path, before, after}, options)`,
`inspectCommand(command, options)`, `applyEdit`) and `tests/detect.test.ts` are copied into arc-mod as
a pure core module, following arc-mod's `*-core.ts` + vitest convention. They are credited the way
arc-skim credits ttqteo/claude-skim (MIT notice kept). Nothing else from goalpost-guard comes along.

### Where it lives

The guard goes in arc-mod (`claude/arc-mod/`, synced to `cmd/wsh/cmd/claude-mod/` by
`task sync:claudemod`; edit only `claude/`). It is a goalpost core module plus `tool.call` hooks on
Edit, Write and Bash in `hooks/register.ts`, next to the existing guard-core hooks. arc-mod is already
loaded into every Claude Code session, so there is no new plugin and no install step.

The hooks never deny and never ask. They run the detectors on the change (an Edit's before/after via
`applyEdit`, a Write's old and new content, a Bash command via `inspectCommand`), then act as below.

### In a run worker

`ARC_RUN_AGENT` (`pkg/jarvis/runexec.go`, `RunAgentEnv`) is set on every agent a run starts, so it is
not enough on its own. Only a **DAG task worker** reports to the reviewer: a run agent whose block
carries a task id (`agent:taskid` meta) and that is not the task's reviewer. Every other run agent
(a quick-run agent, the lead, a stage session, an interrupted-run resume agent) gets the note
described under [Outside a run](#outside-a-run). Its wording asks the agent to name the change in its
final report.

**How findings reach the reviewer.** The mod reports each finding (rule, file, title, before and
after sample lines) through a new wsh command, which stores it on the worker's task. When the engine
builds the task reviewer's prompt (`reviewPrompt` in `pkg/orchestrate/review.go`), it lists the
task's findings as items the reviewer must pass or fail. The reviewer says which it did for each one
in its `dag review pass` / `dag review fail` note.

**What the reviewer passes.** The reviewer passes a finding when the task or spec calls for it, or
when the worker's report explains it and the reviewer agrees. Otherwise it fails the task. This joins
the reviewer's existing instructions; a failed review follows the existing path: back to the worker
first, and the lead wakes when a task fails review twice.

**The worker is told too** (Agent's call). Each guarded hook gives the worker a line that names what
it lowered and asks it to justify the change under its report's Differs from plan section. That way
a justified change passes review the first time instead of costing a sendback round.

A failed report never blocks the edit. It logs to the mod's debug log, and the reviewer still sees
the diff.

**Task reviewers are not guarded** (Agent's call). They only read, and a finding from one would be
stored on the task it is judging.

### Outside a run

The edit runs, and Claude gets a line naming what it lowered, so it tells the user in its reply.
Nothing is recorded and nothing waits.

This applies only to sessions inside Arc (Agent's call). Like every arc-mod hook, the guard passes
straight through when `WAVETERM_BLOCKID` and `WAVETERM_JWT` are not set (the `active` gate in
`register.ts`), so a plain terminal session is untouched.

## Background

- **The worker-question route was considered and rejected.** A worker's AskUserQuestion reaches the
  lead first through the PreToolUse `wsh ask` hook, and `wsh ask --wait` can block a hook until it is
  answered. Holding the edit for the lead was rejected because it costs wall-clock time.
- An engine-side scan of the task diff was considered. Its only advantage was covering pi workers,
  which are out of scope.

## Implementation decisions

Settled after the brainstorm, from reading the code (all Agent's calls).

### The wsh command and the wire

- **`wsh jarvis dag goalpost <findings-json>`**, a worker-side command beside `dag review`. Its one
  argument is a JSON array of findings, each `{rule, file, title, before, after}` (`before`/`after`
  are the detector's sample lines). The mod passes it as one argv entry (`$.process.run`), so no
  shell quoting is involved.
- It resolves the caller's own run from its terminal the way `dag review` does (`dagIds`), and
  sends a new typed RPC, `DagGoalpostCommand` (`CommandDagGoalpostData{ChannelId, RunId, Findings}`
  returning `{Recorded bool}`), defined in `pkg/wshrpc/wshrpctypes_dag.go` and regenerated with
  `task generate`.
- The server records only when the caller's run is a task's current worker: it has a `TaskId`, is
  not `Review`, and the dag's task with that id has `RunID` equal to the caller's run. Anything else
  (a reviewer, a lead, a quick-run agent, a stage session, a resumed or retired attempt, a caller
  outside any run) returns `Recorded: false` with no error.
- The command prints `recorded` or `not a task worker` and exits 0 for both. A failure (no RPC, bad
  JSON) exits non-zero with the reason on stderr.

### Where findings are stored

A new run event, **`task-goalpost`**, on the dag's owner run (`g.ChannelId`, `g.RunID`), with detail
`{taskid, runid, findings}`. It wakes nobody. This mirrors `task-told` (what the human typed to a
worker, read back by `toldToTask` for the reviewer), needs no `TaskNode` field or migration, and puts
each finding on the run's timeline. The engine reads them back with a `goalpostsForTask` beside
`toldToTask`, and a failed read leaves the brief without them rather than failing the review, as
`toldToTask` does.

### The reviewer prompt

`reviewPrompt` takes the findings as a new parameter (as it takes `told`) and, when there are any,
adds a section after the worker's report: each finding as one line (rule, file, title, and its
before/after samples, clipped), then the instruction to pass or fail each one by name in the
verdict's note. It passes one when the task or spec calls for it, or when the worker's report explains
it and the reviewer agrees. A finding the final diff no longer shows is passed as undone. With no
findings the section is absent. Identical findings (same rule, file and title) collapse to one line
here, at the one place that reads them, rather than in the mod.

### Routing in the mod

- The detectors run first, in the tool-call hook, before `next(e)`. With no finding, nothing else
  happens: no wsh call, no context.
- After the tool ran (no deny, not an error), a finding is reported only when the session is
  `active` and has `ARC_RUN_AGENT` set. The mod runs `wsh jarvis dag goalpost` and keeps the answer
  for the session: once it reads `not a task worker`, later findings skip the call.
- The line Claude gets, in its context, names what was lowered (each finding's title and file), and
  then:
  - **task worker** (`recorded`): the task reviewer will pass or fail it, so justify it under your
    report's Differs from plan section, or undo it;
  - **other run agent** (`not a task worker`): name it in your final report;
  - **outside a run** (no `ARC_RUN_AGENT`): tell the user in your reply;
  - **the report failed**: logged to the mod's debug log, and Claude gets the other-run-agent
    line, which reads right for either role.
- Task reviewers fall under "other run agent" through the server's answer, with no special case in
  the mod, and since they only read, they raise none.
- The routing and the note wording are a pure function in the core module (inputs: the findings,
  `ARC_RUN_AGENT` set or not, and the wsh answer, if one came), tested by vitest.

### Tools inspected

Edit (`applyEdit` on the file's current content), Write (the file's current content vs the new
content), and Bash and PowerShell through `inspectCommand`. PowerShell is inspected because Windows
workers use both, and the rules that matter most there (`--no-verify`, a filtered test run) are not
shell-specific. A false alarm from the POSIX-shaped parser costs one reviewer sentence. Bash and
PowerShell already have a `tool.call` hook in `register.ts` (the guard-core `refusal`), so the
detectors join those handlers instead of adding a second one: a refused command is never inspected.

### The copied code

`hooks/detect.ts` becomes `claude/arc-mod/hooks/goalpost-core.ts`, with the rule, category and
finding types from goalpost-guard's `types/index.d.ts` moved into it. `tests/detect.test.ts` becomes
`goalpost-core.test.ts`, switched from `claude-code/testing` to vitest. The MIT notice (Copyright (c)
2026 Xabier Ariznabarreta) and a line naming the source (Xabilimon1/emcc-claude-code-mods,
`mods/goalpost-guard` v0.2.2) head both files. arc-mod has no LICENSE file of its own, so the notice
goes in the file. goalpost-guard's `withRealRetargets` (in its `register.tsx`, which checks the
old import target still exists) is not ported. Without it a retarget false alarm costs one reviewer
sentence. The category gate (`DetectOptions.categories`) is always all six categories.

### Docs

`docs/orchestrator-guide.md` gains a short paragraph on the guard in its review section, and the
`task-goalpost` event joins the run event list in `pkg/waveobj/runevent.go`'s comment block.

## Left to the builder

- The exact wording of the note and of the reviewer prompt's findings section, within the above.
- How many sample lines a finding carries to the reviewer, and how they are clipped.
- Tests:
  - vitest: the copied detector suite, passing as copied, plus the routing and note function;
  - Go: `reviewPrompt` lists a task's findings, collapses duplicates, and omits the section when
    there are none; the server records for a task's current worker and answers not-a-task-worker
    for a reviewer, a retired attempt and a run with no task;
  - `wsh jarvis dag goalpost` rejects malformed JSON.
