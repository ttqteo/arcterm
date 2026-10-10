# Codex run worker and per-task harness routing

**Spec:** `docs/superpowers/specs/2026-10-10-codex-run-worker-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/harness ./pkg/runroute ./pkg/jarvis ./pkg/orchestrate ./pkg/wshrpc/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/harness ./pkg/runroute ./pkg/jarvis ./pkg/orchestrate ./pkg/wshrpc/...`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: codex-worker-route, model-picks need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs codex-worker-route model-picks`

The spec is the source of every decision below; read its section named in each task. Codex mirrors agy, whose
worker path landed in commit 9fd3f537 (`git show 9fd3f537`): follow its shape. The 2026-09-14 removal of the old codex
worker arm is recoverable with `git show adfcbebc:pkg/jarvis/runexec.go` and `git show adfcbebc:pkg/runroute/runroute.go`
for reference only; the launch form in the spec supersedes it.

### Task 1: Codex as a run worker: catalog, route, launch, resume, ask
**Depends on:** none
**Files:** `pkg/harness/catalog.go`, `pkg/harness/catalog_test.go`, `pkg/runroute/runroute.go`, `pkg/runroute/runroute_test.go`, `pkg/jarvis/runexec.go`, `pkg/jarvis/runexec_test.go`, `pkg/jarvis/resume_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/jarvis/onexit_test.go`, `pkg/wshrpc/wshserver/wshserver_dag_test.go`, `pkg/wshrpc/wshserver/wshserver_run_test.go`, `pkg/wshrpc/wshserver/wshserver_resume_test.go`

Spec §1 (Catalog, Route, Launch form, Resume, Asking).

- `harness` codex spec: `RunWorkerCapable: true`, `AssignsOwnSession: true`, `LeadCapable` false; replace the
  "run workers are claude, pi and agy" comment with why codex is worker-only and names its own session. opencode is unchanged.
- `runroute`: `runtimeDefaults` gains codex; `modelNamespaceValid` gains a codex arm matching
  `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
- `jarvis.RunWorkerSpecFor` codex arm: args `--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust`,
  then model args, then the prompt positionally (no prompt flag); `BaseArgs` is the two flags plus the model args; never a
  `--session-id` (follows from `AssignsOwnSession`). Update the doc comments that list the runtimes.
- `jarvis.ResumeWorkerArgs("codex", id, base, nudge)` returns `["resume", id, base..., nudge]`.
- `jarvis.AskTool("codex")` returns the `wsh ask --wait --questions-json '<json>'` form from the spec, including the JSON
  shape (`questions[].question`, `header`, `options[].label`, `description`) so a codex worker can write it unaided,
  and the spec's survival rule: run it with the shell tool's timeout set to 1800000 ms, and if the tool returns while
  the command still runs, keep reading that session until it prints the answers JSON; never start a second ask.
- Existing tests that assert codex is not a run worker or cannot resume (`catalog_test.go`, `runexec_test.go`'s codex/
  opencode loop, `resume_test.go`) change to assert the new behavior for codex and keep asserting it for opencode.
  `onexit_test.go`'s codex cases: keep passing; change them only if they encoded "codex is never a worker".
- Three wshserver tests use codex as their example of a runtime that cannot work; switch each to opencode, keeping what
  it tests: `TestDagSubmitRejectsInvalidTaskRoutesBeforePersistence` (`wshserver_dag_test.go`, the
  "non-worker-runtime" case), `TestCreateRunCommand_RejectsInvalidOrUnavailableRouteBeforePersistence`
  (`wshserver_run_test.go`, "unsupported runtime"; also add a case that a codex lead is refused through
  `OperationLead`, not by runroute), and `TestResumeRefusesARunItCannotResume` (`wshserver_resume_test.go`, the codex
  quick-run case, which `ResumeWorkerArgs("codex")` now resumes).

Acceptance, by focused tests:
- `go test ./pkg/harness -run 'TestCatalog|TestValidate'`: codex is run-worker capable, assigns its own session, fails
  `OperationLead`.
- `go test ./pkg/runroute -run 'TestResolve'`: `{codex}` and `{codex, gpt-5.5}` resolve (the latter with
  `--model gpt-5.5`); `{codex, "gpt 5"}` and `{codex, "a;b"}` are refused.
- `go test ./pkg/jarvis -run 'TestRunWorkerSpecFor|TestResumeWorkerArgs|TestAskTool|TestWorkerSessionId'`: the codex args
  with and without a model, no `--session-id` even when one is passed, the resume line, `WorkerSessionId("codex") == ""`,
  and `AskTool("codex")` contains `wsh ask --wait` and `1800000`.
- `go test ./pkg/wshrpc/wshserver -run 'TestDagSubmitRejectsInvalidTaskRoutes|TestCreateRunCommand_Rejects|TestResumeRefuses'`.

### Task 2: Engine liveness and late session binding for codex
**Depends on:** Task 1
**Files:** `pkg/orchestrate/liveness.go`, `pkg/orchestrate/liveness_test.go`, `pkg/orchestrate/sessionbind_test.go`, `pkg/orchestrate/review_test.go`, `pkg/orchestrate/suspect_test.go`, `pkg/orchestrate/engine.go`

Spec §1 (Liveness). codex joins `livenessRuntimes` and `firstTokenRuntimes`; rewrite both map comments so they name
codex and say why (late-bound id, like agy). `engine.go`'s `validateLeadHarness` comment names codex beside agy; no
logic change there. `NoteWorkerSession` and `transcriptForRun` need no code change: they key on `AssignsOwnSession`.

