# Codex as a run worker, and per-task harness routing

A claude lead can hand an engine task to a Codex or an Antigravity (agy) worker. Two pieces:

1. **Codex becomes a run worker**, on the same footing as agy: a task worker only, never a lead, a task reviewer or a
   stage session. A run's **Workers** route can be Codex.
2. **A plan's `**Model:**` line can name a harness**, so a lead puts one task on Codex and another on agy in one plan.

Codex already has the pieces an interactive agent needs (commit 42fcd349): `wsh codex-hook` reports state, model,
session id and transcript; `agentsessions` finds a rollout by session id; `codex resume <id>` reopens a session;
usagestats reads codex tokens. This design adds the unattended worker path on top. It reverses the 2026-09-14 removal
recorded in `docs/deferred.md` ("Codex and opencode run workers") for codex only; opencode stays consult-only.

## 1. Codex run worker

Codex mirrors agy (commit 9fd3f537): it names its own session, so the engine learns the id late from its first hook.

**Catalog** (`pkg/harness/catalog.go`). The codex spec gets `RunWorkerCapable: true`, `AssignsOwnSession: true`,
`LeadCapable` stays false. The comment above it says why: a lead needs the handoff `/compact` and re-orientation after
compaction, which codex lacks; it names its own session id. Every generic path keyed on these flags then covers codex
with no change of its own: `jarvis.WorkerSessionId` returns "", `orchestrate.NoteWorkerSession` binds the id codex
reports to its child run, `validateLeadHarness` refuses codex as a reviewer or stage session, `ListHarnesses` offers its
models in the Workers picker, and `dag submit` / dispatch accept it as a worker route.

**Route** (`pkg/runroute/runroute.go`). `runtimeDefaults` gains `{Runtime: "codex", ResolvedModel: operatorDefault}`.
`modelNamespaceValid` gains a codex arm: a model id matching `^[A-Za-z0-9][A-Za-z0-9._-]*$` (`gpt-5.5`, `o3`,
`gpt-5.1-codex-max`); anything with a space, slash, quote or shell metacharacter is refused. `resolveModelPin` already
emits `--model <id>`, which codex takes.

**Launch form** (`pkg/jarvis/runexec.go`, `RunWorkerSpecFor`). The codex arm is

    codex --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust [--model <id>] <prompt>

- The prompt is positional, which opens the interactive TUI on it (never `codex exec`: the worker must stay a live
  terminal the human can watch and the engine can type into).
- `--dangerously-bypass-approvals-and-sandbox`: a worker has no human at its prompts. Setting the approval/sandbox mode
  on the command line also makes codex skip its "trust this folder" screen in a fresh worktree.
- `--dangerously-bypass-hook-trust`: Codex runs a user hook only once the person trusted it with `/hooks`. Without the
  flag, a person who never trusted arcterm's hook gets a worker that never reports a session id and stalls at the
  first-token deadline. The cost, accepted: in a worker, every enabled hook in `~/.codex/hooks.json` (another tool's
  too) runs untrusted.
- `BaseArgs` is the two flags plus the model args, as for every runtime.

**Resume** (`ResumeWorkerArgs`). codex resumes with the `resume` subcommand: `codex resume <id> <BaseArgs...> <nudge>`
(clap takes the options after the positional id). This matches `agentResumeFlags["codex"] = "resume"` in
`pkg/blockcontroller/agentrestore.go`.

**Asking** (`pkg/jarvis/leadprompt.go`, `AskTool`). Codex has no ask tool the cockpit sees. `AskTool("codex")` returns
the shell form a codex worker runs:
`` `wsh ask --wait --questions-json '<{"questions":[{"question","header","options":[{"label","description"}]}]}>'` ``,
which blocks until the lead or the human answers and prints the answers as JSON. It goes through the same `AskCommand`
RPC as pi's bridge, so the engine's worker-question routing (lead first, then the human) applies unchanged. The engine's
worker contract (`engine.go`, "ask once with %s") prints whatever `AskTool` returns, so no other prompt changes.

