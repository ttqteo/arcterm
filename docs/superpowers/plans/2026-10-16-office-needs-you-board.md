# Office Needs you Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Cockpit's Office view the Needs you strip gives way to a notice board in the hall: an `!n` bubble
over it while rows wait, ↵ (or a click, or the office menu's "Notice board") opens a dialog box with one page per row,
and the ▶ menu runs the same acts the strip's buttons run. Cards keeps the strip unchanged.

**Architecture:** The strip's rows and handlers move into one hook, `useNeedsYou` (`needsyou.ts`), that the strip
and the board share. A new pure model, `officeboardmodel.ts`, turns a `StripRow` into the board's ▶ items and words
and pages between rows. The floor plan (`officeplanmodel.ts`) gains a fixed `board` (box and spot) in the hall below
the lounge, and `officeboss.ts` lets the boss stand at it like a desk (key `board:needs-you`). The office
(`cockpitoffice.tsx`) draws the board, its bubble and its "↵ Read" prompt, adds it to the cursor's stops while rows
wait, and opens its dialog through the existing `dialogFor` / layer machinery; the Cockpit surface builds that dialog.

**Tech Stack:** React 19 + Tailwind 4 + jotai, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-16-office-needs-you-board-design.md` and the canvas in the Prototype line
(boards Main, Dialog, States).

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-controls office-needs-you-board`
**Prototype:** <repo>/.superpowers/design/office-needs-you-board/project/

## Global Constraints

- Frontend only. `Verify` names `./pkg/wconfig` only because `scripts/verify.mjs` needs one Go pattern; no Go changes.
- Colours come from `@theme` tokens (`frontend/tailwindsetup.css`): the office's scenery uses the existing
  `--color-office-*` tokens through `officepalette.ts`, the bubble the `asking` token. No raw hex in components. The
  canvas's hex values are the token values, for reference only.
- Pure logic in `.ts` with a `.test.ts` beside it; no jsdom render tests (AGENTS.md, "Frontend conventions").
- Every act the board runs calls the code the strip calls today (`runAttentionAct`, `RpcApi.LearnDecideCommand`,
  `openOrPeek`, `workOnDueChunk`, `onFocusAgent`). Nothing about what an act does changes.
- The Office layout redesign (floors, elevator) is designed in another session and not built. Don't build any of it;
  keep the board's place a single `plan.board` so that work can move it per floor.
- Run single test files with `npx vitest run <file>`; the typecheck is `task check:ts` (~2 min, give it a 5-minute
  timeout).
- Commit with a pathspec: `git commit -m "<msg>" -- <paths>` (add new files with `git add -- <paths>` first). Never
  leave files staged.

---

### Task 1: Share the strip's rows and acts through `useNeedsYou`

**Depends on:** none

**Files:** `frontend/app/view/agents/needsyou.ts`, `frontend/app/view/agents/needsyoustrip.tsx`, `frontend/app/view/agents/attentionstore.ts`

What each file is for:
- Create: `frontend/app/view/agents/needsyou.ts`
- Modify: `frontend/app/view/agents/needsyoustrip.tsx`
- Modify: `frontend/app/view/agents/attentionstore.ts`

The strip keeps rendering exactly as today; this task only moves code.

- [ ] **Step 1: Add a DEV fixture atom to `attentionstore.ts`**

Below `attentionLoadedAtom`, add:

```ts
// DEV only (the office-needs-you-board scenario): Needs you rows to show in place of the live list. null is live.
// The poll never writes it, so a scenario's rows survive the next loadAttention.
export const attentionFixtureAtom = atom<AttentionItem[] | null>(null) as PrimitiveAtom<AttentionItem[] | null>;
```

- [ ] **Step 2: Create `needsyou.ts` with the hook**

Move from `NeedsYouStrip` (`needsyoustrip.tsx:168-275`) into `useNeedsYou(model, onFocusAgent)`: the atom reads, the
`rows` memo, the `busy` set and `setRowBusy`, `open`, `decideLearn` and `act`, and the `feedback` toasts. The rows
read `attentionFixtureAtom ?? attentionAtom`. It returns:

```ts
export interface NeedsYou {
    rows: StripRow[];
    now: number;
    busy: ReadonlySet<string>;
    open: (row: StripRow, e?: React.MouseEvent) => void;
    act: (row: StripRow, which: AttentionAct, e?: React.MouseEvent) => void;
    decideLearn: (row: StripRow, accept: boolean, text?: string) => Promise<boolean>;
}
```

`act` and `open` take an optional event: the board calls them from a keypress, with no mouse event. Where
`openOrPeek` takes the event today, pass it through as given (it already handles `undefined`: check its signature in
`frontend/app/view/jarvis/openref.ts` and, if it requires an event, pass `undefined` the way other keyboard callers
do).

Header comment: what it is (the Needs you rows and their acts, shared by the Cockpit's strip and the Office's notice
board), in the repo's comment style.

- [ ] **Step 3: Make `NeedsYouStrip` use the hook**

`NeedsYouStrip` becomes `const ny = useNeedsYou(model, onFocusAgent); if (ny.rows.length === 0) return null;` and
renders as before from `ny.*`. `LearnRow` is unchanged.

- [ ] **Step 4: Typecheck and run the strip's tests**

Run: `npx vitest run frontend/app/view/agents/needsyoustripmodel.test.ts`
Expected: PASS.
Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -- frontend/app/view/agents/needsyou.ts
git commit -m "refactor(cockpit): share the Needs you rows and acts through useNeedsYou" -- frontend/app/view/agents/needsyou.ts frontend/app/view/agents/needsyoustrip.tsx frontend/app/view/agents/attentionstore.ts
```

---

### Task 2: The board's dialog model, `officeboardmodel.ts`

**Depends on:** none

**Files:** `frontend/app/view/agents/officeboardmodel.ts`, `frontend/app/view/agents/officeboardmodel.test.ts`, `frontend/app/view/agents/officedialogmodel.ts`

What each file is for:
- Create: `frontend/app/view/agents/officeboardmodel.ts`
- Create: `frontend/app/view/agents/officeboardmodel.test.ts`
- Modify: `frontend/app/view/agents/officedialogmodel.ts` (two type unions)

- [ ] **Step 1: Widen the dialog types**

In `officedialogmodel.ts`: `DeskKind` gains `"board"`; `DialogItemId` gains `` `board:${BoardAct}` `` where
`BoardAct` is exported from `officeboardmodel.ts` (import the type only: `import type { BoardAct } from
"./officeboardmodel"`).

- [ ] **Step 2: Write the failing tests**

`officeboardmodel.test.ts`, building rows with a small `row(over: Partial<StripRow>): StripRow` helper (kindLabel
"Plan to review", tone "asking", source "Jarvis as graph", text "4 proposed", why "An agent proposed these chunks.",
waitingSince 0, act `{ label: "Open", kind: "open" }`, secondAct null, run `{} as AttentionRunRow`, open
`{ kind: "effort", effortId: "e1" }`, learnId null):

```ts
describe("boardItems", () => {
    it("is the row's act alone when the act is Open", () => {
        expect(boardItems(row({}), false).map((i) => [i.id, i.label])).toEqual([["board:act", "Open"]]);
    });
    it("is the act, the second act, then Open, as the strip's buttons", () => {
        const r = row({
            act: { label: "Start now", kind: "start-queued" },
            secondAct: { label: "Remove", kind: "remove-queued" },
            open: { kind: "channel", channelId: "c", runId: "r" },
        });
        expect(boardItems(r, false).map((i) => i.label)).toEqual(["Start now", "Remove", "Open"]);
    });
    it("leaves Open out when the row opens nothing", () => {
        const r = row({ act: { label: "Approve", kind: "approve-dag" }, open: null });
        expect(boardItems(r, false).map((i) => i.label)).toEqual(["Approve"]);
    });
    it("is empty when the row's only act is Open and it opens nothing", () => {
        expect(boardItems(row({ open: null }), false)).toEqual([]);
    });
    it("is Accept, Dismiss and a ruled-off Why for a learned rule, with no Edit", () => {
        const r = row({ kindLabel: "Learned rule", learnId: "l1", why: "“never stage files”" });
        const items = boardItems(r, false);
        expect(items.map((i) => i.id)).toEqual(["board:accept", "board:dismiss", "board:why"]);
        expect(items[2]).toMatchObject({ label: "Why", rule: true });
        expect(boardItems(r, true)[2].checked).toBe(true);
    });
    it("drops Why for a learned rule with no words behind it", () => {
        const r = row({ kindLabel: "Learned rule", learnId: "l1", why: "" });
        expect(boardItems(r, false).map((i) => i.id)).toEqual(["board:accept", "board:dismiss"]);
    });
    it("dims every item while the row's call is in flight", () => {
        const r = row({ act: { label: "Approve", kind: "approve-dag" }, open: null });
        expect(boardItems(r, false, true).every((i) => i.dim)).toBe(true);
    });
});

describe("boardPage", () => {
    it("clamps the page to the rows there are", () => {
        expect(boardPage(5, 3)).toBe(2);
        expect(boardPage(-1, 3)).toBe(0);
        expect(boardPage(0, 0)).toBe(-1);
    });
});

describe("boardTabs", () => {
    it("is the page's kind and which of how many, only with two rows or more", () => {
        const rows = [row({}), row({ kindLabel: "Run to land" })];
        expect(boardTabs(rows, 1)).toEqual({ head: "Run to land", at: 1, of: 2 });
        expect(boardTabs([row({})], 0)).toBeUndefined();
    });
});

describe("boardWords", () => {
    it("titles the page with its kind and source and shows the why, except a learned rule's until Why", () => {
        expect(boardWords(row({}), false)).toEqual({
            title: "Plan to review · Jarvis as graph",
            text: "4 proposed",
            why: "An agent proposed these chunks.",
            quote: undefined,
        });
        const learn = row({ kindLabel: "Learned rule", learnId: "l1", why: "“never stage files”" });
        expect(boardWords(learn, false).quote).toBeUndefined();
        expect(boardWords(learn, false).why).toBe("");
        expect(boardWords(learn, true).quote).toBe("“never stage files”");
    });
});

describe("boardCall", () => {
    it("maps each ▶ item to the strip handler it runs", () => {
        const r = row({
            act: { label: "Start now", kind: "start-queued" },
            secondAct: { label: "Remove", kind: "remove-queued" },
        });
        expect(boardCall(r, "board:act")).toEqual({ kind: "act", act: r.act });
        expect(boardCall(r, "board:act2")).toEqual({ kind: "act", act: r.secondAct });
        expect(boardCall(r, "board:open")).toEqual({ kind: "open" });
        expect(boardCall(r, "board:accept")).toEqual({ kind: "learn", accept: true });
        expect(boardCall(r, "board:dismiss")).toEqual({ kind: "learn", accept: false });
        expect(boardCall(r, "board:why")).toEqual({ kind: "why" });
    });
    it("is null for a second act the row lacks and for another desk's item", () => {
        expect(boardCall(row({}), "board:act2")).toBeNull();
        expect(boardCall(row({}), "reply")).toBeNull();
    });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeboardmodel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `officeboardmodel.ts`**

Pure, with the repo's header comment (cite the spec and the canvas's Dialog board). Exports:

```ts
export type BoardAct = "act" | "act2" | "open" | "accept" | "dismiss" | "why";

/** Pure: the ▶ menu of one page: the strip's buttons for its row, in their order. A learned rule is Accept, Dismiss
 *  and Why (its words) behind a rule; Edit needs typing, which the box has no place for, so it stays in Cards. */
export function boardItems(row: StripRow, whyOpen: boolean, busy = false): DialogItem[];
/** Pure: the page in range, -1 with no rows. */
export function boardPage(page: number, rows: number): number;
/** Pure: ◀ the page's kind ▶ and which of how many, over the ▶ menu; none for a single row. */
export function boardTabs(rows: readonly StripRow[], page: number): QuestionTabs | undefined;
export interface BoardWords { title: string; text: string; why: string; quote?: string }
/** Pure: the box's words. A learned rule's `why` is the person's own words: shown only once Why is picked. */
export function boardWords(row: StripRow, whyOpen: boolean): BoardWords;
export type BoardCall =
    | { kind: "act"; act: AttentionAct }
    | { kind: "open" }
    | { kind: "learn"; accept: boolean }
    | { kind: "why" };
/** Pure: which strip handler a ▶ item runs; null for an item that is not the board's, or a second act the row lacks.
 *  The Cockpit surface only switches on it (Task 4), so what each item does is pinned here. */
export function boardCall(row: StripRow, id: DialogItemId): BoardCall | null;
```

(`AttentionAct` is the type of `StripRow.act`, from `@/app/view/jarvis/attentionact`.)

Rules (they are what the tests pin):
- Non-learned row: `board:act` (label `row.act.label`) unless the act is `open` and `row.open` is null; then
  `board:act2` (label `row.secondAct.label`) when there is a second act; then `board:open` ("Open") when the act is
  not `open` and `row.open` is set.
- Learned row (`learnId != null`): `board:accept` "Accept", `board:dismiss` "Dismiss", and when `row.why` is not empty
  `board:why` "Why" with `rule: true` and `checked: whyOpen`.
- `busy` sets `dim: true` on every item.
- `boardWords`: `title` is `` `${row.kindLabel} · ${row.source}` `` (just the kind when the source is empty); for a
  learned row `why` is `""` and `quote` is `row.why` only when `whyOpen`; otherwise `why` is `row.why` and `quote`
  undefined.
- `boardCall`: `board:act` → the row's act; `board:act2` → its second act (null without one); `board:open` → open;
  `board:accept` / `board:dismiss` → learn with accept true / false; `board:why` → why; any other id → null.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/officeboardmodel.test.ts frontend/app/view/agents/officedialogmodel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- frontend/app/view/agents/officeboardmodel.ts frontend/app/view/agents/officeboardmodel.test.ts
git commit -m "feat(office): the notice board's dialog model" -- frontend/app/view/agents/officeboardmodel.ts frontend/app/view/agents/officeboardmodel.test.ts frontend/app/view/agents/officedialogmodel.ts
```

---

### Task 3: The board in the floor plan, and the boss standing at it

**Depends on:** none

**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/officeboss.ts`, `frontend/app/view/agents/officeboss.test.ts`, `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts`, `frontend/app/view/agents/cockpitoffice.tsx`

What each file is for:
- Modify: `frontend/app/view/agents/officeplanmodel.ts` (the `Plan` interface at :126, `buildPlan`'s return at
  ~:638)
- Modify: `frontend/app/view/agents/officeboss.ts` (`furniture` :49, `deskAt` :189, `cardAt` :212, `spotOf` :183)
- Modify: `frontend/app/view/agents/cockpitoffice.tsx` (the `officeMenuItems` caller, `OfficePopup`)
- Modify: `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/officeboss.test.ts`
- Modify: `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts` (menu item)

- [ ] **Step 1: Write the failing tests**

In `officeplanmodel.test.ts`, with any existing plan fixture:
- `plan.board.box` lies inside `plan.hall`, its top at least `plan.lounge.y + plan.lounge.h`, its left at
  `plan.hall.x + 8` (against the hall's left wall), and it overlaps no room, desk or lounger box.
- `plan.board.spot` is under the board (its x the board's centre, its y `board.box.y + board.box.h + 22`) and on
  the hall's floor (`canStand(plan, plan.board.spot)`).
- With a Home booth (an agent with no project) the board and its spot are still in the hall above the booth's top
  wall (`spot.y` below `top + bodyH - boothH - HWALL`), with the fewest bands (one project, one agent) and with several.

In `officeboss.test.ts`:
- `canWalk(plan, <the board box's centre>)` is false (the board is furniture) and `canWalk(plan, plan.board.spot)` is
  true.
- `deskAt(plan, plan.board.spot)` is `BOARD_KEY`; 60 px to the right of the spot it is `undefined`.
- `spotOf(plan, BOARD_KEY)` is `plan.board.spot`.
- `cardAt(plan, { at: plan.board.spot, path: [] }, BOARD_KEY)` is defined (`{ board: true }`); with the cursor on
  another desk it is undefined.
- `pathBetween(plan, <a desk's spot>, plan.board.spot)` ends at the board's spot and every point on it can be stood on.

In `officecontrols.test.ts`, update both `officeMenuItems` tests for the new third parameter `boardRows` and the item
`{ id: "needsYou", label: "Notice board", count: "3", ask: true }` placed second, right after "Next Needs you"; no key;
no count at 0.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeboss.test.ts frontend/app/view/agents/officecontrols.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `officeplanmodel.ts`: `export const BOARD_KEY = "board:needs-you";` (the board's cursor key; Task 4 and
  `officeboss.ts` import it from here), `export const BOARD_W = 96, BOARD_H = 96;` (the canvas's NoticeBoard board) and
  `board: { box: Box; spot: Point }` on `Plan`. In `buildPlan`: `box = { x: hallX + 8, y: top + LOUNGE_H + 16, w:
  BOARD_W, h: BOARD_H }`, `spot = { x: box.x + box.w / 2, y: box.y + box.h + 22 }`. Keep it clear of the lounge's
  `loungeMore` label and of the hall lane at `hall.x + hall.w - 36` (`officeboss.ts` `LANE_FROM_RIGHT`). The booth takes the hall's foot at the
  same left wall (its top wall at `top + bodyH - boothH - HWALL`), so add
  `LOUNGE_H + 16 + BOARD_H + 40 + (boothH ? boothH + HWALL : 0)` to the `Math.max` that sets `bodyH`
  (`officeplanmodel.ts:387-392`).
- `officeboss.ts`: import `BOARD_KEY` from `./officeplanmodel`. `furniture()`: add the board's box (padded the way the
  sofa's is, but never reaching `plan.board.spot`) so the boss cannot walk over it. `deskAt`: in the hall, return `BOARD_KEY` when `p` is within `REACH_X` /
  `REACH_Y` of `plan.board.spot`, before the `undefined`. `spotOf`: `BOARD_KEY` → `plan.board.spot`. `cardAt`: when
  `cursorId === BOARD_KEY` and the boss stands still at it, return `{ room: undefined, board: true }`; widen the
  return type to `{ desk?: Desk; seat?: Seat; room?: Room; board?: boolean }` and check each caller in
  `cockpitoffice.tsx` (`OfficePopup` reads `at.desk`; it must not draw a card or the "↵ Talk" prompt for the board,
  so make it return null when `at?.board`).
- `officecontrols.ts`: `OfficeMenuId` gains `"needsYou"`; `officeMenuItems(asks, newEvents, eventsOpen, boardRows)`
  puts `{ id: "needsYou", label: "Notice board", count: boardRows > 0 ? String(boardRows) : undefined, ask: true }`
  second. Update the one caller (`cockpitoffice.tsx:712`) to pass `props.boardRows ?? 0` (the prop arrives in Task 4;
  until then pass `0`).

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeboss.test.ts frontend/app/view/agents/officecontrols.test.ts frontend/app/view/agents/officebehavior.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(office): a notice board in the hall the boss can stand at" -- frontend/app/view/agents/officeplanmodel.ts frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeboss.ts frontend/app/view/agents/officeboss.test.ts frontend/app/view/agents/officecontrols.ts frontend/app/view/agents/officecontrols.test.ts frontend/app/view/agents/cockpitoffice.tsx
```

---

### Task 4: Draw the board and open its dialog in the Office

**Depends on:** Task 1, Task 2, Task 3

**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/officestore.ts`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `frontend/app/view/agents/officedialog.tsx`, `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts`

What each file is for:
- Modify: `frontend/app/view/agents/cockpitoffice.tsx` (the board's DOM layer, bubble, slips, prompt, handle)
- Modify: `frontend/app/view/agents/cockpitsurface.tsx`
- Modify: `frontend/app/view/agents/officestore.ts`
- Modify: `frontend/app/view/agents/usecockpitkeyboard.ts`
- Modify: `frontend/app/view/agents/officedialog.tsx` (the board's plate and body)
- Modify: `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts` (the board's frame and
  cork, drawn with the lounge)

- [ ] **Step 1: Page state**

`officestore.ts`: `officeBoardPageAtom = atom(0)` and `officeBoardWhyAtom = atom(false)` (the Why toggle of the page
in view; set back to false whenever the page changes).

- [ ] **Step 2: Draw the board**

The board is drawn in two parts, so the scenery does not redraw when a row comes or goes:

- **Frame and cork, in `scenery.ts`.** In `scenery()`, after the lounge (where the sofa, coffee machine and plant are
  drawn as `under.box` / `under.rect` ops), draw the board at `artBox(plan.board.box)` as the canvas's NoticeBoard
  board shows it: a dark-trimmed frame on two legs, cork inside, with its shadow. Roles from `officepalette.ts`:
  `trim` frame, `desk` cork, `ink` outlines (check each role exists; use the nearest existing one if not). Add
  `plan.board.box` to `sceneryKey`. `scenery.test.ts`: the ops include the board's box, and `sceneryKey` changes when
  `plan.board.box` moves.
- **Slips, in `cockpitoffice.tsx`.** A DOM layer over `plan.board.box`, placed the way the office places its other
  DOM over the plan (the desks' hit areas, the bubbles), carrying `data-office-board=""`: one paper slip per waiting
  row (three at most, `data-office-board-slip`), each with a pin, as small token-coloured boxes (`bg-office-*`
  utilities from the same roles: the cup colour for the paper, the sofa colour for the pin). It is also the board's
  click target.

Above it, while `boardRows > 0`, the bubble: the `asking`-tone `!` mark the asking desks use (`Bubble` with the ask
mark, `cockpitoffice.tsx:1442`) and beside it the count on the label plate (`bg-office-plate`, `text-asking`,
`tabular-nums`), `data-office-board-count`.

A click on the board calls `onPick(BOARD_KEY)`, as a desk click does (`cockpitoffice.tsx:830-836`, `pickRef`: `goTo`, then
`openDialog`, then `onCursor`), so the boss walks there and the box opens.

- [ ] **Step 3: The "↵ Read" prompt**

While the boss stands still at the board (`cardAt(...)?.board`), `layer === "walk"`, and rows wait, draw the same
prompt button `OfficePopup` draws for a desk (`cockpitoffice.tsx:1886-1912`, `data-office-prompt="board"`), verb
"Read", over the boss's head; its click calls `talk()`. Factor the prompt into a component both use rather than
copying it.

- [ ] **Step 4: The cursor stops at the board**

`CockpitOfficeProps` gains `boardRows: number`. The handle's `order()` returns `plan.order` plus `BOARD_KEY` at the end
while `boardRows > 0`, and so does `asks()` (`plan.asks` plus `BOARD_KEY`): the spec's "↑↓ and next-ask reach it",
so `n` (Next Needs you) comes to the board after the asking desks. Leave `plan.asks` itself alone; only the handle
adds the board. `goTo` / `showPath`
already resolve a key through `spotOf`, which knows the board after Task 3. Check that the Cockpit's cursor
(`cockpitsurface.tsx:341-342`, the office's stops) keeps `BOARD_KEY` as a valid cursor instead of resetting it.

- [ ] **Step 5: The board's dialog**

In `cockpitsurface.tsx`:
- Call `const ny = useNeedsYou(model, focusAgentCard)` once. Pass `boardRows={ny.rows.length}` to `CockpitOffice`.
- In `dialogFor(key)`, before the card lookup: when `key === BOARD_KEY`, read the page and Why atoms, clamp with
  `boardPage`, return null when there is no row, else:

```ts
const row = ny.rows[page];
const words = boardWords(row, why);
return {
    kind: "board",
    label: "Notice board",
    items: boardItems(row, why, ny.busy.has(row.key)),
    tabs: boardTabs(ny.rows, page),
    plate: <BoardPlate count={ny.rows.length} />,
    body: <BoardDialogBody words={words} row={row} now={ny.now} />,
    run: (id) => runBoardItem(row, id),
};
```

- `runBoardItem` only switches on `boardCall(row, id)` (Task 2): `act` → `ny.act(row, call.act)`; `open` →
  `ny.open(row)`; `learn` → `ny.decideLearn(row, call.accept)`; `why` → toggle `officeBoardWhyAtom`; null → nothing.
  A `work-on` act goes through `ny.act` too (it already calls `workOnDueChunk`).
- `officedialog.tsx`: `BoardPlate` (asking dot, "Notice board", "Needs you · N" in `text-warning tabular-nums`, as
  the canvas's Dialog board) and `BoardDialogBody` (the title line in the row's tone, the text at the agent box's
  main size, the why, the quote on `bg-surface-code` when Why is open, and "Waiting <age>" at the foot using
  `stripAge`). `OfficeDialogBox`'s ▶ frame width stays 268 px for `"board"`.

- [ ] **Step 6: Paging and closing**

- `OfficeHandle` gains `pageBoard(delta: -1 | 1)`: it steps `officeBoardPageAtom` by `delta`, clamped with
  `boardPage` against the row count, sets `officeBoardWhyAtom` false, and sets `selAtom` (module-local to
  `cockpitoffice.tsx`) back to 0, so the ▶ starts on the new page's first item as the canvas does (the render clamps
  it through `clampSel`).
- `usecockpitkeyboard.ts` `case "tab"`: when `cursorId === BOARD_KEY`, call `office.pageBoard(act.delta)`,
  `preventDefault`, and return.
- When the row count drops (a row acted on or gone) the page clamps through `boardPage` on the next render; when it
  reaches 0 rows, `dialogFor` returns null, so the box is no longer drawn and `boxLayer` reads it as walking. Also
  set the layer back to `"walk"` there so the next ↵ is a fresh talk: do it in `cockpitoffice.tsx` with an effect on
  `boardRows` reaching 0 while the cursor is the board.
- The ◀ ▶ of `QuestionTabsHead` are not clickable today; leave them so (the keys page).

- [ ] **Step 7: The office menu item and hiding the strip**

- `onOfficeMenu` (`cockpitsurface.tsx:489`): `case "needsYou"`: walk the boss to the board and open its box, as the
  board click in Step 2 does: expose `openBoard()` on the handle (it calls `onPick(BOARD_KEY)`) and use it there.
- Pass `props.boardRows` to `officeMenuItems` (`cockpitoffice.tsx:712`).
- Render `<NeedsYouStrip …/>` (`cockpitsurface.tsx:866`) only when `view !== "office"`.

- [ ] **Step 8: Typecheck and run the office's tests**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: exit 0.
Run: `npx vitest run frontend/app/view/agents/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(office): the Needs you notice board" -- frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/officestore.ts frontend/app/view/agents/usecockpitkeyboard.ts frontend/app/view/agents/officedialog.tsx frontend/app/view/office/scenery.ts frontend/app/view/office/scenery.test.ts
```

---

### Task 5: The `office-needs-you-board` scenario, changelog and docs

**Depends on:** Task 4

**Files:** `frontend/app/view/agents/cockpitofficedevhooks.ts`, `frontend/app/view/agents/cockpitoffice.tsx`, `scripts/cdp/cockpitofficescenarios.mjs`, `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/superpowers/specs/2026-10-15-cockpit-office-design.md`

What each file is for:
- Modify: `frontend/app/view/agents/cockpitofficedevhooks.ts` (the rows hook)
- Modify: `frontend/app/view/agents/cockpitoffice.tsx` (the probe object, `cockpitoffice.tsx:248`)
- Modify: `scripts/cdp/cockpitofficescenarios.mjs`
- Modify: `CHANGELOG.md`, `docs/keyboard-shortcuts.md` (if it lists the office menu)
- Modify: `docs/superpowers/specs/2026-10-15-cockpit-office-design.md` (one line pointing at the board spec where it
  describes the hall)

- [ ] **Step 1: A DEV hook for the rows**

`cockpitofficedevhooks.ts`: `window.__cockpitOfficeAttention = (items: AttentionItem[] | null) =>
globalStore.set(attentionFixtureAtom, items)`; declare it on `Window`. In `cockpitoffice.tsx`, extend the probe
object (`probe`, read by `readOfficeProbe`) with `board: { count, page, of, why }` from what the office drew, kept up
to date where the office already writes the probe.

- [ ] **Step 2: The scenario**

In `cockpitofficescenarios.mjs`, add `office-needs-you-board`, modelled on `cockpit-office-controls` (same arrange: the
office fixture, Office view, animation off). Arrange sets two rows through the hook, as the spec's Testing names:
- a `plan-review` item: source "Jarvis as graph", text "4 proposed", why "An agent proposed these chunks. They count
  once you accept them.", and `oref` `"effort:<id>"` (`buildNeedsYouRows` reads the effort from `oref`, not
  `effortoid`; without it the row opens nothing and its ▶ menu is empty). Use the id of an initiative the dev store
  has (read one in arrange the way other scenarios that open an initiative do; grep `scripts/cdp/` for one), so its
  Open lands;
- a `learn-proposal` with `learnid` and `why` "“never leave files staged”".

Teardown sets the hook back to `null`. Steps, each with a shot in `cdp-shots/`:

1. Office view: no `[data-cockpit-needs-you]` in the DOM; `[data-office-board]` drawn with two
   `[data-office-board-slip]`; `[data-office-board-count]` reads 2.
2. The cursor reaches the board: from a desk, `j` (or ↓) steps along `order()` until the cursor is `board:needs-you`
   (the probe's cursor, or the boss's spot under the board); then `n` from an asking desk also lands on the board
   after the asking desks.
3. A click on `[data-office-board]` from elsewhere in the office walks the boss to the board's spot and opens
   `[data-office-dialog="board"]` on page 1 of 2 ("Plan to review · Jarvis as graph", items `["Open"]`). Esc.
4. Office menu (`m`) lists "Notice board" second, with 2; picking it walks the boss to the board and opens the box on
   page 1 of 2.
5. → pages to "Learned rule" (items "Accept", "Dismiss", "Why"), the ▶ on Accept (the first item); ↓↓ ↵ on Why shows
   the quote; ← back to page 1 puts the ▶ on its first item again.
6. Esc closes the box; the "↵ Read" prompt (`[data-office-prompt="board"]`) shows; ↵ opens the box again.
7. ↵ on Open (page 1): it opens the initiative (read `openTarget` in `frontend/app/view/jarvis/openref.ts` for where
   an effort target lands, or, if the fixture's roster has an agent on that initiative, `buildNeedsYouRows` opens that
   agent instead) and the step asserts it landed there; then return to the Cockpit's Office view.
8. Clearing the rows (the hook with `[]`) closes any open box and drops the bubble and the slips; the board stays
   drawn.
9. Cards view (`o`) shows the strip with the same two rows when the hook is set again.

Open only loads and shows; do not press Accept or Dismiss: they call the server. `boardCall`'s unit tests (Task 2)
pin which handler each item runs, and the handlers are the strip's own.

- [ ] **Step 3: Run it**

Run: `node scripts/cdp/final-verify.mjs office-needs-you-board`
Expected: every step PASS. If no dev app can start on this machine, say so in the commit message and leave the
scenario in.

- [ ] **Step 4: Docs**

- `CHANGELOG.md` under `## Unreleased` → `Added`: "The Office has a notice board in the hall: what needs you waits
  there as pinned slips, and ↵ at the board pages through them with the same buttons the Cards view shows."
- `docs/keyboard-shortcuts.md`: the office menu's "Notice board" item, if the file lists the menu's items.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(office): office-needs-you-board scenario; changelog and docs for the notice board" -- frontend/app/view/agents/cockpitofficedevhooks.ts frontend/app/view/agents/cockpitoffice.tsx scripts/cdp/cockpitofficescenarios.mjs CHANGELOG.md docs/keyboard-shortcuts.md docs/superpowers/specs/2026-10-15-cockpit-office-design.md
```
