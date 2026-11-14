# Council bugs and UX: batch 1 (UI and tests)

**Effort:** effort:67d1c761-ccae-4498-8c85-50d0ab9a65dd
**Verify:** `node scripts/verify.mjs ./pkg/jarvis ./pkg/council`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-needs-you council-discussion council-summary council-tree`

Eleven small fixes from the initiative "Council: bugs and UX". There is no spec: each task quotes the chunk it closes,
and the chunk's label is the requirement. A worker ticks nothing on the initiative; the lead does that after the run.

Principles for every worker: the smallest change that fixes the chunk, one source of truth (reuse `councilmodel.ts`,
`openref.ts` / `openOrPeek`, `channelProjects`; never a second reading of council state), no abstraction for one use.
Colors from `@theme` tokens only; UI follows `DESIGN.md`. Pure logic lives in a `.ts` beside its `.test.ts`; no
render tests. Never hand-edit generated files: change the Go type, then `task generate`.

## Review Focus

- A council waiting on you whose folder is not a registered project: under one project's filter it is left out, under
  All it shows (as a channel item whose channel has no project does today).
- A learned-rule row in the palette must not open on a surface where the rule cannot be decided: it lands where the
  Cockpit's Needs you strip shows it.
- Retry on a failed summary when no idea was sent must not fire `CouncilRetryCommand` at all (wavesrv refuses it with
  "has no sent idea to summarize").
- The kept jump link on a report whose kept section is already open must leave it open, not toggle it shut.
- An image exactly at 3.5 MB is accepted; one byte over is refused before any RPC, in every composer.

---

### Task 1: Needs you rows for a waiting council and a learned rule
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_channels.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/view/agents/needsyou.ts`, `frontend/app/view/agents/needsyoustrip.tsx`, `frontend/app/cockpit/palette-needs.ts`, `frontend/app/cockpit/palette-needs.test.ts`, `frontend/app/cockpit/command-palette.tsx`, `scripts/cdp/council/needsyou.mjs`

Closes two chunks:
- "Cockpit's Needs you strip skips a waiting council (needsyoustripmodel.ts KIND_LABEL); it needs a project for the
  filter and an open target"
- "Palette Needs you: a learn-proposal row has no open target (needsTarget returns null), as the council row had
  before the fix"

Facts: `councilItems` (`pkg/jarvis/attention.go:483`) builds the council item with no channel and no project;
`wshrpc.AttentionItem` (`pkg/wshrpc/wshrpctypes_channels.go:95`) has no project field. `buildNeedsYouRows`
(`needsyoustripmodel.ts:117`) skips any kind not in `KIND_LABEL` and filters by `channelProject.get(channelid)`.
`needsyou.ts:65` `open` handles `agent`, `effort`, else channel. Learned rules are decided only in the Cockpit strip
(`LearnRow`, `LearnDecideCommand` in `needsyou.ts`); Setup's Learned tab lists accepted lines only.

- [ ] **Step 1: Go: the council item carries its project folder**
  Add `ProjectPath string \`json:"projectpath,omitempty"\`` to `AttentionItem` (comment: the folder a council item
  belongs to; a channel item is scoped through its channel instead). `councilItems` sets it from `c.Project`. Test in
  `attention_test.go`: `TestCouncilItemCarriesProjectPath`, an awaiting council with `Project: "/p/arcterm"` yields one
  item with `ProjectPath == "/p/arcterm"`. Run `go test ./pkg/jarvis -run '^TestCouncilItemCarriesProjectPath$'`
  (fails first, then passes). Then `task generate` and check `frontend/types/gotypes.d.ts` gained
  `projectpath?: string` on `AttentionItem`.

- [ ] **Step 2: Strip model: a council row, scoped by its project**
  In `needsyoustripmodel.ts`: `KIND_LABEL.council = "Council"`; `StripOpen` gains `| { kind: "council"; councilId:
  string }`; `buildNeedsYouRows` takes a new input `pathProject: Map<string, string>` (normalized project path →
  registry name; export `projectsByPath(registry)` built from the loop already inside `channelProjects`, and have
  `channelProjects` use it). A council item's project is `pathProject.get(normProjectPath(a.projectpath))`; under a
  project filter it is kept only when that equals the filter; under `all` it shows. Its `open` is
  `{ kind: "council", councilId }` from `oref` `council:<id>` (the existing `idOf(a.oref, "council")`). Tests in
  `needsyoustripmodel.test.ts`:
  - `"a waiting council is a row labelled Council that opens the council"`: kindLabel `"Council"`, open
    `{ kind: "council", councilId: "c1" }`.
  - `"a council row follows the project filter by its folder"`: shown under `"arcterm"` when its projectpath maps to
    it, left out under `"other"`, shown under `"all"`; a projectpath no project registers is left out under
    `"arcterm"` and shown under `"all"`.

