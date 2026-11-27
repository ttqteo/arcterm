# Save for later, fix round 1: the placement and toast checks, the tracker's delete step, and the gaps the workers named

**Spec:** `docs/superpowers/specs/2026-11-27-ask-later-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/waveobj ./pkg/jarvis ./pkg/jarvisstate ./pkg/dume ./pkg/wavevault ./pkg/sessionideas ./pkg/wshrpc/wshserver ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs save-later later-section later-sheet later-card chat-quote chat-initiative brief-inline-tracker jarvis-initiative-sheet jarvis-brief-later initiative-link`

Round 1's Final passed 60 of 68 steps. The full step details are in
`<data dir>/final-shots/6c94e506-fdb6-4811-8c68-158dbfd15c06/1/shots.json`, and the
screenshots are in `cdp-shots/` beside it. `later-sheet`, `later-card`, `chat-quote`, `chat-initiative`,
`jarvis-initiative-sheet` and `jarvis-brief-later` passed in full. These steps failed:

- `initiative-link` 3, 3b, 3c and 4: base failures. Run af2b7967 (Chunk priority) hit the same four in its round 1
  (final-shots `80fa0a7a…/1`). The cause was a bare `i` in Chat being typed into the chat box since `8c547fd79` and
  `9819ff687`. Its fix `1cf2c18a4` is on main. The lead merged main into this branch in `9e1fc41c1`, which brings that
  fix and Chunk priority. That merge keeps both fields and leaves later chunks out of the rank rule (Builder's call 16).
  No task here touches `initiative-link`; Final shows whether the merge fixed it.
- `save-later` 3: `placedAt` is false and every other term holds. The press was at x 1206 in a 1455px viewport, and
  the 330px picker opened above it with its right edge at 1205.5. floating-ui's `flip` (crossAxis) flipped the
  alignment to `top-end`, so the picker's right edge sits on the point. `placedAt` only models `shift` (left edge at
  `min(x, vw - width - 8)`, which is 1117). The placement is correct; the check is too narrow. Task 1.
- `later-section` 3: every term holds except the toast text. It read `"Done · Push DEV to originUndo"` because the
  toast's `textContent` includes its Undo button. Task 1.
- `brief-inline-tracker` 7 (`{"gone":false,"back":true}`: Delete chunk on "Ship" did not hide the row, or no Undo toast
  showed) and 9 (`{"sheet":true,"chunks":4,"brief":true}`: two Escapes after step 8 left the sheet open). No earlier
  Final ran this scenario, so whether the base fails it is unknown. `cdp-shots/brief-inline-tracker-confirm.png` (step 8)
  shows the sheet's ⋯ menu drawn at the window's top-left corner. Task 2.

This run's agents run no CDP (`ARC_RUN_AGENT`), so Final is the only live check. Work from the code and the step
details above, and say in the report which fixes are read from the code rather than seen.

### Task 1: The save-later placement check allows the end alignment, and the later-section toast check reads the message alone
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-save-later.mjs`, `scripts/cdp/scenarios-later-section.mjs`

- `placedAt(picker, at)` in `scenarios-save-later.mjs` also accepts the `-end` alignment that flip's cross axis picks
  near the right edge: the picker's right edge within 6px of `at.x`. This is in addition to the shifted left edge it
  accepts today. Vertically it is still below (`top ≈ y + 6`) or above (`bottom ≈ y - 6`). The comment above it names
  both alignments. Step 5 uses the same helper and passed, so it must still pass.
- `later-section` step 3 reads the toast's message without the Undo button's text. Clone the toast and drop
  `[data-jarvis-toast-undo]`, or read the message element if the toast has one; check `laterchunksregion.tsx` and the
  Brief toast for a message hook. The step keeps asserting exactly `Done · ${TICK_LABEL}`. Read every other step of
  both scenarios that reads a toast's `textContent`, and fix any that has the same flaw. In `save-later` step 3 the
  `t.text` read `"Moved to Save later fixture twoDecide…"`; if a step compares such text exactly, make it read the
  title and the body apart.
- Re-check each term of `save-later` step 3 and `later-section` step 3 against the round-1 details quoted in this
  plan's header. Name any term other than the two above that would still fail.
- Acceptance: `node --check` on both files. The two changed predicates are pure: put them where a node one-liner can
  call them, and run them on the round-1 numbers. `placedAt` with rect `{left: 875.45, top: 432.73, right: 1205.45,
  bottom: 658.84, width: 330}`, `vw` 1455 and point `{x: 1206, y: 665}` returns true. It returns false for a picker 40px
  left of that. Paste both outputs in the report.

### Task 2: The initiative sheet's Delete chunk and Escape steps (brief-inline-tracker 7 and 9)
**Depends on:** none
**Model:** opus
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/jarvis/inlinetrackerview.tsx`, `frontend/app/view/jarvis/initiativeedits.ts`, `frontend/app/view/jarvis/initiativeedits.test.ts`, `frontend/app/view/jarvis/initiativesheet.tsx`, `frontend/app/view/jarvis/trackeredit.ts`, `frontend/app/view/jarvis/trackeredit.test.ts`, `frontend/app/view/jarvis/inlinetracker.ts`, `frontend/app/view/jarvis/inlinetracker.test.ts`

