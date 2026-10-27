# Goalpost guard for run workers

**Spec:** `docs/superpowers/specs/2026-10-27-goalpost-guard-design.md` (read its Implementation decisions section: it fixes the wire, the storage and the routing every task below relies on)
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/waveobj ./pkg/wshrpc/... ./cmd/...`
**Check:** `go build ./... && go vet ./pkg/orchestrate ./pkg/waveobj ./pkg/wshrpc/... ./cmd/... && task check:ts`

Two tasks run side by side: the engine side (Go: the wsh command, the RPC, the stored run event and the
reviewer prompt) and the mod side (TypeScript in arc-mod: the copied detectors, routing and hooks). They meet
only at the command-line contract below, which both tasks must honour exactly.

**The contract between the tasks.** `wsh jarvis dag goalpost <findings-json>`:
- one positional argument: a JSON array of findings, each `{"rule": string, "file": string, "title": string,
  "before": string[], "after": string[]}`; `file`, `before` and `after` may be absent;
- it prints exactly `recorded` (the finding was stored on the caller's task) or `not a task worker` (any
  other caller, including one with no run context) on stdout and exits 0 for both;
- it exits non-zero with the reason on stderr for malformed JSON, an empty array or an RPC failure.

### Task 1: Engine side: record findings and list them for the reviewer
**Depends on:** none
**Files:** `pkg/waveobj/runevent.go`, `pkg/wshrpc/wshrpctypes_dag.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_dag_goalpost_test.go`, `pkg/orchestrate/goalpost.go`, `pkg/orchestrate/goalpost_test.go`, `pkg/orchestrate/review.go`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_goalpost_test.go`, `docs/orchestrator-guide.md`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Design decisions this task carries (from the spec):
- `waveobj.RunEventKindTaskGoalpost = "task-goalpost"` in `pkg/waveobj/runevent.go`, documented in its comment
  block: on the dag's owner run, detail `{"taskid", "runid", "findings"}`, wakes nobody.
- A typed RPC `DagGoalpostCommand(ctx, wshrpc.CommandDagGoalpostData) (*wshrpc.CommandDagGoalpostRtnData, error)`
  with `CommandDagGoalpostData{ChannelId, RunId string; Findings []GoalpostFinding}` and
  `CommandDagGoalpostRtnData{Recorded bool}`, in `pkg/wshrpc/wshrpctypes_dag.go` (types and the `DagCommands` interface). The
  finding type is `wshrpc.GoalpostFinding{Rule, File, Title string; Before, After []string}` with json tags
  `rule`, `file,omitempty`, `title`, `before,omitempty`, `after,omitempty`. Run `task generate` after; never
  hand-edit the generated files.
- `pkg/orchestrate/goalpost.go` owns the engine logic:
  - `RecordGoalposts(ctx context.Context, dagID, callerRunID string, findings []wshrpc.GoalpostFinding) (bool, error)`:
    loads the dag; records only when the caller is a task's current worker (the caller run has a `TaskId`,
    is not `Review`, and the dag's task with that id has `RunID == callerRunID`), by appending one
    `task-goalpost` event on `g.ChannelId`/`g.RunID`; returns `false, nil` for every other caller. An
    empty findings slice is an error.
  - `goalpostsForTask(ctx context.Context, g *waveobj.TaskGroup, taskID string) []wshrpc.GoalpostFinding`,
    shaped like `toldToTask` in `review.go`: oldest first, a failed read logged and treated as none.
- `reviewPrompt` gains a `findings []wshrpc.GoalpostFinding` parameter after `told`, filled by
  `spawnReviewer` from `goalpostsForTask`. With findings, a section follows the worker's report: one line per
  distinct finding (same rule, file and title collapse to one, keeping the latest samples), with rule, file,
  title and its before/after samples clipped to a few lines each. Then the instruction: pass or fail each by
  name in the verdict's note. Pass one when the task or spec calls for it, or when the worker's report
  explains it and you agree. Pass one the final diff no longer shows as undone. Otherwise fail the task.
  With no findings the section is absent and the prompt is byte-identical to today's. Update every existing
  `reviewPrompt` caller and test for the new parameter.
- `DagGoalpostCommand` in `wshserver_dag.go`: requires channel, run and at least one finding, loads the
  caller's run; a run with no `DagORef` answers `Recorded: false`; otherwise calls `RecordGoalposts`.
- `wsh jarvis dag goalpost <findings-json>` in `wshcmd-jarvisdag.go`, honouring the contract above. It
  resolves the caller's own run as `dagIds` does, but a caller with no run context prints `not a task worker`
  and exits 0 instead of erroring. It parses and validates the JSON before any RPC.
- `docs/orchestrator-guide.md`, section "A task's review": a short paragraph saying that arc-mod reports
  check-lowering edits from Claude Code task workers, that the reviewer must pass or fail each one, and that
  pi workers are not covered.

Acceptance (focused tests):
- `go test ./pkg/orchestrate -run 'TestReviewPromptGoalposts|TestRecordGoalposts|TestGoalpostsForTask'`:
  - `TestReviewPromptGoalposts`: findings appear, one line each, with rule, file and title; two identical
    findings yield one line; no findings yields exactly today's prompt (compare against a call with nil);
  - `TestRecordGoalposts`: recorded (true, and one `task-goalpost` event with the task id) for the task's
    current worker; false and no event for the task's reviewer run, for a retired attempt (the task's
    `RunID` now names a newer run) and for a run with no task id; error for an empty findings slice;
  - `TestGoalpostsForTask`: returns only the named task's findings, oldest first.
