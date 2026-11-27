# Clickable prototypes: Try/Mark toggle, A/B/C slot chips, marks that carry their screen

**Spec:** `docs/superpowers/specs/2026-11-27-prototype-feedback-design.md` (its "Builder decisions" section settles the syntax, the message shapes and the copy; read it before your task)
**Verify:** `node scripts/verify.mjs ./pkg/canvasserve ./pkg/storage ./pkg/orchestrate ./skills`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs proto-chips proto-pane proto-rail brainstorm-board-pick canvas-tabs brainstorm-mode`
**Prototype:** D:\work\arcterm\.superpowers\design\prototype-feedback\project

Lead's notes for every worker: messages between a board and Arc are `arc-canvas-proto` (board → Arc) and
`arc-canvas-slot-pick` (Arc → board), shaped as the spec says. Colors come from `@theme` tokens. No jsdom render
tests: pure logic goes in a `.ts` with a test beside it; rendered UI is proven by the named CDP scenario step.
Lint and format only the files you touched. The look to match is in the Prototype canvas: chips and their hover
outline as `D-slot-chip.dc.html`, the Try | Mark toggle as `A-mode-toggle.dc.html`. Window capture can fail (a Mac
without Screen Recording, `task dev:browser` with no Tauri host): nothing but Send may depend on it, so every draw
step of a scenario runs without a host.

### Task 1: The prototype interface: protomodel, picks store, fixture and scenario stubs
**Depends on:** none
**Files:** `frontend/app/view/agents/protomodel.ts`, `frontend/app/view/agents/protomodel.test.ts`, `frontend/app/view/agents/protostore.ts`, `frontend/app/view/agents/protocapture.ts`, `scripts/cdp/proto-fixtures.mjs`, `scripts/cdp/scenarios-proto-chips.mjs`, `scripts/cdp/scenarios-proto-pane.mjs`, `scripts/cdp/scenarios-proto-rail.mjs`, `scripts/cdp/scenarios.mjs`

The small interface Tasks 4–7 build on. `protomodel.ts` (pure) exports, with these names and shapes:
- `PROTO_REPORT_MSG = "arc-canvas-proto"`, `SLOT_PICK_MSG = "arc-canvas-slot-pick"`.
- `type ProtoSlot = { id: string; label: string; letters: string[]; picked: string; rect: { x: number; y: number; w: number; h: number } }`, `type ProtoReport = { screen: string | null; slots: ProtoSlot[] }`, `type SlotPicks = Readonly<Record<string, string>>`.
- `protoReport(data: unknown): ProtoReport | null`: null for anything not of that type; a malformed slot is dropped, not the report.
- `slotPickMessage(picks: SlotPicks)`, `shownLetter(slot): string` (what the board shows: `slot.picked` when it is one of the slot's letters, else the first letter; the stored pick never leads, so a chip's pressed letter follows the board's report, not the click), `picksToResend(report, picks): boolean` (true when a stored pick that is one of a reported slot's letters differs from what that slot shows).
- `type MarkContext = { screen: string | null; slots: { id: string; label: string; letter: string }[] }`, `markContext(report | null): MarkContext` (letters by `shownLetter`), `contextKey(ctx): string`, `contextPhrase(ctx): string` (`screen "Để sau", slot danh sách = B`; `""` with no screen and no slots), `protoReadout(report | null): string` (`Để sau · danh sách B`; `""` when empty).
- `boardPicksKey(src: string): string` (the URL without query and hash), `CAPTURE_ATTR = "data-canvas-capturing"`, and `HIDE_WHILE_CAPTURING`, the Tailwind class every Arc overlay inside a board frame wears so it hides while its frame carries `CAPTURE_ATTR`.

`protostore.ts`: `slotPicksAtom` (an atomFamily of `SlotPicks` by `boardPicksKey`) and `setSlotPick(key, id, letter)`.

`protocapture.ts`: `withOverlaysHidden<T>(frameEl: HTMLElement, fn: () => Promise<T>): Promise<T>`: sets
`CAPTURE_ATTR` on the frame, waits until the overlays have hidden (two animation frames), runs `fn`, and removes the
attribute in a `finally`. Tasks 4 and 5 capture through it.

`scripts/cdp/proto-fixtures.mjs`: writes a canvas topic folder for scenarios: `canvas.json` with a main board
(`is_interactive: true`), a screen child entry with `part_of`, and a static board. The main board is plain HTML (no
support.js, no CDN): two screens (`data-dc-screen`, switched by an inline-script button) and, on both screens, a
slot `data-dc-slot="list"` labeled `danh sách` with variants A/B/C, each drawn visibly different.

Register three scenario modules in `scripts/cdp/scenarios.mjs`: `proto-chips`, `proto-pane`, `proto-rail`, each a
stub that returns one skip step ("built by Task N"), so Tasks 4, 6 and 7 each own one module file. The modules
cannot reach `scenarios.mjs`'s private helpers, and Tasks 4 and 6 may not edit it: add a `CANVAS_KIT` there (as
`BS_KIT` is built for `scenarios-brainstorm-board-pick.mjs`) exposing `arrangeCanvasBoards`, `teardownCanvasBoards`,
`clickCanvasSwap` and what canvas-gallery's scenarios use to open the Canvas gallery and a topic's viewer, and pass
it to all three modules (`proto-rail` gets `BS_KIT` as well).

Acceptance: `npx vitest run frontend/app/view/agents/protomodel.test.ts` covers each function above, including
rejected reports, a dropped malformed slot, a reported `picked` that is not one of the letters, a stored pick a slot
lacks (no resend), and the empty phrase.
`unknownScenarios` (`scripts/cdp/report.mjs`) over the registered scenarios finds none of the three names unknown (a short node check run in the task tree).

### Task 2: The board script reports screens and slots and swaps variants
**Depends on:** none
**Files:** `pkg/canvasserve/boardscript.js`, `pkg/canvasserve/canvasserve.go`, `pkg/canvasserve/canvasserve_test.go`, `skills/design/support.js`

Move `heightScript` into an embedded `pkg/canvasserve/boardscript.js` (`go:embed`), still appended after every
board page inside one `<script>`, still reporting `arc-canvas-height` unchanged. Add the proto report and the pick
apply exactly as the spec's "Arc learns slots and swaps variants" says: the report on load and on change (body
subtree mutations, attributes included, and resizes; one rAF per burst; deduped by JSON), the default style rule
that shows each slot's first variant before any pick arrives, the per-id hide rules, and no write loop (the style
lives in `<head>`, outside what the observer watches). A pick applies only to a slot that has that letter: a
same-id slot on another screen without it keeps its default (scope the rule with
`[data-dc-slot="<id>"]:has(> [data-dc-variant="<L>"])`), never hiding every variant.

Check that support.js keeps `data-dc-screen`, `data-dc-slot`, `data-dc-slot-label` and `data-dc-variant` on the DOM
it renders, a dc-import child's root included; fix its attribute walk only if it drops or camel-cases them.

Acceptance: `go test ./pkg/canvasserve -run 'TestHandler|TestBoardScript'`: a served board ends with the script, the
script holds both message types, the height report and the `:has` scoping, and a non-HTML file is served without it
(rename what `TestHandlerAddsTheHeightScriptToPagesOnly` references if `heightScript` goes). The proto-chips
scenario (Task 4) proves the report and the swap in the running app.

### Task 3: Screens are parts of their prototype; boards know they are interactive
**Depends on:** none
**Files:** `frontend/app/view/agents/canvasmodel.ts`, `frontend/app/view/agents/canvasmodel.test.ts`, `frontend/app/view/agents/canvaspoller.ts`, `frontend/app/view/agents/canvaspoller.test.ts`, `pkg/storage/canvases.go`, `pkg/storage/canvases_test.go`, `pkg/storage/canvaslink.go`, `pkg/orchestrate/planreview.go`

`boardsFromCanvasJson` drops entries that carry a `part_of` string and gives `CanvasBoard` an optional
`interactive: true` from `is_interactive === true`; a new `partsFromCanvasJson` returns the dropped screen file
names. Editing only a screen file must still reload its prototype: `canvaspoller.ts` `readServer` HEADs the parts
too and folds their Last-Modified into `lastModifiedMs` (they are never boards). The Go gallery listing
(`readCanvasMeta` and `canvasBoards`) leaves `part_of` files out of a canvas's boards and their count, but counts
their mtime in `ModTs`; if `canvasBoards`' signature changes, update its caller `canvaslink.go:138`.
`planReviewBoardItem` keeps its current opening words (tests match the prefix) and adds the exception: a file whose
canvas.json entry has `part_of` is covered by the step for its prototype. The rendered result (no screen tab, no
screen in the gallery) is proven by Task 6's `proto-pane` steps.

Acceptance: `npx vitest run frontend/app/view/agents/canvasmodel.test.ts frontend/app/view/agents/canvaspoller.test.ts`
(a screen is dropped, `order` naming it is ignored, interactive is read only from `true`, a newer screen file raises
`lastModifiedMs`); `go test ./pkg/storage -run 'TestListCanvases|TestSetCanvasLink'` (a `part_of` file is not a board,
its mtime still counts in `ModTs`, a malformed `part_of` is ignored); `go test ./pkg/orchestrate -run 'TestPlanReview'`
still passes.

### Task 4: A/B/C chips on every board opened large
**Depends on:** Task 1 (uses protomodel and the picks store), Task 2 (its chips draw from the reports the board script posts)
**Files:** `frontend/app/view/agents/canvaspane.tsx`, `frontend/app/view/agents/slotchips.tsx`, `frontend/app/view/agents/canvasthumb.ts`, `frontend/app/view/agents/canvascopy.ts`, `scripts/cdp/scenarios-proto-chips.mjs`

`BoardFrameView` parses `arc-canvas-proto` from its own iframe beside the height report, keeps the latest report,
and draws `SlotChips` over the frame: one segmented chip per slot, letters from the report, the shown one
pressed (`shownLetter`), placed at the slot's rect times the frame's scale on its top-right edge as board D shows;
hovering a chip outlines the slot region dashed. A click calls `setSlotPick(boardPicksKey(src), …)`; the frame
posts `slotPickMessage` to the iframe when the picks change and when `picksToResend` says a reload lost them. It
also takes an optional `onProtoReport(report)` for its parent. Chips wear `HIDE_WHILE_CAPTURING`, sit above any
child layer, and a press on one stops propagation, so it never starts a mark. No call site changes: every new prop is
optional, so the gallery viewer, the rail, `chatcanvaspickmodal.tsx` and `brainstormbandview.tsx` get chips
through `BoardFrameView` untouched. A tile (`tile` true: CanvasPane's and `chatcanvaspickmodal.tsx`'s All grid) draws
no chips, since small thumbnails stay static. The gallery thumbnail (`maybeCaptureThumb`) and the Copy shot
(`copyBoardShot`) capture the window: wrap their capture in Task 1's `withOverlaysHidden(boardEl, …)` so neither
picture holds a chip.

Acceptance: the `proto-chips` scenario, on the Task 1 fixture: (1) in the agent's canvas pane the chip shows on
the slot with A pressed; (2) hovering the chip outlines the slot region dashed (as board D); (3) clicking B makes the
next report show B (the chip's pressed letter follows the report, not the click), with a screenshot of the swapped
region; (4) moving to the second screen in the board keeps B; (5) under the All tab no tile shows a chip; (6) the
Canvas gallery's viewer for the same topic shows the chip with B; (7) a static board shows no chip.

### Task 5: Marks carry their screen and variants; one picture per context; the mode toggle
**Depends on:** Task 1 (uses MarkContext, contextKey, contextPhrase and the capture attribute)
**Files:** `frontend/app/view/agents/canvasmarks.ts`, `frontend/app/view/agents/canvasmarks.test.ts`, `frontend/app/view/agents/canvassend.ts`, `frontend/app/view/agents/canvassend.test.ts`, `frontend/app/view/agents/canvasmarking.tsx`, `frontend/app/view/agents/canvasstore.ts`, `frontend/app/view/agents/canvasstore.test.ts`

As the spec's "Marks keep their context" and "Marks survive Try" say. `Mark` gains its `ctx` and its clean
`shot` (picture, its frame-relative rect, device px per CSS px). `MarkLayer` takes an optional `ctx` (no context
when absent, so today's callers still compile), draws only the marks of that context with their global numbers,
and on drawing a mark adds it at once, then captures the visible board through `withOverlaysHidden` (Task 1) and
crops it into the mark's `shot`. A failed capture leaves `shot: null` and the mark stands (drawing never needs a
host). `sendCanvasMarks` groups by `contextKey`, composes each group's boxes onto its newest shot (a group with no
shot is captured at Send as today, through `withOverlaysHidden`), writes one `NNN.png` per group, and types one line (`canvasHandoffLine` per group, joined by ` | `); a mark list with no screen and no
slots gives exactly today's line. `MarkTray` names each mark's context when marks span more than one. `setMarking(id,
false)` keeps the marks. Export `ModeToggle` from `canvasmarking.tsx`: on an interactive board a segmented
**Try | Mark** (`data-canvas-mode="try"` / `"mark"`, `aria-pressed`), on a static board today's single Mark
button; both titled with the `m` key, and the Mark button in both keeps today's title, `Mark parts of the board
(<m>)` (canvas-tabs and brainstorm-mode find it by that prefix); it takes extra attributes for its Mark button so
the rail keeps `data-brainstorm-rail-mark`.

Acceptance: `npx vitest run frontend/app/view/agents/canvasmarks.test.ts frontend/app/view/agents/canvassend.test.ts frontend/app/view/agents/canvasstore.test.ts`:
grouping by context in first-appearance order, the box geometry in a shot (scrolled and scaled), the line for one
context (today's text unchanged) and for two, one file written per group with numbers that count across groups,
a removed mark absent from its group's boxes, a group with no shot captured at Send, and `setMarking(false)`
keeping marks while a board switch drops them.
The rendered toggle and layer are proven by Task 6's and Task 7's scenario steps.

### Task 6: CanvasPane: Try | Mark, marks across screens, the readout
**Depends on:** Task 3 (reads `board.interactive`), Task 4, Task 5 (uses ModeToggle and MarkLayer's ctx)
**Files:** `frontend/app/view/agents/canvaspane.tsx`, `scripts/cdp/scenarios-proto-pane.mjs`, `CHANGELOG.md`

Replace the Mark button with `ModeToggle`. Keep the selected board's latest report (`onProtoReport`) and pass
`markContext(report)` to `MarkLayer`. The tray shows while marking or while any mark is unsent. The meta line
leads with `protoReadout` when it is not empty. One CHANGELOG line under Added, `<!-- big -->` with its shot
(`h.whatsnewShot` in the scenario), per dev-workflow "CHANGELOG markup".

Acceptance: the `proto-pane` scenario on the Task 1 fixture, the toggle drawn as board A: (1) the tabs name the
main and the static board and no screen file, and the Canvas gallery's card and viewer for the topic hold no screen
(Task 3); (2) the interactive board shows Try pressed and Mark, the static board only Mark; (3) the readout reads the
screen and `danh sách A`; (4) in Mark a box draws mark 1 and the board takes no click, and a click on a chip in Mark
mode swaps the variant and starts no mark; (5) Try, a move to the second screen and a swap to B keep mark 1 in the
tray and hide it from the layer; (6) Mark again, mark 2 on that screen, the tray names both contexts; (7) where a
Tauri host is present, Send writes two pictures and the agent's terminal gets one line naming both screens and
`slot danh sách = B` (a skip step naming the missing host otherwise; steps 1–6 need no host); (8) `m` toggles the
mode.

### Task 7: The brainstorm rail: Try on opened boards, the question's slot previews its options
**Depends on:** Task 1 (shares `scripts/cdp/scenarios.mjs`), Task 3 (reads `board.interactive`), Task 4 (uses BoardFrameView's onProtoReport), Task 5 (uses ModeToggle and MarkLayer's ctx)
**Files:** `frontend/app/view/agents/brainstormrail.tsx`, `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`, `scripts/cdp/scenarios-proto-rail.mjs`, `scripts/cdp/scenarios.mjs`

In `WidenedBoard`: `ModeToggle` in place of Mark (its Mark button keeps `data-brainstorm-rail-mark`); on an
interactive board Try drops the click-to-close cover, so the board runs (close stays on X and Esc); `MarkLayer` gets
the context; the tray shows while marks are unsent; closing the dialog drops marks and marking. `brainstormmodel.ts`
parses `question.slot` (a non-empty string) and gives `boardPick` the slot path: with the question's slot in the
opened board's report, the offer is the option whose letter the chip shows. A chip pick on that slot sets
`optionHoverAtom` to its option. Keep `brainstorm-mode`'s rail mark steps (2l9, 2l10) and `canvas-tabs` step 5 in
`scenarios.mjs` passing (both are in Final); update a step or comment there only where it relied on Mark-off
dropping marks (canvas-tabs' last comment says it does).

Acceptance: `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts -t "boardPick|question"` (slot parsed,
empty slot ignored, the offer follows the shown letter, a slot the question does not name offers nothing new, the
per-board path unchanged). The `proto-rail` scenario: a brainstorm whose question names `slot: "list"` with three
options and one interactive board, chips as board D and the toggle as board A, every step host-free: (1) the opened
board shows Try pressed and runs a click; (2) chip C lights option
row C and the pick bar reads `Pick C · …`; (3) Mark draws a mark and the tray holds it after Try. `brainstorm-board-pick`
still passes.

### Task 8: Teach the agent: slot syntax, prototypes, when to draw clickable
**Depends on:** none
**Files:** `skills/design/reference/format.md`, `skills/design/SKILL.md`, `skills/brainstorm/SKILL.md`

`format.md`: `data-dc-screen`, `data-dc-slot` / `data-dc-slot-label` / `data-dc-variant` (a real box, letters in
order, first shows by default, claude.ai shows all), the prototype layout (main board with shared state, one child
file per screen via dc-import, a navigation callback prop) and canvas.json's `part_of` plus `is_interactive`.
`design/SKILL.md`: the Options rule's two paths (differ in one region → one board with a slot; whole screen → one
board per option), a section on when to draw a clickable prototype (a flow, state or interaction) versus static
boards (layout or look) and that the person may ask for one, and a short prototype example. `brainstorm/SKILL.md`:
`question.slot`, listing only the main board in the part's `boards`, never a screen file. Keep the canvas.json
index example valid JSON with `replaces` and `notreplaces`.

Acceptance: `go test ./skills -run 'TestDesignSkillVersions|TestShippedSkills'`.
