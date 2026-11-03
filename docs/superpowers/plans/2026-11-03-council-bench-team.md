# Council bench: council against a Claude Code agent team

**Spec:** `docs/superpowers/specs/2026-11-03-council-bench-team-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `go vet ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`

Read the spec first, especially "Approved cases" and "Calls made while planning": they fix the cases, the wiring
(`bench.Funcs`, `TeamFunc`, `TeamOutcome`), the judge tokens, the case fields, the order, the verdict's wire shape, key
reads, the token cross-check and the smoke run. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target
x86_64-windows-gnu"` (Bash). Go is the source of truth for wire types: never hand-edit `frontend/types/gotypes.d.ts`;
change the Go and run `task generate`. The plan stops at ready to run: no task starts `wsh council bench` or spends
tokens on a real pass. The one real-model call in the plan is Task 3's haiku smoke run.

Work by these principles: simple, direct solutions; KISS, YAGNI, DRY, one source of truth; no abstraction for a single
implementation; handle errors at boundaries and never swallow them silently.

### Task 1: The bench's new types and fields
**Depends on:** none
**Files:** `pkg/council/bench/cases.go`, `pkg/council/bench/judge.go`, `pkg/council/bench/judge_test.go`, `pkg/council/bench/results.go`, `pkg/council/bench/team.go`

The small interface Tasks 2, 3 and 4 build on. No behaviour change beyond what is listed.

- `cases.go`: add `VariantTeam = "team"` and price the variants from 0b's measured means: solo 2,300,000, council
  8,800,000, team 4,500,000 (rewrite the comment over `variantTokens` to say so). `AllVariants()` is unchanged here.
  `Case` gains `Retired bool `json:"retired,omitempty"`` and `Tag string `json:"tag,omitempty"``; add
  `const TeamPassTag = "team-bench-2026-11"`.
- `judge.go`: `Verdict` gains `Tokens int64`, set from the judge call's usage (`consult.Usage`).
- `results.go`: `CouncilBenchResult` gains `JudgeTokens int64 `json:"judgetokens,omitempty"``.
- `team.go` (new): `TeamOutcome{Session string; State string; Summary *council.CouncilSummary; Tokens int64; Minutes
  float64; Messages int}`, the state constants `TeamDone = "done"`, `TeamFailed = "failed"`, `TeamTimedOut =
  "timed-out"`, `TeamOptions{Lead, Mate string; Limit time.Duration}`, `DefaultTeamOptions` (opus, sonnet, 45 minutes),
  `type TeamFunc func(ctx context.Context, c Case) (TeamOutcome, error)` and
  `func RunTeam(ctx context.Context, c Case) (TeamOutcome, error)`, which here returns a failed outcome and logs that the
  team runner is not built yet. Task 3 replaces its body and keeps every name and signature.

Tests (focused): `go test ./pkg/council/bench -run 'Judge'`: the judge's `Verdict.Tokens` carries the stubbed call's
usage. The existing bench tests stay green.