The ask blocks for as long as the lead or the human takes (up to `wsh ask`'s 30-minute ceiling), and codex's shell tool
gives a command a short default timeout unless the call sets one. So the `AskTool("codex")` text also tells the worker
to run it with the shell tool's timeout set to 30 minutes (1800000 ms), and, when the tool hands back control while the
command still runs (unified exec returns a running session), to keep reading that session until it prints the answers
JSON, never to start a second ask. A killed ask leaves the question on the lead's card with nobody waiting on it, which
the engine's hung-worker checks then catch.

**Liveness** (`pkg/orchestrate/liveness.go`). codex joins `livenessRuntimes` (its rollout is an append-only JSONL named
by the session id, found by `agentsessions.TranscriptForSession`) and `firstTokenRuntimes`, for agy's reason: until its
first hook reports an id, a codex worker stuck in onboarding or signed out is otherwise invisible. Both map comments
name codex.

**Out of scope, recorded in `docs/deferred.md`:**
- A codex worker's heavy commands do not wait in the job queue (`wsh jobslot`): codex's `PreToolUse` hook is async and
  reports only. Gating it means a synchronous hook with a long timeout on every tool call. Until then, **Workers at
  once** is the only bound on parallel codex builds.
- `wsh agents` still cannot message a codex tab (`agentHarnesses`); `dag tell` types into any worker and covers it.
- Codex as a lead, reviewer or Quick-run lead.

## 2. A harness on the plan's Model line

**Syntax.** `**Model:** <value>`, still one token, no backticks. The value is read in this order:

| value | runtime | model |
|---|---|---|
| `<harness>:<model>`, where `<harness>` is a catalog runtime (`codex:gpt-5.5`, `agy:gemini-3-pro`, `pi:openrouter/x:free`) | `<harness>` | `<model>` |
| a catalog runtime alone (`codex`, `agy`, `claude`, `pi`) | that runtime | "" (its default) |
| anything else (`sonnet`, `openrouter/qwen/qwen3:free`) | "" (the lead's, as today) | the value |

The split is on the first `:` and only when the part before it is a runtime `harness.Lookup` knows, so a pi model id
with a colon in it still reads as a model. `pkg/jarvis/plan.go` writes `task.RunSpec.Runtime` and `RunSpec.Model`;
`ModelSource` stays `plan`.

**When it counts: unchanged.** A plan line, harness or not, routes its task only when the run's workers setting is
**Reviewer picks** (`effectiveTaskRoute`); on any other setting the human's Workers choice wins and the line is ignored,
as today. So a lead that wants a task on codex writes the line, and the human enables it by starting the run on
Reviewer picks. The plan reviewer's pick vocabulary stays `sonnet|lead`: it never moves a task to codex or agy, and it
sends no pick for a task whose plan names one.

**Validation: unchanged code path.** `dag submit` already resolves each plan task's pin and checks its harness for the
run-worker operation on this machine (`wshserver_dag.go`). A `codex:` line on a machine without codex, or an
`opencode:` line, is refused at submit naming the task.

**Plan format text.** `jarvis.PlanFormat`'s Model sentence becomes: "A task may also carry one **Model:** line in that
same place (not in backticks): a model id (`sonnet`), a harness and model (`codex:gpt-5.5`, `agy:<model>`), or a harness
alone for its default model (`codex`, `agy`); it is the model its worker runs on, used when the run's workers setting is
Reviewer picks and ignored otherwise. Workers can be claude, pi, agy or codex." The template line becomes
`**Model:** <model-id or harness:model>`.

**Plan preview.** `planPreviewTasks` shows a plan line as written: `codex:gpt-5.5`, `codex`, or the bare model.

## 3. Where the cockpit shows it

`frontend/app/view/orchestrate/taskroute.ts` today compares and labels models only, so a task on codex's default model
next to a workers route on claude's default reads as "same model" and gets no tag, and a runtime-only route reads
`default`.

- A route's face is its short model, or the harness runtime when the route names no model: `codex`, `agy`.
- `cardModelTag` tags a card whose route differs from the workers route in runtime **or** model:
  `codex · plan`, `gpt-5.5 · plan`.
- `workersChip` reads `workers · codex` for a codex default route.

The rail's `worker · plan's pick` line and the route attribute (`plan:codex:`) come from the same `taskRoute` and need
no change.

## 4. Docs

- `docs/guide/orchestrator.md`: the Workers row lists Codex; the "Codex và OpenCode chỉ để consult" line names OpenCode
  only; a short note that a codex worker launches with the two bypass flags and asks through `wsh ask --wait`.
- `docs/guide/plan-format.md`: the Model line's three forms, with an example, and its error table.
- `docs/deferred.md`: the 2026-09-14 entry says codex came back (this spec) and opencode did not; a new
  "(arcterm) Codex workers skip the job queue" entry.
- `AGENTS.md`: "task workers are claude, pi and agy" gains codex.
- `CHANGELOG.md`: one `Added` line.

## Testing

- `pkg/harness`: codex is run-worker capable, assigns its own session, cannot lead.
- `pkg/runroute`: `Resolve` accepts `codex` and `codex` + `gpt-5.5`, refuses `codex` + `gpt 5` / `a;b`.
- `pkg/jarvis`: `RunWorkerSpecFor` codex args with and without a model, never a `--session-id`; `ResumeWorkerArgs`
  codex; `AskTool("codex")`; plan parsing of the three Model forms, including a pi id with a colon and a harness the
  catalog does not know.
- `pkg/orchestrate`: `NoteWorkerSession` binds a codex report to a codex child and leaves a claude child alone;
  `transcriptForRun` tracks an unbound codex child with no path; `firstTokenArmed` for codex; `validateLeadHarness`
  refuses codex for a reviewer.
- `pkg/wshrpc/wshserver`: `planPreviewTasks` shows `codex:gpt-5.5`.
- vitest `taskroute.test.ts`: runtime-only faces, a codex-default card tag, the codex workers chip.
- CDP: a new `codex-worker-route` scenario submits a Reviewer-picks run whose plan has a codex task behind a sonnet
  task that only runs `sleep 600` (so it never completes and the codex worker is never dispatched in the scenario's
  lifetime; teardown cancels the run before anything else), records the plan-review pass, and asserts the codex card's
  `codex · plan` tag and its rail route; it skips when codex is not installed.
