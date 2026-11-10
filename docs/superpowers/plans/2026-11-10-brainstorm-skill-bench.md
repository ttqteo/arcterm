# Brainstorm skill bench: implementation plan

**Goal:** Add `brainstorm` as a fourth council-bench variant: `claude -p` runs Arc's brainstorm skill on a Brainstorm
case, a driver plays the person and the skill's judge and builder check, and the bench judge scores the design against
the case's key, in the same table as council, team and solo, split by mode.

**Architecture:** All in `pkg/council/bench`, plus `pkg/brainstormcheck` made a leaf package (Task 1: it would
otherwise close an import cycle), the results wire type, the `wsh council bench` CLI, and a `go run` entry point. The
bench's interface lands early (Task 2: the variant, the row fields, the `BrainstormFunc` seam and how its outcome
becomes a row); the fake wsh, the pure driver and the design judge are built beside it; the runner joins them; the
entry point and the wavesrv wiring come last.

**Spec:** `docs/superpowers/specs/2026-11-10-brainstorm-skill-bench-design.md` — read it whole, including its last
section, "Calls made while planning", which settles what the spec left open; every task below follows it.

**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/brainstormcheck ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`

Rules for every task:

- Go tests on Windows need cgo: prefix with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash).
- No test starts `claude`: fake the existing seams `startLead` (`team.go`) and `runClaude` (`judge.go`).
- Never hand-edit generated files; run `task generate` after changing a type that crosses the wire.
- Check formatting only on files you touch (`gofmt -l <files>`); never format the tree.
- Errors are handled where they cross a boundary (a launch, a file, a parse) and become a failed row or a reminder with
  a reason; nothing is swallowed silently: every failure is logged with `[council-bench]` and the case id.

### Task 1: `pkg/brainstormcheck` becomes a leaf package
**Depends on:** none
**Files:** `pkg/brainstormcheck/brainstormcheck.go`, `pkg/brainstormcheck/brainstormcheck_test.go`, `pkg/brainstormcheck/judge.go`, `pkg/brainstormcheck/judge_test.go`, `pkg/wshrpc/wshserver/wshserver_brainstorm.go`, `pkg/wshrpc/wshserver/wshserver_brainstorm_test.go`, `pkg/wshrpc/wshserver/wshserver_brainstormdecide.go`, `pkg/wshrpc/wshserver/wshserver_brainstormdecide_test.go`

Spec call 5. Today `brainstormcheck` imports `pkg/jarvis` and `pkg/waveobj` only for its watcher half, and `jarvis` →
`wshrpc` → `council/bench`, so the bench (Task 7) cannot import it.

- Move the watcher half — `ActionKind` and its `Wait` / `Deliver` / `Fail`, `Action`, `Decide`, `DecideJudge`, `decide`,
  `EmptyReportReason`, `JudgeEmptyReason`, and `unusableHead` if only `DecideJudge` uses it — into the new
  `pkg/wshrpc/wshserver/wshserver_brainstormdecide.go`, their one user's package, unexported where nothing outside
  the package needs them. Move their tests from `brainstormcheck_test.go` and `judge_test.go` into
  `wshserver_brainstormdecide_test.go` unchanged in what they assert. Update `wshserver_brainstorm.go` and
  `wshserver_brainstorm_test.go` to the moved names.
- Rename `judgeFileBytes` to `JudgeFileBytes` (exported, not wrapped); the moved `DecideJudge` calls it.
- `pkg/brainstormcheck` and its tests then import neither `pkg/jarvis` nor `pkg/waveobj`.

Tests (focused): `go list -deps ./pkg/brainstormcheck` lists no `pkg/jarvis`, `pkg/waveobj` or `pkg/wshrpc`;
`go test ./pkg/brainstormcheck` (a small package) and
`go test ./pkg/wshrpc/wshserver -run 'Decide|Brainstorm'` pass, with every moved test present.

### Task 2: The brainstorm variant, its row fields and its seam
**Depends on:** none
**Files:** `pkg/council/bench/cases.go`, `pkg/council/bench/cases_test.go`, `pkg/council/bench/results.go`, `pkg/council/bench/results_test.go`, `pkg/council/bench/run.go`, `pkg/council/bench/run_test.go`

Land the bench interface every other bench task builds on.

- `cases.go`: `VariantBrainstorm = "brainstorm"`; `variantTokens[VariantBrainstorm] = 5_000_000` with a comment that it
  is to re-measure after the first bench; `variantOrder` gains it last; `AllVariants()` returns council, team,
  brainstorm. `Plan` leaves a `brainstorm` item out for a case whose mode is not `council.ModeBrainstorm` (named or
  not), and its estimate counts only the items it keeps.
- `results.go`: `CouncilBenchResult` gains `Mode string "mode,omitempty"`, `Skill string "skill,omitempty"`,
  `Decisions int "decisions,omitempty"`, `RecallDone int "recall_done,omitempty"`,
  `MatchesDone map[string]int "matches_done,omitempty"`, `Questions int "questions,omitempty"`. Do not touch
  `Summarize` or `CouncilBenchRow` (Task 3 owns them). `CouncilBenchResult` crosses the wire
  (`CouncilBenchResultsRtnData.Results`), but do not run `task generate` here: Task 3 runs it after its own wire change
  and its regenerated `frontend/types/gotypes.d.ts` carries these fields too.
- `run.go`: `Funcs` gains `Brainstorm BrainstormFunc`. Define, in `run.go`:
  ```go
  // BrainstormOutcome: State is TeamDone, TeamFailed or TeamTimedOut; Final and AtDone are set only when done.
  type BrainstormOutcome struct {
      Session     string
      State       string
      Skill       string
      Tokens      int64   // the agent's turns, the skill's judge and the builder reviewer
      JudgeTokens int64   // both bench judge calls
      Minutes     float64
      Turns       int
      Questions   int
      Decisions   int     // decision parts at the final mark
      Final       Verdict // the final mark
      AtDone      Verdict // the done mark
  }
  type BrainstormFunc func(ctx context.Context, c Case) (BrainstormOutcome, error) // error is ctx's only
  ```
  `runItem` sets `row.Mode = c.Mode` on every row and sends a brainstorm item to a new `runBrainstormItem`, shaped like
  `runTeamItem`: nil `f.Brainstorm` is a failed row with a log line; a non-ctx error is a failed row; otherwise the row
  takes Session (as `Council`), State (failed when empty), Skill, Tokens, JudgeTokens, Minutes, `Messages = Turns`,
  Questions; when done also `Keys`, `Decisions`, `Recall`/`Matches`/`Wrong` from `Final`, `RecallDone`/`MatchesDone`
  from `AtDone`.

Tests (focused): `go test ./pkg/council/bench -run 'TestPlan|TestAllVariants|TestRunBrainstormItem|TestResultRoundTrip'`.
They prove: `Plan` skips brainstorm on a Review case and keeps it on a Brainstorm case, with the estimate matching; a
bare plan includes brainstorm; a row with every new field survives `AppendResult` → `LoadResults`, and a line written
before the fields existed still reads; `runBrainstormItem` with a fake `BrainstormFunc` builds the right row for done,
failed, timed-out and nil-func outcomes; every row carries its case's mode. Fix any existing test the new
`AllVariants` breaks.

### Task 3: Results split by mode, on the wire and in `wsh council bench`
**Depends on:** Task 2
**Files:** `pkg/council/bench/results.go`, `pkg/council/bench/results_test.go`, `pkg/council/bench/run_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`, `frontend/types/gotypes.d.ts`

- `CouncilBenchRow` gains `Mode string "mode"`, `Skill string "skill,omitempty"`, and `RecallDone`, `Decisions`,
  `Questions` (ints, `recall_done`, `decisions`, `questions`, omitempty), each summed over the row's scored runs
  (spec call 11).
- `Summarize(results []CouncilBenchResult, modes map[string]string) []CouncilBenchRow` groups by harness, mode,
  variant and skill. A row's mode is its own `Mode`, else `modes[r.Case]`, else `""`. Order: newest harness first, then
  mode (review, brainstorm, then `""`), then variant (`compareVariant`), then skill. Update every caller, including
  `run_test.go` (it calls `Summarize(runs)`).
- `CouncilBenchResultsCommand` loads the cases before summarizing and passes the case id → mode map (`LoadCases`
  returns retired cases too); when cases cannot be read it passes nil and keeps today's logging.
- `task generate` (the row crosses the wire); commit the regenerated `frontend/types/gotypes.d.ts`, which also carries
  Task 2's new `CouncilBenchResult` fields — check they are in it.
- `councilBenchTable` prints a Review section and a Brainstorm section (a heading each; rows of an unknown mode under a
  third, "Unknown mode", only when there are any), each with today's columns; the Brainstorm section adds `skill`,
  done-mark recall (`RecallDone/Keys`), `decisions` and `questions` columns. Under the Brainstorm section, one note
  line: council items are cut at 3, while brainstorm scores every decision. The planned-items count (near line 1129)
  lists brainstorm too.
- `councilBenchCmd`'s `--variant` help and its Long text name brainstorm among the variants (default council, team
  and brainstorm, brainstorm only on Brainstorm cases).

Tests (focused): `go test ./pkg/council/bench -run 'TestSummarize'` (a council row from a Review case and one from a
Brainstorm case land in separate rows; an old line with no mode takes the map's mode; a case that is gone groups under
`""`; two brainstorm skills never add up; `RecallDone`, `Decisions`, `Questions` sum over scored runs only);
`go test ./pkg/wshrpc/wshserver -run 'TestCouncilBenchResults'` with a new case proving `CouncilBenchResultsCommand`
fills an old line's mode from cases.json; `go test ./cmd/wsh/cmd -run 'TestCouncilBench'` (the two sections, the
note, the new columns, the planned count, the help naming brainstorm).

### Task 4: The fake wsh
**Depends on:** none
**Files:** `pkg/council/bench/fakewsh.go`, `pkg/council/bench/fakewsh_test.go`

- `writeFakeWsh(binDir, requestsPath string) error` writes a POSIX `sh` script named `wsh` (mode 0755) into `binDir`,
  as a Go string constant (not `go:embed`), with the requests file's path baked in with forward slashes
  (`filepath.ToSlash`) and shell-quoted.
- `wsh brainstorm judge <file> [--line <text>]` appends `{"cmd":"judge","file":"<file>","line":"<text>"}` and prints
  `judge started`; `wsh brainstorm check <file>` appends `{"cmd":"check","file":"<file>"}` and prints
  `builder check started`. Values are JSON-escaped (backslash, double quote; tab, CR and LF become spaces). Every other
  invocation (`ui reveal …`, `jarvis complete --report …`, no arguments) exits 0 and prints nothing.
- `type wshRequest struct { Cmd, File, Line string }` with JSON tags `cmd`, `file`, `line`, and
  `readRequests(path string) ([]wshRequest, error)`: a missing file is no requests; a line that is not JSON is an error
  naming the line.

Tests (focused): `go test ./pkg/council/bench -run 'TestFakeWsh'`. Runs the script for real with `sh` (skip the test
when `exec.LookPath("sh")` fails): a judge with a `--line` holding a quote, a backslash and a newline; a judge without
`--line`; a check; `ui reveal x` and `jarvis complete --report r` printing nothing with exit 0; `readRequests` returning
the three requests in order.

### Task 5: The pure driver: reading `brainstorm.json` and choosing the next line
**Depends on:** none
**Files:** `pkg/council/bench/brainstormdriver.go`, `pkg/council/bench/brainstormdriver_test.go`

The spec's "The driver loop" and its calls 1, 2 and 3, as pure code (no files, no processes).

- `type brainstormState` holds what the driver reads of the file: `question` (`n`, `text`, `options[]` with `label` and
  `pick`), `working`, `parts[]` (`id`, `title`, `body`, `state`, `kind`, `was`), `history[]` (`kind`, `a`,
  `superseded`), `done`, `check` (as `*` with `yours[]` holding `a`), `spec`.
- `parseBrainstormState(raw []byte) (brainstormState, error)` applies the skill's "broken" rules (`skills/brainstorm/SKILL.md`,
  "Arc treats the file as broken, and shows an error instead of the brainstorm, unless"): `v` is 1, `title` a string,
  `parts` an array of unique non-empty ids, every non-note part's state one of yours/guess/asked/open, `question` null or
  an object with a number `n` and a string `text`, `check` null or an object. The error names the first rule broken.
- `type step struct { Kind stepKind; Line string; ScoreDone bool; Reason string }` with kinds `stepJudge`,
  `stepCheck`, `stepSend`, `stepFinished`, `stepStuck`. `nextStep(s brainstormState, pending string) step`, `pending`
  being `""`, `"judge"` or `"check"`, takes the first that applies, in the spec's order 1–8 with the "Agent's call
  (builder question 5)" amendment: 1 `judge` pending → `stepJudge`; 2 `check` pending → `stepCheck`; 3 a question
  with options → send the `pick` option's label, with no options → `brainstorm: guess`; 4 a decision part with `was` →
  `brainstorm: keep every change`; 5 no question open and a decision is a `guess` → `brainstorm: confirm every guess`;
  6 `done`, `check` null, every decision `yours` → send `brainstorm: check` with `ScoreDone`; 7 an entry of
  `check.yours` with no `a` → `brainstorm: builder decide`; 8 `check` set, every entry answered, every decision `yours`,
  no question → `stepFinished`. Otherwise `stepStuck` with a reminder line naming what is missing under arc:brainstorm's
  rules (`question` null with `done` false; `working` set with no request; `done` with an `asked` or `open` part;
  `options` with no `pick`). Decisions are parts without `kind: "note"`.
- `decisionItems(s) []council.CouncilDirection`: every decision part except id `builder`, in file order, title as
  `Title`, body as `Reasoning`. `answeredQuestions(s) int`: `history` entries of kind `question` with a non-empty `a`
  and not `superseded`.

Tests (focused): `go test ./pkg/council/bench -run 'TestNextStep|TestParseBrainstormState|TestDecisionItems|TestAnsweredQuestions'`.
`TestNextStep` is a table with one case per branch above (each of the four stuck shapes too), plus the order cases:
a pending judge beats an open question; `was` beats confirm-every-guess; a guess left by `builder decide` during the
check gets confirm-every-guess, not finished. `TestParseBrainstormState` has one case per broken rule and the skill's
own example file (copy the JSON from the SKILL.md example into the test) parsing clean.

### Task 6: Judging a whole design
**Depends on:** none
**Files:** `pkg/council/bench/judge.go`, `pkg/council/bench/judge_test.go`

- `JudgeDesign(ctx context.Context, c Case, items []council.CouncilDirection) (Verdict, error)`: one `runClaude` call
  on `judgeModel` like `Judge`, judging every item (no `TopBrainstorm` cut, no Kept list), its `Tokens` carried on
  failure too. Refactor so `Judge` and `JudgeDesign` share one prompt builder and one parser, parameterized by the
  items shown and the kept list; `Judge`'s prompt and parsing stay byte-for-byte what they are today.
- No items is an error (nothing to judge).

Tests (focused): `go test ./pkg/council/bench -run 'TestJudge'`: `JudgeDesign` on 6 items names all 6 in the prompt,
says to judge 6, has no kept section, and keeps a match at rank 6 while dropping rank 7; a reply with no verdict is an
error that still carries the tokens; the existing `Judge` tests pass unchanged (they prove the refactor kept its
prompt).

### Task 7: The runner: `RunBrainstorm`
**Depends on:** Task 1 (the leaf brainstormcheck and JudgeFileBytes), Task 2 (BrainstormOutcome, VariantBrainstorm), Task 4 (writeFakeWsh, readRequests), Task 5 (nextStep, parseBrainstormState, decisionItems), Task 6 (JudgeDesign)
**Files:** `pkg/council/bench/brainstorm.go`, `pkg/council/bench/brainstorm_test.go`, `pkg/council/bench/teamtokens.go`

`RunBrainstorm(ctx, c Case) (BrainstormOutcome, error)` is the real `BrainstormFunc`; it calls an unexported
`runBrainstorm(ctx, c, opts brainstormOptions)` (model `opus`, 60 turns, 60 minutes) that a test drives. Follow the
spec's "How the bench drives the skill", "Launch and limits" and calls 1, 3, 6, 7, 8, 9, 10:

- Set up: copy the project (`copyProject`) to a temp folder, removed after; a temp bin folder with `writeFakeWsh`; a
  temp plugin folder `arc` (`.claude-plugin/plugin.json` naming `arc`, and the `brainstorm` tree from `skills.FS`); find
  superpowers in `<claude config dir>/plugins/installed_plugins.json`. The config dir is `CLAUDE_CONFIG_DIR` or
  `~/.claude`: factor that out of `claudeProjectsDir` in `teamtokens.go` into one helper both use. `Skill` = first 8
  hex of the sha256 of the embedded `SKILL.md`, a space, `superpowers@<version>`. Any setup failure is a failed outcome
  with a logged reason.
- Environment: `withoutWaveEnv(os.Environ())` minus `ARC_RUN_AGENT`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
  `CLAUDE_CODE_SSE_PORT` and `CLAUDE_CODE_PLUGIN_DIRS` (the spec's "The fake wsh" section; auth and provider variables
  stay), with the bin folder first on `PATH` (keep the variable's existing name: `Path` on Windows).
- Every launch goes through `startLead`: `-p --model opus --output-format json --permission-mode bypassPermissions
  --strict-mcp-config --setting-sources project,local --plugin-dir <arc> --plugin-dir <superpowers>`; the agent's first
  turn adds `--session-id <uuid>`, later turns `--resume <uuid>`; the skill's judge and reviewer add
  `--disallowedTools` naming every tool but Read, Grep, Glob, Write and Bash, and run with no session flags.
- The first prompt asks to brainstorm the case's feature and question with superpowers:brainstorming inside Arc, reading
  `Case.FileList()` first, and says the answers come as the person's. It never mentions a benchmark, a key, a test or
  who answers.
- The loop, after every turn: count the turn and its `modelUsageTotal`; a failed turn or an unparseable result counts
  toward the in-a-row failure rule; find `brainstorm.json` (call 1), parse it, read the requests, take the first
  unconsumed request's command as `pending`, call `nextStep`, and act: `stepJudge` runs the skill's judge
  (`ReadJudgeInput`, `JudgePrompt` with the request's line and `rand.Shuffle`, a temp report path, `JudgeFileBytes`,
  write `judge.json` at `JudgeResultPath`, send `JudgedLine`, or `JudgeFailedLine(reason)`); `stepCheck` resolves the
  spec against the copy (a missing spec is a reminder, call 6), runs the reviewer on `brainstormcheck.Prompt`, writes
  its report at `ReportPath`, sends `Line`; `ScoreDone` snapshots `decisionItems`; `stepStuck` sends the reminder
  (4th stuck turn: failed with the reason); `stepFinished` judges the done snapshot and the final items with
  `JudgeDesign` and ends done (either judge failing: failed). Past 60 turns or 60 minutes: `timed-out`.
- After the run, whatever its state: read the agent's transcript (`leadTranscript`, `readTranscripts`); any `KeyReads`
  turns a done outcome into failed with that reason. `Tokens` sums every launch's `modelUsageTotal`; `JudgeTokens` the
  two `JudgeDesign` calls. A cancelled `ctx` returns ctx's error.

Tests (focused): `go test ./pkg/council/bench -run 'TestRunBrainstorm|TestTeam'` (the second proves the config-dir
helper kept the team's transcript lookup), with `startLead` and `runClaude` faked and `CLAUDE_CONFIG_DIR` pointed at a
temp folder holding a fake `installed_plugins.json` and transcript. The fake `startLead` plays a script by writing
`brainstorm.json` and `requests.jsonl` in the copy: two questions (one with options, one without), one approach
question through the judge (its fake judge launch writes the report file), done, check (its fake reviewer writes a
report), one builder question, finished. Assert the lines the driver sent in order; the launch flags (setting sources,
both plugin dirs, `--resume` after the first turn); the environment (no `WAVETERM_*`, `ARC_RUN_AGENT`, `CLAUDECODE`
or `CLAUDE_CODE_PLUGIN_DIRS`, set in the test beforehand; the bin folder first on the path); the prompt never
containing "bench"; and the outcome (state done, `Questions`, `Decisions` without the `builder` part, both verdicts,
token sums, `Skill`). Also: a stuck agent fails on its 4th stuck turn; two invalid files in a row fail; a turn limit
times out; a key read fails a done run.

### Task 8: The `go run` entry point, the wavesrv wiring and the docs
**Depends on:** Task 3 (shares `wshserver_council.go` and its test), Task 7 (uses RunBrainstorm)
**Files:** `cmd/council-bench-brainstorm/main.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `docs/guide/council.md`, `docs/hand-checks.md`, `CHANGELOG.md`

