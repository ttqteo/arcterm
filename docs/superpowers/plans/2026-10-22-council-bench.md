# Council benchmark that keeps running Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 0's hand-run benchmark into a command the person re-runs whenever the council's prompts or models
change, plus a one-tap "Was this useful?" on every real council, so the council is held to numbers continuously.

**Architecture:** A `pkg/council/bench` package loads the cases Phase 0 left in the data dir, runs each case's
variants through the council runner one at a time (the queue from part 2), judges each report against its key with an
opus call through `pkg/consult`, and appends results to a JSONL file that also takes the real councils' ratings. Every
council records the harness version it ran; a bench council is marked so it writes no document into the case's project
and the cockpit never lists it. `wsh council bench` drives it over wshrpc (a dry run prices it for the Token burn gate,
then the real call starts it); the report gains the rating. A full bench ends by adding a re-measure chunk due a month
later to the `Council benchmark` initiative.

**Tech Stack:** Go (`pkg/council`, `pkg/council/bench`, `pkg/consult`, `pkg/wshrpc`, `cmd/wsh`), React 19, vitest, CDP.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("Benchmark": cases, variants, scores,
"Continuous"; "The harness": versioned) and `docs/council-phase0.md` (the rubric, the cut to top items, the token count).

**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs council-summary`

## Global Constraints

- Cases live in `<data dir>/council-bench/cases.json` with their `key` files (Phase 0's shape: `id`, `mode`, `project`,
  `group`, `solo_group`, `feature`, `question`, `files`, `key`); results go to `<data dir>/council-bench.jsonl`.
  `<data dir>` is `wavebase.GetWaveDataDir()`. Nothing of a case enters the repo. No task needs real cases: every test
  makes its own in a temp dir.
- Variants: `council` (V2: the case's group, today's harness) and `solo` (V0: the case's `solo_group`). V1 (no argue
  round) is dropped (spec "Benchmark", the person's call 2026-10-22). A future agent-team variant plugs in as a third
  name; nothing else is assumed about it.
- Runs: `--runs n` runs each case × variant n times (default 1); the spec's first pass is `--runs 2`.
- Scores per run, as Phase 0: recall of key lines within the top 5 (Review) or top 3 (Brainstorm) items; for a
  Brainstorm report, the key lines matched among its Wild ideas kept aside (`Summary.Kept`) in a column of their own,
  outside recall; wrong items; tokens in `pkg/consult`'s count (input + cache read + cache creation + output); minutes;
  messages.
- Judge rubric, verbatim from Phase 0: an item matches a key line only when it names the same problem (same terms, same
  sentence pattern, same missing baseline, same bug), not the same topic; each item is `key:<Kn>`, `valid` or `wrong`.
- A bench run asks the Token burn gate once with its total estimate (Phase 0's measured figures: solo ≈ 0.55M,
  council ≈ 1.4M per case per run), computed by a dry run of the bench command before anything starts; a refusal
  prints `Not run: …` and starts nothing.
- `council-bench.jsonl` has one owner, `pkg/council/bench`: it writes both line kinds (`run`, `rating`) and reads them
  back. `pkg/council` never imports it (bench imports council); the wshserver handlers call both.
- Every type that crosses the wire is prefixed `Council` (`pkg/council/types.go`'s rule): `CouncilBenchRow`,
  `CouncilBenchRatingRow`, never a bare `Row`.
- Name the tests as the steps do: a `-run` filter that matches nothing prints `ok [no tests to run]` and passes.
- Go tests on Windows go through `node scripts/verify.mjs <packages>` (it sets `CGO_ENABLED=1` and zig for the sqlite
  store), or carry `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`.
- No thesis or paper detail anywhere (the repo is public).
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **A case whose project folder or key is gone:** the bench skips it with one line naming it, and runs the rest.
- **A council in the bench that fails or is stopped:** its row is written with state `failed`/`stopped` and no
  recall, never a zero recall that reads like a bad score.
- **The person's own council running when a bench starts:** bench councils wait in the queue; they never run two at once.
- **Bench councils stay out of sight and out of each other's way:** no document in the case's project (a later variant
  on the same case would read it), no toast, unread dot, tree row or Needs you item.
- **Results from two harness versions:** `wsh council bench results` groups by version, so an old score is never read
  as the new one's.
- **A rating changed after it was given:** the latest one counts; the file keeps both lines with their times.
- **A refused gate starts nothing:** no council saved, no line in the results file.

---

### Task 1: The harness version on every council, and the bench mark

**Depends on:** none
**Files:** `pkg/council/prompts.go`, `pkg/council/types.go`, `pkg/council/runner.go`, `pkg/council/markdown.go`, `pkg/council/prompts_test.go`, `pkg/council/runner_test.go`, `pkg/council/markdown_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `const HarnessVersion = "<YYYY-MM-DD>.<n>"` in `prompts.go` (start at today's date `.1`), with a comment:
  bump it in the same commit as any change to a prompt, a role brief or a default model; `Council.Harness string`
  (`json:"harness,omitempty"`) set when a council starts; `Council.Bench bool` (`json:"bench,omitempty"`): a council
  the benchmark started.

- [ ] **Step 1: Tests.** `runner_test.go`: `TestStartRecordsHarness` (a council started through the runner carries
  `Harness == HarnessVersion`), `TestBenchCouncilSavesNoDocument` (a bench council that ends done or stopped writes
  nothing under its project's `docs/council/` and keeps no `DocPath`; the same council without `Bench` does).
  `markdown_test.go`: `TestDocumentRunFactsHarness` (the run facts `Document` writes through `writeRunFacts`
  (`markdown.go`) carry a `Harness: <version>` line when it is set, none when empty). `wshserver_council_test.go`:
  `TestCouncilListHidesBenchCouncils` (`CouncilListCommand` with any project, `""` included, leaves bench councils
  out; `CouncilGetCommand` still loads one). The queue keeps reading `council.List` unfiltered, so a queued bench
  council still starts.
- [ ] **Step 2:** Run `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/wshserver` — Expected: FAIL.
- [ ] **Step 3:** Implement: `saveDocument` returns at once for a bench council; the filter lives in
  `CouncilListCommand`, so the cockpit's list (and with it the notices, the tree and Needs you) never sees one. Run
  `task generate`.
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/wshserver` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): every council records the harness version it ran; bench councils stay unseen`.

### Task 2: The bench file format: cases, plan, results and ratings

**Depends on:** none
**Files:** `pkg/council/bench/cases.go`, `pkg/council/bench/results.go`, `pkg/council/bench/cases_test.go`, `pkg/council/bench/results_test.go`

**Interfaces:**
- Produces: `Case` (Phase 0's fields plus the key lines read from its file); `LoadCases(dataDir string) ([]Case,
  []string, error)` (the cases, one warning per skipped case, an error when `cases.json` is missing that names the path
  and says Phase 0b's tasks 1–2 build it); `Options{Cases []string; Variants []string; Runs int}` (empty = all
  cases, `solo` and `council`; `Runs` 0 reads as 1); `PlanItem{Case, Variant string; Run int}`;
  `Plan(cases []Case, opts Options) ([]PlanItem, int64, error)` (the runs in order, case × variant × run, and the total
  estimate; an unknown case or variant name is an error); `CouncilBenchResult` (`kind:"run"`, `date` (RFC 3339 time),
  `harness`, `case`, `variant`, `run`, `council`, `state`, `recall`, `keys` (the denominator), `kept` (omitempty),
  `wrong`, `tokens`, `minutes`, `messages`); `CouncilBenchRating` (`kind:"rating"`, `ratedat` (RFC 3339 time),
  `harness`, `mode`, `council`, `rating` `useful`|`not`); `AppendResult(dataDir string, r CouncilBenchResult) error`;
  `AppendRating(dataDir string, r CouncilBenchRating) error`; `LoadResults(dataDir string) ([]CouncilBenchResult,
  []CouncilBenchRating, error)` (a missing file is no lines; an unknown `kind` and a bad line are skipped);
  `Summarize(results []CouncilBenchResult) []CouncilBenchRow` (per harness × variant, newest harness first: runs,
  recall summed over key lines, kept matches, wrong items, tokens, recall per M tokens; a failed or stopped run counts
  in runs and tokens, never in recall); `SummarizeRatings(ratings []CouncilBenchRating) []CouncilBenchRatingRow` (per
  harness × mode: useful and not, the latest line per council counting).

- [ ] **Step 1: Tests.** `cases_test.go`: `TestLoadCasesPhase0Shape`, `TestLoadCasesSkipsMissingProject`,
  `TestLoadCasesSkipsMissingKey` (each skip named in the warnings, the rest loaded), `TestLoadCasesNoFile`;
  `TestPlanOrderAndEstimate` (2 cases × 2 variants × `Runs: 2` gives 8 items, case-major, and
  2 × 2 × (0.55M + 1.4M)), `TestPlanUnknownName`. `results_test.go`: `TestAppendAndLoadResults` (run and rating lines
  round-trip; an unknown kind and a broken line are skipped), `TestSummarizeByHarness` (two harness versions give
  separate rows, newest first; a failed run adds no recall), `TestSummarizeRatingsLatestCounts` (a council rated
  `useful` then `not` counts once, as `not`; both lines stay in the file).
- [ ] **Step 2:** Run `node scripts/verify.mjs ./pkg/council/bench` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/council/bench` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): the bench's cases, plan and results file`.

### Task 3: The judge and the bench run

**Depends on:** Task 1 (sets `Council.Bench`, reads `Council.Harness`), Task 2 (the plan and the results file)
**Files:** `pkg/council/bench/judge.go`, `pkg/council/bench/run.go`, `pkg/council/bench/judge_test.go`, `pkg/council/bench/run_test.go`

**Interfaces:**
- Produces: `Judge(ctx, c Case, report *council.Council) (Verdict, error)` (`Verdict`: the matched key lines with the
  rank that matched each, the kept matches, each item's verdict); `type StartFunc func(ctx, c *council.Council)
  (*council.Council, error)`, `type WaitFunc func(ctx, id string) (*council.Council, error)`, `type JudgeFunc func(ctx,
  c Case, report *council.Council) (Verdict, error)`, `type RemindFunc func(ctx) error`; `Run(ctx, dataDir string,
  opts Options, start StartFunc, wait WaitFunc, judge JudgeFunc, remind RemindFunc) error`: it builds each item's
  council (`Bench: true`, the case's project, files and question; the `group` or `solo_group`), starts it, waits for
  its end, judges a done one, appends its row, and goes on to the next; when `opts.Cases` is empty and every item ran,
  it calls `remind` once.

- [ ] **Step 1: Tests.** `judge_test.go`: `TestJudgePrompt` (the key, the rubric verbatim, the report cut to the top 5
  (Review) or top 3 (Brainstorm) items and, for Brainstorm, the Kept list apart), `TestJudgeParse` (parses
  `{"matches":{"K1":1,"K2":null},"kept":{"K3":1},"items":[{"rank":1,"verdict":"key:K1"}]}` from a fake consult reply;
  a reply that is not that JSON is an error). `run_test.go`, all with fake start, wait, judge and remind:
  `TestRunOneAtATime` (start is never called again before the last wait returned; items in plan order),
  `TestRunWaitsOnQueuedCouncil` (start returns the council `queued`, as when the person's own council runs; Run waits
  on it and starts nothing else meanwhile), `TestRunFailedAndStoppedRows` (a failed and a stopped council each write a
  row with that state, no recall, and are not judged), `TestRunMarksBenchCouncils` (every started council has
  `Bench: true`), `TestRunRemindsOnFullBenchOnly` (no `Cases`: remind called once at the end; with `Cases`: never;
  cancelled midway: never), `TestRunSkipsMissingCase` (a skipped case's warning is logged and the rest run).
- [ ] **Step 2:** Run `node scripts/verify.mjs ./pkg/council/bench` — Expected: FAIL.
- [ ] **Step 3:** Implement; the judge calls opus through `pkg/consult` with no tools; the report is built the way
  `docs/council-phase0.md` describes (summary answer and text, then each direction's rank, title and reasoning, then
  the Kept list for Brainstorm). The real `wait` is wired in Task 4; Run itself only calls the funcs.
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/council/bench` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): the bench runs the cases one at a time and judges each report`.

### Task 4: `wsh council bench` and the monthly reminder

**Depends on:** Task 3 (calls bench.Run, bench.Judge and the Task 2 functions)
**Files:** `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `CouncilBenchCommand(ctx, CommandCouncilBenchData{Cases, Variants []string; Runs int; DryRun bool})
  (*CouncilBenchRtnData, error)`; `CouncilBenchRtnData{Items []bench.PlanItem; Estimate int64; Skipped []string}`.
  With `DryRun` it only plans (loads the cases, `bench.Plan`) and starts nothing; without it, it plans the same way,
  starts `bench.Run` in a wavesrv goroutine and returns at once. `CouncilBenchResultsCommand(ctx)
  (*CouncilBenchResultsRtnData, error)` with `Runs []bench.CouncilBenchRow` and `Ratings
  []bench.CouncilBenchRatingRow`. `wsh council bench [--case c]... [--variant v]... [--runs n]` and
  `wsh council bench results`.

- [ ] **Step 1: Tests.** `wshcmd-council_test.go`, through package-level seams for the two rpc calls
  (`councilBenchCall`, `councilBenchResultsCall`) and the gate (`councilBenchGate`, a var set to `tokengateDecide`,
  which is a plain func today):
  `TestCouncilBenchGateBeforeStart` (the dry run is called first, the gate is asked with its estimate, then the real
  call), `TestCouncilBenchRefusalStartsNothing` (a refusal prints `Not run: …` and the real call is never made),
  `TestCouncilBenchResultsTable` (one row per harness version × variant, newest version first, then the ratings per
  harness × mode). `wshserver_council_test.go`: `TestCouncilBenchDryRunStartsNothing` (a dry run on a temp data dir
  with one case returns its items and estimate, saves no council and writes no results line),
  `TestBenchReminderAddsOneChunk` (the reminder func, with the effort calls faked, creates `Council benchmark` when
  missing, adds `Re-measure the council: wsh council bench` due 30 days later, and reuses the effort found by title
  on a second call).
- [ ] **Step 2:** Run `node scripts/verify.mjs ./pkg/wshrpc/... ./cmd/wsh/...` — Expected: FAIL.
- [ ] **Step 3:** Implement; run `task generate`. The goroutine wires `start` to the runner's `Start`, `wait` to a
  loop on the council's state that returns once it is done, failed or stopped (a bench council waiting on the person
  is stopped), `judge` to `bench.Judge`, and `remind` to the reminder func: find the effort titled `Council benchmark`
  in `effortstore.GetAll`, create it through the same code `EffortCreateCommand` runs when missing, and add the chunk
  with its due date through `EffortMutateCommand`'s code, as `wsh effort chunk add --due` does.
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/wshrpc/... ./cmd/wsh/...` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): wsh council bench runs the benchmark and reminds a month later`.

