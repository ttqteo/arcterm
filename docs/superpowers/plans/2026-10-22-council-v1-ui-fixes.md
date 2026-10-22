# Council v1 made readable: fix round

> **For agentic workers:** a fix round of run 74b368ce on `docs/superpowers/plans/2026-10-22-council-v1-ui.md`. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three defects the run left inside its own goal: the council toast ignores the In-app toasts setting,
the coordinator and experts can still write `P2` in the prose the person reads, and the command palette's Needs you
row for a waiting council opens nothing.

**Global constraints:** plain words in every string the person reads (the run's plan, Global constraints). Keep every
`data-council-*` hook. Scenario data comes from per-step `edit` copies (`writeCouncil(ctx, name, edit)`); the shared
fixtures in `scripts/cdp/council/` are not touched.

### Task 1: The council toast honours In-app toasts

**Depends on:** none
**Files:** `frontend/app/view/agents/councilnotify.ts`, `frontend/app/view/agents/councilnotify.test.ts`, `frontend/app/view/agents/councilnotifysync.tsx`

`NotifySync` (`notifysync.tsx:108`) reads `notify:toast` (Settings → In-app toasts, default on) and pushes no toast when
it is off; `CouncilNotifySync` pushes its toast regardless, so a person who turned toasts off still gets council ones.

- [ ] **Step 1: Test.** In `councilnotify.test.ts`, a pure decision in `councilnotify.ts` (for example
  `noticeRoute(notice, toastsOn): { toast: boolean; unread: boolean }`, or your own shape): with a notice and toasts on,
  both; with toasts off, no toast and the unread dot still marks; with no notice, neither.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilnotify.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. `CouncilNotifySync` reads `getSettingsKeyAtom("notify:toast")` (`?? true`, as
  `NotifySync` does) through its `shown` ref, so the list effect still runs on the list alone, and uses the decision
  from Step 1. The unread dot does not depend on the setting.
- [ ] **Step 4:** Rerun Step 2's command — Expected: PASS. `council-tree`'s toast steps (8 and 9) run with toasts on and
  must still pass in Final; no scenario step is added.
- [ ] **Step 5:** Commit `fix(council): the council toast honours the In-app toasts setting`.

### Task 2: Prompts name ideas by title, never by id, in prose

**Depends on:** none
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`

The UI no longer shows proposal ids, but no prompt tells a model to keep them out of its prose, so a direction's
reasoning, the summary text, the one-sentence answer and an expert's reason can still read "P2 is better than P3".

- [ ] **Step 1: Test.** In `prompts_test.go`: the round 2 prompt, the synthesis prompt (with and without a question),
  and every other prompt whose JSON shape has a prose field the person reads (a reason, an answer to the person, a
  revised argument, "text", "reasoning", "answer", a weak claim's "note") contain one shared rule: name a proposal by its
  title or what it says, never by its id. The id fields keep ids: `proposalid`, `picks`, `from`, the keys of
  `outcomes`, `ref`, `replyid`; the existing tests that check those still pass unchanged.
- [ ] **Step 2:** Run `go test ./pkg/council -run 'Prompt'` (adjust the filter to the test names) — Expected: FAIL.
- [ ] **Step 3:** Implement as one rule constant beside `stanceRule` and `evidenceRule`, written into each of those
  prompts once. Change no JSON shape and no parser.
- [ ] **Step 4:** Rerun Step 2's command — Expected: PASS. `gofmt -l pkg/council/prompts.go` prints nothing.
- [ ] **Step 5:** Commit `fix(council): prompts ask for ideas by title, not by id, in what the person reads`.

### Task 3: The palette's Needs you row for a waiting council opens it

**Depends on:** none
**Files:** `frontend/app/cockpit/palette-needs.ts`, `frontend/app/cockpit/palette-needs.test.ts`, `frontend/app/cockpit/openneeds.ts`, `scripts/cdp/council/needsyou.mjs`

A `council` attention item (`council:<id>` oref, no channel) lands in the palette's Blocked group, since `KIND_GROUP`
does not name it, and `needsTarget` returns null for it, so Enter on the row does nothing.

- [ ] **Step 1: Tests.** In `palette-needs.test.ts`: a `council` item groups under `reviews`, not `blocked`;
  `needsTarget` gives `{ kind: "council", councilId }` from its `council:<id>` oref, and null for an oref that is not a
  council's.
- [ ] **Step 2:** Run `npx vitest run frontend/app/cockpit/palette-needs.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. `KIND_GROUP` gains `council: "reviews"`; `NeedsTarget` gains the council case;
  `openNeedsTarget` opens it through the one router (`openTarget(model, { kind: "council", councilId })` in
  `frontend/app/view/jarvis/openref.ts`, which exists), never by setting the selection and surface by hand.
- [ ] **Step 4: Scenario.** In `needsyou.mjs`, add a step after the Jarvis row's Open step, with the council still
  awaiting (write it again with the same id first if an earlier step changed it): open the palette, pick its Needs you
  scope (`[data-palette-scope="needs"]`), find the row holding the council's feature, take a screenshot, click it, and
  assert `[data-council-discussion]` for that council shows and the palette has closed. `scripts/cdp/scenarios.mjs`
  step 12 (`openPalette`, the `button[data-idx]` rows) shows the pattern; copy what the scenario needs, don't import
  across scenario files. Run `node scripts/cdp/final-verify.mjs council-needs-you` — Expected: PASS.
- [ ] **Step 5:** Commit `fix(council): the palette's Needs you row for a waiting council opens it`.