### Task 2: Plan order, retired cases, the token cap and the wiring
**Depends on:** Task 1
**Files:** `pkg/council/bench/cases.go`, `pkg/council/bench/cases_test.go`, `pkg/council/bench/run.go`, `pkg/council/bench/run_test.go`, `pkg/council/bench/results.go`, `pkg/council/bench/results_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

- `cases.go`: `AllVariants()` is council then team; solo stays valid when named in `Options.Variants`. `Plan` leaves a
  retired case out unless `Options.Cases` names it, and orders items by run, then case, then variant (run 1 of every
  cell before any run 2; a case's council and team cells back to back). `Options` gains `Cap int64` (0 means
  `TokenCap`), with `const TokenCap int64 = 50_000_000`.
- `run.go`: `Run(ctx, dataDir string, opts Options, f Funcs) error`, where
  `type Funcs struct { Start StartFunc; Wait WaitFunc; Judge JudgeFunc; Remind RemindFunc; Team TeamFunc }`. Before
  each item, Run sums `Tokens + JudgeTokens` over the rows this invocation wrote; at or past the cap it starts nothing
  more, logs one line naming the spend, the cap and how many items were not run, and returns nil without calling Remind.
  A cell already running is never stopped by the cap. `runItem` gets a team branch: a nil `f.Team` or a non-done outcome
  is a row with no scores (the outcome's state, `failed` when empty); a done outcome is judged by wrapping its summary in
  `&council.Council{Id: outcome.Session, Mode: c.Mode, Summary: outcome.Summary}`. Team rows carry
  `council.HarnessVersion`, `Council` = the lead's session id, and the outcome's tokens, minutes and messages. A
  `TeamFunc` error is the context's only and ends the bench, as a start's does today. Both paths copy the verdict's
  `Tokens` into the row's `JudgeTokens`.
- `results.go`: `Summarize` orders a harness's variants solo, council, team.
- `wshserver_council.go`: `councilBenchWiring` becomes `bench.Funcs`, with `Team: bench.RunTeam`. The tracking wrapper
  wraps Start and Wait as today; a team cell is stopped by the run context's cancel, which `bench stop` already does.

Tests (focused): `go test ./pkg/council/bench -run 'Plan|Run|Summarize|LoadCases'` and
`go test ./pkg/wshrpc/wshserver -run 'CouncilBench'`, covering: the plan's order for 2 cases × 2 variants × 2 runs; a
retired case left out of a bare plan and included when named; the team price in the estimate; the cap stops new items
once the rows' tokens plus judge tokens reach it, with Remind not called, and a cap never reached runs every item; a done
team outcome is judged and scored, a failed and a timed-out one are rows with no scores and are not judged; a nil `Team`
is a failed row; `JudgeTokens` lands in the row; the server wiring tests pass with the new struct.

### Task 3: The team runner, its report parser, its token count and the smoke run
**Depends on:** Task 1
**Files:** `pkg/council/bench/team.go`, `pkg/council/bench/team_test.go`, `pkg/council/bench/teamprompt.go`, `pkg/council/bench/teamreport.go`, `pkg/council/bench/teamreport_test.go`, `pkg/council/bench/teamtokens.go`, `pkg/council/bench/teamtokens_test.go`, `pkg/council/bench/testdata/team-smoke/counter.go`

Replace `RunTeam`'s body with the real runner: `RunTeam` calls `runTeam(ctx, c, DefaultTeamOptions)`.

- **Folder.** Copy the case's project to a fresh temp folder and write `.claude/settings.json` there with
  `{"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}}`. Remove the folder when the cell ends; a failed removal is
  logged, not fatal.
- **Prompt** (`teamprompt.go`). Port 0b's prompt from the data dir (`council-bench/work/v3/review.md` for Review,
  `brainstorm.md` for Brainstorm) with the spec's two changes, no Scout and no Write tool: drop the Scout step, cost rule
  1 (read once into notes.md) and every mention of notes.md, and the Write line of the tools and the shared block; the
  agent-call count is one per role. The lead (on `opts.Lead`) coordinates, adds no findings of its own, spawns one
  teammate per role of the case's group (roles and briefs from `council.ExpertsFor(c.Group)`, each with `model` =
  `opts.Mate`), runs the propose / argue rounds with the remaining cost rules, and ends with its report as its final
  message in this shape (the one the parser reads): `Answer: <one sentence>`, then
  `## What to do, most important first`, then numbered items `1. <title>` / `   Why: <why, with path:line>` /
  `   Disagrees: <who and why, or "no one">`, at most 5 for Review and 3 for Brainstorm. Build it from the case's
  feature, question and files.
- **Launch.** `claude -p --model <opts.Lead> --output-format json --permission-mode bypassPermissions --strict-mcp-config
  --disallowedTools Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch`, prompt on stdin, cwd the temp folder,
  the environment with every `WAVETERM_*` variable removed, and a context limited to `opts.Limit`. The launch goes
  through a package variable (as `runClaude` is in `judge.go`) so tests replace it and no test starts claude.
- **Result.** Read the JSON result's `result`, `session_id`, `is_error` and `modelUsage`. Outcome states: `timed-out`
  when the limit fired while the caller's context is alive; `failed` on a non-zero exit, `is_error`, a report with no
  items, or any key read (below); `done` otherwise. The function's error is the caller's context error only.
- **Report parser** (`teamreport.go`). Into `council.CouncilSummary`: `Answer`, and `Directions` with rank, title and
  reasoning (the Why line, then the Disagrees line). It skips text around the report and tolerates a missing Why or
  Disagrees line; zero items is an error the runner turns into `failed`.
