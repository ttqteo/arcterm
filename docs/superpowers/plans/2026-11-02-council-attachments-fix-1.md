# Council attachments, fix round 1: the stale Retry step

**Spec:** `docs/superpowers/specs/2026-11-02-council-attachments-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/consult ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-discussion`

The run's final stage passed 92 of 93 `council-discussion` steps. The one failure is on main too and predates this run:
`room: Security's Retry, on its chip and on its failure line (stubbed), records CouncilRetryCommand with its expert id`
(`scripts/cdp/council/discussion.mjs` ~line 949) clicks both Retry buttons on the `room` fixture, whose council is
`running`. Since `50daec52b` ("every Retry is off while the council runs") both buttons are disabled while a council runs:
`SeatChipRow`'s `data-council-chip-retry` (`frontend/app/view/agents/councilchat.tsx` ~line 418, `disabled={running || …}`,
title "The council is running: retry once it is done") and `FailedLine`'s `data-council-retry` (~line 983). The clicks do
nothing, `until` times out, and the step records `[]`. The person chose to fix the test only. The product rule stays as
it is.

### Task 1: The Retry step follows the rule that Retry is off while a council runs

**Depends on:** none

**Files:** `scripts/cdp/council/discussion.mjs`

Change only the scenario. Leave `councilchat.tsx` and the fixtures alone.

- In `room` (the block after the `council-discussion-room.png` shot): replace the stubbed clicks and the
  `room: Security's Retry …` step with one step that reads, on the running room, that `[data-council-chip-retry="security"]`
  and `[data-council-channel] [data-council-retry="security"]` both exist and are `disabled`, and that the chip's `title`
  is `The council is running: retry once it is done`. Then stub `CouncilRetryCommand`, click both, and assert that no
  `CouncilRetryCommand` was recorded. Do not wait on `until` for calls that should never come: read the calls right after
  the clicks. Unstub afterwards. Suggested step name: `room: while the council runs, Security's Retry on its chip and on
  its failure line is disabled (the chip says why), and a click records no CouncilRetryCommand`.
- In `failed` (the stopped council, `rail-apps-failed.json`): the existing step already clicks the failure lines' Retry
  for Skeptic and the coordinator. Add the chip's Retry there too, so a Retry click on a seat chip is still checked
  somewhere: click `[data-council-chip-retry="skeptic"]` with `CouncilRetryCommand` stubbed and assert it records one call
  with that council's id and `expertid: "skeptic"`. The fixture may not draw a chip Retry for Skeptic, because
  `chip.retry` is false or because Retry all replaces it when two or more seats failed. If so, read why in
  `councilchat.tsx` and assert the chip-level control the stopped council does draw (Retry all, when that is what shows)
  instead. Say which in the report. Keep the existing two-call assertion intact: either take the chip click in its own
  stub window, or count three calls in a clearly named step.
- Never run prettier on this `.mjs` file. Keep its 4-space hand formatting.

**Acceptance:** `node scripts/cdp/final-verify.mjs council-discussion` passes every step, the rewritten room step and the
added failed-council check included. No other step's assertion is weakened.
