# Council benchmark that keeps running Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 0's hand-run benchmark into a command the person re-runs whenever the council's prompts or models
change, plus a one-tap "Was this useful?" on every real council, so the council is held to numbers continuously.

**Architecture:** A `pkg/council/bench` package loads the cases Phase 0 left in the data dir, runs each case's
variants through the council runner one at a time (the queue from part 2), judges each report against its key with an
opus call through `pkg/consult`, and appends results to a JSONL file. Every council records the harness version it ran.
`wsh council bench` drives it over wshrpc; the report gains the rating. A monthly initiative chunk brings the re-run
back to the person.

**Tech Stack:** Go (`pkg/council`, `pkg/council/bench`, `pkg/consult`, `pkg/wshrpc`, `cmd/wsh`), React 19, vitest, CDP.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("Benchmark": cases, variants, scores,
"Continuous"; "The harness": versioned) and `docs/council-phase0.md` (the rubric, the cut to top items, the token count).

**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs council-summary`

## Global Constraints

- Cases live in `<data dir>/council-bench/cases.json` with their `key` files (Phase 0's shape: `id`, `mode`, `project`,
  `group`, `solo_group`, `feature`, `question`, `files`, `key`); results go to `<data dir>/council-bench.jsonl`.
  `<data dir>` is `wavebase.GetWaveDataDir()`. Nothing of a case enters the repo.
- Variants: `council` (the case's group, today's harness) and `solo` (the case's `solo_group`). A future agent-team
  variant plugs in as a third name; nothing else is assumed about it.
- Scores per run, as Phase 0: recall of key lines within the top 5 (Review) or top 3 (Brainstorm) items; wrong items;
  tokens in `pkg/consult`'s count (input + cache read + cache creation + output); minutes; messages.
- Judge rubric, verbatim from Phase 0: an item matches a key line only when it names the same problem (same terms, same
  sentence pattern, same missing baseline, same bug), not the same topic; each item is `key:<Kn>`, `valid` or `wrong`.
- A bench run asks the Token burn gate once with its total estimate (Phase 0's measured figures: solo ≈ 0.55M,
  council ≈ 1.4M per case); a refusal prints `Not run: …` and runs nothing.
- No thesis or paper detail anywhere (the repo is public).
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **A case whose project folder or key is gone:** the bench skips it with one line naming it, and runs the rest.
- **A council in the bench that fails or is stopped:** its row is written with state `failed`/`stopped` and no
  recall, never a zero recall that reads like a bad score.
- **The person's own council running when a bench starts:** bench councils wait in the queue; they never run two at once.
- **Results from two harness versions:** `wsh council bench results` groups by version, so an old score is never read
  as the new one's.
- **A rating changed after it was given:** the latest one counts; the file keeps both lines with their times.

---

### Task 1: The harness version on every council

**Depends on:** none
**Files:** `pkg/council/prompts.go`, `pkg/council/types.go`, `pkg/council/runner.go`, `pkg/council/prompts_test.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `const HarnessVersion = "<YYYY-MM-DD>.<n>"` in `prompts.go` (start at today's date `.1`), with a comment:
  bump it in the same commit as any change to a prompt, a role brief or a default model; `Council.Harness string`
  (`json:"harness,omitempty"`) set when a council starts.

- [ ] **Step 1: Test.** A council started through the runner carries `Harness == HarnessVersion`.
- [ ] **Step 2:** Run `go test ./pkg/council -run Harness` — Expected: FAIL.
- [ ] **Step 3:** Implement; run `task generate`.
- [ ] **Step 4:** Run `go test ./pkg/council` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): every council records the harness version it ran`.

### Task 2: The bench package

**Depends on:** Task 1 (records `Council.Harness` in each result)
**Files:** `pkg/council/bench/cases.go`, `pkg/council/bench/judge.go`, `pkg/council/bench/run.go`, `pkg/council/bench/results.go`, `pkg/council/bench/bench_test.go`

**Interfaces:**
- Produces: `LoadCases(dataDir string) ([]Case, error)`; `Judge(ctx, c Case, report Report) (Verdict, error)`;
  `Run(ctx, opts Options, start StartFunc, wait WaitFunc) ([]Result, error)` where `Options{Cases []string; Variants []string}`
  (empty = all) and `StartFunc`/`WaitFunc` wrap the runner so tests use fakes; `AppendResult(dataDir string, r Result) error`;
  `Summarize(results []Result) []Row` (per harness version × variant: recall summed over key lines, wrong items,
  tokens, recall per M tokens). `Result` holds `kind:"run"`, date, harness, case, variant, council id, state, recall
  numerator and denominator, wrong, tokens, minutes, messages.

- [ ] **Step 1: Tests.** `LoadCases` reads Phase 0's shape and skips a case whose project is missing (named in the
  returned warnings); `Judge` builds the prompt with the key, the rubric and the report cut to the top 5 or 3 items, and
  parses `{"matches":{"K1":rank|null},"items":[{"rank","verdict"}]}` from a fake consult reply; `Run` with fakes runs
  case × variant in order, one at a time, writes a failed council's row with no recall; `Summarize` groups by harness.
- [ ] **Step 2:** Run `go test ./pkg/council/bench` — Expected: FAIL.
- [ ] **Step 3:** Implement; the judge calls opus through `pkg/consult` with no tools; the report is built the way
  `docs/council-phase0.md` describes (summary answer and text, then each direction's rank, title and reasoning).
- [ ] **Step 4:** Run `go test ./pkg/council/bench` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): a bench package that runs the cases, judges the reports and keeps the results`.

