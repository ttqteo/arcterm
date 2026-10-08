# Antigravity CLI (`agy`) harness — design

**One line:** Bring the Antigravity CLI back as a harness, this time integrated: live status through agy's own hooks,
questions answered on the cockpit card, launch and resume from the cockpit, `ask @agy` consults, Conversation History and
transcripts, token usage, steering and skills sync, and agy as an engine **task worker** (not a lead).

**Status:** Design. The agy behaviour this design relies on was measured against **agy 1.3.1 on macOS arm64
(2026-10-08)**; see [Verified facts](#verified-facts-agy-131-2026-10-08).

## Background

- arcterm had an `antigravity` runtime until 2026-08-12 (`5e1e8c03`, "remove the antigravity harness end to end"). It
  was thin: a catalog row, a launch command (`agy -i <task>`), a consult arm (`agy -p`), and a `GEMINI.md` memory
  projection. It never reported status: no hooks existed then, and the roster row was only the pending launch row.
- agy now ships a hook system (`~/.gemini/config/hooks.json`, five events) whose payloads carry the conversation id,
  the transcript path, the model and the workspace. That is enough to integrate agy the way Claude Code and pi are
  integrated, instead of the way codex is.
- Run workers were scoped to claude and pi on 2026-09-14 (`docs/deferred.md`, "Codex and opencode run workers")
  because each runtime multiplies the orchestration surface: wake, compaction, ask delivery, liveness and route
  validation. Task workers need only liveness, ask delivery and route validation. Leads also need wake, the handoff
  `/compact`, and re-orientation after compaction. agy has no `/compact` command and no compaction event, so this
  design makes agy a task worker only.

## Goals

1. An agy launched from the cockpit shows on the rail with live state (working, asking, idle), model, title and its
   conversation id.
2. A question agy asks (`ask_question`) is answered on the cockpit card, for interactive agents and run workers
   alike, and the answer reaches agy.
3. A heavy shell command agy runs goes through memgate, like claude's and pi's.
4. New Agent launches agy; a reopened or restored agy tab resumes its conversation.
5. `ask @agy` consults work.
6. Conversation History lists agy conversations, and the transcript reader renders them.
7. Usage counts agy's tokens (at $0).
8. Steering and skills sync into agy's global config.
9. The engine can run plan tasks on agy, with liveness, questions, resume, and failure on exit, like a pi worker.

## Non-goals

- **agy as a run lead, reviewer or stage session.** These are judgment roles; a lead needs the handoff `/compact` and
  re-orientation after compaction, and agy has neither. A `docs/deferred.md` entry records what would make it possible.
- **A live context meter for agy.** Its transcript carries per-call token counts but no context-window size, and a
  model → window table would be a maintained static catalog (`pkg/runroute/catalog.go` forbids those).
- **Cost.** agy bills against a Google quota, not per token; its usage counts tokens and shows $0, whatever the model
  (agy also serves `claude-*` models, which must not be priced as Anthropic API calls).
- **A "waiting on permission" state.** agy's own permission prompt (mode `request-review`) fires no hook, so the rail
  cannot see it. Run workers launch with `--dangerously-skip-permissions` and never prompt.
- **Automating agy's first-run onboarding.** Its Terms of Service page carries a data-sharing consent only the person
  can give. The docs say to run `agy` once in a terminal first.
- **Harvesting memory out of agy** (closed as no-go, `2026-07-01-memory-sync-phase-c-agy-findings.md`).
- **The Antigravity desktop app.** It shares `~/.gemini/config/` with the CLI; arcterm's hooks run there too but do
  nothing outside an arcterm block (below).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Runtime identity `agy`, binary `agy`, label **Antigravity**, glyph `◭`. | Identity equals the binary for every other harness (claude, codex, opencode, pi). The old `antigravity` id only survives in records older than 2026-08-12, which already render through the `UNKNOWN` fallback. |
| D2 | agy runs **task workers only**. A new catalog capability `LeadCapable` (claude, pi) gates the run's own runtime (lead and phases) and the reviewer route; `RunWorkerCapable` (claude, pi, agy) gates worker routes and task route pins. | The person's choice. Leads need `/compact` and a compaction hook (above). |
| D3 | Questions are **always answered on the cockpit card**. The PreToolUse hook on `ask_question` blocks on `wsh ask --wait` and returns the answer to agy as a `deny` with the answer as `reason`. | The person's choice: one path for interactive agents and workers. Verified: the model reads the reason (it answered "blue"). |
| D4 | A new hidden `wsh agy-hook <Event>` command, with its pure logic in a new `pkg/agyhook`, separate from `wsh agent-hook`. | agy's payload, its decision protocol (stdout) and its missing event name share nothing with Claude's stdin parse in `wshcmd-agenthook.go`, a file that is already Claude-only. |
| D5 | Hooks install into the global `~/.gemini/config/hooks.json` under an owned top-level key `"arcterm"`, merged so every other key survives. Installed only when `~/.gemini/antigravity-cli/` exists (the CLI has run). | Verified: global hooks fire. The named-key schema is agy's (the docs show no `"hooks"` wrapper). Gating on the CLI's own data dir follows the agentsync rule that arcterm never provisions a harness the person never ran. |
| D6 | agy assigns its own conversation id, so an agy worker's session id is **bound late**: the engine spawns it with no session id, and the first hook report that carries a `conversationId` binds it to the worker's child run. | Verified: agy ignores both an unknown `--conversation <uuid>` ("conversation not found", then a new id) and `ANTIGRAVITY_CONVERSATION_ID`. Liveness already treats a run without a session id as "unobservable", never as stalled. |
| D7 | Steering goes to `~/.gemini/config/AGENTS.md`, skills to `~/.gemini/config/skills/`. | Verified: agy reads all of `~/.gemini/{GEMINI,AGENTS}.md` and `~/.gemini/config/{GEMINI,AGENTS}.md`. Its built-in docs name `~/.gemini/config/` as the global configuration root and `~/.gemini/config/skills/<name>/` as the global skills dir. |
| D8 | Conversation History reads agy's `conversation_summaries.db` (SQLite, read-only) for title, workspace and modification time, and the transcript JSONL for content. | The transcript has no cwd and no title; the summaries table has both (`workspace_uris`, `title`). |
| D9 | The consult arm is `agy -p` with no PTY. | Verified: `-p` writes its answer to a non-TTY stdout on 1.3.1, so the 2026-06 PTY workaround (upstream bug #76) is not needed. |

## Verified facts (agy 1.3.1, 2026-10-08)

Measured with probe hooks and print-mode runs; the TUI could not be probed (onboarding was not completed).

- **Install:** `curl -fsSL https://antigravity.google/cli/install.sh | bash` installs `~/.local/bin/agy` on macOS and
  Linux; agy self-updates in the background; `agy update` updates on demand.
- **Flags:** `-i/--prompt-interactive <prompt>` (a TUI session with a first prompt), `-p/--print <prompt>`,
  `--conversation <id>`, `-c/--continue`, `--dangerously-skip-permissions`, `--model <slug>`, `--add-dir`,
  `--output-format text|json|stream-json`. A positional prompt is an error: "Prompts are read only from -p/--print,
  -i/--prompt-interactive, or stdin".
- **Models:** `agy models` prints `Fetching available models...` then `<slug>\t<label>` lines, e.g.
  `gemini-3.8-flash-high\tGemini 3.8 Flash (High)`, `claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)`.
- **Workspace:** the launch cwd is the workspace (`workspaceDirs=[<cwd>]` in agy's own log, and `workspacePaths` in
  every payload). `--add-dir <d>` adds `d` in front of it.
- **Hook schema** (`~/.gemini/config/hooks.json`, or `<workspace>/.agents/hooks.json`):

  ```json
  { "arcterm": {
      "PreInvocation": [{ "type": "command", "command": "...", "timeout": 10 }],
      "PreToolUse":    [{ "matcher": "*", "hooks": [{ "type": "command", "command": "...", "timeout": 3720 }] }],
      "PostToolUse":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "...", "timeout": 10 }] }],
      "Stop":          [{ "type": "command", "command": "...", "timeout": 10 }]
  } }
  ```

  `timeout` is in seconds. Tool events take `{matcher, hooks}` groups; the others take a flat list.
- **The payload does not name its event.** The command line must carry it (`wsh agy-hook PreToolUse`).
- **Hook environment:** the hook inherits agy's environment (so `WAVETERM_BLOCKID`, `WAVETERM_JWT` reach it) plus
  `ANTIGRAVITY_CONVERSATION_ID`. Its cwd is the hooks file's directory, not the workspace.
- **Payloads.** Common to all events: `conversationId`, `transcriptPath`, `artifactDirectoryPath`, `modelName`,
  `workspacePaths[]`. Then:
  - PreInvocation / PostInvocation: `invocationNum`, `initialNumSteps`.
  - PreToolUse: `stepIdx`, `toolCall: {name, args}`. `run_command` args: `CommandLine`, `Cwd`, `WaitMsBeforeAsync`,
    `toolAction`, `toolSummary`. `ask_question` args:
    `{"questions":[{"question":"Which color do you prefer?","options":["Red","Blue"],"is_multi_select":false}],
    "toolAction":"...","toolSummary":"..."}`.
  - PostToolUse: as PreToolUse, plus `error`. It does not fire for a tool a PreToolUse hook denied.
  - Stop: `executionNum`, `terminationReason` (e.g. `NO_TOOL_CALL`), `error`, `fullyIdle`.
- **PreToolUse decisions (stdout):**
  - **Empty stdout:** no opinion. The tool runs under agy's normal permissions.
  - **`{}` or `{"decision":""}`: deny.** The model sees "denied by a pre-tool hook".
  - `{"decision":"deny","reason":"<text>"}`: deny. The model sees "tool call denied by pre-tool hook: <text>".
  - Pre/PostInvocation, PostToolUse and Stop printing `{}` changed nothing in the probes.
- **Stop does not always fire.** In a print run whose only command was auto-denied, neither PostInvocation nor Stop
  fired.
- **Headless permissions:** without `--dangerously-skip-permissions`, a command that needs the `command` permission is
  auto-denied in `-p` mode, and the JSON result carries `denied_actions`.
- **Transcript:** `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript_full.jsonl`
  (the hook's `transcriptPath`). One JSON object per step: `step_index`, `source` (`USER_EXPLICIT` | `MODEL` |
  `SYSTEM`), `type` (`USER_INPUT` | `PLANNER_RESPONSE` | `GENERIC` | …), `status` (`DONE` | `ERROR`), `created_at`
  (RFC 3339), plus as present: `content`, `thinking`, `tool_calls[{name, args}]`, and on `PLANNER_RESPONSE`
  `input_tokens`, `output_tokens`, `cache_read_tokens`. The model is not in it.
  - A `USER_INPUT` `content` wraps the prompt: `<USER_REQUEST>\n…\n</USER_REQUEST>` followed by
    `<ADDITIONAL_METADATA>` and sometimes `<USER_SETTINGS_CHANGE>` blocks.
  - A tool's result is the next `GENERIC` step, whose `content` starts with `Created At:` / `Completed At:` lines.
  - `transcript.jsonl` beside it is a lossy copy (args re-quoted as strings); never read it.
- **Conversation index:** `~/.gemini/antigravity-cli/conversation_summaries.db`, table `conversation_summaries`:
  `conversation_id`, `title`, `preview`, `step_count`, `last_modified_time`, `workspace_uris` (a JSON array of
  `file://` URIs), `status` (e.g. `CASCADE_RUN_STATUS_IDLE`). It also holds conversations migrated from the
  Antigravity desktop app, which have no transcript under `brain/`.
- **Print JSON:** `{"conversation_id","status","response","duration_seconds","num_turns","usage":{...}}`.
- **Onboarding:** the first TUI start shows a theme picker and a Terms of Service page with a pre-ticked consent to
  share interaction data; `~/.gemini/antigravity-cli/cache/onboarding.json` reads `"onboardingComplete": false`
  until it is done. Print mode works without it.

## Design

### 1. Catalog and capabilities (`pkg/harness`, `pkg/runroute`, wshrpc)

- `pkg/harness/catalog.go` gains two `Spec` fields and one row:
  - `LeadCapable bool`: may run as a run's lead, its phases, task reviewers and stage sessions. True for claude and pi.
  - `AssignsOwnSession bool`: the harness names its own session and takes no `--session-id`; arcterm learns the id
    from the harness's first status report (D6). True for agy only.
  - `{Runtime: "agy", Bin: "agy", Label: "Antigravity", ConsultCapable: true, RunWorkerCapable: true,
    SteeringRel: [".gemini","config","AGENTS.md"], SkillsRel: [".gemini","config","skills"],
    UpdateArgs: ["update"]}`, placed after pi and claude. No `NpmPackage`: agy is not on npm.
- `harness.OperationLead` joins `OperationConsult` and `OperationRunWorker`; `ValidateInstalled` refuses
  `"harness \"agy\" cannot lead a run"` for it.
- Every validation site that checks a **run's own runtime** or its **reviewer route** switches to `OperationLead`:
  `wshserver_runs.go` (run start, channel quick run, child of a run), `wshserver_runsettings.go` (the reviewer route
  only), and the engine's reviewer spawns, `pkg/orchestrate/review.go` (~113) and `stagesession.go` (~40), which today
  check the reviewer route with `validateWorkerHarness` (run-worker). Worker routes (`WorkerRoute`, a task's `RunSpec`
  pin in `wshserver_dag.go`, `engine.go`'s task spawn) keep `OperationRunWorker`. The worker of each site reads it
  before switching: a site that validates both stays split.
- `HarnessInfo` (`pkg/wshrpc/wshrpctypes_jarvis.go`) gains `LeadCapable bool \`json:"leadcapable"\``; run
  `task generate`.
- `pkg/runroute/runroute.go`: `runtimeDefaults` gains `{Runtime: "agy", ResolvedModel: operatorDefault}`;
  `modelNamespaceValid("agy", m)` accepts a model slug, `^[a-z0-9][a-z0-9.-]*$`.
- `pkg/runroute/catalog.go`: `enumerateAgy` parses `agy models` (skip the `Fetching…` line and anything that is not
  `<slug>\t<label>`), the same degrade-to-free-form rule as `enumeratePi`.

### 2. Hooks: `wsh agy-hook <Event>` (`pkg/agyhook`, `cmd/wsh/cmd/wshcmd-agyhook.go`)

`pkg/agyhook` holds everything that can be pure: the payload type, the event → emission mapping, the
`ask_question` → `[]baseds.AgentAskQuestion` conversion, the answer → reason text, and the decision encoding. The
command file wires it to RPC.

**Always:** read stdin, never write to stderr, exit 0, and never let a failure block agy. Outside an arcterm block (no
`WAVETERM_BLOCKID`, which is the case in the Antigravity desktop app and in plain terminals) it prints the event's
neutral output at once and returns, with no RPC.

**Neutral output:** nothing for PreToolUse (verified: `{}` would deny), `{}` for every other event.

| Event | State reported (`--agent agy`) | stdout |
|---|---|---|
| PreInvocation | `working` | `{}` |
| PreToolUse, `ask_question` | `asking`, then blocks on the card (below), then `working` once it returns (PostToolUse never fires for a denied tool) | `{"decision":"deny","reason":<answer>}`, or nothing if the card failed |
| PreToolUse, `run_command` | `working`, detail = the command; then memgate (below) | nothing, or `{"decision":"deny","reason":<memgate's refusal>}` |
| PreToolUse, any other tool | `working`, detail = `toolCall.args.toolSummary`, else the tool name | nothing |
| PostToolUse | `working` | `{}` |
| PostInvocation | none | `{}` |
| Stop with `fullyIdle: true` | `idle` | `{}` |
| Stop with `fullyIdle: false` | none | `{}` |

Every report carries `Agent: "agy"`, `SessionID: conversationId`, `TranscriptPath: transcriptPath`, `Model: modelName`,
`Cwd: workspacePaths[last]` (the launch cwd; `--add-dir` entries come first), and `Title`: the first `USER_REQUEST`
of the transcript, cut by the same `titleFromPrompt` rule `wsh agent-hook` uses. It also stamps
`MetaKey_AgentTranscriptPath` on the block, as `agent-hook` does, so a gone worker's exit can read its outcome. Reports
go through `publishAgentStatusData` with a start timestamp taken before any RPC (the ordering rule `agent-hook`
documents).

**Ask bridge (D3).** Convert `questions[]` to `baseds.AgentAskQuestion` (each string option becomes a label with no
description; `is_multi_select` → `MultiSelect`; no header). Call `wshclient.AskCommand` with `Wait: true` and the
30-minute ceiling `wsh ask --wait` uses. Then:
- Answered: deny with the reason
  `The user answered in the arcterm cockpit:\n<question> -> <answer labels joined by ", ">` (one line per question).
- Cancelled: deny with `The user dismissed the question.`
- RPC error, no cockpit, or timeout: no output. agy's own question UI then asks in the terminal (graceful degradation).

The hook returning is the delivery: the registry entry clears when the waiter returns, the same rule pi follows
(orchestrator spec §5, "Delivery").

**Time bound.** PreToolUse is the only event that blocks: on the ask card (30-minute ceiling) or in memgate (its hold
card, 30 minutes, then `memgate.WaitLimit`, 30 more). `wsh agy-hook` bounds its own PreToolUse work at **60 minutes**
with a context deadline and, when the bound hits, answers neutral (no output). agy's PreToolUse `timeout` is
**3720 s** (62 minutes), so the hook always answers before agy would kill it; what agy does with a killed hook is
unverified and never reached.

**Memgate.** Run the decision `wsh memgate` makes (`memgate.Classify`, `Fits`, the hold card, wait) through one shared
function: extract it from `wshcmd-memgate.go` and have both commands call it. Don't copy it. A verdict with
`Run: false` becomes a deny whose reason is the verdict's message. An error lets the command run, the rule memgate
already documents ("a broken gate never blocks an agent").

**Missed Stop.** Stop does not always fire (verified). The fallbacks already exist: a process exit reports idle
(`shellcontroller.go` `idleOnExitEvent`), and engine liveness ages the transcript and samples CPU. No new timer.

### 3. Installer (`cmd/wsh/cmd/wshcmd-installhooks.go`)

- `installAgyHooks(home)` runs from `installAgentHooksRun` beside the opencode plugin installer.
- It runs only when `~/.gemini/antigravity-cli/` exists. Otherwise it is a quiet skip.
- It reads `~/.gemini/config/hooks.json`. A missing file is `{}`. A file that does not parse as a JSON object is left
  untouched, and the installer reports an error naming the file. It never overwrites one it cannot read.
- It sets the top-level `"arcterm"` key to the four events in the table above. Every command is the quoted absolute
  path of the fixed `~/.arc/bin/wsh` plus `agy-hook <Event>`. Timeouts: PreToolUse 3720 s (§2, Time bound), the
  others 10 s.
- It writes atomically (temp file + rename) and only when the content changed.
- Every other top-level key is preserved byte-for-byte in meaning (re-marshalled), so claude-mem's, ACP's or the
  person's own hooks survive.
- `wsh install-agent-hooks` also prints agy in its summary line, like the other harnesses.

### 4. Launch, flags and resume (frontend + boot restore)

- `frontend/app/view/agents/launch.ts`:
  - `Runtime` gains `"agy"`. `RUNTIME_CMD.agy = "agy"`.
  - `RUNTIME_FLAGS.agy`: `skip-permissions` → `--dangerously-skip-permissions`, `continue` → `--continue`,
    `sandbox` → `--sandbox`. Every flag is one token, the shape the flag menu appends.
  - `buildLaunchMeta` passes the task as `-i <task>` for agy (a bare positional is an error), positionally for the
    rest.
  - `resumeArgsForAgy(id)` = `--conversation <id>`.
- `agentresumestore.ts` persists agy's resume args like opencode's, keyed by the `sessionid` its status reports (the
  transcript basename is `transcript_full` for every agy conversation, so it can't be the key):
  `resumeArgsForAgy(sessionId, baseArgs)` follows its siblings' `(id, baseArgs)` shape, and `persistResume` takes the
  status's `sessionid` from its caller in `agentstatusstore.ts`.
- `pkg/blockcontroller/agentrestore.go`: `agentResumeFlags["agy"] = "--conversation"`, so a hand-launched agy tab is
  tracked live and restored at boot.
- Everywhere the runtime list is enumerated gains agy: `newagentmodal.tsx` `RUNTIMES`, `settingssurface.tsx`
  `FLAG_RUNTIMES`, `channelmessages.ts` (`@agy`), `runtimemeta.ts` (label Antigravity, glyph `◭`, `text-rt-agy`),
  `runtimelogo.ts`, `cockpitrailmodel.ts`, `dailychart.tsx`, the `PROVIDER_RANK` maps (`agentsviewmodel.ts`,
  `ratelimitstore.ts`), and `frontend/app/cockpit/cockpit-actions.ts` if it lists runtimes.
- **Logo:** `frontend/app/asset/antigravity.svg` comes back from `git show 5e1e8c03^:frontend/app/asset/antigravity.svg`.
- **Tokens:** `--color-provider-agy` and `--color-rt-agy` (with `-soft` and `-line`) go in `frontend/tailwindsetup.css`
  and every theme in `themes.ts` that defines its runtime siblings. They take the old accent `#8ecdf0` as the base, and
  themes may tune it.
- **Pickers:** the run-lead and reviewer route pickers list only `leadcapable` harnesses; worker route pickers keep
  `runworkercapable`; consult pickers keep `consultcapable`. The lead pickers are the run launcher's and New Run's
  "Lead model", the brief profile's "Lead route", and Settings' run route. The reviewer pickers are the run launcher's
  and New Run's "Reviewers model", the brief run sheet's and the brief profile's reviewer route.
- **Run route resolution.** The consult harness picker and the run route share one preference
  (`harness:preferredruntime`), so a person who picks Antigravity for consults would otherwise have every new run
  launch with an agy lead and be refused. `resolveChannelLaunchRoute` (`runactions.ts`) therefore skips any candidate
  route (channel override, then the shared preference) whose harness is not lead-capable. When none is left, it uses
  the first installed lead-capable harness's default route. The New Agent default (`resolveDefaultRuntime`) is
  unchanged: an interactive agy is fine.

### 5. Consult (`pkg/consult`)

`runtimeSpecs["agy"] = {Bin: "agy", BaseArgs: ["-p"]}`, with the prompt as `-p`'s value, no PTY (D9), and no
`--dangerously-skip-permissions`: a consult reads, and headless agy auto-denies commands. Restore the shape from
`git show 5e1e8c03^:pkg/consult/consult.go` and drop its `UsePty`. agy gets the operator principles injected like every
non-claude runtime (`wshserver_jarvis.go`). `SpecFor` takes the binary from the harness catalog row.

### 6. Run workers (`pkg/jarvis`, `pkg/orchestrate`, wshserver)

- **Launch form.** `RunWorkerSpecFor` agy arm:
  - `Args = ["--dangerously-skip-permissions", <ModelArgs…>, "-i", <prompt>]`
  - `BaseArgs = ["--dangerously-skip-permissions", <ModelArgs…>]`
  - It never adds `--session-id`.
- **Resume.** `ResumeWorkerArgs("agy", id, base, nudge)` = `["--conversation", id, <base…>, "-i", nudge]`. The nudge
  needs `-i`, so the agy arm owns its own composition.
- **Ask tool.** `jarvis.AskTool("agy")` = `"ask_question"`. The worker contract names it.
- **Late-bound session (D6).**
  - Spawn: where the engine generates a session id for a child, it stores `""` when the runtime's spec has
    `AssignsOwnSession`. Today that is `engine.go` (tasks), `review.go` and `stagesession.go`; the last two only ever
    run lead-capable runtimes after D2. One helper decides, so no site tests `"agy"` by name.
  - Bind: a new `orchestrate.NoteWorkerSession(ctx, data)` runs from `publishEvent` (`wshserver.go`) next to
    `NoteLeadStatus`. For an agent status with a non-empty `SessionID` whose agent's spec has `AssignsOwnSession`, it
    finds the child run whose worker tab holds the reporting block (the owner stamp the engine writes on the tab) and,
    **only when that child run's own runtime also has `AssignsOwnSession`**, sets its `SessionId` when it differs. The
    runtime check keeps a nested `agy -p` run inside a claude or pi worker's block from overwriting that worker's
    session. The latest id wins: agy's `/clear` starts a new conversation, and liveness and resume must follow the
    live one. The write is idempotent, and a status for a block that is no worker is a no-op.
- **Liveness.**
  - `livenessRuntimes` gains agy. Its transcript is append-only per step, so mtime is progress.
  - `firstTokenRuntimes` also gains agy. Before the bind, `transcriptForRun` reports an agy child as **tracked with
    nothing written yet** (path `""`), not untracked. The engine skips untracked children before both the first-token
    and stuck-starting checks (`engine.go` ~476), and stuck-starting needs `Status_Init`. So an agy worker that is
    alive but blocked before its first hook (onboarding, signed out) would otherwise never fail. With this, an agy
    worker that has bound no session and written nothing within `FirstTokenDeadline` (5 minutes) stalls, and the hung
    wake reaches the lead. agy's first hook (PreInvocation) fires seconds after start, so a healthy worker binds long
    before the deadline.
- **Transcript lookup.** Via `agentsessions` (§7). `evidence.go` and `onexit.go` read the outcome and last answer
  through the agy arms of `LastAnswer` / `HumanPrompts`.
- **`wsh agents` send** (`wshserver_agentmsg.go` `agentHarnesses`) gains agy if it lists runtimes it can type into.

### 7. Sessions, transcripts and usage

- **`pkg/agentsessions` agy provider** (its own file, `agy.go`):
  - root `~/.gemini/antigravity-cli/brain`; it matches `transcript_full.jsonl` under
    `<id>/.system_generated/logs/`.
  - Session id = the `brain` child directory name.
  - Metadata comes from `conversation_summaries.db`, opened read-only (`file:<path>?mode=ro`) once per scan and keyed by
    id: `title`, cwd = the last `workspace_uris` entry as a path, `last_modified_time`. A missing DB or row degrades to
    title = first `USER_REQUEST`, cwd = `""`, mtime from the file. The error is logged once per scan and never fails
    it. Conversations with no transcript (desktop-app migrations) are not listed.
  - `resumeCmd` = `agy --conversation <id>`.
  - Arms for `ExtractSession`, `SessionRoot`, `TranscriptForSession` (`<root>/<id>/.system_generated/logs/transcript_full.jsonl`),
    `HumanPrompts` (each `USER_INPUT`'s `USER_REQUEST` text), and `LastAnswer` (the last `PLANNER_RESPONSE` with
    `content`).
  - The SQLite read uses `github.com/mattn/go-sqlite3`, already a dependency. wsh is built with `CGO_ENABLED=0`, so
    this path runs only in wavesrv: wsh never lists sessions. Keep it out of any function `wsh agy-hook` calls.
- **Frontend projector** `agytranscriptprojection.ts`, with a test beside it, registered in `transcriptregistry.ts`:
  - `USER_INPUT` becomes a user entry with the `USER_REQUEST` text only (the metadata blocks dropped).
  - `PLANNER_RESPONSE` `content` becomes an assistant text entry, and each `tool_calls[]` a tool entry (name,
    `toolSummary`/`CommandLine` as its detail). `thinking` is dropped, as the other projectors drop reasoning:
    `AgentEntry` has no thinking kind.
  - `GENERIC` after a tool call becomes that tool's result, a bash detail (the `Created At`/`Completed At` header
    stripped, CRLF folded); `status: "ERROR"` marks it failed. A result over 64 KiB is cut and ends `… [truncated]`.
  - `extractTitle` is the first `USER_REQUEST`.
  - `agentFromPath` maps `/antigravity-cli/brain/` to agy.
- **Usage** (`pkg/usagestats`): a scan root for agy's transcripts. Each `PLANNER_RESPONSE` adds its `input_tokens`,
  `output_tokens` and `cache_read_tokens` to the day of its `created_at`, provider agy, model `""`, so cost is $0
  (Non-goals). The per-transcript readers (`transcriptRecords`, behind `TranscriptUsage` and `SumTranscript`), which
  the per-run totals (`pkg/jarvis/usage.go`) and the agent card (`wshserver_agents.go`) use, route an agy transcript
  path to the same parser, as they already do for pi and opencode.

### 8. Agent-sync

Nothing agy-specific: `pkg/agentsync` iterates `harness.List()`. With `SteeringRel` and `SkillsRel` set (D7), steering
projects into `~/.gemini/config/AGENTS.md` and skills into `~/.gemini/config/skills/` whenever `~/.gemini/config/`
exists. The Antigravity desktop app reads the same directory, which is intended: one steering file for both. Tests that
pin the catalog's synced harness count update.

### 9. Docs

- `AGENTS.md`: "run workers are claude + pi only" becomes "leads are claude + pi; task workers are claude, pi and agy".
- `README.md`: the harness lines name Antigravity (hooks and run workers).
- `docs/agents/`: a short `antigravity.md` covering what is installed where (hooks.json key, steering, skills), the
  one-time `agy` onboarding, and what the rail can and cannot see (no permission-wait state, no context meter).
- `docs/deferred.md`: "agy as a lead" — what is missing (`/compact`, a compaction event or re-orientation path) and
  where to pick it up (`OperationLead`, `wake.go` `HandoffCompact`, PreInvocation `injectSteps`).
- `CHANGELOG.md`: one `Added` line.

## Error handling

- **Hooks** never fail agy's turn. Every path ends in exit 0 with the event's neutral output, except the explicit
  denies above. A broken `hooks.json` is reported by the installer and left alone.
- **SQLite** read errors degrade the History metadata (§7), logged once per scan.
- **Validation** refuses an agy lead or reviewer route at the RPC boundary with a message that names agy, never a
  silent fallback to claude (`pkg/harness` already promises "never silently fall back to another harness").
- **A worker that never reports** (agy at onboarding, signed out, or failing to start) has no session to watch. If its
  process exits, it fails through the existing exit path. If it stays alive, the first-token deadline stalls it after
  5 minutes (§6, Liveness) and the hung wake names it.

## Risks and open points

- **The TUI was not probed** (onboarding not done on the test machine). The hook behaviour, workspace and flags are
  verified in print mode, and the agy log shows the TUI backend takes the launch cwd as its workspace. What the TUI
  could still do differently: a folder-trust prompt in a fresh worktree. A run worker uses
  `--dangerously-skip-permissions`; if a trust prompt still blocks it, the worker never reports and stalls at the
  first-token deadline. That shows up on the first live run, not silently.
- **Windows:** the hook command quoting (`"<path>\wsh.exe" agy-hook <Event>`) is untested against agy's Windows shell.
  The installer test pins the string; the first Windows run confirms it.
- **agy is young and self-updating.** The payload, decision protocol and file layout are pinned by fixture tests built
  from the payloads above, so a format change fails visibly in tests rather than silently on the rail.

## Testing

- **Go**
  - `pkg/agyhook`: table tests over fixture payloads for each event × tool (state, detail, session, model, cwd, title,
    stdout). Also the `ask_question` conversion, the answer and cancel reason texts, the neutral outputs, and the no-op
    outside a block.
  - Installer: a fresh file; a merge that keeps foreign keys; an unchanged second run that writes nothing; a malformed
    file left untouched with an error; a skip without `~/.gemini/antigravity-cli/`.
  - `pkg/harness`: the agy row, `OperationLead` refusal, and the updated counts in `catalog_test.go` and
    `wshserver_harness_test.go`.
  - `pkg/runroute`: the agy default, the slug namespace, and `enumerateAgy` against `agy models` output.
  - `pkg/jarvis`: `RunWorkerSpecFor` and `ResumeWorkerArgs` agy arms, and `AskTool`.
  - `pkg/orchestrate`:
    - An agy child spawns with no session id.
    - `NoteWorkerSession` binds, and rebinds on a new id. It ignores a non-worker block, a non-agy agent, and an agy
      status from a claude worker's block.
    - Liveness reads an agy transcript once bound, and reports tracked-with-nothing-written before.
    - An unbound agy child stalls at the first-token deadline.
    - The reviewer spawns refuse an agy reviewer route.
  - `pkg/agentsessions`: provider over a temp `brain/` and a temp summaries DB; the DB-missing degrade; the migration
    rows skipped; `TranscriptForSession`, `HumanPrompts`, `LastAnswer`.
  - `pkg/usagestats`: token sums per day for agy at $0, and the per-transcript total of an agy transcript.
  - `pkg/consult`: the agy argv.
  - `pkg/blockcontroller`: agy resume flag restore.
  - The lead/worker validation split at each switched site.
- **Frontend (vitest):**
  - `launch.test.ts`: agy command, `-i` task, flags, resume args.
  - `agytranscriptprojection.test.ts`.
  - `transcriptregistry` path fallback.
  - `runtimemeta`, the lead-runtime filter, the run route resolution skipping a non-lead preference,
    `agentresumestore` keyed by `sessionid`.
- **CDP:** a new scenario `agy-harness` (`scripts/cdp/scenarios.mjs`), run by Final. Each step covers one view:
  - the New Agent modal offers Antigravity and fills `agy`;
  - an injected agy roster row on the rail with its glyph, title and `asking` state;
  - an agy session in Conversation History, opened in the compact transcript reader with user, assistant and tool
    rows;
  - the consult harness picker lists Antigravity;
  - a worker route picker lists it, and the lead picker does not;
  - the daily usage chart draws an agy series in its provider color.

  The harness list and sessions come from injected fixtures, so the scenario needs no agy install.
