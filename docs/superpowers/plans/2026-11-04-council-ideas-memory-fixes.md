# Council: Ideas by stance and a Memory tab — fix round

Two test stand-ins the run left behind still answer as they did before the round check existed. Neither changes
product code.

### Task 1: The routing scenario's estimate stand-in prices the round check

**Depends on:** none
**Files:** `scripts/cdp/council/routing.mjs`

`answerEstimates` (around lines 214–246) is a stand-in for `CouncilEstimateCommand` that copies wavesrv's pricing,
and it still prices the old way. Task 5 of the run added one round check (`roundCheckTokens`, 15k, one call) per
message: see `EstimateRouted` and `EstimateFollowup` in `pkg/council/estimate.go`, which are the source of truth.

- Add a `ROUND_CHECK_TOKENS = 15_000` beside `ROUTER_TOKENS` and make the stand-in answer what `estimate.go` answers
  now: a routed message is `calls: 3`, `callsmax: 4`, and both token ends carry router + round check (30k) besides the
  seats; a follow-up of `n` seats is `n + 1` calls and `20k × n + 15k` tokens.
- Update the comment above it (lines ~213–216) and the file header's example (line ~8) to the new numbers.
- Update every hint the scenario expects to match: the Auto, On and Off lines (around 294–295, 334, 338, 344) and the
  `3 experts answer` line (around 424). Compute each from `estimate.go` and the stand-in, not by guessing.
- Run the scenario on its own: `node scripts/cdp/final-verify.mjs council-routing` must pass. If it cannot run in your
  environment (exit 3), say so under Not verified.

Acceptance: the stand-in and `estimate.go` give the same numbers for a routed message (Auto, On, Off) and for a
follow-up, and `council-routing` passes. No other assertion in the file is loosened.

### Task 2: The wshserver council fake answers the two check prompts

**Depends on:** none
**Files:** `pkg/wshrpc/wshserver/wshserver_council_test.go`

`councilCallKind` and `councilCanned` in this test file do not know the pre-set check or the round check that Task 4
added, so every full council run in these tests logs `round check failed: … no canned reply for ?`. The tests pass,
but the log reads as a failure.

- Teach `councilCallKind` the two prompts the same way `kindOf` in `pkg/council/runner_test.go` does (the prompts
  start `You check one direction the person wants to set` and `You read one round of a council discussion`).
- Make `councilCanned` answer them in the shape `parsePresetCheck` and `parseRoundCheck` in
  `pkg/council/memorycheck.go` accept: the pre-set check says it fits, the round check says no change.
- Raise no other expectation. If a test's call or token count moves because the check now answers instead of
  failing, it should not (a failed check books its call and tokens too); if one does, report why under Differs from
  plan rather than changing the number blindly.

Acceptance: `go test ./pkg/wshrpc/wshserver -run Council` passes and its output no longer has a `round check failed`
line.