### Task 3: `wsh council bench` and the monthly reminder

**Depends on:** Task 2 (calls bench.Run and bench.Summarize)
**Files:** `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Interfaces:**
- Produces: `CouncilBenchCommand(ctx, CommandCouncilBenchData{Cases, Variants []string}) (*CouncilBenchRtnData, error)`
  (starts the bench in the background, returns its total estimate and the list it will run) and
  `CouncilBenchResultsCommand(ctx) ([]bench.Row, error)`; `wsh council bench [--case c]... [--variant v]...` and
  `wsh council bench results`.

- [ ] **Step 1: Tests.** `wsh council bench` asks the gate with the total before calling the command and prints
  `Not run: …` on refusal; `bench results` prints one row per harness version × variant, newest version first.
- [ ] **Step 2:** Run `go test ./cmd/wsh/... -run Bench` — Expected: FAIL.
- [ ] **Step 3:** Implement; run `task generate`. When a full bench (no `--case`) ends, add the chunk
  `Re-measure the council: wsh council bench` due 30 days later to the initiative `Council benchmark` (create it if
  missing), through the same RPC `wsh effort chunk add` uses.
- [ ] **Step 4:** Run `go test ./cmd/wsh/... ./pkg/wshrpc/...` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): wsh council bench runs the benchmark and reminds a month later`.

### Task 4: "Was this useful?" on the report

**Depends on:** Task 3 (adds the rate command beside the bench commands)
**Files:** `pkg/council/types.go`, `pkg/council/store.go`, `pkg/council/store_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/summary.mjs`, `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Interfaces:**
- Produces: `Council.Rating string` (`json:"rating,omitempty"`, `useful` or `not`) and `RatedAt int64`;
  `CouncilRateCommand(ctx, CommandCouncilRateData{Id, Rating string}) error`, which saves it and appends
  `{"kind":"rating","date","harness","mode","council","rating"}` to `council-bench.jsonl`.

- [ ] **Step 1: Tests.** `store_test.go`: rating twice keeps the latest on the council and both lines in the file;
  `councilsummarymodel.test.ts`: a done council shows the rating row; after rating it reads
  `Thanks: this goes into the council benchmark` with a Change link.
- [ ] **Step 2:** Run `go test ./pkg/council -run Rate` and `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement: under the report, "Was this useful?" with **Useful** and **Not really**, styled like the
  report's other quiet rows (`DESIGN.md`); run `task generate`.
- [ ] **Step 4:** Run the same commands — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/summary.mjs` click Useful on a done fixture and assert the thanks line. Shown
  by `council-summary`.
- [ ] **Step 6:** Commit `feat(council): rate a council's report; the rating feeds the benchmark`.

### Task 5: Changelog, docs and the first reminder

**Depends on:** Task 3 (its line), Task 4 (its line)
**Files:** `CHANGELOG.md`, `docs/open-issues.md`, `docs/council-phase0.md`

- [ ] **Step 1:** `CHANGELOG.md` under `## Unreleased`: `Added` lines for "Was this useful?" on a council's report
  and for `wsh council bench`.
- [ ] **Step 2:** `docs/council-phase0.md`: a closing paragraph saying the benchmark is now `wsh council bench`
  (`bench results` for the table) and that `HarnessVersion` must be bumped with any prompt or role change.
- [ ] **Step 3:** `docs/open-issues.md` "0 · Waiting on a hand check": run `wsh council bench --case newcomer` on the
  installed app, allow the Token burn card, and check `wsh council bench results` shows the row and the initiative
  `Council benchmark` is untouched (a single case adds no reminder).
- [ ] **Step 4:** Commit `docs(council): the benchmark command and its hand check`.