- `go test ./pkg/wshrpc/wshserver -run 'TestDagGoalpostCommand'`: a run with no dag answers false; a missing
  run id is an error.
- `go test ./cmd/wsh/cmd -run 'TestDagGoalpost'`: malformed JSON and an empty array fail before any RPC; a
  stubbed `lookupRunCtx` with no run prints `not a task worker`; a stubbed RPC answer prints `recorded`.

### Task 2: Mod side: detectors, routing and hooks in arc-mod
**Depends on:** none
**Files:** `claude/arc-mod/hooks/goalpost-core.ts`, `claude/arc-mod/hooks/goalpost-core.test.ts`, `claude/arc-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/goalpost-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts`

Design decisions this task carries (from the spec):
- **The copy.** Fetch goalpost-guard v0.2.2 from Xabilimon1/emcc-claude-code-mods, `mods/goalpost-guard`
  (for example `gh api repos/Xabilimon1/emcc-claude-code-mods/contents/mods/goalpost-guard/hooks/detect.ts -H "Accept: application/vnd.github.raw"`;
  likewise `tests/detect.test.ts` and `types/index.d.ts`). `hooks/detect.ts` becomes
  `claude/arc-mod/hooks/goalpost-core.ts`, with `GoalpostCategory`, `GoalpostRule` and `GoalpostFinding`
  moved into it from `types/index.d.ts`. Keep the detection logic as upstream wrote it, but reformat it to
  arc-mod's style (4-space indent, double quotes; check with `npx prettier --check` on the file).
  `tests/detect.test.ts` becomes `goalpost-core.test.ts`, switched from `claude-code/testing` to
  `vitest`. It imports no fixture file (its `import { add } from './add'` is test data inside a template
  string), and no file beyond this task's Files line is added: anything else under `claude/arc-mod/hooks/`
  ships in the embed. Both files open with the full MIT notice
  (Copyright (c) 2026 Xabier Ariznabarreta) and a line naming the source repo, path and version. Port nothing
  else: no `register.tsx`, `withRealRetargets`, UI, trailers, exceptions or profiles.
- **The routing**, two pure functions in `goalpost-core.ts`:
  - `goalpostRole(isRunAgent: boolean, answer: string | null): "task-worker" | "run-agent" | "outside"`:
    `isRunAgent` false gives `outside` (no answer is consulted); otherwise a trimmed answer of `recorded`
    gives `task-worker`, and `not a task worker`, `null` (the report failed or was skipped as already
    known) or anything else gives `run-agent`.
  - `goalpostNote(findings: GoalpostFinding[], role: "task-worker" | "run-agent" | "outside"): string`. It
  names each finding (title and file) and then adds one of three asks: for `task-worker`, the task reviewer
  will pass or fail it, so justify it under your report's Differs from plan section or undo it; for
  `run-agent`, name it in your final report; for `outside`, tell the user in your reply. Also
  `ALL_CATEGORIES` (all six) as the `DetectOptions` the hooks always pass.
- **The hooks in `register.ts`:**
  - When `active` is false (no `WAVETERM_BLOCKID`/`WAVETERM_JWT`), every goalpost hook returns `next(e)`
    without detecting: a plain terminal session is untouched, like every arc-mod hook.
  - Edit: before = the file's current content (`$.fs.exists`/`$.fs.read`; no mod in this repo uses `$.fs`
    yet, so confirm both against the engine API in `claude-code`'s types before relying on them, and use
    what it actually offers); after = `applyEdit(before, old_string, new_string, replace_all)`.
    No file, or `applyEdit` returning null, means no findings. Write: before = current content or null,
    after = `content`. Bash and PowerShell: `inspectCommand(command, ALL_CATEGORIES)`, inside the existing
    `refusal` handlers after the refusal check, so a refused command is never inspected. `inspectChange`
    also always gets `ALL_CATEGORIES`.
  - Detect before `next(e)`; with no finding, return `next(e)` untouched. After `next(e)`, only when the
    result has no `deny` and is not an error, attach the note as `context`
    (`{ ...ran, context: [...(ran.context ?? []), note] }`).
  - Role, always through `goalpostRole`: with `ARC_RUN_AGENT` unset, `goalpostRole(false, null)`.
    Otherwise run `[WSH, "jarvis", "dag", "goalpost", JSON.stringify(findings)]` and pass its stdout (or
    `null` on a non-zero exit or a thrown error, which is logged with `$.ui.log(..., { to: "debug" })`).
    Once a call answered `not a task worker`, a module-level flag (reset at `session.start`) skips later
    calls and passes `null`. A detector that throws is logged the same
    way, and the tool call goes through untouched. The guard never denies and never asks.
- Run `task sync:claudemod` so the embedded copies under `cmd/wsh/cmd/claude-mod/hooks/` match; never edit
  them by hand.

Acceptance (focused tests):
- `npx vitest run claude/arc-mod/hooks/goalpost-core.test.ts`: the copied upstream suite passes unchanged
  in its assertions. Add `goalpostRole` cases: `(true, "recorded\n")` is `task-worker`;
  `(true, "not a task worker")` is `run-agent`; `(true, null)` (a failed report) is `run-agent`;
  `(false, "recorded")` is `outside`. Add `goalpostNote` cases: each role's ask appears, every finding's
  title and file are named, and `task-worker` mentions Differs from plan.
- `npx vitest run claude/arc-mod/hooks/guard-core.test.ts` still passes (the Bash/PowerShell handlers now do
  both).
- `claude plugin validate claude/arc-mod` passes.
