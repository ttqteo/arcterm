# Brainstorm boards in a resizable right rail

Moves a brainstorm's boards out of the thumbnail column beside the options and the full-size `"board"` view, into a
tabbed, resizable right rail (Boards · Decided so far, or the builder check's rail as the second tab). Each board is
tied to its option, the rail lays boards out in two columns when wide enough, and clicking a board widens the rail to
its largest while the question stays on screen and live, with marking in place.

**Spec:** `D:\work\arcterm\docs\superpowers\specs\2026-11-02-brainstorm-canvas-design.md` (read its "Decisions for the build" before starting)
**Verify:** `node scripts/verify.mjs ./pkg/wshrpc`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs canvas-tabs brainstorm-mode brainstorm-builder-ask`
**Prototype:** D:\work\arcterm\.superpowers\design\brainstorm-canvas\project\Rail.dc.html

Conventions for every task: pure logic in a `.ts` with a vitest beside it, thin `.tsx` (AGENTS.md "Frontend
conventions"); colors only from `@theme` tokens; read `DESIGN.md` before styling; never hand-edit generated files;
single tests run as `npx vitest run <file>` or `-t "<name>"`. The prototype is the look to match: tabs as filled chips
(`Boards · 3`, `Decided so far · 3`), a quiet `2 columns · 52%` readout right of them, a 12px handle with a 4×44px grip
on the rail's left edge, board heads `A` + label above each tile, the hovered option's board outlined 2px in the accent.

Hooks other tasks and the scenarios rely on: the rail's root is `data-brainstorm-board-rail` (not
`data-brainstorm-rail`, which stays on Decided so far's content root, as today); tabs `data-brainstorm-rail-tab="boards"
| "second"` with `aria-selected`; handle `data-brainstorm-rail-handle`; readout `data-brainstorm-rail-readout`; a tile
`data-brainstorm-rail-board="<name>"` with `data-linked-option="<i>"` when linked; the widened view
`data-brainstorm-rail-widened`; its Mark button `data-brainstorm-rail-mark`; a linked option row `data-linked`.

### Task 1: The rail's pure model
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`

Additive only: add these to `brainstormmodel.ts`, change nothing existing (Task 5 changes `paneView`,
`pickableOptions`). Other tasks rely on these names and signatures:

- Constants `RAIL_MIN_W = 280`, `RAIL_MIN_W_CHECK = 460`, `QUESTION_MIN_W = 360`, `RAIL_TILE_W = 380`,
  `RAIL_TILE_GAP = 16`, `RAIL_DEFAULT_FRAC = 0.32`.
- `clampRailWidth(stored: number | null, paneWidth: number, min: number): number` — null → `paneWidth * 0.32`; clamped
  to `[min, paneWidth - QUESTION_MIN_W]`; when the pane is too narrow for both, returns `min`.
- `railMaxWidth(paneWidth: number, min: number): number` — the widened width, `max(min, paneWidth - QUESTION_MIN_W)`.
- `railStacks(paneWidth: number, min: number): boolean` — `paneWidth < QUESTION_MIN_W + min` (the rule the container
  query encodes; tested so the two cutoffs, 640 and 820, are fixed in one place).
- `railColumns(innerWidth: number, boardCount: number): 1 | 2` — 2 when `boardCount >= 2` and
  `innerWidth >= 2 * RAIL_TILE_W + RAIL_TILE_GAP`.
- `railReadout(columns: 1 | 2, railWidth: number, paneWidth: number): string` — `"2 columns · 52%"`,
  `"1 column · 32%"`.
- `type RailBoardHead = { name: string; letter: string | null; label: string; option: number | null }` and
  `railBoardHeads(f: BrainstormFile, partId: string, boards: CanvasBoard[]): RailBoardHead[]` — per the spec's
  "Agent's call (builder question 3)": letter + option label + option index only when the open question is about this
  part, has `options`, and the part's board count equals the option count (≥ 2); otherwise `label` is the board's
  `title` from `canvas.json` (`boards` is `BrainstormState.boards`), else its file name, and `option` is null.
- `type RailGroup = { partId: string; title: string; boards: string[]; spikes: string[] }` and
  `railGroups(f: BrainstormFile, base: string | null, partId?: string): RailGroup[]` — the parts with boards or spikes
  (via `partBoards`/`partSpikes`) in design order, or only `partId`'s when given.
- `type RailTab = "boards" | "second"` and `railTabs(f: BrainstormFile, base: string | null, at: { question: boolean;
  check: boolean }): { tabs: RailTab[]; first: RailTab }` — with a question open, Boards exists only when the
  question's part has boards and opens first (in the check too); a question with no boards → `["second"]`. With no
  question open (design, judging, working, review): Boards exists when the design has any board; first is Boards in the
  design, the check's tab in the check.

Acceptance: `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts -t "rail"` passes, with a test per rule
above, including each mismatch shape the spec names (one board and three options, boards on a question with no options,
more boards than options), a board with and without a `title`, the narrow-pane clamp, both stacking cutoffs, the
readout's two forms, and the 2-column threshold at exactly `2 * 380 + 16`.

### Task 2: Share the marking layer
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/canvasmarking.tsx`, `frontend/app/view/agents/canvaspane.tsx`, `scripts/cdp/scenarios.mjs`

Move `MarkLayer` and `MarkTray` (and the `MARK_CHIP` style they use) out of `canvaspane.tsx` into a new
`canvasmarking.tsx`, exported as `MarkLayer({ agentId, marks })` and `MarkTray({ agent, marks })` with their current
behaviour unchanged; `CanvasPane` imports them. No behaviour change to `CanvasPane`, the standalone canvas pane or the
Canvas gallery.

Acceptance: `task check:ts` clean; the `canvas-tabs` scenario gains a step `mark on a board` that presses Mark, drags a
box over the board, and asserts the numbered mark and the tray's note field and Send button are drawn (no mark scenario
exists today; this one covers the extraction). It does not send.

### Task 3: The rail's interface
**Depends on:** Task 1 (uses the rail constants)
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormrail.tsx`

A small task that lands the exports Tasks 4, 5 and 6 build on, so the full rail (Task 4) runs beside the wiring:

- `optionHoverAtom(agentId: string)` — a jotai `atomFamily` of `number | null`: the option index hovered or ticked in
  the question (set by the options, Task 5, and by a board tile, Task 4).
- `type RailFocus = { partId: string; nonce: number }` — the part to show; a new nonce (even for the same part) switches
  to Boards and scrolls to its group.
- `BrainstormRail({ agent, s, f, second, minWidth = RAIL_MIN_W, question, focus })` with `second: { label: string;
  render: (tabbed: boolean) => ReactNode }`, `question: boolean` (a question is open, passed to `railTabs`), and
  `focus: RailFocus | null`.

In this task the component renders only `second.render(false)` inside an `aside` carrying `data-brainstorm-board-rail`,
sized as the rail with no Boards tab: `w-[32%] min-w-[280px] max-w-[500px]` when `minWidth` is `RAIL_MIN_W`, `w-[460px]`
when it is `RAIL_MIN_W_CHECK` (both `flex-none overflow-y-auto border-l border-border bg-surface`). Task 4 fills it in
without changing the signature.

Acceptance: `task check:ts` clean.

### Task 4: The full rail
**Depends on:** Task 3, Task 2 (uses the shared marking layer)
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormrail.tsx`

Fill in `BrainstormRail` behind Task 3's signature (spec "Design" + "Decisions for the build"):

- Tabs from `railTabs`; with only `"second"`, Task 3's fixed sizing and `second.render(false)`, no tab strip, no handle.
  With Boards: a tab strip (`Boards · N`, `second.label`), the readout (`railReadout`) right of it, and
  `second.render(true)` under the second tab. A new `focus.nonce` selects Boards and scrolls to `focus.partId`'s group.
- Width from `localStorage["brainstorm.railWidth"]` (every read and write in try/catch; a failure logs with
  `console.warn` and falls back to the default), clamped with `clampRailWidth(stored, paneWidth, minWidth)` against the
  pane's width (a ResizeObserver on the rail's parent). The handle (pointer capture, `col-resize`) sets it; write on
  pointer up. One stored width for the design and the check.
- Narrow pane: `@container` queries on the rail's parent (the parent gets `@container`, added by Tasks 5 and 6) stack the
  rail under the question, full width, no handle, below 640px when `minWidth` is 280 and below 820px when it is 460
  (`railStacks` holds the rule).
- Boards tab: one group per `railGroups` entry headed by the part title (no heading when one part shows), its tiles in
  `railColumns` columns (CSS grid, `minmax(0,1fr)` tracks), then its spikes as links that open in the external browser
  (copy the `Spikes` markup from `brainstormui.tsx`, keeping `data-brainstorm-spikes` / `data-brainstorm-spike`; Task 7
  deletes the original). A tile is the whole board as a scaled iframe at its own aspect (`boardUrl`), headed by
  `railBoardHeads`' letter and label, outlined 2px accent and scrolled into view when `optionHoverAtom` equals its
  option; hovering it sets the atom, leaving clears it.
- Clicking a tile: `attachCanvas(...)` as `Thumbnails` does today, then `openBrainstormBoard(agentId, name)`; the rail
  takes `railMaxWidth` (not stored) and shows only that board, drawn from the agent's canvas state with `BoardFrameView`
  (`canvaspane.tsx`), so `[` `]` stepping the canvas's board moves it. The board sits in an element carrying
  `data-canvas-scroll` around exactly one `data-canvas-board` (`sendCanvasMarks` reads both, `canvassend.ts:64`; tiles
  carry neither). A header holds the board's head, the Mark button (`aria-pressed`, toggles `setMarking` as `CanvasPane`
  does) and a close control; clicking the board again or close calls `openBrainstormBoard(agentId, null)` and the rail
  returns to its width. While marking, `MarkLayer` sits over the board and `MarkTray` under it (`canvasmarking.tsx`).

Acceptance: `task check:ts` clean. What it draws is proven by Task 5's and Task 6's scenario steps (`rail boards tab`,
`rail two columns with option hover`, `board hover lights option`, `widened board`, `step boards while widened`,
`mark in rail`, `rail width survives reload`, `design boards tab`, `rail stacks when narrow`, `check rail boards tab`),
which run in Final.

### Task 5: Wire the rail into the talk
**Depends on:** Task 3 (uses `BrainstormRail`, `RailFocus` and `optionHoverAtom`), Task 2
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormpane.tsx`, `frontend/app/view/agents/brainstormui.tsx`, `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/cockpit/footer-visible.test.ts`, `frontend/app/cockpit/footerhints.ts`, `scripts/cdp/scenarios.mjs`

- `brainstormmodel.ts`: `paneView` no longer returns `"board"` (drop it from `PaneView`); `paneBack` returns `"board"`
  whenever `s.board != null` and the view is design or check, so Esc un-widens; `pickableOptions` drops its
  `s.board != null` guard, so letter keys pick while a board is widened; delete `boardBackLabel`. Update the tests,
  with a new one for picking while widened.
- `brainstormpane.tsx`: drop the `CanvasPane` branch, `boardBackLabel` and the `PartMockups` import; `Design` renders
  `<BrainstormRail second={{ label: "Decided so far · N", render: (tabbed) => <DecidedRail … heading={!tabbed}/> }}
  question={view === "question"} focus={…}/>` in place of the bare `DecidedRail`, which loses its own `aside` sizing and
  keeps `data-brainstorm-rail`, `data-brainstorm-history` and its entry hooks; the parent gets `@container`. Every way a
  part opens (`openParts`, and a row's own `setOpen(id, true)`) sets `focus` to `{ partId, nonce: n + 1 }`. `PartRow` no
  longer renders `PartMockups`.
- `brainstormui.tsx`: `QuestionMain` drops the `data-brainstorm-question-boards` row and its `Thumbnails` (the check's
  talk question too, same component). `QuestionAnswers`, `Options` and `OptionRow` take an optional `agentId`; with it,
  a row sets `optionHoverAtom` on hover and focus, clears it on leave, and carries `data-linked` and a lit border while
  the atom equals its index (`BuilderAsk`, Task 6's file, passes none and stays as it is). Pros and cons start folded
  when the question's part has boards (the existing "Show pros and cons" toggle opens them). Leave `Thumbnails`,
  `PartMockups` and `Spikes` in place (Task 7 deletes them).
- `bindings.ts`: `brainstormBoardOpen` becomes "a board is widened" (`s.board != null`, pane in design or check), so
  `[` `]` and ← → keep stepping the boards and `agent:brainstorm-back` keeps its board step; letter-key picks and
  `inBrainstormReview`'s `j` `k` `y` `u` Enter stay live while widened and stand down while the canvas is marking. Fix
  `bindings.test.ts`, `footer-visible.test.ts` and `footerhints.ts` to the new meaning.
- `scenarios.mjs`, `brainstorm-mode`: the pane is ~514px with the details rail open (`bsRailOpen`, ~29400), which
  stacks the rail; steps that need width close the details rail (`railVisibleAtom`) first and fold the agent sidebar if
  the pane is still under 1190px, assert the pane width they need, and restore both in teardown. `bsRead`'s `rail` reads
  the second tab's label when tabbed (else `[data-brainstorm-rail] h2`); steps 2l (~29879), 2r (~29777) and 4 (~29996),
  which read Decided so far, click `[data-brainstorm-rail-tab="second"]` first. Rewrite the steps that read
  `data-brainstorm-thumb` / `data-brainstorm-open-board` / `view === "board"`, and add, each with a screenshot:
  `rail boards tab` (a question with boards opens on Boards, a tile per option headed `A · <label>`, pros and cons
  folded), `rail two columns with option hover` (drag the handle wide: 2 columns and the readout says `2 columns`; hover
  option B: its tile has the accent outline and `data-linked-option="1"` — the prototype's board; drag back: 1 column),
  `board hover lights option` (hover tile A: option A has `data-linked`), `widened board` (click a tile: the rail is at
  its largest, the question and options still on screen; press the key that picks option B (the binding `pickableOptions` gates) and the pick lands as a pick does today; Esc returns
  the rail to its width), `step boards while widened` (`]` shows the next board), `mark in rail` (Mark on, draw a box,
  note it, Send: the tray clears with no error and the line reaches the agent, read as the scenario reads other sent
  lines), `rail width survives reload` (drag, reload the page, the rail opens at the dragged width), `design boards tab`
  (open the design: Boards is shown, grouped by part title, part rows hold no thumbnails; toggling a part row open
  scrolls the rail to its group), `rail stacks when narrow` (details rail open, pane under 640px: the rail is under the
  question with no handle).

Acceptance: `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts frontend/app/store/keybindings/bindings.test.ts frontend/app/cockpit/footer-visible.test.ts`
passes; `task check:ts` clean; the `brainstorm-mode` steps above pass under Final.

### Task 6: Wire the rail into the builder check
**Depends on:** Task 3 (uses `BrainstormRail` and `RailFocus`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormcheck.tsx`, `frontend/app/view/agents/brainstormreview.tsx`, `scripts/cdp/scenarios-brainstorm-builder.mjs`

- `brainstormcheck.tsx`: `Check` renders `<BrainstormRail minWidth={RAIL_MIN_W_CHECK} second={{ label: "Builder check",
  render: () => … }} question={main === "question"} focus={…}/>`, the second tab being `AskRail` while a question is open
  and `AnsweredRail` in the review; both lose their own `w-[460px] flex-none border-l` sizing (the rail sizes them) and
  keep their "A builder read the design" heading, paragraph, `data-brainstorm-check-rail` and content. The parent gets
  `@container`. `BuilderAsk` is unchanged.
- `brainstormreview.tsx`: the review row and the one-part panel drop `PartMockups`; opening a review row whose part has
  boards or spikes sets the rail's `focus` to `{ partId, nonce: n + 1 }` (lift the setter through `CheckReview`'s props).
- `scenarios-brainstorm-builder.mjs`, `brainstorm-builder-ask` (its arrange writes the board and spike, ~501): step 3a
  (~604) becomes `check rail boards tab`: opening the guess row shows its board tile and spike in the rail's Boards tab,
  the row has no `data-brainstorm-thumb`, the rail is at least 460px wide, the second tab reads `Builder check`, and its
  content still reads "A builder read the design". Screenshot it.

Acceptance: `task check:ts` clean; `check rail boards tab` passes under Final.

### Task 7: Delete the old thumbnails, document the rail
**Depends on:** Task 5, Task 6 (removes the last `PartMockups` use in `brainstormreview.tsx`), Task 4 (documents the Boards tab it builds)
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormui.tsx`, `docs/agents/brainstorm.md`, `CHANGELOG.md`

- Delete `Thumbnails`, `PartMockups`, `Spikes`, `THUMB_W*`, `THUMB_MAX_H` and any import left unused in
  `brainstormui.tsx` after grepping every use (including `import type` and re-exports); nothing else may import them.
- `docs/agents/brainstorm.md`: where it says `PartMockups` draws boards and spikes, say the rail
  (`brainstormrail.tsx`) does, from `railGroups`.
- `CHANGELOG.md`: one `Changed` line under the top `Unreleased` section (open one if the top section has a date), for
  the user: a brainstorm's boards now sit in a resizable right rail beside the question, side by side when wide, each
  tied to its option, and open large without leaving the question.

Acceptance: `task check:ts` clean; `npx eslint frontend/app/view/agents/brainstormui.tsx` reports no unused symbol.