### Task 5: "Was this useful?" on the report

**Depends on:** Task 4 (both edit the council rpc files and regenerate the generated files, which cannot be merge-resolved)
**Files:** `pkg/council/types.go`, `pkg/council/store.go`, `pkg/council/store_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/summary.mjs`, `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Interfaces:**
- Produces: `Council.Rating string` (`json:"rating,omitempty"`, `useful` or `not`) and `Council.RatedAt int64`;
  `council.SetRating(id, rating string, at int64) (*Council, error)` in `store.go` (refuses any other rating);
  `CouncilRateCommand(ctx, CommandCouncilRateData{Id, Rating string}) error`, which calls `SetRating` and then
  `bench.AppendRating` with the council's harness and mode; `rateCouncil(id, rating)` in `councilstore.ts`, which sets
  the council's atom from the answer at once, so the thanks line does not wait for `council:changed`.
- The row's rule: it shows under the report of a council whose state is `done` or `stopped` and that has a summary;
  never on a running council (one re-summarizing over an old summary), a failed one, or a bench council.

- [ ] **Step 1: Tests.** `store_test.go`: `TestSetRatingLatestCounts` (rating twice keeps the latest and its time),
  `TestSetRatingRefusesUnknown`. `councilsummarymodel.test.ts`: the rule above on done, stopped, running-with-summary
  and failed councils; unrated reads `Was this useful?` with Useful and Not really; rated reads
  `Thanks: this goes into the council benchmark` with a Change link. `councilstore.test.ts`: `rateCouncil` calls
  `CouncilRateCommand` with `{id, rating}` and updates the council's atom on success, leaves it on failure.
- [ ] **Step 2:** Run `node scripts/verify.mjs ./pkg/council` and `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts frontend/app/view/agents/councilstore.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement: under the report, "Was this useful?" with **Useful** and **Not really**, styled like the
  report's other quiet rows (`DESIGN.md`), the row `data-council-rating`, the Change link
  `data-council-rating-change`; run `task generate`.
