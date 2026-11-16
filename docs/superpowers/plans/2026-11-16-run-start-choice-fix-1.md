# Choosing when a run starts — final-stage fix, round 1

**Verify:** `node scripts/verify.mjs ./pkg/runqueue ./pkg/runstart ./pkg/jarvis ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs run-start-choice run-start-choice-live run-start-choice-brainstorm run-queue-recheck run-queue brief-run-queue chat-verdict-handoff`

The final stage's Verify failed on one frontend test, which is already failing on the base and is outside this run's
goal: `frontend/tauri/browsershim/browsershim.test.ts` > "answers every Tauri command the frontend invokes" fails with
`core.ts answers no cloak_window`. Base commit `1b509d496 fix(float)` added `invoke("cloak_window", { cloaked })` in
`frontend/app/view/agents/floatstore.ts` (`cloak`, Windows only: it hides the window while Full <-> Float changes its
frame, `src-tauri/src/winframe.rs`) without teaching the browser stand-in that command. Every other command the frontend
invokes is already answered.

### Task 1: The browser stand-in answers cloak_window

**Depends on:** none

**Files:** `frontend/tauri/browsershim/core.ts`

**Decision:** `cloak_window` joins `NO_OPS`, beside `hold_window_frame` and `set_folded_chrome`, with a short comment in
the list's style: a page has no native window to hide while its frame changes. It is a no-op that resolves, not an
error: `floatstore.ts` already swallows a failure with `.catch(() => {})`, and a page never changes a window frame, so
there is nothing to report. Do not touch the test, `floatstore.ts` or the Rust side.

**Acceptance:**
- `node node_modules/vitest/vitest.mjs run frontend/tauri/browsershim/browsershim.test.ts` passes, all 10 tests.
- `invoke("cloak_window", { cloaked: true })` on the stand-in resolves to `undefined`.
- No other file changes. No CHANGELOG line: this is a test stand-in, nothing a user sees.