- [ ] **Step 3: Strip wiring**
  `needsyou.ts`: build `pathProject` with `projectsByPath(registry)` and pass it; `open` handles
  `to.kind === "council"` with `openOrPeek(model, { kind: "council", councilId: to.councilId }, e)`.
  `needsyoustrip.tsx` `openTitle`: `"Open the council"` for a council row.

- [ ] **Step 4: Palette: a learned rule opens the Cockpit**
  `palette-needs.ts`: `NeedsTarget` gains `| { kind: "cockpit" }` (comment: a learned rule, decided in the Cockpit's
  Needs you strip); `needsTarget` returns it for `kind === "learn-proposal"`. `command-palette.tsx`: `needsEcho` reads
  `"Opens the Cockpit, where the rule is accepted or dropped"`; `openNeeds` for `cockpit` switches the surface to
  `cockpit` the way the other surface switches in that file do. Test in `palette-needs.test.ts`:
  `"a learned rule opens the Cockpit"`: `needsTarget` of a `learn-proposal` row is `{ kind: "cockpit" }`.

- [ ] **Step 5: Scenario step**
  In `scripts/cdp/council/needsyou.mjs`, after the existing Jarvis row checks and before the resolve step, add a step
  that switches to the Cockpit surface (filter All), asserts a strip row whose label is `Council` and whose text names
  the fixture council, shoots `cdp-shots/council-needs-you-strip.png`, clicks its open button
  (`[data-needs-you-open="council"]`) and asserts the council's Discussion is on screen.

- [ ] **Step 6: Run and commit**
  `npx vitest run frontend/app/view/agents/needsyoustripmodel.test.ts frontend/app/cockpit/palette-needs.test.ts`
  passes; `go test ./pkg/jarvis` passes. Commit: `fix(needs-you): a waiting council is a Cockpit strip row, and a
  learned rule in the palette opens the Cockpit`.

### Task 2: Council Discussion and Report fixes
**Depends on:** none
**Files:** `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `frontend/app/view/agents/councildiscussionmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/summary.mjs`

Closes five chunks:
- "councilchat.tsx ReachRow/QuoteRow: no whitespace between pieces, DOM text reads 'Router failedUX' / 'YouWhere…'"
- "Memory tab dot is not shown when the Ideas rail is folded, so a waiting suggestion or held direction goes unseen"
- "Gate or reword a failed coordinator's Retry when no idea was sent (…): it now hits the Go refusal 'has no sent
  idea to summarize'"
- "The report's kept jump link scrolls to the folded Also raised heading but does not open it; opening it would lift
  KeptSection's fold state"
- "discussion.mjs: assert no 'round' text in the failed state too (running, empty, paused have it; failedWhile has
  only a unit test)"

- [ ] **Step 1: ReachRow and QuoteRow read with spaces**
  `councilchat.tsx` `ReachRow` (~:1354) and `QuoteRow` (~:1399): put a `{" "}` text node between adjacent pieces
  (icon excepted), so `textContent` reads `Router failed UX` and `You Where…`. The visible gap stays the CSS gap.

- [ ] **Step 2: The unfold button carries the Memory dot**
  The folded rail's button (`data-council-rail-unfold`, ~:3920) draws the same dot as the Memory tab when
  `memoryDotOn(c, seen)` is true: the dot element with `data-council-memory-dot` and the tab's aria-label, after
  `Ideas · N`. Read `seen` the way `CouncilRail` does (~:3283).

- [ ] **Step 3: Retry on a failed summary needs a sent idea**
  `councildiscussionmodel.ts`: `export function summaryRetryHold(c: Council): string | null`: `null` when
  `sentProposals(c).length > 0`, else `"No idea was sent, so there is nothing to summarize"`. Test
  `"summaryRetryHold: null with a sent idea, the reason with none"` in `councildiscussionmodel.test.ts`. In
  `councildiscussion.tsx` `SummaryFailedPanel` (~:394) and both "Retry the summary" buttons in `councilsummary.tsx`
  (~:886, ~:1199): when it returns a reason, the button is disabled with the reason as its `title`; no
  `CouncilRetryCommand` is sent.

- [ ] **Step 4: The kept jump link opens the fold**
  `councilsummary.tsx`: move `KeptSection`'s `open` (~:432) into a module-level jotai atom
  `keptOpenAtom = atom<Record<string, boolean>>({})` keyed by council id (folded by default, as now). The toggle
  flips its entry; `JumpLinks.go` (~:627) sets the entry to `true` when `e.id === "kept"` before it scrolls (waiting
  one animation frame so the opened section is measured). An already open section stays open.

- [ ] **Step 5: Scenario steps**
  - `discussion.mjs` `failed` (~:961): add to the Skeptic step's assertion `!/round/i.test(skeptic)` and to the panel
    step `!/round/i.test(panel)`, and say so in their labels. Add a step on a fixture council whose coordinator failed
    with no sent idea (seed `failed` with every proposal unsent via `seedCouncil`'s `edit`): the coordinator's Retry
    is disabled and its title is the reason; a click records no `CouncilRetryCommand`.
  - `discussion.mjs`: a step that folds the Ideas rail on a council with a memory entry newer than its seen time and
    asserts `[data-council-rail-unfold] [data-council-memory-dot]` exists; shoot
    `cdp-shots/council-discussion-folded-dot.png`. A step reading `ReachRow`'s `textContent` on the routing fixture
    asserts a space between the router word and the first seat.
  - `summary.mjs`: a step that clicks `[data-council-jump="kept"]` on a report with kept ideas and asserts
    `[data-council-kept-idea]` drew; shoot `cdp-shots/council-summary-kept-jump.png`.

- [ ] **Step 6: Run and commit**
  `npx vitest run frontend/app/view/agents/councildiscussionmodel.test.ts` passes. Commit:
  `fix(council): spaced chat rows, the Memory dot on a folded rail, no Retry with nothing to summarize, the kept jump
  opens its fold`.

### Task 3: One image cap, a FinalPick test, teardown retries, j/k in the tree, the changelog
**Depends on:** Task 1 (its changelog lines describe the Needs you rows Task 1 adds), Task 2 (its changelog lines describe Task 2's Discussion and Report fixes)
**Files:** `frontend/app/view/agents/composerattachments.ts`, `frontend/app/view/agents/composerattachments.test.ts`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `pkg/council/runner_test.go`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/tree.mjs`, `CHANGELOG.md`

