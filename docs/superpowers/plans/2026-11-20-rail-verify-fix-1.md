# Rail Verify fix round 1

**Goal:** Fix what the final stage of run de501e59 failed on (the Verify tile's head verdict breaking word by word in
the default rail width), and the stale tile its last task found (an edit after a passed run never shows as out of
date until a remount).

**Spec:** `docs/superpowers/specs/2026-11-20-rail-verify-design.md` (read "The cockpit draws it" and the B-tile copy).

**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/... ./cmd/wsh/...`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs rail-verify`

---

### Task 1: the tile's head keeps each verdict part whole, and the tile re-reads when the agent's state changes
**Depends on:** none
**Files:** `frontend/app/view/agents/railverify.tsx`, `frontend/app/view/agents/verifystore.ts`, `scripts/cdp/scenarios-rail-verify.mjs`, `docs/agents/verify.md`, `public/whatsnew/1.10.0-rail-verify.webp`

**1. The head verdict (the failing Final step).** In `railverify.tsx` `headBody`, every `tile.head.parts` span is a
shrinking flex item with no `whitespace-nowrap`, so in the 300px rail `1 failed · 1 no result · 1 out of date`
renders as `1 / failed · 1 no / result · 1 out / of / date` beside `3 scenarios` (Final shot
`rail-verify-1-failed-noresult-outofdate.png`). Give each `[data-verify-verdict]` span `whitespace-nowrap`, make the
`·` separators `flex-none`, and put the verdict parts in one `min-w-0 flex flex-wrap items-baseline gap-x-[4px]` span
(or flex-wrap the head row), so a part that does not fit moves to the next line whole and `3 scenarios` stays at the
right. The folded line (`Verify · N passed`) and a one-part head must look as they do now.

**2. The rerun command** (the reviewer's minor note): the mono command line breaks mid-word
(`chat-council-c / ard`); use `break-words` (`overflow-wrap:anywhere` only where a single token is wider than the
tile) instead of `break-all`.

**3. Re-read on the agent's state change.** `verifystore.ts` reads on mount, on a cwd change, on `verify:changed` and
after a skip; a watched file the agent edits publishes nothing, so the tile reads `passed` after an edit until a
remount. The spec now says the store also reads each time the agent's state changes (a turn starting or ending).
`useAgentVerify` passes `agent.state` to `useVerify`, which re-reads (`loadVerify`) when it changes, without
re-subscribing or touching `watched`'s ref counts. Keep wavesrv's no-poll rule: no timer. Update the header comment of
`verifystore.ts` and the "how the cockpit learns of a change" passage in `docs/agents/verify.md` (t-8 wrote the old
behaviour there).

**4. Scenario.** In `scenarios-rail-verify.mjs`:
- Step 1 (`1 failed · 1 no result · 1 out of date`) asserts that every `[data-verify-verdict]` span draws on one line
  (`getClientRects().length === 1`, or its height equals one line box) and that the count `3 scenarios` is visible.
- The step that writes `x.tsx` after a passed run and today calls `loadVerify` by hand: if the scenario can change
  the fixture agent's state the way the app does, drop the manual `loadVerify`, change the state, and assert the row
  reads out of date; if it cannot, keep the manual call and say why in your report.

**5. The What's new picture.** `public/whatsnew/1.10.0-rail-verify.webp` shows the broken head. Re-take it with the fix
in: run `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs rail-verify` (the scenario's `h.whatsnewShot`
rewrites the file in this tree) and commit the new picture. CHANGELOG's line keeps its shot comment unchanged.

**Acceptance:** `rail-verify` step 1's shot shows the verdict on whole parts with `3 scenarios` at the right, and its
new assertion passes; every other step still passes; `npx vitest run frontend/app/view/agents/verifymodel.test.ts`
passes; the re-taken picture is committed.
