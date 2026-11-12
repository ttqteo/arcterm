# Brainstorm bench, round 2 — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-11-brainstorm-bench-round2-design.md` (its "Builder's decisions" section
settles everything the spec left to the builder; read it first)
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/... ./cmd/council-bench-brainstorm/`
**Check:** `go vet ./pkg/council/... ./cmd/council-bench-brainstorm/ ./cmd/wsh/... ./pkg/wshrpc/...`

**Goal:** make the council bench fair and its Brainstorm keys deep, so round 2 (4 cases × brainstorm skill and
Brainstorm council × 2 runs) can run once the merged build is installed.

**Shape:** the row fields (Task 1), then the judge rewrite (Task 2) beside the wire and table (Task 3); beside them
the case installer (Task 4) and the four case drafts that use it (Tasks 5–8, in parallel), and the driver (Task 9). No task runs the bench, builds the app or
installs it: the round itself starts after the land, by the person (handoff at the end of this plan).

Principles for every worker: simple and direct, no abstraction for one use, one source of truth, errors handled at the
boundary and never swallowed (log what is skipped). Go tests on Windows: prefix with
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in Bash. Never edit generated files by hand (`task generate`).
Never run prettier on `scripts/*.mjs` (hand-formatted, 4 spaces). No CHANGELOG line: the bench is internal tooling.

## Brief for the case tasks (Tasks 5–8)

Each case task writes one `scripts/council-bench-brainstorm-cases/<id>.json` in Task 4's format and nothing else.
How to draft:
1. Read the feature as it shipped: its spec at the spec commit (`git show <spec commit>:<spec path>`) and the commits
   that implemented it (find them with `git log` after the spec commit; they are `feature_commits`, the spec commit
   included).
2. Read the code as it stood at the snapshot (`<spec commit>^`): `node scripts/council-bench-brainstorm-cases.mjs
   --check <id>` archives it, or use `git show <snapshot>:<path>`.
3. Key lines (4–6): each is a mechanism or an edge case the shipped design depends on that shows only when the
   snapshot's code is read closely — like run-pause's "a paused run still counts against `runs:maxactive`, so the queue
   does not start another run in its place", which follows from `runqueue.Active`. Not a general line ("let a run be
   paused"), not taste, not a number nobody can derive. Each cites the `path:line` in the snapshot that shows it, with
   `shows` holding text from that line.
4. The question says what the person wants and any preference a key line rests on (e.g. "automatic first, manual as a
   fallback"), never how to build it, and holds no key text. `feature` is a short title.
5. `files` is where a designer would start reading (5–10 paths that exist at the snapshot), chosen for that, not built
   from the key's cites — the key must still need the code read closely.
6. Acceptance: `node scripts/council-bench-brainstorm-cases.mjs --check <id>` exits 0 (cites resolve, leak check
   clean) and `npx vitest run scripts/council-bench-brainstorm-cases.test.mjs` passes. In the commit message, list each
   key line's `at` so the reviewer can check every line against its cite.

### Task 1: The round-2 row fields and the harness bump
**Depends on:** none
**Files:** `pkg/council/bench/results.go`, `pkg/council/bench/results_test.go`, `pkg/council/prompts.go`

The small interface Tasks 2 and 3 build on.
- `CouncilBenchResult` gains `Recall3 int json:"recall3,omitempty"` (key lines matched at rank 1–3) and
  `Judged int json:"judged,omitempty"` (items the judge was shown: the denominator of the wrong rate). `Kept` and
  `KeptMatches` stay, their comments saying only rows of a harness before 2026-11-12.1 carry them. On a Brainstorm row
  from this harness `Recall` is recall@all (document that on the field).
- `CouncilBenchRow` gains `Recall3 int json:"recall3"` and `Judged int json:"judged"`, summed over scored runs in
  `Summarize` like `Recall`. **`CouncilBenchRow.Kept` stays in this task** (`cmd/wsh` still prints it; Task 3 removes it
  with its column). `RecallPerM` stays `Recall` per million tokens.
- `council.HarnessVersion` becomes `"2026-11-12.1"` in `pkg/council/prompts.go`; its comment says round 2 of the bench
  changed the scoring, not the prompts.
- Acceptance: new tests in `results_test.go` — `TestSummarizeSumsRecall3AndJudged` (two scored Brainstorm rows and one
  failed row: the failed one adds neither) and `TestLoadResultsReadsAnOldBrainstormLineWithKept` (an old line with
  `kept`/`keptmatches` reads back with them set and `Recall3`/`Judged` 0). Run
  `go test ./pkg/council/bench -run 'TestSummarizeSumsRecall3AndJudged|TestLoadResultsReadsAnOldBrainstormLineWithKept'`
  and `go test ./pkg/council -run TestHarnessVersionFormat`.

### Task 2: Judge a Brainstorm report as one whole list, and save the brainstorm's items
**Depends on:** Task 1 (fills the `Recall3` / `Judged` row fields it adds)
**Files:** `pkg/council/bench/judge.go`, `pkg/council/bench/judge_test.go`, `pkg/council/bench/run.go`, `pkg/council/bench/run_test.go`, `pkg/council/bench/brainstorm.go`, `pkg/council/bench/brainstorm_test.go`

Decisions (from the spec's "Builder's decisions"):
- `Judge` on a Brainstorm case judges `Summary.Directions` followed by `Summary.Kept` as one numbered list, every item,
  with no answer/text ahead of it — the same `judgeInput` shape `JudgeDesign` builds, so both sides get one prompt.
  Review cases keep `judgedItems` at `TopReview` exactly as today (answer and text included).
- The prompt asks that `matches` give the rank of the *first* item that names a key line. `readVerdict` keeps, per key
  line, the lowest rank among `matches` and the items whose verdict is `key:Kn` (case-insensitive), within range.
- Remove the judge's kept machinery: `judgeInput.kept`/`askKept`, `verdictJSON.Kept`, `Verdict.Kept`, `KeptMatched`,
  the kept reply example. **`TopBrainstorm` stays**: `teamprompt.go:133` and `cmd/wsh` still use it.
- `Verdict` gains `Judged int` (items shown) and `RecallAt(n int) int` (key lines matched at rank ≤ n); `Recall()`
  stays recall@all.
- Rows: on a Brainstorm case (council or brainstorm variant) `judgeRow` / `runBrainstormItem` write `Recall` =
  recall@all, `Recall3` = `RecallAt(3)`, `Judged`, `Wrong`, `Matches` (every match with its rank); nothing writes
  `Kept` / `KeptMatches` any more. `RecallDone` stays the done mark's recall@all. Review rows unchanged apart from kept.
- Saved items: `BrainstormOutcome` gains `FinalItems` and `DoneItems` (`[]council.CouncilDirection`), set by
  `runBrainstorm` when done. `runItem` and `runBrainstormItem` take `dataDir string` (thread it from `Run`; update the
  existing `run_test.go` callers of `runItem`). Before returning a done brainstorm row, `runBrainstormItem` calls
  `SaveJudgedItems(dataDir, …)` — defined in `run.go` — which writes `<dataDir>/council-bench-items/<session>.json` as
  `{"case","harness","session","final":[…],"done":[…]}`. A failed write is logged with the path and the row is still
  returned (and appended by `Run`).

Acceptance (tests written first, names as given):
- `judge_test.go`: `TestJudgeBrainstormCouncilJudgesDirectionsThenKeptAsOneList` (4 directions + 2 kept → 6 items in
  the prompt, no answer/text, no `kept` asked; `Judged` 6), `TestVerdictRecallAtCutsAtRank` (a match at rank 5 counts in
  `Recall()`, not `RecallAt(3)`), `TestReadVerdictTakesTheLowestRank` (matches and an item verdict disagree); the
  existing Review prompt tests still pass unchanged.
- `run_test.go`: `TestBrainstormCouncilRowHasRecall3AndJudged` (all-rank `Matches`, no kept),
  `TestDoneBrainstormItemSavesItsItems` (file written with both lists) and
  `TestBrainstormItemRowSurvivesAFailedItemsWrite` (the items folder path is a file: row still returned, done).
- Run: `go test ./pkg/council/bench -run 'Judge|Verdict|RunItem|Brainstorm'` (it covers the tests above and the
  existing judge and run tests you changed).

### Task 3: Round-2 columns on the wire and in `wsh council bench results`
**Depends on:** Task 1 (prints the `Recall3` / `Judged` row fields it adds)
**Files:** `pkg/council/bench/results.go`, `pkg/council/bench/results_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`, `frontend/types/gotypes.d.ts`

Runs beside Task 2 (no shared file).
- Remove `CouncilBenchRow.Kept` and its sum in `Summarize` (`results.go`; fix any `results_test.go` use), together with
  the kept column in both sections of the table.
- `CouncilBenchResultsRtnData` gains `Harness string json:"harness"`: the answering wavesrv's
  `council.HarnessVersion`, set in `CouncilBenchResultsCommand` on every path, the no-cases path included. This is the
  interface the driver (Task 9) reads from `wsh council bench results --json`.
- Brainstorm section columns: `harness, variant, skill, scored/runs, recall@3, recall@all, recall@done, wrong,
  decisions, questions, tokens, recall@all/M tokens`; `wrong` is `<wrong>/<judged>`; a row with `Judged == 0` prints
  `-` for recall@3 and its wrong count alone; skill/recall@done/decisions/questions stay `-` for non-brainstorm
  variants. The Review section drops only its kept column. Replace `councilBenchBrainstormNote`'s text: both sides are
  judged on their whole list, and rows of a harness before 2026-11-12.1 were scored the old way (a council cut at 3).
- Run `task generate`; commit what it changes (`frontend/types/gotypes.d.ts`); then `task check:ts` (4-minute timeout).
- Acceptance: in `wshserver_council_test.go`, `TestCouncilBenchResultsGroupsByHarness` and
  `TestCouncilBenchResultsWithNoCasesFileLogsNothing` assert `Harness == council.HarnessVersion`. In
  `wshcmd-council_test.go`, the table test covers the new Brainstorm header, a round-2 row, an old row (dashes) and the
  Review section without kept. Run `go test ./pkg/wshrpc/wshserver -run 'TestCouncilBenchResults'`,
  `go test ./cmd/wsh/cmd -run 'CouncilBench'` and `go test ./pkg/council/bench -run 'Summarize'`.

### Task 4: The Brainstorm case installer
**Depends on:** none
**Files:** `scripts/council-bench-brainstorm-cases.mjs`, `scripts/council-bench-brainstorm-cases.test.mjs`, `scripts/council-bench-cases.mjs`

- A case is one file `scripts/council-bench-brainstorm-cases/<id>.json` (Tasks 5–8 write them):
  `{ "id", "snapshot", "feature_commits": [hashes], "feature", "question", "files": [repo paths],
  "key": [{ "text", "at": "path:line", "shows": "text that line holds" }] }`.
- Export from `council-bench-cases.mjs` what is reused (`archiveInto`, `defaultDataDir`, the git helpers as needed);
  don't change its behaviour or its tests.
- Exported pure functions, each unit-tested: `validateCase(c)` (id matches file name, snapshot and feature_commits
  present, question and feature non-empty, `files` non-empty, 4–6 key lines, each `at` is `path:line` with line ≥ 1,
  `shows` non-empty, no key `text` appears inside the question); `checkCites(root, key)` → the lines whose file is
  missing, whose line is past the end, or whose line does not contain `shows` (whitespace-trimmed compare);
  `renderBrainstormKey(key)` → `K1: <text>\n    at <path:line>\n` per line (the indented cite does not match
  `keyLineRe` in `pkg/council/bench/cases.go`, so the judge never sees it; test that against that regex's source
  copied into the test); `brainstormEntry(c, dataDir)` → the cases.json entry (`mode: "brainstorm"`,
  `group: "ui-feature"`, `solo_group: "solo-ui"`, project `<data>/council-bench-projects/<id>`, key
  `<data>/council-bench/keys/<id>.md`); retired ids `["launcher-declutter"]` via `updateCases`.
- CLI: `node scripts/council-bench-brainstorm-cases.mjs [--data-dir <p>] [--dry-run] [--check <id>...]`.
  For each case file (or the named ones): validate, archive the snapshot (into a temp dir under `--check` and `--dry-run`,
  into the project folder only on a real install), scrub docs naming a feature commit (`scrubDocs`), check cites, run the leak check
  (`findLeaks` on the feature commits' subjects and every key `text`). `--dry-run` runs every check in temp dirs, prints each
  case's question, every key line with its `at`, and the check results, and writes nothing to the data dir — it is the listing the person reads before round 2. `--check`
  never touches the data dir and exits nonzero on any failure. A real install writes nothing unless every case passed,
  then the keys and cases.json (launcher-declutter retired).
- Acceptance: `npx vitest run scripts/council-bench-brainstorm-cases.test.mjs` passes, including a test that every
  committed file under `scripts/council-bench-brainstorm-cases/` passes `validateCase` (a missing or empty folder passes: the files arrive with Tasks 5–8),
  and `npx vitest run scripts/council-bench-cases.test.mjs` still passes.

### Task 5: Case run-pause, key rewritten from the code
**Depends on:** Task 4 (uses the case format and `--check`)
**Files:** `scripts/council-bench-brainstorm-cases/run-pause.json`

Snapshot `d04210830^` (round 1's copy matches it); spec `docs/superpowers/specs/2026-11-05-run-pause-design.md`. Keep
round 1's feature and `files` list exactly (from the installed cases.json: `pkg/orchestrate/dag.go,
pkg/orchestrate/interrupted.go, pkg/orchestrate/workerslots.go, pkg/runqueue/rules.go, pkg/jobqueue/jobqueue.go,
pkg/jobqueue/pressure_windows.go, pkg/memusage/memusage.go, frontend/app/view/agents/runcards.tsx`). The question
now states the preference: arcterm frees a run's memory by itself when memory runs short, and manual Pause and Resume
are a fallback. Rewrite the key as code-derived mechanisms; the old K4 (paused runs still count in `runqueue.Active`)
stays in spirit with its cite; the 1 GB and two-pause numbers leave it.

### Task 6: Case held-services
**Depends on:** Task 4 (uses the case format and `--check`)
**Files:** `scripts/council-bench-brainstorm-cases/held-services.json`

Spec commit `33d3bc63a` (`docs/superpowers/specs/2026-10-20-held-services-design.md`): a pinned app's server runs with
no tab open and restarts after a crash. Snapshot `33d3bc63a^`.

### Task 7: Case heavy-job-queue
**Depends on:** Task 4 (uses the case format and `--check`)
**Files:** `scripts/council-bench-brainstorm-cases/heavy-job-queue.json`

Spec commit `5ed9cdb6b` (`docs/superpowers/specs/2026-10-09-heavy-job-queue-design.md`): heavy commands queue by RAM.
Snapshot `5ed9cdb6b^`.

### Task 8: Case goalpost-guard
**Depends on:** Task 4 (uses the case format and `--check`)
**Files:** `scripts/council-bench-brainstorm-cases/goalpost-guard.json`

Spec commit `90db6e666` (`docs/superpowers/specs/2026-10-27-goalpost-guard-design.md`): a worker's check-lowering edit
reaches its reviewer. Snapshot `90db6e666^`.

### Task 9: The round-2 driver
**Depends on:** none
**Files:** `scripts/council-bench-all.mjs`, `scripts/council-bench-all.test.mjs`, `docs/hand-checks.md`

The data dir's `council-bench/work/bench-all.mjs` (read it at
`%LOCALAPPDATA%\dev.arc.app\data\council-bench\work\bench-all.mjs`; do not edit or delete it) moved into the repo and
given the round-2 plan:
- Plan: cases `run-pause, held-services, heavy-job-queue, goalpost-guard`; per case the council variant via the
  installed `wsh council bench --case <id> --variant council --runs <n>` and the brainstorm variant via
  `go run ./cmd/council-bench-brainstorm --case <id> --runs <n>` from the repo root (derived from the script's own
  path, not hard-coded); 2 scored runs per cell.
- A cell's scored runs are rows of `council-bench.jsonl` with that case and variant, `state` `done` and `harness` equal
  to the checkout's `council.HarnessVersion` (read from `pkg/council/prompts.go` with a regex); no `--since`.
- Before its first bench it reads `harness` from `wsh council bench results --json`; when it differs from the
  checkout's (or is absent), it logs and exits nonzero with "install the new build first".
- Keeps today's behaviour: waits for 8 GB free RAM on two reads 30 s apart; reads the results before every step and
  runs only missing cells; at most 3 starts per bench; never stops a bench itself; a refused Token burn card
  (`Not run`) stops the driver; one live copy via the pid file. Status, pid and final-table files stay in
  `<data dir>/council-bench/work/` (`bench-all.status.txt`, `bench-all.pid`, `bench-all.results.txt`). Windows and Mac
  data dirs as `cmd/council-bench-brainstorm` resolves them; the wsh path is the data dir's `bin/wsh(.exe)` on Windows,
  `wsh` on PATH otherwise.
- Its header says how to start it: `wsh detach -- node scripts/council-bench-all.mjs` (so an arcterm restart does not
  take it down), and `--dry` prints the missing cells and starts nothing.
- Pure, exported, unit-tested: `parseHarnessVersion(goSource)`, `scoredRuns(rows, harness, case, variant)`,
  `missingCells(rows, plan, harness)` → `[{case, variant, need}]`, `harnessCheck(serverHarness, checkoutHarness)`.
  The process side (spawning, sleeping, files) stays thin and untested.
- `docs/hand-checks.md`: one `- [ ] (arcterm) …` line for round 2: after the land, `task tauri:build`, the person runs
  `! task install`, reads `node scripts/council-bench-brainstorm-cases.mjs --dry-run`, installs the cases with it,
  then starts the driver detached and reads `bench-all.results.txt`.
- Acceptance: `npx vitest run scripts/council-bench-all.test.mjs` passes, covering: round-1 rows (old harness) never
  fill a cell; a failed row does not count; two done rows close a cell; the harness check refuses a missing or
  different version; the version regex reads the real `pkg/council/prompts.go` and the result matches
  `^\d{4}-\d{2}-\d{2}\.\d+$` (assert the format, not a literal version: the bump lands in Task 1, which this task
  does not wait on).

## Handoff after the land (not a task)

The engine lands this; the bench itself is the person's: `task tauri:build`, then `! task install` once, then
`node scripts/council-bench-brainstorm-cases.mjs --dry-run` to read the drafts, the install of the cases, and
`wsh detach -- node scripts/council-bench-all.mjs` (16 runs, about 62M tokens, about 2 hours).