Existing tests that use codex as the example of an untracked runtime (`liveness_test.go`'s codex/opencode/gemini loop,
`suspect_test.go` around line 265) switch that example to opencode or gemini, keeping what they test.

Acceptance, by focused tests (`go test ./pkg/orchestrate -run '<names>'`, names as you write them):
- `transcriptForRun` on a codex child with no session id is tracked with an empty path; with a session id and a rollout
  under a temp root (`sessionsRootFor` seam, `<root>/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`), it returns that file.
- `firstTokenArmed` is true for a codex child.
- `NoteWorkerSession` writes a codex status report's session id onto a codex child run, and ignores a codex report from
  a block whose child is a claude worker (mirror the agy tests in `sessionbind_test.go`).
- A task reviewer or stage session on codex is refused by `validateLeadHarness` with the "cannot lead" message (mirror
  the agy case in `review_test.go`).

### Task 3: A harness on the plan's Model line
**Depends on:** none
**Files:** `pkg/jarvis/plan.go`, `pkg/jarvis/plan_model_test.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_dagplan_test.go`

Spec §2. In `plan.go`'s `**Model:**` branch, read the value by the spec's table: split on the first `:` only when the
part before it is a runtime `harness.Lookup` knows; a bare known runtime is that runtime with model ""; anything else is
a model with runtime "" as today. Write `RunSpec.Runtime` and `RunSpec.Model`; `ModelSource` stays `plan`. The existing
"one model id, not in backticks" and "appears twice" errors keep their wording. Replace `PlanFormat`'s Model sentence and
template line with the spec's text. `planPreviewTasks` shows the line as written: `runtime:model`, `runtime`, or
`model`.

Use agy and pi in tests, not codex: this task runs beside Task 1, before codex is a worker. Submit-time validation is the
existing per-task `runroute.Resolve` + run-worker harness check in `wshserver_dag.go`; it needs no change, only a test.

Acceptance, by focused tests:
- `go test ./pkg/jarvis -run 'TestPlanModel'`: `agy:gemini-3-pro` → `{agy, gemini-3-pro}`; `agy` → `{agy, ""}`;
  `sonnet` → `{"", sonnet}`; `openrouter/qwen/qwen3:free` → `{"", openrouter/qwen/qwen3:free}`;
  `pi:openrouter/x:free` → `{pi, openrouter/x:free}`; `nosuch:model` → `{"", nosuch:model}`; `PlanFormat` contains
  `codex:gpt-5.5`.
- `go test ./pkg/wshrpc/wshserver -run 'TestPlanPreview|TestDagSubmit'` (names as you write them): the preview shows
  `agy:gemini-3-pro` and `agy`; a submit whose plan names `opencode:x` is refused naming the task.

### Task 4: Cockpit shows the harness on routes, and a CDP scenario for it
**Depends on:** Task 1, Task 3
**Files:** `frontend/app/view/orchestrate/taskroute.ts`, `frontend/app/view/orchestrate/taskroute.test.ts`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/fixtures/codex-route-plan.md`

Spec §3 and its Testing CDP line.

- `taskroute.ts`: one helper for a route's face (short model, or the runtime when no model), used by `cardModelTag`,
  `workersChip` and `reviewersChip`. `cardModelTag` tags a route that differs from the workers route in runtime or model.
- vitest: `npx vitest run frontend/app/view/orchestrate/taskroute.test.ts` covers a codex-default plan task on a
  claude-default lead (`codex · plan`), a `codex:gpt-5.5` task (`gpt-5.5 · plan`), a same-runtime same-model task (no
  tag), and `workersChip` for a codex default route (`workers · codex`). Existing cases keep passing.
- New scenario `codex-worker-route` in `scenarios.mjs`, built like `model-picks` (copy its arrange/teardown helpers; it
  is registered wherever `model-picks` is). Fixture plan: Task 1 `**Model:** sonnet`, whose text has the worker run the
  shell command `sleep 600`, wait for it, and make no file changes, so it never completes in the scenario's lifetime;
  Task 2 `**Model:** codex`, a noop, with no Depends line so it waits for Task 1 and is never dispatched. Teardown is
  `teardownFixtureRun`, which cancels the run before anything else. The run is Reviewer
  picks, parallelism 1; record the plan-review pass in the reviewer's name with no picks (both tasks have Model lines).
  Arrange first checks `listharnesses` and the scenario's single step is a skip ("codex is not installed") when codex is
  missing. Steps, each with a screenshot under `cdp-shots/`: (1) the run's graph opens with 2 tasks; (2) the t-2 card
  tag reads `codex · plan`; (3) selecting t-2 the rail's route attribute is `plan:codex:` and its text includes
  `worker · plan's pick`.
- `model-picks` still passes unchanged (it is in the Final line).

### Task 5: Docs, deferred entries, changelog
**Depends on:** none
**Files:** `docs/guide/orchestrator.md`, `docs/guide/plan-format.md`, `docs/deferred.md`, `AGENTS.md`, `CHANGELOG.md`

Spec §4. The guides are Vietnamese; keep their language and voice. `orchestrator.md`: Workers row lists Codex, the
consult-only line names OpenCode only, and a short note on the codex worker's two bypass flags and its `wsh ask --wait`
asking. `plan-format.md`: the Model line's three forms with one example, the line in the head-block table, and the
example plan's note. `deferred.md`: amend the 2026-09-14 "Codex and opencode run workers" entry (codex came back with
this spec, opencode did not) and add "(arcterm) Codex workers skip the job queue" plus the other two deferred items from
spec §1, each with what, why and the way back. `AGENTS.md`: "task workers are claude, pi and agy" gains codex.
`CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one above a dated top section), written for
the user. No code; the check is that every path and flag named matches the spec.
