# Council, stronger: fix round

Spec: `docs/superpowers/specs/2026-11-03-council-stronger-design.md`. This round fixes defects the run's tasks reported
inside the run's goal. It adds no features.

### Task 1: A real verify process is tested, and wsh's help uses the new role names
**Depends on:** none
**Files:** `pkg/council/verify_test.go`, `cmd/wsh/cmd/wshcmd-council.go`

Two defects in Go:

1. `realVerifyCmd` (`pkg/council/verify.go`, ~line 789) has no test: every RunVerifies test swaps in a fake launcher.
   Add tests in `verify_test.go` that call `realVerifyCmd` itself on a tiny Go module written to `t.TempDir()` (a
   `go.mod` and one `_test.go` file), with `go test . -run <name>`:
   - a passing test returns exit 0;
   - a failing test returns a non-zero exit, and its output holds the failure line;
   - output longer than the kept tail returns only the end, holding the last line;
   - a context that ends while a test sleeps (`time.Sleep(time.Minute)`, a context of about 3 s) returns
     `ctx.Err()` within a few seconds and leaves no process of that test running. For example, the test writes its PID
     to a file, and the check confirms that process no longer exists.
   Don't change `verifyTimeout`. Use a context with a short deadline instead. Keep each test under ~30 s.
2. `cmd/wsh/cmd/wshcmd-council.go` still names the old roles in its help text and comments (about lines 29, 71-72, 352,
   418, 607-608 and 646-647: Skeptic, Contrarian, Facilitator, coordinator). Use the names `pkg/council/roles.go` now
   gives them, reading them from that file rather than guessing. Change text only, no behaviour.

Test: `go test ./pkg/council -run 'TestRealVerifyCmd'` and `go build ./cmd/wsh/...`.

### Task 2: The Report names the summarizer by its seat name
**Depends on:** none
**Files:** `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/summary.mjs`

`councilsummary.tsx` (~line 366) labels an idea's reasoning with the fixed word "Coordinator:". The seat that writes
the summary is now named "Summarizer" ("Người tổng hợp" in a Vietnamese council), and a person can rename it. Put a
pure helper in `councilsummarymodel.ts` that returns the summarizing seat's name: the expert in `c.experts` with
`coordinator: true`, by its own `name`, so a rename or the Vietnamese name carries through. It falls back to
"Summarizer" when there is no such seat. Use it for that label. Test the helper in `councilsummarymodel.test.ts` with
the stock name, a renamed seat and a council with no coordinator seat. If a `council-summary` step expects the old
"Coordinator:" label, update it.

Test: `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts`.