The scenario is the `brief-inline-tracker` object in `scripts/cdp/scenarios.mjs`. Step 7 opens Ship's status pill,
presses "Delete chunk" in `[data-jarvis-tracker-menu]` and expects the row gone with an Undo toast. Step 9 presses
Escape twice after step 8's sheet ⋯ menu and expects the sheet closed.

- Find the cause, the superpowers:systematic-debugging way, before changing anything. This run changed the files
  above: compare each with the base, `git diff 840dd5ea3 HEAD -w -- <file>`. The base is the commit before this run's
  tasks; `HEAD` also holds the merge of main, so separate main's Chunk priority changes (for example the Priority menu
  in the chunk menu) from this run's. Read the paths each step drives:
  - the chunk menu's open toggle (`menu === menuId`) and the outside-press close;
  - `drawRow` now being called from two places (the plan and the Later group);
  - `scheduleRemove` and the pending-delete filter;
  - `canRemove`;
  - how Escape reaches the sheet after a ⋯ menu.
  Also check whether a state left by step 6 (the rename input's Escape) survives into steps 7–9.
- If the cause is this run's code, fix the code and add a unit test where the logic is pure (`trackeredit.ts`,
  `initiativeedits.ts`, `inlinetracker.ts`). If the scenario is stale against the base behaviour, fix the scenario. Say
  which, with the `path:line` that shows it.
- Whatever the cause, step 7 records its sub-checks in its detail: the menu opened on Ship, "Delete chunk" was found,
  the row was hidden, the Undo toast showed, the row came back. Step 9 records, before its Escapes, what is still open:
  a menu, a rename input, the focused element's tag and data attributes. A failure in the next Final then names its
  cause. The step texts stay true.
- A later row's menu (`drawRow(..., later = true)`) hides the Priority section the merge of main ported into the
  chunk menu, as it already hides the move entries. A later chunk has no place in the order of work, and "Not later"
  brings the section back with the chunk. Lead's call; no test is needed beyond `task check:ts`.
- If the ⋯ menu drawn at the window's top-left corner (step 8's shot) comes from this run's code, fix it in the same
  way. If it is on the base, name it in the report and leave it.
- Acceptance: `npx vitest run` on the jarvis test files in the list passes, and `node --check scripts/cdp/scenarios.mjs`
  passes. The report states the cause found, or, if none could be found from the code, the hypotheses ranked and what
  the new step details will tell.

### Task 3: The stale scan leaves later chunks out
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/jarvis/chunkstale.go`, `pkg/jarvis/chunkstale_test.go`, `pkg/wshrpc/wshserver/wshserver_effortstale.go`, `pkg/wshrpc/wshserver/wshserver_effortstale_test.go`

Builder's call 4: every Go reader of an initiative's work checks `c.Later`. The stale scan was missed. Today
`wsh effort stale` and the 15-minute scan can list a saved passage that names a file, and the base backfill stamps a
base on it.
- Where the stale scan and the base backfill pick chunks (`jarvis.ChunkIsOpen` and its callers), skip a chunk with
  `Later`. Do not change `ChunkIsOpen` itself if other readers rely on it for plan chunks and later chunks alike; read
  its callers first and put the check where the scan picks. `ChunkIsOpen` is in `pkg/jarvis/chunkstale.go`, and
  `wshserver_effortstale.go` is its only other caller.
- Acceptance: a test with one plan chunk and one later chunk, both naming a file the scan would flag, lists only the
  plan chunk, and backfill stamps only the plan chunk. `go test` on the touched packages passes.

### Task 4: A failed later add after making a new initiative does not make a second one, and the chunk view steps through the plan only
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/savelater.ts`, `frontend/app/view/agents/savelater.test.ts`, `frontend/app/view/agents/chatinitiativestore.ts`, `frontend/app/view/agents/chatinitiativecard.tsx`, `frontend/app/view/agents/chatquotemenu.tsx`, `frontend/app/view/jarvis/chunkview.tsx`, `frontend/app/view/jarvis/chunksteps.ts`, `frontend/app/view/jarvis/chunksteps.test.ts`

- `saveLaterTo("new", …)` creates the idea, then adds the later chunks. If the add fails, the caller does not learn the
  idea was made, so the card's "Try again" makes a second one. Make the created initiative's oref reach the caller on
  failure: an error that carries it, or a result type, whichever fits the existing callers. The later card
  (`chatinitiativestore.ts` / `chatinitiativecard.tsx`) then switches its target to that initiative, so Try again adds there. Drop the hint that
  works around this. The Chat menu caller (`chatquotemenu.tsx`) names the made initiative in its failure toast.
- `chunkview.tsx`'s `useChunkSteps` builds "chunk n / total" and prev/next from `state.planChunks`, which holds every
  server chunk. Opening a plan chunk must count and step through plan chunks only (`planChunks` from
  `laterchunk.ts`). A later chunk opened from the Later group has no place in the plan: it shows no "n / total" and no
  prev/next. Put the list logic in a pure `chunksteps.ts` with its test,
  and have `useChunkSteps` call it.
- Acceptance: `npx vitest run` on the touched test files. The `savelater` test covers the add failing after the
  create, with the oref reaching the caller and no second create on retry. The step list test covers a plan with one
  later chunk in the middle.
