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
**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-controls cockpit-office-board`
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

**Files:**
- Create: `frontend/app/view/agents/needsyou.ts`
- Modify: `frontend/app/view/agents/needsyoustrip.tsx`
- Modify: `frontend/app/view/agents/attentionstore.ts`

The strip keeps rendering exactly as today; this task only moves code.

- [ ] **Step 1: Add a DEV fixture atom to `attentionstore.ts`**

Below `attentionLoadedAtom`, add:

```ts
// DEV only (the cockpit-office-board scenario): Needs you rows to show in place of the live list. null is live.
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

**Files:**
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
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeboardmodel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `officeboardmodel.ts`**

Pure, with the repo's header comment (cite the spec and the canvas's Dialog board). Exports:

```ts
export const BOARD_KEY = "board:needs-you";
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
```

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

**Files:**
- Modify: `frontend/app/view/agents/officeplanmodel.ts` (the `Plan` interface at :126, `buildPlan`'s return at
  ~:638)
- Modify: `frontend/app/view/agents/officeboss.ts` (`deskAt` :189, `cardAt` :212, `spotOf` :183)
- Modify: `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/officeboss.test.ts`
- Modify: `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts` (menu item)

- [ ] **Step 1: Write the failing tests**

In `officeplanmodel.test.ts`, with any existing plan fixture:
- `plan.board.box` lies inside `plan.hall`, its top at least `plan.lounge.y + plan.lounge.h`, its left at
  `plan.hall.x + 8` (against the hall's left wall), and it overlaps no room, desk or lounger box.
- `plan.board.spot` is under the board (its x the board's centre, its y `board.box.y + board.box.h + 22`) and on
  the hall's floor (`canStand(plan, plan.board.spot)`).
- With a Home booth (an agent with no project) the board is still in the hall above the booth.

In `officeboss.test.ts`:
- `deskAt(plan, plan.board.spot)` is `BOARD_KEY`; 60 px to the right of the spot it is `undefined`.
- `spotOf(plan, BOARD_KEY)` is `plan.board.spot`.
- `cardAt(plan, { at: plan.board.spot, path: [] }, BOARD_KEY)` is defined (`{ board: true }`); with the cursor on
  another desk it is undefined.
- `pathBetween(plan, <a desk's spot>, plan.board.spot)` ends at the board's spot and every point on it can be stood on.

In `officecontrols.test.ts`, update both `officeMenuItems` tests for the new third parameter `boardRows` and the item
`{ id: "board", label: "Notice board", count: "3", ask: true }` placed second, right after "Next Needs you"; no key;
no count at 0.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeboss.test.ts frontend/app/view/agents/officecontrols.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `officeplanmodel.ts`: `export const BOARD_W = 96, BOARD_H = 96;` (the canvas's NoticeBoard board) and
  `board: { box: Box; spot: Point }` on `Plan`. In `buildPlan`: `box = { x: hallX + 8, y: top + LOUNGE_H + 16, w:
  BOARD_W, h: BOARD_H }`, `spot = { x: box.x + box.w / 2, y: box.y + box.h + 22 }`. Keep it clear of the lounge's
  `loungeMore` label and of the hall lane at `hall.x + hall.w - 36` (`officeboss.ts` `LANE_FROM_RIGHT`). If the
  building is too short for it (the hall shorter than `LOUNGE_H + 16 + BOARD_H + 40`), grow `bodyH` the way the booth
  does (`officeplanmodel.ts:383-394`).
- `officeboss.ts`: import `BOARD_KEY`. `deskAt`: in the hall, return `BOARD_KEY` when `p` is within `REACH_X` /
  `REACH_Y` of `plan.board.spot`, before the `undefined`. `spotOf`: `BOARD_KEY` → `plan.board.spot`. `cardAt`: when
  `cursorId === BOARD_KEY` and the boss stands still at it, return `{ room: undefined, board: true }`; widen the
  return type to `{ desk?: Desk; seat?: Seat; room?: Room; board?: boolean }` and check each caller in
  `cockpitoffice.tsx` (`OfficePopup` reads `at.desk`; it must not draw a card or the "↵ Talk" prompt for the board,
  so make it return null when `at?.board`).
- `officecontrols.ts`: `OfficeMenuId` gains `"board"`; `officeMenuItems(asks, newEvents, eventsOpen, boardRows)`
  puts `{ id: "board", label: "Notice board", count: boardRows > 0 ? String(boardRows) : undefined, ask: true }`
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

**Files:**
- Modify: `frontend/app/view/agents/cockpitoffice.tsx`
- Modify: `frontend/app/view/agents/cockpitsurface.tsx`
- Modify: `frontend/app/view/agents/officestore.ts`
- Modify: `frontend/app/view/agents/usecockpitkeyboard.ts`
- Modify: `frontend/app/view/agents/officedialog.tsx` (the board's plate and body)
- Possibly create: a board sprite in `frontend/app/view/office/plansprite.ts` (see Step 2)

- [ ] **Step 1: Page state**

`officestore.ts`: `officeBoardPageAtom = atom(0)` and `officeBoardWhyAtom = atom(false)` (the Why toggle of the page
in view; set back to false whenever the page changes).

- [ ] **Step 2: Draw the board**

In `cockpitoffice.tsx`, in the hall's scenery layer (where the lounge's sofa and plant are drawn), draw the board at
`plan.board.box` as the canvas's NoticeBoard board shows it: a dark-trimmed frame on two legs, cork inside, and one
paper slip per waiting row (three at most), each with a pin. Draw it the way the office draws its other fixtures (look
at how the sofa, coffee machine and plants are drawn, sprite or boxes, and follow that; colours from
`officepalette.ts` roles: `trim` frame, `desk` cork, `cup` slips, `sofa` pins, `ink` outlines, in both phases). It
carries `data-office-board=""`.

Above it, while `boardRows > 0`, the bubble: the `asking`-tone `!` mark the asking desks use (`Bubble` with the ask
mark, `cockpitoffice.tsx:1442`) and beside it the count on the label plate (`bg-office-plate`, `text-asking`,
`tabular-nums`), `data-office-board-count`.

A click on the board calls the handle's `goTo(BOARD_KEY)` and then opens the dialog once the boss arrives: reuse how a
click on a desk walks the boss there and opens its box; if a desk click only walks, open the board's box on arrival in
`afterStop` when the arrival was a board click (a ref flag).

- [ ] **Step 3: The "↵ Read" prompt**

While the boss stands still at the board (`cardAt(...)?.board`), `layer === "walk"`, and rows wait, draw the same
prompt button `OfficePopup` draws for a desk (`cockpitoffice.tsx:1886-1912`, `data-office-prompt="board"`), verb
"Read", over the boss's head; its click calls `talk()`. Factor the prompt into a component both use rather than
copying it.

- [ ] **Step 4: The cursor stops at the board**

`CockpitOfficeProps` gains `boardRows: number`. The handle's `order()` returns `plan.order` plus `BOARD_KEY` at the end
while `boardRows > 0`; `asks()` is unchanged (the `n` key keeps jumping between asking desks). `goTo` / `showPath`
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

- `runBoardItem`: `board:act` → `ny.act(row, row.act)`; `board:act2` → `ny.act(row, row.secondAct!)`;
  `board:open` → `ny.open(row)`; `board:accept` / `board:dismiss` → `ny.decideLearn(row, accept)`; `board:why` →
  toggle `officeBoardWhyAtom`. A `work-on` act goes through `ny.act` too (it already calls `workOnDueChunk`).
- `officedialog.tsx`: `BoardPlate` (asking dot, "Notice board", "Needs you · N" in `text-warning tabular-nums`, as
  the canvas's Dialog board) and `BoardDialogBody` (the title line in the row's tone, the text at the agent box's
  main size, the why, the quote on `bg-surface-code` when Why is open, and "Waiting <age>" at the foot using
  `stripAge`). `OfficeDialogBox`'s ▶ frame width stays 268 px for `"board"`.

- [ ] **Step 6: Paging and closing**

- `usecockpitkeyboard.ts` `case "tab"`: when `cursorId === BOARD_KEY`, step `officeBoardPageAtom` by `act.delta`,
  clamped with `boardPage`, set `officeBoardWhyAtom` false, `preventDefault`, and return.
- When the row count drops (a row acted on or gone) the page clamps through `boardPage` on the next render; when it
  reaches 0 rows, `dialogFor` returns null, so the box is no longer drawn and `boxLayer` reads it as walking. Also
  set the layer back to `"walk"` there so the next ↵ is a fresh talk: do it in `cockpitoffice.tsx` with an effect on
  `boardRows` reaching 0 while the cursor is the board.
- The ◀ ▶ of `QuestionTabsHead` are not clickable today; leave them so (the keys page).

- [ ] **Step 7: The office menu item and hiding the strip**

- `onOfficeMenu` (`cockpitsurface.tsx:489`): `case "board"`: `officeRef.current?.showPath(BOARD_KEY)` then open the
  box on arrival, the same way as the board click in Step 2 (expose one handle method, `openBoard()`, that both use).
- Pass `props.boardRows` to `officeMenuItems` (`cockpitoffice.tsx:712`).
- Render `<NeedsYouStrip …/>` (`cockpitsurface.tsx:866`) only when `view !== "office"`.

- [ ] **Step 8: Typecheck and run the office's tests**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: exit 0.
Run: `npx vitest run frontend/app/view/agents/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(office): the Needs you notice board" -- frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/officestore.ts frontend/app/view/agents/usecockpitkeyboard.ts frontend/app/view/agents/officedialog.tsx
```

(add any sprite file you touched to the pathspec.)

---

### Task 5: The `cockpit-office-board` scenario, changelog and docs

**Depends on:** Task 4

**Files:**
- Modify: `frontend/app/view/agents/cockpitofficedevhooks.ts`
- Modify: `scripts/cdp/cockpitofficescenarios.mjs`
- Modify: `CHANGELOG.md`, `docs/keyboard-shortcuts.md` (if it lists the office menu), `docs/open-issues.md`
- Modify: `docs/superpowers/specs/2026-10-15-cockpit-office-design.md` (one line pointing at the board spec where it
  describes the hall)

- [ ] **Step 1: A DEV hook for the rows**

`cockpitofficedevhooks.ts`: `window.__cockpitOfficeAttention = (items: AttentionItem[] | null) =>
globalStore.set(attentionFixtureAtom, items)`; declare it on `Window`. Extend `readOfficeProbe` (or the probe object
in `cockpitoffice.tsx`) with `board: { count, page, of, why }` from what the office drew.

- [ ] **Step 2: The scenario**

In `cockpitofficescenarios.mjs`, add `cockpit-office-board`, modelled on `cockpit-office-controls` (same arrange: the
office fixture, Office view, animation off). Arrange sets three rows through the hook: a `plan-review` item (source
"Jarvis as graph", text "4 proposed", why "An agent proposed these chunks. They count once you accept them.",
`effortoid` set), a `run-land-held` item with `channelid` and `runid`, and a `learn-proposal` with `learnid` and `why`
"“never leave files staged”". Teardown sets the hook back to `null`. Steps, each with a shot in `cdp-shots/`:

1. Office view: no `[data-cockpit-needs-you]` in the DOM; `[data-office-board]` drawn; `[data-office-board-count]`
   reads 3.
2. Office menu (`m`) lists "Notice board" second, with 3; picking it walks the boss to the board and opens
   `[data-office-dialog="board"]` on page 1 of 3 ("Plan to review · Jarvis as graph", items `["Open"]`).
3. → pages to "Run to land" (items "Land again", "Open"); → again to "Learned rule" (items "Accept", "Dismiss",
   "Why"); ↓↓ ↵ on Why shows the quote.
4. Esc closes the box; the "↵ Read" prompt (`[data-office-prompt="board"]`) shows; ↵ opens the box again.
5. Clearing the rows (the hook with `[]`) closes the box and drops the bubble; the board stays drawn.
6. Cards view (`o`) shows the strip with the same three rows when the hook is set again.

Do not press Accept, Dismiss or Land again: they call the server. The unit tests cover what they run.

- [ ] **Step 3: Run it**

Run: `node scripts/cdp/final-verify.mjs cockpit-office-board`
Expected: every step PASS. If no dev app can start on this machine, say so in the commit message and leave the
scenario in.

- [ ] **Step 4: Docs**

- `CHANGELOG.md` under `## Unreleased` → `Added`: "The Office has a notice board in the hall: what needs you waits
  there as pinned slips, and ↵ at the board pages through them with the same buttons the Cards view shows."
- `docs/open-issues.md` "0 · Waiting on a hand check": `- [ ] (arcterm) Office notice board: walk to it, page with
  ← →, run Open, Land again and a learned rule's Accept from the box (run <run id>)`.
- `docs/keyboard-shortcuts.md`: the office menu's "Notice board" item, if the file lists the menu's items.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(office): cockpit-office-board scenario; changelog and docs for the notice board" -- frontend/app/view/agents/cockpitofficedevhooks.ts scripts/cdp/cockpitofficescenarios.mjs CHANGELOG.md docs/open-issues.md docs/keyboard-shortcuts.md docs/superpowers/specs/2026-10-15-cockpit-office-design.md
```
