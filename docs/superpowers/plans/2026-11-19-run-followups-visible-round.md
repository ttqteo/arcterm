# To review: fix round — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-19-run-followups-visible-design.md` (decisions 12 and 13 are this round's)
**Verify:** `node scripts/verify.mjs ./pkg/jarvis ./pkg/jarvisstate ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke brief-run-review`
**Prototype:** D:\work\arcterm\.superpowers\design\run-review-inbox\project\B-strip-sheet.dc.html

Goal: close the three open issues the run left in its own feature: a run's proposals counted twice on the Brief, the
undo toast drawn over the To review sheet, and the `proposed` note text written as a literal beside
`jarvis.ProposedNote`.

Conventions: Go tests on Windows run as `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run
'^TestName$'` (Bash). Frontend logic goes in a pure `.ts` with its vitest beside it; the `.tsx` stays thin. Colors from
`@theme` tokens, motion from `motiontokens.ts`. Never hand-edit generated files. No CHANGELOG line: the feature's line
already covers it.

### Task 1: The `proposed` note text has one source

**Depends on:** none

Decisions: `jarvis.ProposedNote` (`pkg/jarvis/proposal.go`) is the note text. Use it where a note's text is written or
compared: `chunkNote(e, idx, "proposed", …)` in `addChunk` (`pkg/jarvis/effortops.go`, about line 367) and
`note.Text == "proposed"` in `planReviewItems` (`pkg/jarvis/attention.go`, about line 651). The chunk *status*
`"proposed"` is a different thing and stays as it is.

Files: `pkg/jarvis/effortops.go`, `pkg/jarvis/attention.go`.

Acceptance: no note-text literal `"proposed"` is left in `pkg/jarvis` outside `proposal.go`; existing tests pass
(`go test ./pkg/jarvis -run '^(TestPlanReview.*|TestProposalRun.*|TestApplyOps.*)$'`).

### Task 2: A run's proposal counts in To review only

**Depends on:** none

Decisions (spec decision 12): an initiative row's `proposed` text (`initiativeLine` in
`frontend/app/view/jarvis/briefrows.ts`, which the Ideas box and the linked-initiative lines in `briefrowviews.tsx`
read) counts only the proposed chunks To review does not list. The set To review lists is
`WorkState.runreview`'s items, keyed by `effortoid` + `label` (reuse `reviewKey` in `runreview.ts`, or a helper beside it,
rather than a second key format). A row with none left shows no count. The initiative sheet's Proposed group is not
changed. Pass the set in from where the Brief already holds the snapshot; keep the filtering pure and tested.

Files: `frontend/app/view/jarvis/briefrows.ts` + `briefrows.test.ts`, `frontend/app/view/jarvis/runreview.ts` +
`runreview.test.ts` if a helper goes there, the callers that build initiative lines (`briefsurface.tsx`,
`briefrowviews.tsx`, others `initiativeLine` has), `scripts/cdp/scenarios.mjs` (`brief-run-review` only).

Acceptance: vitest covers a row whose proposals are all in To review (no count), a row with one listed and one not
("1 proposed"), and a row with no To review data (unchanged). Scenario `brief-run-review` step 2 also asserts that the
`verify-rr-a` and `verify-rr-b` Ideas rows show no `[data-jarvis-proposed-count]`, and the step's record says so.

### Task 3: The undo toast leaves the To review sheet clear

**Depends on:** Task 2 (both edit the `brief-run-review` scenario in `scripts/cdp/scenarios.mjs`)

Decisions (spec decision 13): while the To review sheet is open (`runReviewOpenAtom`), `BriefToastView`
(`frontend/app/view/jarvis/brieftoast.tsx`, today `absolute bottom-6 left-1/2`) is centred in the part of the page
column left of the sheet, so it covers no part of the sheet; closed, its placement is unchanged. Derive the offset from
the sheet's own width (one source: the sheet's width constant or class, not a second number). The scenario's What's new
picture (`h.whatsnewShot("run-review", …)` in step 2) is framed so the sheet's header, its title and count line, is
whole in the picture.

Files: `frontend/app/view/jarvis/brieftoast.tsx`, `frontend/app/view/jarvis/runreviewsheet.tsx` (if the width moves to
a shared constant), a pure helper + test if the placement needs logic, `scripts/cdp/scenarios.mjs`
(`brief-run-review` only).

Acceptance: in `brief-run-review`, the step that presses `l` (step 5) or clicks Later (step 6) also reads the toast's
and the sheet's bounding rects while the toast is up and asserts they do not intersect; the step's record says so. The
step 2 shot is checked by eye: the header reads "To review" and its count line whole.