- **Transcripts** (`teamtokens.go`). Read the lead's transcript and every teammate transcript of the session under
  `~/.claude/projects/`: the lead's `<session>.jsonl` and `<session>/subagents/*.jsonl` (0b's
  `council-bench/work/v3/tokens.sh` and `run.sh` in the data dir; confirm with the smoke run). From them:
  - **Tokens**: each assistant message once (lines that share a `message.id` are one message), input + cache read +
    cache creation + output, the count `pkg/consult` uses. Compare it with `modelUsage` summed over every model (the
    same four fields); a gap over 5% is logged with both figures, and the row keeps the transcripts' count.
  - **Messages**: the `SendMessage` tool uses, each tool-use id once.
  - **Key reads**: tool uses other than Agent, Task and SendMessage whose input names the `council-bench` folder
    (`council-bench[/\\]`, as 0b's `run.sh` matched). One or more makes the cell `failed`, with a log line naming the
    count.
  - Minutes is wall time to a tenth. Report how many teammate transcripts were read, for the smoke run.
- **Smoke run.** `TestTeamSmoke` in `team_test.go` skips unless `ARC_BENCH_SMOKE=1`. It runs `runTeam` with haiku for
  lead and teammates and a 15-minute limit on a Review case whose project is `testdata/team-smoke/` (one small Go file
  with an obvious bug), group `ui-feature`, and asserts state `done`, at least one parsed item, at least one teammate
  transcript read, `Messages` ≥ 1, and the transcripts' tokens within 5% of `modelUsage`. It judges nothing.

Tests (focused): `go test ./pkg/council/bench -run 'Team'` covering: the parser on a well-formed report, one with
missing Why/Disagrees lines, one wrapped in extra text, and one with no items; over fixture transcripts the test writes
(a lead file plus two teammate files, one message split over two lines that share an id): the token count with that
message once, the SendMessage count, a key read found (and a path elsewhere not counted), and the modelUsage gap
logged; the launch seam: the args carry every flag above, the environment has no `WAVETERM_*`, the settings file is
written, a non-zero exit is `failed`, a key read is `failed`, a limit that fires is `timed-out`, a cancelled caller
returns its context error, and a done result is parsed into the summary.

Acceptance also needs the smoke run itself, once:
`ARC_BENCH_SMOKE=1 CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/council/bench -run '^TestTeamSmoke$' -v -timeout 20m`.
It must pass; put its state, item count, teammate transcripts, messages, tokens, modelUsage and minutes in the commit
message body. If it cannot pass for a reason outside the code (no claude login, agent teams unavailable), report that
instead of weakening the test.

### Task 4: The go / no-go rule
**Depends on:** Task 1 (uses `VariantTeam`, `Case.Tag` and `CouncilBenchResult`'s fields)
**Files:** `pkg/council/bench/decision.go`, `pkg/council/bench/decision_test.go`

`CouncilBenchDecision{Outcome, Reason string; CouncilRecall, TeamRecall float64; Keys int; CouncilTokens, TeamTokens
float64}` (lowercase json names) with outcomes `go`, `no-go` and `not decided`, and
`func Decide(results []CouncilBenchResult, caseIds []string) CouncilBenchDecision`. It reads only rows of
`council.HarnessVersion` for those cases and the council and team variants, and per cell the latest two runs that ended
done (by `Date`). A cell with fewer than two makes the outcome `not decided` with a reason naming each such cell
(`incomplete: bugs-orchestrate team has 1 of 2 scored runs`). Otherwise a cell's recall and tokens are its two runs'
mean, and each side's recall and tokens are summed over the cases. **Go**: team recall ≥ council recall − 1 and team
tokens < 0.8 × council tokens. **No-go**: team recall ≤ council recall − 2. **Not decided**: anything else. The reason
states both sides' recall out of the keys and the token ratio.

Tests (focused): `go test ./pkg/council/bench -run 'Decide'`, covering: go just inside both thresholds (recall −1,
tokens 0.79×); not decided at tokens exactly 0.8× and at recall −1.5; no-go at recall −2; go when the team is above the
council; an incomplete cell named; rows of another harness, another case or the solo variant ignored; only the latest
two scored runs of a cell counted.

### Task 5: The verdict in `bench results`, and the bench command's defaults and words
**Depends on:** Task 2, Task 4 (uses `Decide` and `CouncilBenchDecision`)
**Files:** `pkg/wshrpc/wshrpctypes_council.go`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`, `CHANGELOG.md`

- Wire: `CouncilBenchResultsRtnData` gains `Verdict *bench.CouncilBenchDecision `json:"verdict,omitempty"``; rewrite
  `CommandCouncilBenchData`'s comment so empty variants mean council and team; run `task generate`.
- `CouncilBenchResultsCommand` loads the cases (`bench.LoadCases`), takes the ids tagged `bench.TeamPassTag` (retired or
  not), and sets the verdict from `bench.Decide` only when there is at least one; a cases load error leaves the verdict
  out and is logged.
- `wshcmd-council.go`: `councilBenchTable` prints `verdict: <outcome>: <reason>` under the runs table when the verdict is
  set (also when no runs exist yet, in place of "no bench results yet"). `--runs` defaults to 2. Rewrite the `--runs`
  and `--variant` help (variants are council, team and solo) and `councilBenchCmd`'s Long text: a bare bench runs
  council and team twice on the cases not retired, the plan's prices are 0b's measured means, and the bench stops
  starting cells at the 50M token cap.
- `CHANGELOG.md`: one line under the top section's `Changed` (open `## Unreleased` above a dated top section):
  `wsh council bench` now runs the council against a Claude Code agent team on two new cases, stops at a 50M token cap,
  and `wsh council bench results` says whether the team is a go.

Tests (focused): `go test ./pkg/wshrpc/wshserver -run 'CouncilBenchResults'` and `go test ./cmd/wsh/cmd -run 'CouncilBench'`,
covering: the results command sets the verdict for tagged cases and leaves it out with none; the table prints the
verdict line, and none when the verdict is absent; a bare bench asks for 2 runs. After `task generate`, `task check:ts`
passes (give it a timeout over 2 minutes).

### Task 6: Build the two approved cases
**Depends on:** none
**Files:** `scripts/council-bench-cases.mjs`, `scripts/council-bench-cases.test.mjs`

A Node script, hand-formatted with 4-space indents (never run prettier on it), that installs the spec's two approved
cases, `spec-live-agents` (snapshot `0d452589e`) and `bugs-orchestrate` (snapshot `18e85a3fa^`, i.e. `16abe9e10`), into
the packaged app's data dir (`%LOCALAPPDATA%\dev.arc.app\data` on Windows, `~/Library/Application Support/dev.arc.app`
on a Mac; `--data-dir <path>` overrides). The snapshots, files, features, questions, key lines and fix commits are the
spec's, word for word, held in one table in the script.

- For each case: `git archive <snapshot>` of the repo into `<data dir>/council-bench-projects/<id>` (replacing an
  earlier copy), then delete any file under `docs/` whose text names one of the case's fix commits by hash or subject,
  except the files in the case's file list (for `spec-live-agents` the spec and plan under review stay).
- **Leak check**, before anything is written to `cases.json`: grep the project for each fix commit's subject and each key
  line verbatim. A hit prints the file and the needle and exits nonzero, leaving `cases.json` unchanged.
- Write each key to `<data dir>/council-bench/keys/<id>.md` (`K1: …` lines), then update `cases.json`: mark 0b's four
  cases (`newcomer`, `services-bugs`, `agents-bugs`, `services-sleep`) `"retired": true`, and add or replace the two new
  cases with mode `review`, group `ui-feature`, solo group `solo-ui`, tag `team-bench-2026-11`, forward-slash absolute
  paths as the existing entries use. Keep every other field and case as it is. Rerunning gives the same result.
- `--dry-run` prints what it would do and writes nothing.

Tests (focused): `npx vitest run scripts/council-bench-cases.test.mjs`, on the script's exported pure parts: the leak
check finds a planted subject and a planted key line and passes a clean tree; the `cases.json` update retires 0b's cases,
adds the two new ones, keeps an unknown extra case and field untouched, and is idempotent.

Then run the script for real (no `--dry-run`) and check it with a one-off `bench.LoadCases` read of the real data dir (a
throwaway test or `go run` file, not committed) showing both new cases load with 4 key lines each and no warning. Put
the script's output in the commit message body.