Closes four chunks:
- "Two image limits disagree: the composer refuses over 10 MB, but createTempFileFromBlob refuses over 3.5 MB
  (MAX_UPLOAD_BYTES, uploadfile.ts); pick one"
- "Add a test that a re-summarize keeps Council.FinalPick (checked by reading only, run d81c57a6 t-1)"
- "Final store teardown: EPERM deleting fx-council-routing-auto.json on a second council-routing run (exit stayed 0)"
- "j/k skipping council rows not checked in the live app (unit-tested through treeNavIds only)"

Decision on the cap: 3.5 MB everywhere. Every image travels base64 in one websocket message, which `ws.ts` drops above
5 MiB (`uploadfile.ts:12-16`), so 10 MB never worked.

- [ ] **Step 1: One image cap**
  `composerattachments.ts`: `MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES` imported from `./uploadfile`, comment pointing
  there; the oversize message uses `MAX_UPLOAD_LABEL` (`"<name> is over 3.5 MB"`). `councilstore.ts:523`
  `IMAGE_TOO_BIG = \`Image too large (over ${MAX_UPLOAD_LABEL})\``. Update the tests: `composerattachments.test.ts`
  (~:91: at `3.5 * 1024 * 1024` not oversize, one byte more oversize) and `councilstore.test.ts` (~:719-733: a file
  over 3.5 MB is refused, error matches `/3\.5 MB/`).

- [ ] **Step 2: FinalPick survives a re-summarize**
  `runner_test.go`: `TestSummarizeKeepsTheFinalPick`, built like `TestSummarizeRerunsTheSynthesis` (~:3044): set a
  FinalPick with `SetFinalPick`, run Summarize, assert the reloaded council's `FinalPick` is unchanged. Run
  `go test ./pkg/council -run '^TestSummarizeKeepsTheFinalPick$'`. If it fails, the Summarize path clears it: fix
  that in `runner.go` instead, and add `pkg/council/runner.go` to this commit.

- [ ] **Step 3: Teardown retries a locked file**
  `fixtures.mjs` (~:245-258): the per-file `rmSync(join(dir, f), { force: true, recursive: true })` gets
  `maxRetries: 5, retryDelay: 200`, as the base dir's removal at ~:327 has.

- [ ] **Step 4: j/k in the live tree**
  `tree.mjs`: a step on the existing tree fixture with a council row between two agents: focus the tree, press `j`
  from the agent above it, assert the focused id is the agent below (the council row skipped), then `k` back.
  Use the key helper `scenarios.mjs` uses for the Agent tree (`uiPress(h, "j", "KeyJ", 74, "j")`, ~:4062).

- [ ] **Step 5: Changelog**
  Under `## Unreleased` in `CHANGELOG.md`, `Fixed`:
  - `A council waiting on you shows in the Cockpit's Needs you strip, under its project's filter.`
  - `A learned rule in the palette's Needs you opens the Cockpit, where you accept or drop it.`
  - `Folding a council's Ideas rail keeps the Memory dot in sight.`
  - `The Report's Also raised link opens the section it jumps to.`
  - `Retry on a failed council summary is off when no idea was sent, and says why.`
  - `An image over 3.5 MB is refused when you add it, not lost on send.`

- [ ] **Step 6: Run and commit**
  `npx vitest run frontend/app/view/agents/composerattachments.test.ts frontend/app/view/agents/councilstore.test.ts`
  and `go test ./pkg/council -run '^TestSummarize'` pass. Commit: `fix(council): one 3.5 MB image cap, a FinalPick
  test, teardown retries and a j/k tree check`.
