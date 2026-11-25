# Kael sync 11-25 (3 of 3): Boards, better (drawings, the drawings row, view mode)

**Spec:** `docs/superpowers/specs/2026-11-25-kael-sync-boards-drawings-design.md` (the port's calls and the fork-to-main file map; the design itself is `git show kael/main:docs/superpowers/specs/2026-11-20-boards-better-design.md`)
**Verify:** `node scripts/verify.mjs ./pkg/boarddrawer ./pkg/boardstore ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs boards-split boards-library boards-chat`

Shape of the work: Task 1 lands the names every later task builds on (wire fields, the pure drawings module, the
per-board atoms, `wrapEarlier`). Then four tasks run side by side: Task 2 (the drawer answers one drawing at a time),
Task 3 (answers land as framed drawings), Task 4 (the canvas: view mode, following, the row's data, parts inside the
drawing in view) and Task 5 (the strip, the board cell, Library, copy, CHANGELOG). Task 6 writes the scenario steps
and hand checks beside them, against the `data-*` hooks and atom names this plan fixes (it runs no CDP; Final runs
its steps on the merged result).

The hooks Task 6 drives, fixed here: on the canvas root `data-board-view-mode` ("true"/"false") and
`data-board-in-view` (Task 4); `data-board-strip`, `data-board-drawings` (the row), `data-board-drawing="<id>"` with
`aria-current="true"` on the one in view, `data-board-drawing-new`, `data-board-edit` with `aria-pressed`, and
`data-board-empty` over an empty canvas in the board cell and in Library (Task 5); existing hooks keep their names.

Rules for every task:

- Principles: simple and direct, KISS, YAGNI, DRY, one source of truth; measure before optimizing; no abstraction for
  a single implementation; handle errors at the boundaries and never swallow one silently (a failed save or landing
  logs with `console.warn` and what it lost, as the canvas already does).
- **How to port.** The fork is the `kael` remote (fetched; tip `45edf22ed`). Read the commit named in your task with
  `git show <hash>` and a file at the fork tip with `git show kael/main:<path>`, then write the behaviour into main's
  files. Nothing merges; `git cherry-pick -n` only where a hunk applies cleanly. Main's shape differs (spec, "Where main
  differs from the fork"): there is no Boards surface, `boardview.tsx`, `boardtalk.tsx` or workspace tab here.
- Where the fork's change would reverse a behaviour a test on main pins (beyond what the spec says moves with the
  port), keep main's and add an "(arcterm) Kael sync 11-25, owner decision" row to `docs/open-issues.md` (only Task 3
  owns that file; another task names the conflict in its report instead).
- UI follows `DESIGN.md`: theme tokens only, selection and pressed states in grey (never accent), motion from
  `frontend/app/element/motiontokens.ts`, reduced motion honoured, copy in sentence case saying what happens.
- Run only the focused tests named in your task, plus `task check:ts` (give it a 5-minute timeout). Never hand-edit
  generated files; run `task generate` after changing a wshrpc type.
- Commits carry no attribution trailer.

