# Kael sync 11-25 (3 of 3): Boards, better (drawings, the drawings row, view mode)

The design is Kael's: `git show kael/main:docs/superpowers/specs/2026-11-20-boards-better-design.md` (goals, decisions,
anti-goals). This file holds only the port: what main takes, what it does not and why, where each fork change lands in
main's shape, and the calls the port makes where main differs from the fork. Method as in
`2026-11-19-kael-sync-agent-edits-and-fixes-design.md`: nothing merges; each fork commit is read with `git show` and its
behaviour is written into main's files.

## Where main differs from the fork

- **No Boards surface, no workspace board tab.** Main shows a board as a cell of the Agent grid beside a chat
  (`frontend/app/view/boards/boardsplit.tsx`, `2026-11-22-independent-board-cells-design.md`), alone over the centre
  (the same component, `alone`), and in Library → Boards (`frontend/app/view/library/libraryboards.tsx`). The fork's
  `boardssurface.tsx`, `boardview.tsx`, `boardtalk.tsx` and `workspaceboardtab.tsx` have no counterpart; their
  behaviour goes into those two places. The earlier sync rejected the workspace pane; this one does not take it either.
- **Main reads a dense board one part at a time** (`boardparts.ts`; the header's `‹ N parts ›` stepper, the Read label,
  ← → and Esc). The fork has no parts. See "Drawings and parts" below.
- **Main's canvas is lazy** (`React.lazy`), eases the view on the Fluid curve (`easeTo`), and lands answers through
  `boardconvert.ts` `landAnswer` (fonts turned readable, text re-measured) both on the open canvas and, for a board
  that is not open, in the file (`boardapplier.ts`).
- **Main's drawer** has `ParseAnswer(reply, scene)` (no `elsewhere`, no summary handoff), turn kinds `ask` and
  `request`, and charts (`chart.go`: one `chart` entry expands into many shapes).
- **No drawings count on `BoardInfo`.** Main's facts read shapes and time only.

## What is taken

| Fork commit | Behaviour | Main files |
|---|---|---|
| 83fc79e86 wire fields | `drawingid` on `CommandBoardAskData` and `BoardTurn`; `title`, `drawingid` on `BoardAnswer` | `pkg/wshrpc/wshrpctypes_board.go`, generated `frontend/types/gotypes.d.ts` |
| 757b91724 drawings as frames | a drawing is an Excalidraw frame numbered in `customData.arcDrawing`; a new answer becomes the next frame, right of the board, top-aligned; an edit joins the frame it names and refits it, or lands new when that frame is gone; `wrapEarlier` puts a frameless board in one "Earlier drawings" frame; children before their frame; `shapeCount` skips frames; `boarddrawings.ts` (`drawingsOf`, `drawingInView`, `askedDrawing`) | `frontend/app/view/boards/boardmodel.ts`, new `boarddrawings.ts`, their tests |
| c38d5ce85 one drawing at a time | the drawer answers a new drawing (adds only) or, with `"edit": true`, an edit of the drawing in view; scene shows frames and each shape's frame; refusals (edit with none in view, a change outside the drawing or on a frame, a new drawing that updates or removes, more than 40 adds, any text or label over 12 words); the turn carries `drawingid` through ask, Draw instead and Send to agent; the prompt names the drawing in view; the answer carries title and the edited frame | `pkg/boarddrawer/{answer,scene,prompt,drawer}.go`, `drawer-prompt.md`, `pkg/wshrpc/wshserver/wshserver_board.go`, `pkg/boardstore/boardstore.go` (shape count) |
| 228cc10f9 view mode, Edit | every board opens in Excalidraw's view mode (controlled `viewModeEnabled`); one Edit switch per board in memory, shared by every view of it; Edit off clears selection and tool; in view mode the ask box says "Press Edit to ask about shapes" and an ask sends no selection | `boardstore.ts` (atom), `boardcanvas.tsx`, new `boardstrip.tsx`, `boardsplit.tsx`, `boardaskbox.tsx`, `libraryboards.tsx` |
| 46eecdf0e drawings row, follow | the row lists drawings (number, title; the one in view current; one that landed while you were on an earlier one marked new); a chip fits its drawing; the canvas wraps an old board on load and saves it; the view follows the newest drawing while it is the one in view; reopening a board left following fits its newest; an ask sends the drawing an Edit selection names, else the one in view | `boardstore.ts` (atoms, `following`), `boardcanvas.tsx`, `boardstrip.tsx`, `boardsplit.tsx`, `boardactions.ts`, `libraryboards.tsx` |
| 996cbfb4a frame fits measured text | `applyAnswer` takes a measuring function and measures before the drawing lands, so an edited frame fits its text as measured | `boardmodel.ts`, `boardconvert.ts` |
| 618c718ce empty copy | empty board and empty talk lines point at Edit | `boardsplit.tsx`, `boardturns.tsx`, `libraryboards.tsx` |
| drawer prompt and skill text | one short idea per drawing; more becomes another drawing; an agent's request is a new drawing, or (since 2026-11-27) an edit or delete of the drawing it names | `pkg/boarddrawer/drawer-prompt.md`, `skills/cockpit/SKILL.md` (the fork's skill did not change; ours says the drawer may change any shape, which is no longer true for an agent's request) |

