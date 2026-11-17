# Sidecar orbit dashboard, round 1: what the tasks left behind

**Spec:** `docs/superpowers/specs/2026-11-17-sidecar-orbit-dashboard-design.md`

**Goal:** Fix the defects and leftovers the run's tasks reported in the feature they built (Found not fixed of t-7,
t-8, t-10, t-11). Nothing new is designed here.

---

### Task 1: An answered ask stops pinging, and a fresh failure draws its red bar at once

**Depends on:** none

**Files:** `frontend/app/cockpit/sidecarorbitmodel.ts`, `frontend/app/cockpit/sidecarorbitmodel.test.ts`, `frontend/app/cockpit/sidecarorbit.tsx`, `frontend/app/cockpit/sidecarcompact.tsx`, `scripts/cdp/scenarios-sidecar.mjs`

1. **The ping.** `pings(tile, waiting)` (`sidecarorbitmodel.ts:168`) returns true for an asking tile whose answer was
   already sent (`tile.sent === true`), so P's node keeps pinging while its row says Sent. The spec (Motion) says a
   waiting item pings "while it waits", and a sent answer no longer waits. Make `pings` false for a tile whose only
   reason to ping is waiting (`warning`) when `tile.sent === true`; a failed tile (`error`) still pings. Add a test for
   each case (sent ask: no ping; sent but failed: pings; unsent ask: pings). Then drop Q's local patch
   (`sidecarcompact.tsx:598`, `&& tile.sent !== true`) so both views take it from the model. Check how P's and Q's
   Needs you rows decide their ping: an ask row whose answer was sent must not ping either, in both views, through
   the same rule.
2. **The red bar.** `laneBars` (`sidecarorbitmodel.ts:214`) drops an open span (no `to`) whose `from` is a moment
   after `now`. The bridge starts the failed span at its own `Date.now()`, while the page's `now` comes from the
   snapshot. So a fresh failure's red bar is missing until the next snapshot or the page's 30 s tick, though the node,
   the row and the frame already show the failure. For an open span, clamp `from` to `now`, so it draws a
   `MIN_BAR_PX` bar at the lane's right edge. A closed span with `to < from` stays dropped. Add tests: an open span
   starting after `now` gives one 2 px bar at `x = width - 2` in its state; a closed span with `to < from` gives none.
3. **The scenario.** In `scripts/cdp/scenarios-sidecar.mjs`, the P-failed step waits up to 40 s for the lead lane's
   last bar to be `failed`, only because of item 2. Bring that wait down to the scenario's usual few seconds (the
   2 s P-live uses, or the file's standard wait helper), and keep the assertion. Rename `WALL_VIEWPORT` to
   `ORBIT_VIEWPORT` (lines 45, 1378, 1385).

Run `npx vitest run frontend/app/cockpit/sidecarorbitmodel.test.ts`, `task check:ts`, and
`ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs sidecar-orbit sidecar-compact`. Commit:
`fix(sidecar): an answered ask stops pinging; a fresh failure draws its red bar at once`.

### Task 2: The wall's leftovers: dead code and comments

**Depends on:** none

**Files:** `frontend/app/cockpit/sidecarkeys.ts`, `frontend/app/cockpit/sidecarkeys.test.ts`, `frontend/app/cockpit/sidecarband.tsx`, `frontend/app/cockpit/sidecarbridge.tsx`

1. `resolveSelection` in `sidecarkeys.ts:39` has no caller since the wall went (P and Q use `selectionAfter` in
   `sidecarorbitmodel.ts`). Grep every import of it (only `frontend/app/cockpit/` is relevant: the other
   `resolveSelection` functions in `view/agents/` are unrelated). Delete it and its `describe` in
   `sidecarkeys.test.ts`.
2. Comments that still describe the wall as the page: `sidecarband.tsx` lines 4, 6, 74 and 111 (the band sits over the
   dashboard; Enter and the arrows belong to the dashboard), and `sidecarbridge.tsx:140` ("DEV test seams for the
   sidecar-wall CDP scenario" → the `sidecar-orbit` and `sidecar-compact` scenarios) and line 11. Leave the layout's
   name `"wall"` (`layoutFor`, `data-sidecar-layout`) and comments that mean that layout as they are; the scenarios
   key on it.

No behaviour changes. Run `npx vitest run frontend/app/cockpit/sidecarkeys.test.ts` and `task check:ts`. Commit:
`refactor(sidecar): drop the wall's unused resolveSelection and its wording`.

### Task 3: Free Sidecar's window icons when its window closes (Windows)

**Depends on:** none

**Files:** `src-tauri/src/sidecar.rs`, `src-tauri/src/main.rs`

Each time the Sidecar window opens, it makes two HICONs (`make_icon` in `sidecar.rs`, sent with `WM_SETICON` by
`use_sidecar_icons` in `main.rs`) that are never destroyed. So every close and reopen leaves two icon handles until
the process exits. Keep the two handles with the Sidecar window, and `DestroyIcon` them once that window is destroyed
(Tauri's `WindowEvent::Destroyed` for the Sidecar label, or the equivalent the existing code already hooks). Never
free them while the window can still draw them. Leave the main window's icons as they are: they live as long as the
app. Keep it `#[cfg(windows)]`. Don't run `cargo build`: `src-tauri/target` is junctioned into the main checkout (see
t-10's report). Run `cargo test --manifest-path src-tauri/Cargo.toml` and
`cargo check --release --manifest-path src-tauri/Cargo.toml`. Commit:
`fix(sidecar): free the window's icons when Sidecar closes`.

### Task 4: Move the oldest hand checks out of `docs/hand-checks.md`

**Depends on:** none

**Files:** `docs/hand-checks.md`, `docs/hand-checks-6.md`, `docs/hand-checks-7.md`

`docs/hand-checks.md` is 654 lines, past the 400 its own **Parts** paragraph allows. Follow that paragraph exactly:
move whole entries from the bottom (a date heading goes with its entries) to the top of the highest-numbered part
until this file is under 250 lines. `hand-checks-6.md` is 429 lines, so start `hand-checks-7.md` (the same header)
when moving into part 6 would take it past 600 lines, and add part 7 to the **Older parts** list. Move the lines
unchanged: don't tick, reword or drop any. Check that the line count of the two files together, minus the new header,
is unchanged. Commit: `docs(hand-checks): move the oldest entries to the older parts`.