### Task 1: The names every task builds on
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_board.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/boards/boarddrawings.ts`, `frontend/app/view/boards/boarddrawings.test.ts`, `frontend/app/view/boards/boardstore.ts`, `frontend/app/view/boards/boardmodel.ts`, `frontend/app/view/boards/boardmodel.test.ts`

Fork: 83fc79e86 (wire fields), the pure half of 757b91724 (`boarddrawings.ts`, `wrapEarlier`, `shapeCount`).

1. Wire fields (`pkg/wshrpc/wshrpctypes_board.go`): `DrawingId string json:"drawingid,omitempty"` on
   `CommandBoardAskData` (the drawing in view when the line was asked) and on `BoardTurn` (kept for Retry, Draw
   instead and Send to agent); `Title string json:"title,omitempty"` and `DrawingId string json:"drawingid,omitempty"`
   on `BoardAnswer` (a new drawing's frame name; the frame an edit changes, empty for a new drawing). Run
   `task generate`; any other file it rewrites belongs to this task too. No behaviour change.
2. New pure module `frontend/app/view/boards/boarddrawings.ts` (no React, no Excalidraw runtime; types from
   `@excalidraw/excalidraw/element/types` only), exporting exactly:
   - `interface Drawing { id: string; n: number; title: string; bounds: { minX; minY; maxX; maxY } }`
   - `interface ViewRect { scrollX: number; scrollY: number; zoom: number; width: number; height: number }`
   - `isFrame(el)` (type `"frame"`), `drawingNumber(el): number | null` (from `customData.arcDrawing`),
     `drawingData(n): Record<string, unknown>`
   - `drawingsOf(elements): Drawing[]`: live frames, numbered ones by number, then hand frames (no number) in element
     order numbered on from the highest
   - `drawingInView(drawings, view: ViewRect): string | null`: the drawing covering the most of the view, a tie to
     the newer, null when none is visible
   - `askedDrawing(elements, selectedIds, inView): string | null`: the one live frame every selected shape belongs to
     (a selected frame belongs to itself), else `inView`
   - `drawingShapes(elements, drawingId): ExcalidrawElement[]`: the drawing's live children (frame excluded), for
     parts inside one drawing
   - `drawingViewport(d: Drawing, viewW, viewH): Viewport` (the `Viewport` type from `boardparts.ts`): centred, zoom
     `min(1, 0.9 * min(viewW / w, viewH / h))`, no READ_ZOOM floor
   - `interface BoardDrawings { drawings: { id: string; n: number; title: string }[]; inView: string | null; fresh: string[]; selected: string | null }`
     (what the open canvas publishes for the row and the ask; `boardstore.ts` imports it)
   Port the fork's file (`git show 757b91724 -- frontend/app/view/boards/boarddrawings.ts`) and add the rest.
3. `frontend/app/view/boards/boardstore.ts`: `BoardViewport` gains `following?: boolean` (the newest drawing is the
   one in view, so a new one is fitted as it lands); new atom families keyed by board id, in memory only:
   `boardEditingAtom(boardId): boolean` (false; the Edit switch, shared by every view of the board),
   `boardDrawingsAtom(boardId): BoardDrawings | null` (the type from `boarddrawings.ts`; null until a canvas of the
   board loads; `fresh` = landed while the view was on an earlier drawing and not yet in view; `selected` = the drawing
   every selected shape belongs to, else null), and
   `boardPickAtom(boardId): { drawingId: string; ts: number } | null` (a row pick; a new value re-applies). Say in
   the file's header comment what each is for.
4. `frontend/app/view/boards/boardmodel.ts`: export `wrapEarlier(scene, now): BoardScene` (a board with live shapes
   and no frame gets them all in one frame titled "Earlier drawings", number 1, padded 40, children's `frameId` set,
   the frame after its children; a board with any frame, or none, comes back as the same object) and make
   `shapeCount` skip frames. Keep `newElement`, `bump`, `live` as they are.

Tests: `npx vitest run frontend/app/view/boards/boarddrawings.test.ts frontend/app/view/boards/boardmodel.test.ts`
(port the fork's `boarddrawings.test.ts`; add cases for `drawingShapes`, `drawingViewport` (fits a wide drawing in a
narrow view below 1, keeps a small one at 1, centred), `wrapEarlier` (wraps a frameless board, leaves a framed or
empty one as the same object) and `shapeCount` skipping a frame). `go build ./pkg/...` passes.

### Task 2: The drawer answers one drawing at a time
**Depends on:** Task 1 (uses the `drawingid` and `title` wire fields)
**Model:** sonnet
**Files:** `pkg/boarddrawer/answer.go`, `pkg/boarddrawer/answer_test.go`, `pkg/boarddrawer/chart_test.go`, `pkg/boarddrawer/scene.go`, `pkg/boarddrawer/scene_test.go`, `pkg/boarddrawer/prompt.go`, `pkg/boarddrawer/prompt_test.go`, `pkg/boarddrawer/drawer.go`, `pkg/boarddrawer/drawer_test.go`, `pkg/boarddrawer/drawer-prompt.md`, `pkg/wshrpc/wshserver/wshserver_board.go`, `pkg/wshrpc/wshserver/wshserver_board_test.go`, `pkg/boardstore/boardstore.go`, `pkg/boardstore/boardstore_test.go`, `skills/cockpit/SKILL.md`

Fork: c38d5ce85 (Go side). Main's names differ: `ParseAnswer` (not `CheckAnswer`), no `elsewhere`, turn kinds, charts.

- `scene.go`: `Scene` gains `Frames map[string]string` (frame id → title) and `FrameOf map[string]string` (shape id →
  its live frame); a frame's line shows type `frame` with its title as label; each shape's line carries
  `frame`; `Shapes` skips frames.
- `answer.go`: `ParseAnswer(reply string, scene Scene, drawing string)`; `Answer.Edit` from `"edit": true`;
  `MaxShapes = 200` stays as the whole answer's cap across add, update and remove (only an edit can reach it now);
  `MaxDrawingAdds = 40` counted on the drawer's `add` entries before `expandCharts` (a chart is one); `MaxLabelWords =
  12` on `text`/`label` of add entries and on `text`/`label` patches; `checkScope` as the fork's (an edit with no live
  frame in view, a new drawing that updates or removes, a change to a frame, a change outside the edited drawing are
  unusable, with the fork's reasons). Update every `ParseAnswer` caller (`chart_test.go` too).
- `prompt.go`: `turnInput.DrawingId`; the turn names the drawing in view when it is a live frame
  (`The drawing in view: "<title>" (id …)` plus how an edit is marked), else says none is in view and to draw a new
  drawing; `agentRequestLine` says to draw it as a new drawing.
- `drawer.go`: `Ask` copies `in.DrawingId` onto the turn (update its doc comment's list of caller fields);
  `answer` passes `turn.DrawingId` to the prompt and `ParseAnswer`; the delivered `BoardAnswer` carries `Title`, and
  `DrawingId = turn.DrawingId` only when `answer.Edit`.
- `wshserver_board.go`: `BoardAskCommand` passes `data.DrawingId`; Draw instead and Send to agent copy `t.DrawingId`.
- `drawer-prompt.md`: the fork's "One drawing at a time" section (new drawing: add only, own coordinates near 0,0, Arc
  frames, titles and places it; edit: `"edit": true`, only that drawing's shapes, board coordinates, never a frame;
  an agent's request is always new; keep every drawing short, more becomes another drawing), the 40-adds and 12-words
  limits in place of "at most 200 entries", drop "the whole board is shared" and "put a new drawing beside or under
  what is there", the edit example; main's parts paragraph becomes the spec's shorter in-drawing rule. Keep main's
  chart vocabulary.
- `boardstore.go`: `shapes()` skips `frame` elements.
- `skills/cockpit/SKILL.md` ("Drawing on a board"): each `wsh board draw` request becomes a new, short drawing on the
  board (one idea; for more, send another request); the drawer no longer changes earlier drawings for an agent's
  request, so replace "The drawer may move, restyle or remove any shape on it…" accordingly.

Tests (on Windows prefix each `go test` with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`; the wshserver
package needs CGO for SQLite):
`go test ./pkg/boarddrawer -run 'TestParseAnswer|TestSceneSummary|TestPrompt|TestAsk|TestRetry|TestAnswered|TestRequest|TestChart'`,
`go test ./pkg/wshrpc/wshserver -run 'TestBoardAsk|TestBoardReroute|TestBoardStopAndRetry'`,
`go test ./pkg/boardstore -run 'TestListShapes'`. Add cases to those tests (or new ones whose names those filters
match): each refusal reason; an edit inside the drawing and a new drawing pass; a chart counts once toward 40; 13
words refused in add and in an update; the existing "201 entries" and "200 entries must pass" cases in
`answer_test.go` rewritten as edits inside the drawing in view (a new drawing past 40 adds is refused); an agent's
request answered with `"edit": true` fails its turn; scene frames and `FrameOf`; the turn prompt names a live frame in
view and says none is in view otherwise; `drawingid` kept on ask, Draw instead and Send to agent; the delivered title
and drawing id (edit) or none (new); `Shapes` and `shapes()` without frames.

