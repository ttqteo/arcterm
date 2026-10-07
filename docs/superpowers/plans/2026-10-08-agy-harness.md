# Antigravity CLI (agy) harness — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-08-agy-harness-design.md` (read it first: its "Verified facts" section is the
contract every agy-facing piece is tested against)
**Verify:** `node scripts/verify.mjs ./pkg/harness ./pkg/runroute ./pkg/agyhook ./pkg/agentsessions ./pkg/usagestats ./pkg/consult ./pkg/jarvis ./pkg/orchestrate ./pkg/blockcontroller ./pkg/agentsync ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && go vet ./pkg/... ./cmd/...`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: agy-harness and agent-history need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs agy-harness agent-history`

> **For agentic workers:** each task names its decisions, the files it owns, the interfaces neighbours rely on, and
> the focused tests that prove it. Write the implementation yourself, test-first. Don't run whole packages or the full
> suite: Verify does that at merge.

**Goal:** Antigravity CLI (`agy`) becomes an integrated harness: live status through agy's hooks, cockpit-card
questions, memgate, launch and resume, consults, Conversation History and transcripts, token usage, steering and
skills sync, and engine task workers (not leads).

**Architecture:**
- A catalog row plus two new capabilities: `LeadCapable` (claude and pi, not agy), and `AssignsOwnSession` (agy
  names its own conversation id).
- A hidden `wsh agy-hook <Event>` command that agy's global `hooks.json` calls. It reports status and answers
  `ask_question` and memgate through PreToolUse decisions.
- The engine binds a worker's session id late, in `publishEvent`, and an unbound agy worker is first-token armed.
- An agy session provider that reads agy's summaries DB and transcript, an agy usage parser, and an agy transcript
  projector, all following the existing per-harness patterns.

**Tech stack:** Go (wavesrv, wsh, `mattn/go-sqlite3` already a dependency), React 19 + jotai + Tailwind 4, vitest, CDP
scenarios.

## Global constraints

- Runtime id `agy`, binary `agy`, label `Antigravity`, glyph `◭`. Old stored `antigravity` records keep rendering
  through the existing `UNKNOWN` fallback; add no alias.
- agy's PreToolUse protocol: **empty stdout = no opinion; `{}` or `{"decision":""}` = deny.** Never print `{}` from
  PreToolUse unless denying. The other four events print `{}`.
- agy's payloads do not name their event: the command line carries it (`wsh agy-hook PreToolUse`).
- PreToolUse time bound: `wsh agy-hook` gives up at **60 minutes** and answers neutral. The hooks.json PreToolUse
  `timeout` is **3720** seconds; every other event's is 10.
- wsh is built with `CGO_ENABLED=0`: no SQLite read may sit on a code path `wsh` runs.
- Colors come from `@theme` tokens in `frontend/tailwindsetup.css`, never raw hex in components (AGENTS.md, DESIGN.md).
- Never hand-edit generated files: change Go types, then `task generate`.
- Format only the files you touched (`gofmt -l <files>`, `npx prettier --check <files>`). Never prettier on
  `scripts/*.mjs`, never `--write` the tree. `AGENTS.md`, `docs/deferred.md` and `docs/README.md` already fail
  prettier at HEAD: don't reformat them, and don't check them.
- Never run `task install`, and never stop a process by image name.
- A hook never fails agy's turn: every error path exits 0 with the event's neutral output.

## Review focus

1. **agy run outside arcterm** (the Antigravity desktop app, a plain terminal: no `WAVETERM_BLOCKID`). The hook prints
   the event's neutral output at once and never denies a tool. Pinned in Task 2.
2. **Non-ASCII and multi-line questions and answers** (e.g. Vietnamese option labels, a question with a newline). They
   reach the card and come back in the deny reason byte-for-byte. Pinned in Task 2.
3. **A workspace URI with spaces or percent-encoding** (`file:///Users/x/My%20Project`). Conversation History shows
   the decoded path `/Users/x/My Project`. Pinned in Task 4.
4. **A wsh path with spaces** (`C:\Users\First Last\.arc\bin\wsh.exe`, `/Users/a b/.arc/bin/wsh`). The hook command
   quotes it. Pinned in Task 3.
5. **Transcript lines agy adds later or makes huge**: an unknown `type`, or a `GENERIC` tool output over 1 MiB. The
   scan, the usage parser and the projector skip or truncate them instead of failing the whole session. Pinned in
   Tasks 4, 5 and 10.

---

### Task 1: Catalog row, lead capability and agy routes
**Depends on:** none
**Files:** `pkg/harness/catalog.go`, `pkg/harness/catalog_test.go`, `pkg/runroute/runroute.go`, `pkg/runroute/runroute_test.go`, `pkg/runroute/catalog.go`, `pkg/runroute/catalog_test.go`, `pkg/wshrpc/wshrpctypes_jarvis.go`, `pkg/wshrpc/wshserver/wshserver_jarvis.go`, `pkg/wshrpc/wshserver/wshserver_harness_test.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_runsettings.go`, `pkg/wshrpc/wshserver/wshserver_runsettings_test.go`, `pkg/wshrpc/wshserver/wshserver_runs_lead_test.go`, `pkg/agentsync/agentsync_test.go`, `pkg/agentsync/skills_test.go`, `frontend/types/gotypes.d.ts`

Spec §1 (D1, D2).

**Decisions:**
- `harness.Spec` gains `LeadCapable bool` (true for claude and pi) and `AssignsOwnSession bool` (true for agy only).
  The agy row:
  `{Runtime:"agy", Bin:"agy", Label:"Antigravity", ConsultCapable:true, RunWorkerCapable:true, SteeringRel:[".gemini","config","AGENTS.md"], SkillsRel:[".gemini","config","skills"], UpdateArgs:["update"]}`,
  placed after pi and claude, with no `NpmPackage`. Update the comment at the head of the file that lists harnesses
  and the "run workers are claude and pi only" comment.
- `harness.OperationLead Operation = "lead"`. `ValidateInstalled(rt, OperationLead)` refuses a non-lead-capable
  runtime with `harness "agy" cannot lead a run`, checked **before** the install check, so the refusal does not depend
  on whether agy is installed.
- Server sites that validate a run's own runtime or its reviewer route switch to `OperationLead`:
  - `wshserver_runs.go`: the run's own runtime (lines ~271, ~409, ~621) and its `reviewerRoute` (~452).
  - `wshserver_runsettings.go`: `reviewerRoute`.
  - Worker routes keep `OperationRunWorker`.
  - `validateRoute` gains the operation it validates. The capability refusal applies even when
    `requireInstalled` is false.
  - The engine's reviewer spawns are Task 7's.
- `wshrpc.HarnessInfo` gains `LeadCapable bool \`json:"leadcapable"\``. `ListHarnessesCommand` fills it. Run
  `task generate` (only `frontend/types/gotypes.d.ts` should change).
- `runroute`:
  - `runtimeDefaults` gains `{Runtime:"agy", ResolvedModel: operatorDefault}`.
  - `modelNamespaceValid("agy", m)` matches `^[a-z0-9][a-z0-9.-]*$`.
  - `enumerateCatalog` gains `enumerateAgy`, parsing `agy models` (skip the `Fetching available models...` line and
    any line that is not `<slug>\t<label>`; zero entries degrade to free-form, like `enumeratePi`).

**Interfaces produced** (Tasks 6, 7 and 9 rely on them): `harness.Spec.LeadCapable`, `harness.Spec.AssignsOwnSession`,
`harness.OperationLead`, `HarnessInfo.leadcapable` in TS, and `runroute.Resolve(RoutePin{Runtime:"agy", Model:"gemini-3.8-flash-high"})`
returning `ModelArgs ["--model","gemini-3.8-flash-high"]`.

**Acceptance:**
- `go test ./pkg/harness -run 'TestCatalog|TestValidateInstalled|TestLookup'`: the agy row is present; the counts
  are updated; `OperationLead` refuses agy (installed or not) and accepts claude and pi; `OperationRunWorker` and
  `OperationConsult` accept agy.
- `go test ./pkg/runroute -run 'TestResolve|TestModelNamespace|TestEnumerate'`: the agy default; slug accepted;
  `openai/gpt-5` and `Gemini 3` refused for agy; `enumerateAgy` on the exact `agy models` output quoted in the spec,
  plus one garbage line.
- `go test ./pkg/wshrpc/wshserver -run 'TestListHarnesses|TestRunSettings|TestRunLeadRuntime'`: `leadcapable` is
  true for claude and pi and false for agy; an agy reviewer route is refused even with `requireInstalled=false`; an
  agy worker route is accepted; a run started with runtime agy is refused with the message above (new
  `wshserver_runs_lead_test.go`).
- `go test ./pkg/agentsync -run 'TestApply|TestSkills|TestStatus'`: agentsync iterates the catalog. With no
  `~/.gemini/config` in a test's temp home, agy is skipped. If a test pins the harness list, update it there and add
  one case where `~/.gemini/config` exists and agy receives steering and skills.

### Task 2: `wsh agy-hook` and `pkg/agyhook`
**Depends on:** none
**Files:** `pkg/agyhook/agyhook.go`, `pkg/agyhook/agyhook_test.go`, `pkg/agyhook/testdata/preinvocation.json`, `pkg/agyhook/testdata/pretooluse_run_command.json`, `pkg/agyhook/testdata/pretooluse_ask_question.json`, `pkg/agyhook/testdata/pretooluse_view_file.json`, `pkg/agyhook/testdata/posttooluse.json`, `pkg/agyhook/testdata/stop.json`, `cmd/wsh/cmd/wshcmd-agyhook.go`, `cmd/wsh/cmd/wshcmd-agyhook_test.go`, `cmd/wsh/cmd/wshcmd-memgate.go`, `cmd/wsh/cmd/wshcmd-memgate-decide.go`, `cmd/wsh/cmd/wshcmd-memgate-decide_test.go`

Spec §2 (D3, D4, Time bound).

**Decisions:**
- **`pkg/agyhook`** is pure, with no RPC and no wsh imports.
  - `Payload` holds the fields in the spec's Verified facts: `conversationId`, `transcriptPath`, `modelName`,
    `workspacePaths`, `toolCall{name,args}`, `fullyIdle`, `terminationReason`, `error`.
  - `Plan(event string, p Payload) Emission`. `Emission` holds: the state (`""` = report nothing), the detail, and
    whether the tool is `ask_question` or `run_command` (the command line).
  - `Questions(args json.RawMessage) ([]baseds.AgentAskQuestion, error)`: each string option becomes a label; no
    description; `is_multi_select` → `MultiSelect`; no header.
  - `AnswerReason(qs []baseds.AgentAskQuestion, answers []baseds.AgentAnswerItem) string`: the exact text in spec §2.
  - `DismissedReason = "The user dismissed the question."`.
  - `Deny(reason string) []byte` encodes `{"decision":"deny","reason":...}`.
  - `Neutral(event string) []byte`: empty for PreToolUse, `{}` otherwise.
  - `PreToolUseBound = 60 * time.Minute`, and `HookTimeoutSeconds = 3720` for PreToolUse (Task 3 writes it).
  - The cwd is the **last** `workspacePaths` entry.
- **`wsh agy-hook <Event>`** (hidden, `cobra.ExactArgs(1)`).
  - Read all of stdin. Without `WAVETERM_BLOCKID`, write `Neutral(event)` and return. Otherwise run `Plan`, then:
    - Report through `publishAgentStatusData` with `Agent:"agy"`, `SessionID`, `TranscriptPath`, `Model`, `Cwd`, a
      start timestamp taken before any RPC, and `Title`.
    - The title is the first `<USER_REQUEST>` of the transcript, through the existing `titleFromPrompt`. Read it with a
      bounded head read.
    - Stamp `MetaKey_AgentTranscriptPath`, as `agent-hook` does.
  - PreToolUse runs under a context with `PreToolUseBound`. When the bound hits, write nothing (neutral) and return.
  - `ask_question`: report `asking`, call `wshclient.AskCommand(..., Wait:true)` with the same 30-minute ceiling as
    `wsh ask --wait`, write `Deny(AnswerReason…)` or `Deny(DismissedReason)`, then report `working`. On an RPC error,
    write nothing.
  - `run_command`: report `working` (detail = the command), then call the shared memgate decision under the bound
    context. `Verdict.Run == false` → `Deny(<the verdict's message>)`. An error or the bound → nothing.
  - Every error path ends `return nil`, with no stderr.
- **Memgate refactor:** move the decision in `memgateRun` (classify → fits → hold card → wait) into
  `memgateDecide(ctx context.Context, cmdline string, onHold func(any)) (memgate.Verdict, error)` in
  `wshcmd-memgate-decide.go`. It honours `ctx` in both the ask and the wait. `memgateRun` keeps its printed JSON lines
  through `onHold`, with `context.Background()`, so its behaviour is unchanged. agy-hook calls it with a no-op
  `onHold`. Read `pkg/memgate` for the verdict's message field.
- **Fixtures:** the six `testdata` files are real agy 1.3.1 payloads, shaped exactly as in the spec's Verified facts.
  Home paths become `/home/u`.

**Interfaces produced** (Task 3 relies on the command line and the timeout; Task 7 on the report fields): the command
`<wsh> agy-hook <PreInvocation|PreToolUse|PostToolUse|PostInvocation|Stop>`, `agyhook.HookTimeoutSeconds`, and status
reports carrying `Agent:"agy"` and `SessionID: <conversationId>`.

**Acceptance:**
- `go test ./pkg/agyhook`, a table test over the fixtures:
  - PreInvocation → `working`.
  - PreToolUse `view_file` → `working`, detail = `toolSummary`; with no `toolSummary` the detail is the tool name.
  - `run_command` → `working`, detail = the command line.
  - `ask_question` → asking, with the parsed questions.
  - PostToolUse → `working`.
  - Stop with `fullyIdle:true` → `idle`; with `fullyIdle:false` → no report.
  - PostInvocation → no report.
  - The cwd is the last workspace path.
- Also in `go test ./pkg/agyhook`:
  - `Neutral("PreToolUse")` is empty, `Neutral("Stop")` is `{}`.
  - `Deny` round-trips through `encoding/json`.
  - `AnswerReason` with Vietnamese labels (`"Đồng ý"`), a multi-line question and a multi-select answer keeps every
    byte (Review focus 2).
  - The dismissed text.
  - `HookTimeoutSeconds` exceeds `PreToolUseBound` by at least 60 s.
- `go test ./cmd/wsh/cmd -run 'TestMemgateDecide|TestAgyHook'`:
  - `memgateDecide` returns `Run:true` for a light command without any RPC.
  - `memgateDecide` returns promptly with a context error when its context is already done.
  - Run with `WAVETERM_BLOCKID` unset, `agy-hook` prints nothing for PreToolUse and `{}` for Stop, given each fixture
    on stdin (Review focus 1). Test it through the command's run function with a swapped stdin and stdout.

### Task 3: Install agy's hooks into `~/.gemini/config/hooks.json`
**Depends on:** none
**Files:** `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`

Spec §3 (D5).

**Decisions:**
- `installAgyHooks(home, wshPath string) error` runs from `installAgentHooksRun` beside `installOpencodePlugin`.
- A quiet skip when `<home>/.gemini/antigravity-cli` is not a directory.
- It reads `<home>/.gemini/config/hooks.json`: missing → `{}`; not a JSON object → error naming the file, file
  untouched.
- It sets the top-level `"arcterm"` key to:
  - `PreInvocation` and `Stop`: flat lists of `{"type":"command","command":<cmd>,"timeout":10}`.
  - `PostToolUse`: a `{"matcher":"*","hooks":[…]}` group, timeout 10.
  - `PreToolUse`: `{"matcher":"*","hooks":[{"type":"command","command":<cmd>,"timeout":3720}]}`.
- The 3720 is a literal in this task. Task 2's `agyhook.HookTimeoutSeconds` carries the same number; if Task 2 has
  merged, use the constant instead.
- `<cmd>` is `"<wshPath>" agy-hook <Event>`, with `wshPath` the fixed `~/.arc/bin/wsh` the other harnesses use. The path
  is quoted with double quotes so spaces and backslashes survive.
- It creates `<home>/.gemini/config/` only when `antigravity-cli` exists. It writes through a temp file and rename,
  only when the encoded content differs.
- Every other top-level key is kept.
- The summary line `install-agent-hooks` prints names agy when it installed.
- The hook schema (named top-level key, no `"hooks"` wrapper, seconds) is the one in the spec's Verified facts; don't
  use the `{"hooks":{…}}` shape some third-party docs show.

**Acceptance:** `go test ./cmd/wsh/cmd -run 'TestInstallAgyHooks'`, with a temp home:
- No `antigravity-cli` → no file.
- A fresh install → the exact JSON above.
- An existing file holding `{"claude-mem":{…},"arcterm":{<stale>}}` → `claude-mem` unchanged and `arcterm` replaced.
- A second run → mtime unchanged.
- A file containing `not json` → error, content unchanged.
- A wsh path `/home/a b/.arc/bin/wsh` and a Windows path `C:\Users\First Last\.arc\bin\wsh.exe` are each quoted
  intact in every command (Review focus 4).

### Task 4: agy sessions: provider, transcript lookup, prompts and last answer
**Depends on:** none
**Files:** `pkg/agentsessions/agy.go`, `pkg/agentsessions/agy_test.go`, `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/humanprompts.go`, `pkg/agentsessions/humanprompts_test.go`, `pkg/agentsessions/lastanswer.go`, `pkg/agentsessions/lastanswer_test.go`

Spec §7 (D8).

**Decisions:**
- **`agyProvider(root string) provider`** in `agy.go`:
  - `root` = `<home>/.gemini/antigravity-cli/brain`. `matches` = `transcript_full.jsonl`. Only files at
    `<root>/<id>/.system_generated/logs/transcript_full.jsonl` count; never `transcript.jsonl`.
  - Session id = the `<id>` directory.
  - `resumeCmd` = `agy --conversation <id>`.
- **Metadata:** `agySummaries(dbPath string) (map[string]agySummary, error)` opens
  `file:<dbPath>?mode=ro` with `mattn/go-sqlite3`, reads `conversation_id, title, workspace_uris,
  last_modified_time` once per scan, and closes.
  - The cwd is the last `workspace_uris` entry turned from a `file://` URI into a native path, percent-decoded.
  - With a missing DB, a read error or no row: title = first `USER_REQUEST`, cwd = `""`, time = file mtime. The error
    is logged once per scan, never returned.
  - Keep the reader a seam (`var agySummariesFor = agySummaries`) so tests can skip SQLite. This file is only reached
    from wavesrv paths: don't call it from anything `wsh agy-hook` imports.
- **Arms:**
  - `allProviders()`, `SessionRoot("agy")`, `ExtractSession(path, "agy")`.
  - `TranscriptForSession(root, "agy", cwd, id)` = `<root>/<id>/.system_generated/logs/transcript_full.jsonl`.
  - `HumanPrompts`: each `USER_INPUT`'s `<USER_REQUEST>` body, trimmed.
  - `LastAnswer`: the `content` of the last `PLANNER_RESPONSE` that has one.
- **Robustness:** lines are scanned with a buffer large enough for a 1 MiB step (the existing scanner limit, or
  larger), and an over-long or unparsable line is skipped, not fatal. Unknown `type` values are ignored.

**Interfaces produced** (Task 7 relies on them): `agentsessions.SessionRoot("agy")` and
`agentsessions.TranscriptForSession(root, "agy", cwd, sessionId)`, with the existing signatures.

**Acceptance:** `go test ./pkg/agentsessions -run 'TestAgy|TestHumanPrompts|TestLastAnswer|TestTranscriptForSession'`,
with a temp `brain/` holding two conversations and a temp SQLite summaries DB built in the test:
- Both are listed with their DB title and cwd.
- A DB row with no transcript (a desktop-app migration) is not listed.
- Without a DB: title from the first request, cwd `""`, no error.
- `workspace_uris` `["file:///Users/x/My%20Project"]` → cwd `/Users/x/My Project` (Review focus 3).
- `HumanPrompts` strips the `<ADDITIONAL_METADATA>` and `<USER_SETTINGS_CHANGE>` blocks.
- `LastAnswer` skips a final tool-only response.
- A 2 MiB `GENERIC` line and an unknown `type` do not stop the scan (Review focus 5).
- The resume command is `agy --conversation <id>`.

### Task 5: agy token usage: daily scan and per-transcript totals
**Depends on:** none
**Files:** `pkg/usagestats/agy.go`, `pkg/usagestats/agy_test.go`, `pkg/usagestats/usagestats.go`, `pkg/usagestats/usagestats_test.go`, `pkg/usagestats/pi_test.go`

Spec §7, Usage.

**Decisions:**
- `extractAgy(lines []string) []Record` in `agy.go`:
  - Each `PLANNER_RESPONSE` line yields a record with its `input_tokens`, `output_tokens` and `cache_read_tokens`, at
    the local day of its `created_at`.
  - Provider `agy`, model `""`, so the cost is $0 whatever the model.
  - Lines without token fields, unparsable lines and unknown types yield nothing.
- `isAgyTranscriptPath(path string) bool`: a path ending `.system_generated/logs/transcript_full.jsonl` under an
  `antigravity-cli/brain/` directory, with separators normalised.
- **Daily scan:** a scan root for `<home>/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript_full.jsonl`,
  registered in `scanRoots` like pi's (`pi.go`). Follow the incremental or caching rules the existing roots follow:
  read `usagestats.go` around `scanRoots` first.
- **Per-transcript totals:** `transcriptRecords` routes an agy path to `extractAgy` before the claude/codex fallbacks,
  as it does for opencode shadows and pi. `TranscriptUsage` and `SumTranscript`, which feed the per-run totals
  (`pkg/jarvis/usage.go`) and the agent card (`wshserver_agents.go`), then count agy.
- Update any `scanRoots` count or provider-list assertion in `usagestats_test.go` or `pi_test.go`.

**Acceptance:** `go test ./pkg/usagestats -run 'TestAgy|TestScanRoots|TestTranscriptUsage|TestSumTranscript'`:
- A transcript with three planner responses across two days sums per day.
- A `claude-sonnet-4-6` conversation (model only in the settings-change text) still costs $0.
- A `GENERIC` step and a user step add nothing.
- A truncated last line and a 2 MiB `GENERIC` line are skipped (Review focus 5).
- `TranscriptUsage` and `SumTranscript` on an agy transcript path return the agy totals, not the claude or codex
  parse.
- The scan roots include agy's.

### Task 6: `ask @agy` consults
**Depends on:** Task 1
**Files:** `pkg/consult/consult.go`, `pkg/consult/consult_test.go`

Spec §5 (D9).

**Decisions:**
- `runtimeSpecs["agy"] = {Bin:"agy", BaseArgs:["-p"]}`, with the prompt as the value of `-p`.
- No PTY: `UsePty` is false or absent; leave `runPty` in `exec.go` alone.
- No `--dangerously-skip-permissions`.
- `SupportedRuntimes()` gains agy. Restore the argv shape from `git show 5e1e8c03^:pkg/consult/consult.go`, minus
  its PTY flag.
- The operator-principles injection for non-claude runtimes applies unchanged.

**Acceptance:** `go test ./pkg/consult -run 'TestRuntimeSpecs|TestSupportedRuntimes|TestBuildArgs'`:
- agy's argv is `agy -p <prompt>` with no PTY.
- agy is in the supported list.
- An unknown runtime is still refused.

### Task 7: agy run workers: launch form, late-bound session, liveness, reviewer guard, ask tool
**Depends on:** Task 1, Task 4
**Files:** `pkg/jarvis/runexec.go`, `pkg/jarvis/runexec_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/engine_test.go`, `pkg/orchestrate/review.go`, `pkg/orchestrate/review_test.go`, `pkg/orchestrate/stagesession.go`, `pkg/orchestrate/stagesession_test.go`, `pkg/orchestrate/sessionbind.go`, `pkg/orchestrate/sessionbind_test.go`, `pkg/orchestrate/liveness.go`, `pkg/orchestrate/liveness_test.go`, `pkg/wshrpc/wshserver/wshserver.go`, `pkg/wshrpc/wshserver/wshserver_publish_test.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go`

Spec §1 (the engine's reviewer spawns) and §6 (D6).

**Decisions:**
- **`RunWorkerSpecFor` agy arm:**
  - `Args = ["--dangerously-skip-permissions", <ModelArgs…>, "-i", <prompt>]`.
  - `BaseArgs = ["--dangerously-skip-permissions", <ModelArgs…>]`.
  - It never adds `--session-id`. Drive "does this runtime take `--session-id`" from `!spec.AssignsOwnSession`, not
    from the name.
- **`ResumeWorkerArgs("agy", id, base, nudge)`** = `["--conversation", id, <base…>, "-i", nudge]`.
- **`AskTool("agy")`** = `"ask_question"`.
- **Spawn:** `jarvis.WorkerSessionId(runtime string) string`, exported from `pkg/jarvis/runexec.go` (orchestrate
  imports jarvis; jarvis cannot import orchestrate). It returns `uuid.NewString()`, or `""` for a runtime whose spec
  has `AssignsOwnSession`. Every site that generates a worker session id uses it for both the spawn option and the
  stored `SessionId`:
  - `engine.go` (task spawn ~665/674), `review.go` (~119), `stagesession.go` (~44);
  - `runexec.go` (~365, quick and orchestrator spawns).
- **Reviewer guard:** `review.go` `spawnReviewer` (~113) and `stagesession.go` `spawnStageSession` (~40) check the
  reviewer route with a new `validateLeadHarness` seam (`harness.ValidateInstalled(rt, harness.OperationLead)`), a
  package var beside `validateWorkerHarness` in `engine.go`. Task spawns keep `validateWorkerHarness`.
- **Bind:** `NoteWorkerSession(ctx context.Context, ev *wps.WaveEvent)` in `sessionbind.go`:
  - It acts on an `Event_AgentStatus` whose agent's spec has `AssignsOwnSession` and whose `SessionID` is non-empty.
  - It resolves the reporting block's tab, then the child run that owns that tab, through the owner stamp the engine
    writes at spawn (find it in `SpawnRunWorker` and the engine's child-run records).
  - Only when that **child run's own runtime** also has `AssignsOwnSession` does it set `run.SessionId`, when it
    differs, and persist. The latest id wins. A nested `agy -p` inside a claude or pi worker's block therefore never
    touches that worker.
  - A block that is no worker, or a runtime without `AssignsOwnSession`, is a no-op. Errors are logged, never
    returned.
  - It is called from `publishEvent` in `wshserver.go`, after `NoteLeadStatus`.
- **Liveness:**
  - `livenessRuntimes` and `firstTokenRuntimes` both gain agy.
  - `transcriptForRun` returns `("", "agy", true)` for an agy child with an empty `SessionId`: tracked, nothing
    written yet. Today it returns untracked, which `engine.go` (~476) skips before both the first-token and
    stuck-starting checks.
  - An agy worker that is alive but never reached its first hook (onboarding, signed out) therefore stalls at
    `FirstTokenDeadline`, and `hungWake` names it. Its comment says why agy is armed.
  - Other runtimes' empty `SessionId` keeps returning untracked.
- **`wsh agents`:** `agentHarnesses` in `wshserver_agentmsg.go` gains agy. Check `wsh agents send` types into the
  block like it does for pi; if agy's TUI needs a different submit key, note it in a comment and test the composed
  input.

**Interfaces consumed:** `harness.Spec.AssignsOwnSession` and `harness.OperationLead` (Task 1);
`agentsessions.SessionRoot("agy")` and `TranscriptForSession(…, "agy", …)` (Task 4); the `Agent:"agy"`, `SessionID`
status reports (Task 2, by contract; tests build the event directly).

**Interfaces produced:** `orchestrate.NoteWorkerSession(ctx, *wps.WaveEvent)`, `jarvis.WorkerSessionId(runtime)`.

**Acceptance:**
- `go test ./pkg/jarvis -run 'TestRunWorkerSpecFor|TestResumeWorkerArgs|TestAskTool|TestWorkerSessionId'`:
  - The agy argv and base args, with and without a model pin.
  - No `--session-id` for agy; still present for claude and pi.
  - The resume argv, and the ask tool.
  - `WorkerSessionId` is `""` for agy and a UUID for claude and pi.
- `go test ./pkg/orchestrate -run 'TestNoteWorkerSession|TestLastActivityForRun|TestTranscriptForRun|TestSpawnTaskAgy|TestAgyFirstTokenStall|TestReviewerRouteLead|TestStageSessionRouteLead'`:
  - An agy task child is stored with `SessionId ""`.
  - A status from its block binds the id; a second id rebinds.
  - A status from a non-worker block, a claude status, and an agy status from a **claude** worker's block are all
    no-ops.
  - `transcriptForRun` is tracked with path `""` before the bind, and reads the transcript under a temp `brain/`
    after it.
  - An unbound agy child with nothing written is stalled once `FirstTokenDeadline` has passed since spawn, and not
    before.
  - An agy reviewer route fails `spawnReviewer` with the "cannot lead" message and fails `spawnStageSession`.
- `go test ./pkg/wshrpc/wshserver -run 'TestAgentHarnesses|TestPublishEventBindsWorkerSession'`.

### Task 8: agy across the cockpit UI: identity, launch, resume
**Depends on:** none
**Files:** `frontend/app/view/agents/launch.ts`, `frontend/app/view/agents/launch.test.ts`, `frontend/app/view/agents/newagentmodal.tsx`, `frontend/app/view/agents/settingssurface.tsx`, `frontend/app/view/agents/channelmessages.ts`, `frontend/app/view/agents/channelderive.test.ts`, `frontend/app/view/agents/runtimemeta.ts`, `frontend/app/view/agents/runtimemeta.test.ts`, `frontend/app/view/agents/runtimelogo.ts`, `frontend/app/view/agents/cockpitrailmodel.ts`, `frontend/app/view/agents/dailychart.tsx`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/ratelimitstore.ts`, `frontend/app/view/agents/themes.ts`, `frontend/app/view/agents/session-models/agentresumestore.ts`, `frontend/app/view/agents/session-models/agentresumestore.test.ts`, `frontend/app/view/agents/session-models/agentstatusstore.ts`, `frontend/app/asset/antigravity.svg`, `frontend/tailwindsetup.css`, `pkg/blockcontroller/agentrestore.go`, `pkg/blockcontroller/agentrestore_test.go`

Spec §4.

**Decisions:**
- **`launch.ts`:**
  - `Runtime` gains `"agy"`. `RUNTIME_CMD.agy = "agy"`.
  - `RUNTIME_FLAGS.agy` = `skip-permissions` (`--dangerously-skip-permissions`), `continue` (`--continue`), `sandbox`
    (`--sandbox`).
  - `buildLaunchMeta` puts the task after `-i` for agy only, as two args `["-i", task]`.
  - `resumeArgsForAgy(sessionId: string, baseArgs: string[]): string[]` = `["--conversation", sessionId, …baseArgs]`,
    with any `--conversation <id>`, `-c` or `--continue` already in `baseArgs` dropped, the shape of
    `resumeArgsForOpencode`.
- **Resume persistence:**
  - `persistResume(oref, provider, transcriptPath, sessionId?)` gains the status's `sessionid`.
  - Its sole caller, `agentstatusstore.ts` (~175), passes `data.sessionid`.
  - For agy, the cache key and the resume id are that `sessionId`. Every agy transcript is named
    `transcript_full.jsonl`, so `sessionIdFromTranscript` would give the same key for all of them.
  - `shouldPersistResume` and the block `cmd` check accept `"agy"`.
- **`agentrestore.go`:** `agentResumeFlags["agy"] = "--conversation"`.
- **Lists:** agy joins `newagentmodal.tsx` `RUNTIMES` (glyph `◭`), `settingssurface.tsx` `FLAG_RUNTIMES`,
  `channelmessages.ts` (`@agy`), `runtimemeta.ts` (label `Antigravity`, glyph `◭`, class `text-rt-agy`),
  `runtimelogo.ts`, `cockpitrailmodel.ts`, `dailychart.tsx`, and both `PROVIDER_RANK` maps (after pi).
- **Logo:** restore `frontend/app/asset/antigravity.svg` with `git show 5e1e8c03^:frontend/app/asset/antigravity.svg`.
- **Tokens:**
  - `--color-provider-agy` and `--color-rt-agy`, `-soft`, `-line` in `tailwindsetup.css`, base `#8ecdf0`, alpha
    siblings the same way as their neighbours.
  - Every theme in `themes.ts` that overrides the other `rt-*` tokens overrides agy's too.
  - Check DESIGN.md's contrast floor for `text-rt-agy` on the rail background.

**Acceptance:**
- `npx vitest run frontend/app/view/agents/launch.test.ts frontend/app/view/agents/runtimemeta.test.ts frontend/app/view/agents/session-models/agentresumestore.test.ts frontend/app/view/agents/channelderive.test.ts`:
  - The agy startup command, and the task as `-i <task>` (a task with spaces and quotes stays one arg).
  - The flags.
  - `resumeArgsForAgy("c1", ["--continue","--dangerously-skip-permissions"])` →
    `["--conversation","c1","--dangerously-skip-permissions"]`.
  - The meta label and glyph; an unknown runtime still falls back.
  - agy resume keyed by `sessionid`: two agy blocks whose transcripts both end in `transcript_full.jsonl` get their
    own ids.
  - `@agy` mention parsing.
- `go test ./pkg/blockcontroller -run 'TestTracksAgentLive|TestShouldRestoreAgent'`: an agy block with
  `--conversation <id>` restores, one with `-i <task>` does not.
- The rendered rail row and modal entry are proven by Task 11's `agy-harness` steps 1 and 2. The chart color is proven
  by step 7.

### Task 9: Lead-only route pickers and run route resolution
**Depends on:** Task 1, Task 8
**Files:** `frontend/app/view/agents/harnessstore.ts`, `frontend/app/view/agents/harnessstore.test.ts`, `frontend/app/view/agents/route.ts`, `frontend/app/view/agents/route.test.ts`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/agents/runactions.test.ts`, `frontend/app/view/agents/runlauncher.tsx`, `frontend/app/view/agents/settingssurface.tsx`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/briefprofileview.tsx`, `frontend/app/view/jarvis/newruncontrol.tsx`

Spec §4, Pickers and Run route resolution (D2).

**Decisions:**
- `harnessstore.ts` exports a pure `leadRuntimes(harnesses: HarnessInfo[]): string[]` (installed and `leadcapable`)
  and a derived `leadRuntimesAtom`. Leave `resolveDefaultRuntime` alone: it seeds New Agent, where agy is fine.
- **Pickers.** These `<RoutePicker>`s pass `runtimes={leadRuntimes}`:
  - Lead: `runlauncher.tsx` "Lead model" (~287), `newruncontrol.tsx` "Lead model" (~133), `briefprofileview.tsx`
    "Lead route" (~530), `settingssurface.tsx` `RunRouteSection` (~957, the global run route).
  - Reviewer: `runlauncher.tsx` "Reviewers model" (~309), `newruncontrol.tsx` "Reviewers model" (~159),
    `briefrunsheet.tsx` reviewer route (~283), `briefprofileview.tsx` reviewer route (~273).
  - Stay unfiltered: the workers pickers (`runlauncher.tsx` ~296, `newruncontrol.tsx` ~144, `briefrunsheet.tsx`
    ~268, `briefprofileview.tsx` ~255) and the radar audit picker (`settingssurface.tsx` ~1621, which has its own
    list).
- **Run route resolution:**
  - `resolveEffectiveRoute` gains an optional `allow?: readonly string[]`. A candidate (task, run, channel, settings)
    whose runtime is not in `allow` is skipped. When none is left and `allow` is non-empty, it returns the first
    allowed harness's default pin (`{runtime, model: ""}`), with source `settings`.
  - `resolveChannelLaunchRoute` (`runactions.ts` ~222) passes `allow = leadRuntimes(harnesses)`.
  - Its only caller is a run launch, so a consult preference of Antigravity no longer launches every run with an agy
    lead (which the server refuses).

**Acceptance:**
- `npx vitest run frontend/app/view/agents/harnessstore.test.ts frontend/app/view/agents/route.test.ts frontend/app/view/agents/runactions.test.ts`:
  - `leadRuntimes` keeps claude and pi, and drops agy and uninstalled ones.
  - `resolveEffectiveRoute` with settings `{runtime:"agy"}` and `allow ["claude","pi"]` resolves to the first allowed
    harness's default.
  - A channel override of pi beats an agy setting.
  - No `allow` keeps today's behaviour.
  - `resolveChannelLaunchRoute` with the shared preference set to agy returns a claude or pi pin.
- The rendered filter is proven by Task 11's `agy-harness` steps 5 and 6.

### Task 10: agy transcript projector
**Depends on:** none
**Files:** `frontend/app/view/agents/agytranscriptprojection.ts`, `frontend/app/view/agents/agytranscriptprojection.test.ts`, `frontend/app/view/agents/transcriptregistry.ts`, `frontend/app/view/agents/transcriptregistry.test.ts`

Spec §7, Frontend projector.

**Decisions:**
- `projectAgyTranscript(lines: string[]): AgentEntry[]` and `extractAgyTitle(lines: string[]): string | undefined`.
  Read `pitranscriptprojection.ts` for the `AgentEntry` shapes and follow them.
- **Projection rules:**
  - `USER_INPUT` → a user entry with only the `<USER_REQUEST>` body.
  - `PLANNER_RESPONSE`: `thinking` → a thinking entry; `content` → an assistant text entry; each `tool_calls[]` → a
    tool entry, named by the tool, with its detail = `args.toolSummary`, else `args.CommandLine`.
  - The next `GENERIC` step → that tool's result, with the `Created At:` / `Completed At:` header lines stripped, and
    failed when `status` is `ERROR`.
  - Unknown types are skipped. Malformed lines are skipped.
  - A result over 64 KiB is truncated with the marker the other projectors use.
- **Registry:** `PROJECTORS.agy = { project: projectAgyTranscript, extractTitle: extractAgyTitle }`. `agentFromPath`
  maps a path containing `/antigravity-cli/brain/` (separators normalised) to agy.

**Acceptance:** `npx vitest run frontend/app/view/agents/agytranscriptprojection.test.ts frontend/app/view/agents/transcriptregistry.test.ts`.
The fixture is the four-step `ls` conversation quoted in the spec, plus an `ask_question` denied by hook.
- User, assistant, tool and result entries in order.
- The metadata blocks stripped.
- The `ERROR` result marked failed.
- The title.
- A malformed line, an unknown type and a 2 MiB result handled (Review focus 5).
- A Windows `\.gemini\antigravity-cli\brain\` path resolves to agy.
- An unknown agent still defaults to claude.

### Task 11: `agy-harness` CDP scenario and docs
**Depends on:** Task 2, Task 3, Task 5, Task 6, Task 7, Task 9, Task 10
**Files:** `scripts/cdp/scenarios.mjs`, `AGENTS.md`, `README.md`, `docs/README.md`, `docs/agents/antigravity.md`, `docs/deferred.md`, `CHANGELOG.md`

Spec §9 and the CDP part of Testing.

**Scenario `agy-harness`** (`scripts/cdp/scenarios.mjs`). Read `agent-tree-rail`, `agent-history`, `route-picker-flat`
and `usage-charts` first, and reuse their fixture and mock helpers. Arrange:
- a harness list with claude, pi and agy installed (agy with `leadcapable:false`);
- one live agy roster row;
- one agy session with a transcript fixture in agy's format;
- a `wave:dev-usage-buckets` fixture with an agy bucket.

Nothing needs agy installed. One recorded step per view, each with a screenshot:
1. "new agent modal offers Antigravity": opening the New Agent modal shows an Antigravity card, and picking it fills
   the startup command `agy`.
2. "rail shows the agy row asking": the injected row renders with the `◭` glyph, the `text-rt-agy` color, its title
   and the asking state.
3. "history opens the agy transcript": Conversation History lists the agy session; opening it shows the compact reader
   with the user message, the assistant answer and one tool row.
4. "consult picker lists Antigravity": the consult `HarnessPicker` menu contains Antigravity.
5. "worker picker lists Antigravity": the run launcher's "Workers model" picker lists Antigravity.
6. "lead picker lists no Antigravity": the run launcher's "Lead model" picker does not list it.
7. "daily chart draws the agy series": the usage surface's daily chart has an agy series whose fill resolves to
   `--color-provider-agy`.

Teardown restores every atom, file and localStorage key it touched, as `usage-charts` does for its buckets.

**Docs:**
- `AGENTS.md`: the "run workers are claude + pi only" wording becomes "leads are claude + pi; task workers are claude,
  pi and agy". Edit the line only: the file already fails prettier at HEAD, so don't reformat it.
- `README.md`: the orchestrator line and the hooks line name Antigravity.
- `docs/agents/antigravity.md` (new), with `docs/README.md` linking it. It covers:
  - what `install-agent-hooks` writes (the `arcterm` key in `~/.gemini/config/hooks.json`) and where steering and
    skills go;
  - the one-time `agy` first run (onboarding and consent are the person's);
  - what the rail cannot see (agy's own permission prompt, context size);
  - that questions are answered on the card;
  - that a run never leads on agy, even when Antigravity is the consult preference.
- `docs/deferred.md`: a new "agy as a run lead (2026-10-08)" entry: what is missing (`/compact`, a compaction event),
  why (spec D2), and where to pick it up (`harness.OperationLead`, `pkg/orchestrate/wake.go` `HandoffCompact`, agy's
  PreInvocation `injectSteps`).
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top section is dated): "Antigravity
  CLI (agy) is back as a harness: live status, questions on the card, launch and resume, consults, Conversation History,
  usage, and plan task workers."

**Acceptance:**
- `node -e "import('./scripts/cdp/scenarios.mjs').then((m) => { if (!m.SCENARIOS.some((s) => s.name === 'agy-harness')) process.exit(1); })"`
  exits 0: the module loads and the scenario is in `SCENARIOS`.
- Final runs `agy-harness` with steps 1–7 passing.
- `npx prettier --check docs/agents/antigravity.md CHANGELOG.md README.md`. Those three pass at HEAD; `AGENTS.md`,
  `docs/deferred.md` and `docs/README.md` don't, and stay unchecked.
