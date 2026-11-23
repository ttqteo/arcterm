# Council report tables: round fixes — plan

**Spec:** `docs/superpowers/specs/2026-11-23-council-report-tables-design.md`

Open issues the run's tasks left, each in a file the run changed. Principles: the simple, direct fix; no new
abstraction. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (AGENTS.md).

### Task 1: Test that a council with no project takes no copies; the golden flag's description
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/council/briefs_test.go`, `pkg/council/charts_golden_test.go`

- `takeBriefs` (`pkg/council/briefs.go`) returns early when `c.Project` is empty, and no test covers it. Add one to
  `briefs_test.go`: a council with an empty `Project` and an outside file in `Files` keeps `Files` exactly as it was,
  records no `Briefs`, and writes nothing to disk (use a temp dir as the would-be outside file's folder and check no
  `docs/council/briefs` folder appears anywhere under the test's temp dirs). Run
  `go test ./pkg/council -run Brief`.
- `charts_golden_test.go:21`: the `-update` flag's description says it rewrites only `testdata/glance-golden.json`.
  Read which goldens `*updateGolden` now rewrites in the package (`grep -rn updateGolden pkg/council`) and make the
  description name them all. If it is only glance-golden.json, leave the file as it is and say so in your report.

### Task 2: council-summary's Brainstorm First step read does not depend on innerText's spacing
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/council/summary.mjs`

The Brainstorm step in `council-summary` reads each direction's First step with `innerText`
(`BRAINSTORM_FACTS`, `steps: all("[data-council-direction] [data-council-first-step]").map(t)`) and compares it with
`"First step Try it on one screen"` (around line 1367). The read sometimes comes back without the space
(`"First stepTry it…"`), so the step is flaky. Make the comparison independent of that spacing: either read the
label and the step's own text as two parts, or collapse whitespace on both sides and compare
`"First step"` + the step text with the space normalised. Keep the assertion as strict as it is otherwise (same
label, same step text, three steps). Check the other `facts.*` reads in the same facts object for the same
label-then-text pattern and treat them the same way only if they read a label beside its text. Run
`node scripts/cdp/final-verify.mjs council-summary` with `ARC_FINAL_OUT` set to a scratch folder (AGENTS.md) to
show the scenario passes; if the machine refuses the run (memory, jobslot), say so in Not verified.