### Task 3: Answers land as framed drawings
**Depends on:** Task 1
**Model:** sonnet
**Files:** `frontend/app/view/boards/boardmodel.ts`, `frontend/app/view/boards/boardmodel.test.ts`, `frontend/app/view/boards/boardconvert.ts`, `frontend/app/view/boards/boardapplier.test.ts`, `docs/open-issues.md`

Fork: 757b91724 (`applyAnswer`, `landNew`, `landEdit`), 996cbfb4a (measure before landing). Builds on Task 1's
`boardmodel.ts` (`wrapEarlier`) and `boarddrawings.ts` (`drawingData`, `drawingNumber`, `isFrame`).

- `applyAnswer(scene, answer, added, now, measureText: MeasureText = identity)` (export `type MeasureText`): wraps
  with `wrapEarlier` first; an answer whose `drawingid` is a live frame edits it (its added shapes join the frame,
  placed just before it, the frame refits to its children padded 40); otherwise a new drawing: added shapes move right
  of everything on the board by 120, top-aligned with its topmost shape (an empty board: the origin), inside a new
  frame numbered one past the highest, titled `answer.title`. Changed text is measured (`measureText`) before landing,
  so the frame fits measured boxes. `AnswerResult` gains `drawingId` (the frame it landed in). A label made for a
  framed shape carries its `frameId` and is spliced right after its container (children stay before their frame).