- `cmd/council-bench-brainstorm/main.go`: flags `--case <id>` (required, repeatable), `--runs N` (default 1),
  `--data-dir <path>` (default `%LOCALAPPDATA%\dev.arc.app\data` on Windows, `~/Library/Application
  Support/dev.arc.app` on a Mac, as `scripts/council-bench-cases.mjs` documents); it calls `bench.Run` with
  `Options{Cases, Variants: ["brainstorm"], Runs}` and `Funcs{Judge: bench.Judge, Brainstorm: bench.RunBrainstorm}`,
  logs to stderr, exits 1 with the error on failure, and cancels on Ctrl+C.
- `councilBenchWire` adds `Brainstorm: bench.RunBrainstorm`; check `tracking` passes the new func through.
  `TestCouncilBenchWireHasEveryCall` asserts `Brainstorm` is set.
- `docs/guide/council.md` (Vietnamese) has only the command row for the bench (near line 339): add a short bench
  section after the command table, in the guide's language and style, naming the variants (brainstorm included),
  what brainstorm scores (every decision of the design, the done and final marks), the table split into Review and
  Brainstorm, and the `go run ./cmd/council-bench-brainstorm --case <id>` command.
- `docs/hand-checks.md`: one `- [ ] (arcterm)` line: run `go run ./cmd/council-bench-brainstorm --case run-pause` →
  a `brainstorm` row in `council-bench.jsonl` with `skill`, `recall_done` and the final recall; in the agent's
  transcript the `arc:brainstorm` skill that loaded is the checkout's (the temp plugin dir), not `~/.arc/claude-mod`,
  and superpowers:brainstorming loaded.
- `CHANGELOG.md`: the top `Unreleased` section has `Changed` and `Fixed` but no `Added`: create `### Added` in it
  (above `Changed`) with one line for users: `wsh council bench` also measures Arc's brainstorm skill, and its results
  table is split into Review and Brainstorm.

Tests (focused): `go build ./cmd/council-bench-brainstorm` and `go vet ./cmd/council-bench-brainstorm`;
`go test ./pkg/wshrpc/wshserver -run 'TestCouncilBenchWireHasEveryCall'` with the new assertion.
