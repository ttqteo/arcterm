# Brainstorm boards in a resizable right rail

Brainstorm: `.superpowers/brainstorm/brainstorm-canvas/brainstorm.json` (2026-11-02).
Canvas: `.superpowers/design/brainstorm-canvas/project/Rail.dc.html`.

## Problem

The boards (`arc:design` mockups) inside the brainstorm pane are hard to use. All four of these hurt:

1. **Too small to read.** Beside a question a board is a 220px-wide thumbnail (200px tall at most);
   the text inside it cannot be read without opening it full size.
2. **Detached from its option.** The boards sit in their own column beside the options. Option cards
   with pros and cons are tall, so board A ends up beside option B; the only link is the order
   (`option A of N`).
3. **Full size loses the question.** Opening a board replaces the whole pane with `CanvasPane`; the
   question, its `why`, `read`, pros and cons are gone until "Back to the question", and nothing can
   be picked from there.
4. **No side-by-side comparison.** There is no place where A, B and C sit next to each other at one
   size to be compared by eye and picked.

## What exists today (context)

- Question with boards: `QuestionMain` puts the options and a `Thumbnails` column in one flex-wrap
  row (`frontend/app/view/agents/brainstormui.tsx`, the `data-brainstorm-question-boards` block).
  `Thumbnails` compact is 220px wide; in a part row it is 300px and shows only when the row is open
  (`PartMockups`). Boards are scaled iframes (`boardUrl`).
- Clicking a board: `attachCanvas` + `openBrainstormBoard` → `paneView` returns `"board"` →
  `CanvasPane` replaces the whole brainstorm pane (`brainstormpane.tsx`), with a back button labelled
  by `boardBackLabel` (`brainstormmodel.ts`).
- `CanvasPane` (`canvaspane.tsx`) has per-board tabs plus All, `[`/`]` and ←/→ stepping, a zoom
  percentage, and marking: marks drawn on a board are sent back to the agent as one line
  (`canvasmarks.ts`, `sendCanvasMarks` in `canvassend.ts`). It is also the standalone canvas pane
  and is used by the Canvas gallery.
- The right side of the brainstorm pane is `DecidedRail` ("Decided so far"),
  `w-[32%] min-w-[280px] max-w-[500px]` (`brainstormpane.tsx`).
- Spikes (live pages) are links under a part that open in the external browser.

## Design

### Boards live in the right rail

When the open question's part has boards, the right rail shows them instead of the old column beside
the options. The rail gets two tabs: **Boards** (the default while the question has boards) and
**Decided so far**. A question with no boards keeps the rail as it is today: Decided so far only, at
today's width.

### The rail is resizable

The rail has a drag handle on its left edge. Dragging it wider makes the boards larger; once the rail
is wide enough for two boards side by side, the boards lay out in two columns so they can be compared.
Dragging it narrower returns to one column. The width is remembered per machine.

### Each board is tied to its option

Each board in the rail is headed by its option letter and label (`A · Lag trend first`). Hovering or
selecting an option outlines its board in the accent colour and scrolls the rail to it; hovering a
board lights up its option. Pros and cons start folded when the question has boards, so the question
column stays short (the existing "Show pros and cons" toggle opens them).

**Agent's call (builder question 3):** a board carries an option letter and the hover link only when
the question has `options` and the part's board count equals the option count (2 or more). Otherwise
the board's header is its `title` from `canvas.json`, or its file name when it has none, and it is
linked to no option. This is a pure function in `brainstormmodel.ts` with a test per mismatch shape
(one board and three options, boards on a question with no options, more boards than options).

### Clicking a board widens the rail to its largest

Clicking a board widens the rail to its largest size (the question keeps a narrow column) and shows
only that board. Clicking it again, or Esc, returns the rail to the width it had. The question never
leaves the screen, so an option can be picked while the board is large.

### Marking in the widened rail

The widened rail has a **Mark** button. Marks are drawn on the board in the rail and sent to the agent
as they are today (`sendCanvasMarks`). The marking layer is shared with `CanvasPane` rather than
copied.

### Boards outside a question