## What is not taken, and why

- **2ea2af503** (motion samples report their timing): it edits `scenarios-boards-workspace.mjs`'s W1 steps, which
  exist only for the fork's workspace pane. Main's new motion steps (below) carry their frame counts from the start.
- **The fork's facts "N drawings · …" and `canvasDrawings`**: main's `BoardInfo` has no drawings count and the row
  shows the drawings; adding a wire field for a number the row already shows is YAGNI. Facts keep shapes, now without
  frames.
- **The fork's `BoardCanvasControl.fitDrawing` ref and `boardview.tsx` hook**: main's canvas is driven by props and
  atoms (`highlightIds`, `part`), so a pick goes through an atom (below).
- **Accent styling of the current chip and the pressed Edit button**: DESIGN.md marks selection and pressed states in
  grey, never accent. Both use the grey selected tokens; the "new" mark is a muted word, not an accent one.

## Calls the port makes

### Drawings and parts

The drawings row moves between drawings; parts read inside one. Parts are computed from the shapes of the drawing in
view only (its frame's live children; `boardParts` itself is unchanged), and `needsParts` asks as now whether they need
reading. New drawings are short, so they fit and show no stepper and no Read label; a dense "Earlier drawings" (every
board drawn before this change) reads by parts exactly as today. Leaving a part (Esc, the header's button, a zoom of
your own as today) returns to the whole drawing in view, so the header's button reads **Whole drawing** (`data-board-
part-whole` kept). With no drawing in view there are no parts. Why: one navigation per level, no second stepper beside
the row, and today's reading of old dense boards keeps working (`boards-split` 8b reads B3's three parts inside its
Earlier drawings). `boardParts`' rule that two or more frames are the parts stays in the pure function and its test, but
the canvas no longer feeds it frames: hand frames are drawings in the row instead.

### Fitting and motion

- A drawing is fitted whole: the largest zoom at which its frame fills at most 90% of the view, never above 1
  (`drawingViewport` in `boarddrawings.ts`, pure). Unlike a part, no READ_ZOOM floor: the goal is the whole drawing,
  narrow cell included.
- A row pick, a new drawing landing while following, an edit growing the drawing in view, and leaving a part ease the
  view there with the canvas's existing `easeTo` (durMacro, Fluid curve; reduced motion jumps). Opening a board jumps.
- While the view eases, the row's current drawing and `following` are not recomputed; they are set at the ease's end,
  so the current marker does not flicker through the drawings it passes.
- Chips: a new chip enters with `cardVariants`, the current marker slides with `indicatorSlide` (`layoutId`, one id per
  strip). Both under `MotionConfig reducedMotion="user"`.

### Where things sit

- **The strip** (`boardstrip.tsx`): one 32px row directly above the canvas, the drawings row on its left (scrolls
  sideways, keeps the current chip in view), the Edit switch pinned right. In the board cell it sits inside the canvas
  column (so in the wide expanded layout it spans the canvas, not the turns column); in Library above the canvas. The
  strip shows Edit even before the first drawing. Why: Edit must be one click away in both places, and main's header is
  already full in a narrow cell.
- **Picking a drawing** goes through `boardPickAtom(boardId)` (`{drawingId, ts}`, a new value re-applies): the strip
  writes it, the canvas eases. The canvas publishes the row through `boardDrawingsAtom(boardId)`
  (`{drawings, inView, fresh, selected}`, `selected` being the drawing every selected shape belongs to, else null).
  `boardEditingAtom(boardId)` is the Edit switch. All three in `boardstore.ts`, in memory only. Why: the strip, the cell
  and Library read and write the same per-board state without plumbing callbacks through the canvas.
- **The ask's drawing**: in Edit, `selected ?? inView`; in view mode `inView`, and no selection. A selection across
  drawings names the one in view (the fork's rule).
- **Following** is kept in `boardViewportAtom` (`following?: boolean`). A board opened for the first time this session,
  or left following, opens fitted to its newest drawing; any other returns to where it was left.
- **Which drawing landed**: the canvas compares `drawingsOf` before and after `landAnswer`: a drawing not there before
  is new (fit it when following, else mark it new); otherwise an edit of the drawing in view refits it. The canvas does
  not read `AnswerResult.drawingId` (the landing code adds it for its own tests, as the fork did), so the canvas and the
  landing code are built side by side. That decision, the row's next state (`fresh` added and cleared, published only
  on a change) and `following` are pure functions in `boarddrawings.ts` with vitest cases, not logic in the `.tsx`.
- **Show in view mode** keeps main's `show()`: it sets `selectedElementIds` through `updateScene`, which Excalidraw's
  view mode accepts and draws as an outline without handles or the style panel (the fork relies on the same).

### The drawer

- `ParseAnswer(reply, scene, drawing string, pick bool)` keeps main's name and gains the frame id of the drawing in
  view, and `pick` for the agent's request (2026-11-27, below).
- **40 adds counts the drawer's entries, a chart as one**, checked before `expandCharts`: a chart lays out its bars and
  labels in Arc, and the limit is about what the drawer wrote. The 12-word limit applies to `text` and `label` of `add`
  entries and to `text`/`label` patches in `update`; a chart's `title` and data labels are not counted (Arc lays them
  out, and the prompt already keeps them short).
- An agent's request has no drawing in view. Its answer is a new drawing, or an `edit` that names the drawing it
  changes with a `"drawing": "<frame id>"` key, any drawing on the board; an edit that names none is refused ("its
  drawing key names none"). A person's ask ignores that key and edits only the drawing in view. (Until 2026-11-27 a
  request was always a new drawing, so an agent asked to fix one drew a corrected copy beside it.)
- An edit that puts its own frame's id in `remove`, with no `add` or `update`, deletes the whole drawing: `ParseAnswer`
  expands `remove` to every shape of that frame, then the frame, and `Removed` counts the shapes.
- The drawer prompt's "parts" paragraph (give each part a title at its top left, 120 between parts) becomes a shorter
  rule inside one drawing (one idea; at least 120 between groups, under 40 between shapes of one group): the frame now
  carries the title.
- `boardstore`'s shape count and the scene's `Shapes` skip frames, so the chat card and Library rows count what the
  drawer drew, as the canvas does.

### Tests and pinned behaviour

- Main's `boardmodel.test.ts` pins answers landing at the drawer's absolute coordinates. The goal asks for Arc to place
  each new drawing, so those assertions move with the port (the fork changed the same ones). `boardapplier.test.ts`
  mocks `landAnswer` with a fixed rectangle; its mock now calls the real `applyAnswer` so a closed board's answer is
  shown landing as a titled frame in the saved file.
- `MaxShapes` (200 across add, update and remove) stays as the whole answer's cap, which only an edit can reach now
  (a new drawing has at most 40 adds and nothing else); the answer tests that pass 200 adds as a new drawing are
  rewritten as edits inside the drawing in view.
- Excalidraw refuses undo in view mode, so a scenario step that undoes a landing turns Edit on first. Main-only behaviour pinned there (charts as one group, readable fonts, Nunito refit, arrow routing) must keep
  passing unchanged; if one cannot, main's stays and the conflict becomes an "(arcterm) Kael sync 11-25, owner
  decision" row in `docs/open-issues.md`.
- Scenario steps that select shapes (`boards-split` 4, `boards-library` 7, `boards-chat` 4) press Edit first, and
  shape counts in scenarios and `boards-fixtures.mjs` skip frames, as the fork's scenarios did.

## Not in this port

- Splitting boards drawn before this change per past turn (the fork's non-goal).
- A drawings count on the wire or in the facts.
- Keyboard stepping between drawings (← → still step parts inside a dense drawing).

## Verification

- Go: `TestParseAnswer*` cases for each refusal and for an edit and a new drawing passing; scene frames and `FrameOf`;
  the turn prompt naming the drawing in view or none; `drawingid` kept through ask, Draw instead and Send to agent; the
  delivered answer's title and drawing id; the shape count without frames.
- Vitest: `boarddrawings.test.ts` (`drawingsOf`, `drawingInView`, `askedDrawing`, `drawingViewport`),
  `boardmodel.test.ts` (`wrapEarlier`, a new drawing placed and framed, an edit refitting with measured text, a gone
  frame landing new), `boardapplier.test.ts`.
- CDP (`boards-split`, `boards-library`, `boards-chat`): view mode on open and a drag panning, Show in view mode, Edit
  bringing the tools back and turning off, the drawings row on an old board (one "Earlier drawings"), a new drawing
  landing fitted in the narrow cell (with motion samples), staying on an earlier drawing while a new one is marked new,
  a chip pick, the ask's `drawingid`, an edit refitting its frame, reopening fitted to the newest, empty copy naming
  Edit in the board cell and in Library, Library's strip. Motions no step can judge go to `docs/hand-checks.md`, and so
  does committing the What's new picture the Final run takes. "Empty" reads `(board.shapes ?? 0) === 0` once the list is
  loaded, since `shapes` is omitted at 0 on the wire.
- The drawer's behaviour with a real model is covered by Go tests, not hand checks: an agent's request answered as an
  edit is refused, and the turn prompt names the drawing in view.