- `boardconvert.ts` `landAnswer`: hand `applyAnswer` a measure that applies `withReadableFont` and then measures the
  changed text plus the text the font change touched, so the result's `textIds` still includes both. Keep the module's
  rule that `boardmodel.ts` never loads the Excalidraw runtime.
- `boardapplier.test.ts` mocks `landAnswer` with a fixed rectangle: make the mock call the real `applyAnswer` (from
  `boardmodel.ts`) on a stub rectangle, so a closed board's landed answer is asserted as a titled, numbered frame in
  the saved file.
- Tests in `boardmodel.test.ts` that pinned landing at the drawer's absolute coordinates move with the port (spec,
  "Tests and pinned behaviour"); charts as one group, readable fonts, Nunito refit and arrow routing keep their assertions. A main-only
  behaviour that cannot hold becomes an owner-decision row in `docs/open-issues.md`.

Tests: `npx vitest run frontend/app/view/boards/boardmodel.test.ts frontend/app/view/boards/boardapplier.test.ts`:
a new drawing is placed right of the board and framed with the title and next number; an edit joins and refits its
frame; an edit naming a gone frame lands new; a frameless board is wrapped before landing; a measuring function that
widens a text makes the edited frame contain it (the fork's 996cbfb4a case); the applier lands a closed board's answer
as a drawing in the file.

### Task 4: The canvas: view mode, following the newest drawing, parts inside it
**Depends on:** Task 1 (uses `boarddrawings.ts`, the per-board atoms and `wrapEarlier`)
**Model:** sonnet
**Files:** `frontend/app/view/boards/boardcanvas.tsx`, `frontend/app/view/boards/boardcanvas.css`, `frontend/app/view/boards/boarddrawings.ts`, `frontend/app/view/boards/boarddrawings.test.ts`

Fork: 228cc10f9 and 46eecdf0e (their `boardcanvas.tsx` hunks), written into main's lazy, prop-driven canvas.

- The decisions below are pure functions added to `boarddrawings.ts` with vitest cases, and the canvas only calls
  them: `rowState(prev: BoardDrawings | null, drawings: Drawing[], inView, selected): BoardDrawings` (drops from
  `fresh` the drawing in view and gone ones, returns `prev` itself when nothing changed so the canvas publishes only on
  a change), `isFollowing(drawings, inView): boolean` (no drawings, or the newest in view), and
  `afterLanding(beforeIds: string[], following: boolean, inView: string | null, after: Drawing[], editedId: string | undefined): { fit: string | null; fresh: string | null }`
  (a drawing not there before is new: fit it when following, else mark it fresh; otherwise refit the edited drawing
  when it is the one in view; else nothing).

- View mode: `viewModeEnabled={!editing}` from `boardEditingAtom(boardId)` (controlled, so Excalidraw's own toggle is
  off). Turning Edit off clears the selection and arms the selection tool.
- Load: `wrapEarlier` the parsed scene; when it wrapped, save once the canvas has it. Opening: a board with no
  remembered viewport, or one left `following`, opens fitted to its newest drawing (`drawingViewport`, no ease); any
  other returns to its viewport; a board with no drawings opens as today.
- On every change (not while `easeTo` runs; once at its end): compute `drawingsOf`, `drawingInView`, `following`
  (no drawings, or the newest is in view), `selected` (`askedDrawing` of the selection with a null fallback), and
  publish `boardDrawingsAtom(boardId)` only when it changed; drop from `fresh` the drawing now in view and gone ones;
  keep `boardViewportAtom` with `following`. Skip a zero-size view.
- A landing (`registerLiveBoard`): note `following` and the drawing in view before `landAnswer`; afterwards a drawing
  not there before is new: ease to it when following (and close any open part), else add it to `fresh`; otherwise, if
  the answer's `drawingid` is the drawing in view, ease to it again (it may have grown). One updateScene stays one undo
  step.
- A pick: watch `boardPickAtom(boardId)` and ease to that drawing (close any open part).
- Parts: `boardParts(drawingShapes(elements, inView))`, recomputed when the drawing in view changes as well as after
  edits; none when no drawing is in view. Leaving a part eases to the whole drawing in view (to the whole board only
  when there is none) instead of `wholeBoard()`. The Read label stays; its title says "Esc for the whole drawing".
- Show in view mode: `show()` keeps setting `selectedElementIds` through `updateScene` (Excalidraw's view mode
  accepts it and draws the outline without handles or the style panel); the `selecting` flag that hides the Read
  label still follows it.
- Expose `data-board-view-mode` (`"true"`/`"false"`) and `data-board-in-view` (the drawing id) on the canvas root for
  the scenarios.

Acceptance: `task check:ts`; `npx vitest run frontend/app/view/boards/boarddrawings.test.ts` with cases for
`rowState`, `isFollowing` and `afterLanding` (new while following, new while on an earlier drawing, edit of the
drawing in view, edit of one out of view, fresh cleared when in view, unchanged row returns `prev`); shown by
`boards-split` steps 17a (view mode on open, a drag pans), 17b (Show in view
mode), 17c (Edit on and off), 18a (an old board's Earlier drawings, saved), 18b (a new drawing eased into view in the
narrow cell), 18c (an earlier drawing kept, the new one marked new, a pick), 18e (an edit refits), 18f (reopened
fitted to the newest), and the existing 8b (B3's parts inside its Earlier drawings), all written in Task 6.

### Task 5: The strip, the board cell, Library and copy
**Depends on:** Task 1 (uses the per-board atoms)
**Model:** sonnet
**Files:** `frontend/app/view/boards/boardstrip.tsx`, `frontend/app/view/boards/boardsplit.tsx`, `frontend/app/view/boards/boardheader.tsx`, `frontend/app/view/boards/boardaskbox.tsx`, `frontend/app/view/boards/boardactions.ts`, `frontend/app/view/boards/boardturns.tsx`, `frontend/app/view/library/libraryboards.tsx`, `CHANGELOG.md`

Fork: `boardstrip.tsx` at `kael/main`, 228cc10f9 and 46eecdf0e (their surface and ask hunks), 618c718ce (copy).

- New `boardstrip.tsx`: `BoardStrip({ boardId })`, a 32px row (`border-b border-edge-mid`): the drawings row from
  `boardDrawingsAtom` (chips `data-board-drawing="<id>"`: the number in mono muted, the title truncated, a muted
  "new" word `data-board-drawing-new` on fresh ones, `aria-current="true"` on the one in view; grey selected styling;
  new chips enter with `cardVariants`, the current marker slides with `indicatorSlide` via a per-strip `layoutId`;
  `MotionConfig reducedMotion="user"`; scrolls sideways with no scrollbar and keeps the current chip in view; a click
  sets `boardPickAtom`), hidden while there are no drawings; and the Edit switch pinned right (`data-board-edit`,
  `aria-pressed`, PenLine icon, label "Edit", title "Edit the board: draw, move and select shapes" / "Stop editing",
  grey pressed state) toggling `boardEditingAtom`.
- `boardsplit.tsx`: the strip directly above the canvas, inside the canvas column (the canvas keeps its own
  `relative flex-1` box); the ask passes the drawing (`editing ? selected ?? inView : inView`) and no selection in
  view mode; an empty board (the list loaded, `(board.shapes ?? 0) === 0` since the wire omits 0, and no turn) shows
  over the canvas
  "Nothing drawn yet. Ask below, or press Edit to draw." (`data-board-empty`); the expanded turns' empty line reads
  "No turns yet. Ask below; to ask about shapes, press Edit and select them."
- `boardactions.ts`: `askBoard(board, question, selection, drawingId: string | null)` sends `drawingid`.
- `boardaskbox.tsx`: an `editing` prop; in view mode the hint reads "Press Edit to ask about shapes" and no
  "Selected …" shows; in Edit as today.
- `boardturns.tsx`: an optional `emptyText` prop (default "No turns yet.").
- `boardheader.tsx`: the part button reads "Whole drawing", title "Whole drawing (Esc)", `data-board-part-whole`
  kept; update the header comment.
- `libraryboards.tsx`: the strip above the canvas; an empty board (same test) shows "Nothing drawn yet. Press Edit to
  draw on it." (`data-board-empty`).
- `CHANGELOG.md` (Unreleased): Added, big: each drawer answer on a board is its own titled drawing, the row above the
  board lists them one click away, and the view moves to a new drawing as it lands unless you went back to an earlier
  one (from the kaeltran16 fork) `<!-- big -->` `<!-- shot: none -->` (Task 6's Final run takes the picture; the
  report says to commit it and name it). Changed: boards open for viewing (no drawing toolbar, drags pan); press Edit
  above the board to draw, move or select shapes and ask about them (from the kaeltran16 fork). Changed: the drawer
  keeps each drawing short, a few words per box and one idea per drawing; more becomes another drawing (from the
  kaeltran16 fork).

Acceptance: `task check:ts`; `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes; prettier and eslint clean on the
touched paths. Shown by `boards-split` steps 17a, 17c (the strip's Edit), 18a–18c (the row), 18d (the ask's
`drawingid` and no selection in view mode), 18g (empty board and empty talk copy), the existing 4 (Edit pressed
first) and 8b ("Whole drawing"), and `boards-library` 7b (Library's strip) and 7c (Library's empty board), all
written in Task 6.

### Task 6: Scenario steps and hand checks
**Depends on:** Task 1 (sets `boardEditingAtom` in the page and reads `boardstore.ts`' atoms)
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-boards-split.mjs`, `scripts/cdp/scenarios-boards-library.mjs`, `scripts/cdp/scenarios-boards-chat.mjs`, `scripts/cdp/boards-fixtures.mjs`, `docs/hand-checks.md`

Fork: the scenario hunks of 228cc10f9, 46eecdf0e, 618c718ce (`scenarios-boards-ask.mjs`), translated to main's
board cell. The board RPCs stay stubbed (`boards-fixtures.mjs`); answers land through `putAnswer`.

- `boards-fixtures.mjs`: `shapeCount` skips frames.
- `boards-split`: step 4 presses Edit before selecting (its assertions stay) and checks the ask's `drawingid` is B1's
  Earlier drawings frame; 8b's button is "Whole drawing". New steps, each a screenshot plus a DOM assert:
  17a a board opens in view mode (`data-board-view-mode="true"`, no Excalidraw toolbar, Edit `aria-pressed="false"`,
  the ask hint "Press Edit to ask about shapes"; a drag moves the scroll and no shape); 17b Show in view mode selects
  the turn's shapes with no style panel; 17c Edit brings the toolbar and "Select shapes to ask about them" back, Edit
  again returns to view mode with nothing selected; 18a an old board shows one chip "1 Earlier drawings", current, and
  the saved file holds that frame; 18b in the narrow cell beside the agent (not expanded), an answer with a title lands
  as chip 2, current, and its frame ends fully inside the canvas, with motion samples of the scroll during the ease
  (report frame count and the frame where it first moved) and `h.whatsnewShot("board-drawings", { selector: <the
  cell> })`; 18c pick chip 1: the view fits drawing 1; another answer lands: the view stays, chip 3 reads "new"; pick
  chip 3: fitted, "new" gone; 18d an ask in view mode sends the drawing in view and no `selectedids`; in Edit a shape
  of drawing 1 selected sends drawing 1's id; 18e an edit answer (`drawingid` = the drawing in view) that lengthens a
  label leaves the frame containing that text; 18f close the board while following, land an answer through the
  applier, reopen: fitted to the newest; 18g an empty board (no shapes, no turns, expanded) shows both empty lines and
  they name Edit.
- `boards-library`: step 7 presses Edit before the hand edit; new 7b Library's strip shows Edit and the board's
  chip, and a board opens in view mode there; new 7c a fixture board with no shapes (its list row without `shapes`,
  as the wire omits 0) shows Library's empty line naming Edit.
- `boards-chat`: shape counts skip frames (steps 2 and 4). Step 4 mounts a bare `BoardCanvas` (no strip): set
  `boardEditingAtom(<board>)` true in the page (`globalStore` and `mod("app/view/boards/boardstore.ts")`, as the step
  already imports modules) before its Show and its Ctrl+Z, since Excalidraw refuses undo in view mode; allow for the one
  save the canvas now makes on load when it wraps the board in Earlier drawings; a live answer is still one undo step
  (its shapes and its frame go together). Turn Edit off again in the step's cleanup.
- `docs/hand-checks.md`, today's section, "(arcterm)" lines: the ease to a new drawing in the narrow cell reads
  smooth; the current chip's marker slides and a new chip enters; Show in view mode outlines shapes without handles;
  commit the `board-drawings` What's new picture the Final run wrote under `public/whatsnew/` and replace the big
  CHANGELOG line's `<!-- shot: none -->` with it.

Acceptance: `node --check` on each touched `.mjs`; the Final line runs `boards-split`, `boards-library` and
`boards-chat` and every step passes.