With no question open (the design view, the builder check's review), the rail's Boards tab lists the
boards of every part, grouped under each part's title. When the design has at least one board, Boards
is the tab shown first; opening a part always switches to Boards and scrolls the rail to its boards;
clicking a board widens the rail exactly as during a question. Part rows no longer embed board
thumbnails.

While the judge or the agent is writing (the `judging` and `working` main views), the rail follows the
same rules as with no question open (Agent's call, builder question 2).

**Agent's call (builder question 1):** the builder check uses the same rail shell as the design: one
tabbed, resizable rail that takes its second tab as a slot. In the check that second tab is the
check's own rail ("A builder read the design": `AskRail` while a question is open, `AnsweredRail` in
the review, `brainstormcheck.tsx`). The check's tab opens first; a check question whose part has
boards opens on Boards. The check's rail is resizable and shares the remembered width, with today's
460px as its smallest. The review's one-part panel (`brainstormreview.tsx`) drops `PartMockups` as the
part rows do. Removing the `Thumbnails` column from `QuestionMain` applies to the check's talk
question too.

### Spikes

A part's spikes are links under that part's group of boards in the rail and still open in the
external browser. They no longer sit in the part row.

## Decisions for the build

- **Rail width.** Smallest 280px (460px in the builder check), as today; largest leaves the question
  column 360px; "widened" means the largest. The dragged width is one number shared by the design
  and the check, kept in `localStorage` (`brainstorm.railWidth`), every access wrapped in try/catch;
  with nothing stored the rail opens at today's 32% of the pane. The clamp is a pure function.
- **Two columns at a rail tile of 380px** (human's call, 2026-11-02). `MIN_TILE_W` (560px) would need
  a ~1,136px rail, which the largest rail rarely reaches, so the rail has its own `RAIL_TILE_W = 380`
  in `brainstormmodel.ts`: two columns once the rail's inner width fits two 380px tiles and their
  gap; a single board is always one column. A tile is the whole board scaled to the column width at
  its own aspect (no 200px height cap).
- **The widened board reuses today's state.** `BrainstormState.board` (`openBrainstormBoard`) now
  means "this board is widened in the rail": clicking a board attaches the canvas as today
  (`attachCanvas`) and sets it; `paneView` no longer returns `"board"`, so the pane keeps its view.
  `paneBack` still returns `"board"` while a board is widened, so Esc (`agent:brainstorm-back`)
  un-widens it, and a drawn mark still owns Esc first. `[` `]` and ← → keep stepping the part's
  boards while one is widened, as they do on today's full-size board. The widened board is drawn from
  the agent's canvas state, so marking writes the same `marks` that `sendCanvasMarks` sends.
- **Shared marking layer.** `MarkLayer` and `MarkTray` move out of `canvaspane.tsx` into
  `canvasmarking.tsx`, used by both `CanvasPane` and the widened rail; `CanvasPane`'s behaviour does
  not change. Remove `boardBackLabel` and the brainstorm pane's `CanvasPane` branch; `CanvasPane`
  stays for the standalone canvas pane and the Canvas gallery.
- **Keys while a board is widened.** The question stays live: letter keys pick an option
  (`pickableOptions` no longer returns 0 for a widened board), and in the check's review `j` `k` `y`
  `u` Enter keep acting on the review. While marking, they stand down as they do on today's board.
- **Hover link.** The hovered or ticked option is a per-agent jotai atom the options and the rail
  both read; hovering a board sets the same atom. No hover state lives in `BrainstormState`.
- **Tab names.** `Boards · N` and, as the second tab, `Decided so far · N` in the design and
  `Builder check` in the check. Decided so far drops its own heading line when it is a tab (the tab
  says it); the check's rails keep their "A builder read the design" heading and paragraph. With no
  Boards tab there is no tab strip and Decided so far keeps its heading, as today.
- **Width readout.** While the rail shows boards, a quiet readout right of the tabs says the columns
  and the rail's share of the pane (`2 columns · 52%`), as in the prototype.
- **Opening a part** from anywhere (a link in the rail or over the question, a part row's own
  toggle, reopening the same part) switches the rail to Boards and scrolls to that part's boards.
- **Pane too narrow for both** (narrower than 360px + the rail's smallest, so 640px in the design and
  820px in the check): the rail goes under the question, full width, without the drag handle (a
  container query, no JS measuring). A strip would hide the boards the question is about. With no
  Boards tab the check's rail stays 460px wide, as today.
- **Code shape.** The rail shell, its tabs, the drag handle, the Boards tab and the widened view are
  one new `brainstormrail.tsx`; its pure parts (width clamp, columns, which tab opens, board heads
  and option links) are in `brainstormmodel.ts` with tests. `Thumbnails` and `PartMockups` are
  deleted once nothing uses them.
- **Checks.** The `brainstorm-mode` CDP scenario's question-boards steps are rewritten for the rail,
  with new steps for dragging the rail to two columns, hovering an option to outline its board, a
  widened board with the question still on screen, marking in the widened rail, and the design
  view's Boards tab, among others; `brainstorm-builder-ask` shows the check's rail with its Boards
  tab where the review row's mockups were.

## Out of scope

- The standalone canvas pane and the Canvas gallery do not change.
- What the agent writes to `brainstorm.json` (`boards`, `spikes`, `canvas`) does not change.
