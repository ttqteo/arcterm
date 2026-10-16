# Office Needs you board — design

Date: 2026-10-16. Status: agreed, not built.

## Problem

In the Cockpit's Office view the Needs you strip (`frontend/app/view/agents/needsyoustrip.tsx`) sits as a band above
the office's toolbar, outside the office world, and takes height from the floor. Its count also reads against the
toolbar's "need you" chip, which counts only asking agents: the strip says 1 while the chip says 0.

## Decision

In Office, Needs you becomes a **notice board** in the hall, a place the boss walks to like a desk. Cards keeps the
strip as it is.

## Placement and look

- Office hides the strip; Cards renders it unchanged.
- The board is a cork board on the hall's left wall, just below the lounge (coffee machine, sofa), drawn in the
  desks' pixel-art style. It is always there, so the plan never shifts when something starts waiting.
- With rows waiting, an `!` bubble with the count sits over it, in the `asking` tone (the mark an asking agent's
  bubble uses). With none, it is a quiet fixture.

### With floors (the Office layout redesign)

The Office layout redesign (floors of 2×2 project rooms around the central hall, an elevator strip, runs as meeting
tables inside a project's room; brainstormed 2026-10-16 in another session) keeps the hall and its lounge, so the board
keeps this place. Whichever of the two is built second adapts to the other:

- every floor draws the board at the same place in its hall;
- the board lists the Needs you rows of every floor, not only the floor in view, so an ask on another floor (or one
  folded into a full room's `+N` chip) is answered without taking the elevator;
- `deskAt` and `order()` treat the board the same on every floor.

## Opening it

- **Walk:** the boss stands at the board and presses ↵, as at a desk; the "press ↵" hint shows over its head.
- **Click:** as a click on a desk does, the boss walks there and the dialog box opens.
- **Office menu (`m`):** a "Notice board" item, with the count in the asking colour, walks the boss to the board and
  opens it (not "Needs you": the menu already has "Next Needs you" on `n`, which jumps between asking desks).
- **Cursor:** while rows wait, the board is a stop in the office's `order()`, so ↑↓ and next-ask reach it.

## The dialog box

- One page per Needs you row; ← → (the question tabs' keys) page between them, with `1/n` in the corner, as a
  several-part ask pages today.
- Title: the row's kind and source ("Plan to review · Jarvis as graph"). Body: the row's text, its why, and its age.
- ▶ menu: the row's acts in the strip's order — the primary act (Approve, Land, Work on…), the second act, then Open.
  Esc returns to walking.
- A **learned rule** offers Accept, Dismiss and Why (Why shows the words that raised it). **Edit is left out of the
  office**: the dialog box has no good place to type; edit a rule from Cards.
- Every act calls what the strip calls (`runAttentionAct`, `LearnDecideCommand`, `openOrPeek`, `workOnDueChunk`):
  only the presentation changes.

## Code

- **Shared logic:** `needsyoustrip.tsx`'s row building (`buildNeedsYouRows` and the atoms it reads) and its handlers
  (`open`, `act`, `decideLearn`, the busy set) move into a hook, `useNeedsYou(model, onFocusAgent)`, which both the
  strip and the board use.
- **Plan:** `officeplanmodel.ts` adds `board: { box, spot }` with the fixed key `board:needs-you`. `officeboss.ts`
  `deskAt` returns that key when the boss stands within reach of the board in the hall (today it returns undefined
  anywhere in the hall).
- **Dialog model:** `DeskKind` gains `"board"`. A new pure `officeboardmodel.ts` maps a `StripRow` to `DialogItem[]`,
  builds the box's words, and pages and clamps between rows. `dialogFor("board:needs-you")` in `cockpitsurface.tsx`
  builds the `OfficeDialogVM` from it; its `run(id)` calls the hook's handlers.
- **Drawing:** `cockpitoffice.tsx` draws the board sprite at `plan.board.box` and the `!n` bubble when rows wait;
  a click on it walks the boss there and opens the box. `officeMenuItems` gains a `"needsYou"` item.

## Edge cases

- A row leaves while its page is open (acted on elsewhere, reloaded): the page clamps to the nearest row; with none
  left the box closes and the boss walks again.
- A failed act toasts, as the strip does, and the page stays.
- The project filter narrows the board's rows as it narrows the strip's.

## Testing

- vitest: `officeboardmodel.test.ts` (items per row kind, learned-rule items, paging, clamping when rows leave) and
  the plan / `deskAt` change (the board's place, reach from the hall).
- CDP scenario `office-needs-you-board`: a fixture with one plan-review row and one learned rule; switch to Office;
  shots of the board with `!2` and of the open box on each page; assert the strip is absent in Office and present in
  Cards.
