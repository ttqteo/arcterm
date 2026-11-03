# Council bench team: fix round

Spec: `docs/superpowers/specs/2026-11-03-council-bench-team-design.md`. One task: the bench command's words still say
every item is a council, and the stale missing-cases message is now logged on every results call.

### Task 1: The bench's words name cells, and a data dir with no cases reads quietly

**Depends on:** none

**Decisions:**
- A bench item can be a solo agent, a council or an agent team. Every line `wsh council bench` prints before the
  Token burn gate and after the start must therefore count runs, not councils. `councilBenchPlanLine` prints
  `N runs over M cases · ~X tokens`, with the per-variant split in brackets when more than one variant is planned.
  For example: `8 runs (4 council, 4 team) over 2 cases · ~53.2M tokens`. The order is solo, council, team, and a
  variant with no items is left out. The "bench started" line says `the runs go one at a time`. Use the variant names
  as they are on the wire (`solo`, `council`, `team`).
- `bench.LoadCases`'s missing-file error says `no benchmark cases at <path>; scripts/council-bench-cases.mjs builds
  them: …`, which is the current builder. It must still wrap `fs.ErrNotExist`.
- `CouncilBenchResultsCommand` logs a `LoadCases` error only when it is not `fs.ErrNotExist`. A data dir with no
  `cases.json` (a ratings-only user) gives no verdict and logs nothing. Any other load error is still logged, and the
  table still comes back.
- Do not merge the two `### Changed` headings in `CHANGELOG.md`: they came from main. This task adds no CHANGELOG line.

**Files:**
- Modify: `cmd/wsh/cmd/wshcmd-council.go`: `councilBenchPlanLine`, the "bench started" line, and the
  `councilBenchPlanLine` doc comment.
- Modify: `cmd/wsh/cmd/wshcmd-council_test.go`: `TestCouncilBenchGateBeforeStart`'s "4 councils over 2 cases"
  assertion, plus a test for the split.
- Modify: `pkg/council/bench/cases.go`: the `LoadCases` message. Also `pkg/council/bench/cases_test.go:179`, which
  checks it.
- Modify: `pkg/wshrpc/wshserver/wshserver_council.go`: the `LoadCases` error branch in `CouncilBenchResultsCommand`.
  Add a test in `pkg/wshrpc/wshserver/wshserver_council_test.go` for a data dir with no `cases.json`: the result has
  runs and no verdict, and nothing logs `no verdict`.

**Acceptance:**
- `go test ./cmd/wsh/cmd -run CouncilBench` passes, with a test for one variant (no brackets) and one for two variants
  (the split in solo, council, team order).
- `go test ./pkg/council/bench -run LoadCases` and the new wshserver test pass.
- No other wording in `wsh council bench --help` changes.