- [ ] **Step 4:** Run the same commands — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/summary.mjs`, with `stubRpc(h, ["CouncilRateCommand"])` so nothing reaches
  the data dir's `council-bench.jsonl`, on its own seeded council (`seedCouncil(h, ctx, "done", { id:
  "fx-council-rate" })`): assert the unrated row with both buttons; click Useful, assert the recorded call
  `{id: "fx-council-rate", rating: "useful"}` and the thanks line; click Change, click Not really, assert the call and
  the thanks line again. A council seeded with `rating: "useful"` shows the thanks line at once. A stopped one seeded
  with a summary shows the row; `fx-council-resumming` and `fx-council-synthfailed` show none. Shown by
  `council-summary`.
- [ ] **Step 6:** Commit `feat(council): rate a council's report; the rating feeds the benchmark`.

### Task 6: Changelog, docs and the first reminder

**Depends on:** Task 5
**Files:** `CHANGELOG.md`, `docs/open-issues.md`, `docs/council-phase0.md`

- [ ] **Step 1:** `CHANGELOG.md` under `## Unreleased`: `Added` lines for "Was this useful?" on a council's report
  and for `wsh council bench`.
- [ ] **Step 2:** `docs/council-phase0.md`: a closing paragraph saying the benchmark is now `wsh council bench`
  (`bench results` for the table, `--runs 2` for a first or close pass) and that `HarnessVersion` must be bumped with
  any prompt or role change.
- [ ] **Step 3:** The first reminder, so it exists before any full bench ends: run `wsh effort create "Council
  benchmark"`, then `wsh effort chunk add <its id> "Re-measure the council: wsh council bench" --due +30d`. Expected:
  `wsh effort show <its id>` lists the chunk with its due day.
- [ ] **Step 4:** `docs/open-issues.md` "0 · Waiting on a hand check" (a smoke check; the tests own the logic): once
  Phase 0b's tasks 1–2 have built the cases, run `wsh council bench --case newcomer` on the installed app, allow the
  Token burn card, check `wsh council bench results` shows the row, that the judge's matches agree with the newcomer
  key read by hand (the spec's spot check), and that `Council benchmark` gained no chunk (a single case adds no
  reminder).
- [ ] **Step 5:** Commit `docs(council): the benchmark command and its hand check`.
