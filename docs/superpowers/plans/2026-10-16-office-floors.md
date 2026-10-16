# Office Floors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cockpit office stops growing down: it becomes a building of floors, each one screen of four project
rooms around the hall, with a lift between floors, a run drawn as a meeting table inside its project's room, and rooms
the person arranges by keyboard (`g`) or by dragging, saved per viewer.

**Architecture:** A new pure model, `officelayout.ts`, holds the arrangement (project → floor and slot) and its moves.
`buildPlan` (`officeplanmodel.ts`) builds one floor from the cards and the placements: four slots, one room kind per
project with desks above and table zones below, capacity from the room's size, a `+N` chip for what does not fit, the
lift at the hall's foot, and a summary of every floor. `officeboss.ts` learns the new walls, the table zones (inside
their room), and the chip and the lift as places to stand. `scenery.ts` draws the floor. `officecontrols.ts` maps the
new keys (PageUp / PageDown, `g`, the carry layer). `cockpitoffice.tsx` wires the floor, the lift panel (the dialog box
machinery, kind `"lift"`), the ride, carrying and dragging rooms, and the chip's dialog.

**Tech Stack:** React 19 + Tailwind 4 + jotai, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-16-office-floors-design.md` and the canvas in the Prototype line (boards
`Main`, `LiftPanel`, `Ride`, `Drag`, `Capacity`, `Room`, `NoticeBoard`).

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-controls cockpit-office-board cockpit-office-floors`
**Prototype:** <repo>/.superpowers/design/office-floors/project/

## Global Constraints

- Frontend only. `Verify` names `./pkg/wconfig` only because `scripts/verify.mjs` needs one Go pattern; no Go changes.
- This plan starts after the Office Needs you board run (`0e23de6a`) has landed: `plan.board` (box and spot, key
  `BOARD_KEY`), the board's dialog (`kind: "board"`) and the `cockpit-office-board` scenario exist. Keep the board
  where that plan put it (`{ x: hallX + 8, y: top + LOUNGE_H + 16 }`), now on every floor; its rows stay global.
- Colours come from `@theme` tokens (`frontend/tailwindsetup.css`): the scenery uses the existing `--color-office-*`
  tokens through `officepalette.ts`, the ask marks the `asking` token, selection and drop targets grey (never the
  accent). No raw hex in components. The canvas's hex values are the token values, for reference only.
- Pure logic in `.ts` with a `.test.ts` beside it; no jsdom render tests (AGENTS.md, "Frontend conventions").
- Keyboard first: every act in this plan has a key; the mouse is a second way. Never bind `[` or `]` (Telex).
- The spec's sizes (desk pitch 116 × 110, desks from 104 px down a room, table zone 190 × 124) come from the canvas.
  If the real chibi sprites and labels overlap at those pitches (the no-overlap test says so), take the smallest
  pitch that passes and correct the numbers in the spec's "A room" section in the same commit.
- Run single test files with `npx vitest run <file>`; the typecheck is `task check:ts` (~2 min, give it a 5-minute
  timeout).
- Commit with a pathspec: `git commit -m "<msg>" -- <paths>` (add new files with `git add -- <paths>` first). Never
  leave files staged.

---

### Task 1: The arrangement model, `officelayout.ts`

**Depends on:** none

**Files:** `frontend/app/view/agents/officelayout.ts`, `frontend/app/view/agents/officelayout.test.ts`

What each file is for:
- Create: `frontend/app/view/agents/officelayout.ts`
- Create: `frontend/app/view/agents/officelayout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    EMPTY_LAYOUT,
    floorLabel,
    floorsShown,
    moveToFloor,
    newFloor,
    parseLayout,
    placeRooms,
    stepSlot,
    swapRooms,
} from "./officelayout";

const P = ["Home", "arcterm", "cuscofi", "mit", "vnstock"];

describe("parseLayout", () => {
    it("falls back to empty on junk", () => {
        expect(parseLayout(null)).toEqual(EMPTY_LAYOUT);
        expect(parseLayout("x")).toEqual(EMPTY_LAYOUT);
        expect(parseLayout({ v: 2, rooms: {} })).toEqual(EMPTY_LAYOUT);
    });
    it("drops entries that are not a floor and a slot", () => {
        const l = parseLayout({ v: 1, rooms: { a: { floor: 1, slot: 2 }, b: { floor: -1, slot: 0 }, c: { floor: 0, slot: 4 }, d: "x" } });
        expect(l.rooms).toEqual({ a: { floor: 1, slot: 2 } });
    });
});

describe("placeRooms", () => {
    it("arranges in the given order, four to a floor, from G up", () => {
        const { at } = placeRooms(EMPTY_LAYOUT, P);
        expect(at.Home).toEqual({ floor: 0, slot: 0 });
        expect(at.mit).toEqual({ floor: 0, slot: 3 });
        expect(at.vnstock).toEqual({ floor: 1, slot: 0 });
    });
    it("keeps a saved place and saves a newcomer's", () => {
        const saved = { v: 1 as const, rooms: { vnstock: { floor: 0, slot: 0 } } };
        const { at, layout } = placeRooms(saved, ["Home", "vnstock"]);
        expect(at.vnstock).toEqual({ floor: 0, slot: 0 });
        expect(at.Home).toEqual({ floor: 0, slot: 1 });
        expect(layout.rooms.Home).toEqual({ floor: 0, slot: 1 });
    });
    it("frees an absent project's slot and returns it there when still empty", () => {
        const saved = placeRooms(EMPTY_LAYOUT, ["a", "b"]).layout;
        const gone = placeRooms(saved, ["b", "c"]);
        expect(gone.at.c).toEqual({ floor: 0, slot: 0 });
        const back = placeRooms({ ...saved, rooms: { ...saved.rooms, c: { floor: 0, slot: 2 } } }, ["a", "b", "c"]);
        expect(back.at.a).toEqual({ floor: 0, slot: 0 });
    });
    it("sends a returning project to the first empty slot when its own is taken", () => {
        const saved = { v: 1 as const, rooms: { a: { floor: 0, slot: 0 }, c: { floor: 0, slot: 0 } } };
        const { at, layout } = placeRooms(saved, ["a", "c"]);
        expect(at.a).toEqual({ floor: 0, slot: 0 });
        expect(at.c).toEqual({ floor: 0, slot: 1 });
        expect(layout.rooms.c).toEqual({ floor: 0, slot: 1 });
    });
});

describe("moves", () => {
    const { layout, at } = placeRooms(EMPTY_LAYOUT, P);
    it("swaps two rooms", () => {
        const l = swapRooms(layout, at, "arcterm", { floor: 0, slot: 3 });
        expect(l.rooms.arcterm).toEqual({ floor: 0, slot: 3 });
        expect(l.rooms.mit).toEqual({ floor: 0, slot: 1 });
    });
    it("moves into an empty slot", () => {
        const l = swapRooms(layout, at, "arcterm", { floor: 1, slot: 2 });
        expect(l.rooms.arcterm).toEqual({ floor: 1, slot: 2 });
        expect(l.rooms.mit).toEqual({ floor: 0, slot: 3 });
    });
    it("moves to a floor's first empty slot, refusing a full floor", () => {
        expect(moveToFloor(layout, at, "vnstock", 0)).toBeNull();
        expect(moveToFloor(layout, at, "arcterm", 1)!.rooms.arcterm).toEqual({ floor: 1, slot: 1 });
    });
    it("builds the floor over the top one", () => {
        expect(newFloor(at)).toBe(2);
    });
    it("shows the floors with a room, G when none", () => {
        expect(floorsShown(at)).toEqual([0, 1]);
        expect(floorsShown({})).toEqual([0]);
    });
    it("steps a slot on the 2 × 2 grid, staying put at an edge", () => {
        expect(stepSlot(0, "right")).toBe(1);
        expect(stepSlot(0, "down")).toBe(2);
        expect(stepSlot(3, "right")).toBe(3);
        expect(stepSlot(3, "up")).toBe(1);
    });
    it("names floors G, 1, 2", () => {
        expect([0, 1, 2].map(floorLabel)).toEqual(["G", "1", "2"]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officelayout.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `officelayout.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's arrangement (office floors spec, "The arrangement" and "Arranging rooms"): which floor and
// slot each project's room takes, kept per viewer, and the moves the person makes. Pure: no React, no storage.

import type { Dir } from "./officeboss";

export const SLOTS = 4; // a floor is 2 x 2: slot = row * 2 + column
export interface RoomPlace {
    floor: number;
    slot: number;
}
export interface OfficeLayout {
    v: 1;
    rooms: Record<string, RoomPlace>;
}
export type Placements = Record<string, RoomPlace>;
export const EMPTY_LAYOUT: OfficeLayout = { v: 1, rooms: {} };

const isPlace = (p: unknown): p is RoomPlace =>
    p != null &&
    typeof p === "object" &&
    Number.isInteger((p as RoomPlace).floor) &&
    (p as RoomPlace).floor >= 0 &&
    Number.isInteger((p as RoomPlace).slot) &&
    (p as RoomPlace).slot >= 0 &&
    (p as RoomPlace).slot < SLOTS;

/** Pure: a stored arrangement, or the empty one for anything unreadable. */
export function parseLayout(raw: unknown): OfficeLayout {
    if (raw == null || typeof raw !== "object" || (raw as OfficeLayout).v !== 1) {
        return EMPTY_LAYOUT;
    }
    const rooms: Record<string, RoomPlace> = {};
    const src = (raw as OfficeLayout).rooms;
    if (src != null && typeof src === "object") {
        for (const [k, p] of Object.entries(src)) {
            if (isPlace(p)) {
                rooms[k] = { floor: p.floor, slot: p.slot };
            }
        }
    }
    return { v: 1, rooms };
}

const keyOf = (p: RoomPlace) => `${p.floor}:${p.slot}`;

function firstEmpty(taken: Set<string>, from = 0): RoomPlace {
    for (let floor = from; ; floor++) {
        for (let slot = 0; slot < SLOTS; slot++) {
            if (!taken.has(`${floor}:${slot}`)) {
                return { floor, slot };
            }
        }
    }
}

/** Pure: where the rooms on screen go. `projects` is the visible rooms in arranging order (Home first, then by
 *  name). A saved place is kept when no earlier project took it; the rest take the first empty slot from G up and are
 *  saved there. An absent project keeps its entry but holds no slot. */
export function placeRooms(layout: OfficeLayout, projects: readonly string[]): { at: Placements; layout: OfficeLayout } {
    const at: Placements = {};
    const taken = new Set<string>();
    for (const p of projects) {
        const saved = layout.rooms[p];
        if (saved && !taken.has(keyOf(saved))) {
            at[p] = saved;
            taken.add(keyOf(saved));
        }
    }
    const rooms = { ...layout.rooms };
    for (const p of projects) {
        if (at[p] == null) {
            at[p] = firstEmpty(taken);
            taken.add(keyOf(at[p]));
            rooms[p] = at[p];
        }
    }
    return { at, layout: { v: 1, rooms } };
}

/** Pure: `project` moved to `target`; the visible room there, if any, takes `project`'s place. */
export function swapRooms(layout: OfficeLayout, at: Placements, project: string, target: RoomPlace): OfficeLayout {
    const from = at[project];
    const other = Object.keys(at).find((k) => k !== project && keyOf(at[k]) === keyOf(target));
    const rooms = { ...layout.rooms, [project]: target };
    if (other && from) {
        rooms[other] = from;
    }
    return { v: 1, rooms };
}

/** Pure: `project` moved into the first empty slot of `floor`, or null when the floor is full. */
export function moveToFloor(layout: OfficeLayout, at: Placements, project: string, floor: number): OfficeLayout | null {
    const taken = new Set(Object.entries(at).filter(([k]) => k !== project).map(([, p]) => keyOf(p)));
    for (let slot = 0; slot < SLOTS; slot++) {
        if (!taken.has(`${floor}:${slot}`)) {
            return { v: 1, rooms: { ...layout.rooms, [project]: { floor, slot } } };
        }
    }
    return null;
}

/** Pure: the floor a room dropped on "+ New floor" builds. */
export function newFloor(at: Placements): number {
    return Math.max(-1, ...Object.values(at).map((p) => p.floor)) + 1;
}

/** Pure: the floors that hold a visible room, from G up; G alone when none does. */
export function floorsShown(at: Placements): number[] {
    const s = [...new Set(Object.values(at).map((p) => p.floor))].sort((a, b) => a - b);
    return s.length ? s : [0];
}

/** Pure: the slot one step toward dir on the 2 x 2 grid; at an edge it stays put. */
export function stepSlot(slot: number, dir: Dir): number {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    if (dir === "left" || dir === "right") {
        return row * 2 + (dir === "left" ? 0 : 1);
    }
    return (dir === "up" ? 0 : 1) * 2 + col;
}

export const floorLabel = (floor: number) => (floor === 0 ? "G" : String(floor));
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officelayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- frontend/app/view/agents/officelayout.ts frontend/app/view/agents/officelayout.test.ts
git commit -m "feat(office): the floors' arrangement model" -- frontend/app/view/agents/officelayout.ts frontend/app/view/agents/officelayout.test.ts
```

---

### Task 2: The office keys for floors, the lift and carrying a room

**Depends on:** none

**Files:** `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts`

What each file is for:
- Modify: `frontend/app/view/agents/officecontrols.ts`
- Test: `frontend/app/view/agents/officecontrols.test.ts`

- [ ] **Step 1: Write the failing tests** (add to `officecontrols.test.ts`)

- `officeKey("walk", false, "PageUp")` is `{ do: "floor", delta: 1 }`; `"PageDown"` is `{ do: "floor", delta: -1 }`.
- `officeKey("walk", false, "g")` is `{ do: "grab" }`.
- In the new layer `"carry"`: arrows give `{ do: "slot", dir }`; PageUp / PageDown `{ do: "floor", delta: ±1 }`;
  Enter `{ do: "drop" }`; Escape and `g` `{ do: "cancel" }`; `m`, `j`, `n`, `f` give `{ do: "none" }` (nothing else
  acts while a room is carried); a chord still passes.
- In the `"dialog"` layer PageUp / PageDown are `{ do: "pass" }` (no ride while a box is up).
- `officeMenuItems(...)` lists `{ id: "lift", label: "Lift", key: "PgUp PgDn" }`, `{ id: "move", label: "Move this
  room", key: "g" }` and `{ id: "arrange", label: "Arrange automatically" }` after the desk items, in that order.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/agents/officecontrols.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `OfficeLayer` gains `"carry"`. `OfficeKeyAction` gains `{ do: "floor"; delta: -1 | 1 }`, `{ do: "grab" }`,
  `{ do: "slot"; dir: Dir }`, `{ do: "drop" }`, `{ do: "cancel" }`.
- In `officeKey`, after the chord check and before the menu: when `layer === "carry"` return the carry mapping above.
  In the walk layer (after `m`, `j`/`k`, `n`, `f`, `h`/`l`), PageUp → `floor +1`, PageDown → `floor −1`, `g` → `grab`.
  The dialog and card layers do not take PageUp / PageDown / `g` (they fall to `pass`).
- `backFrom("carry")` is `"walk"`.
- `OfficeMenuId` gains `"lift" | "move" | "arrange"`; add the three items in `officeMenuItems` as above. Keep the
  existing items and their order.
- Update the file's header comment: the Game Boy controls plus the lift's PageUp / PageDown and `g` to carry a room.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officecontrols.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(office): keys for the lift and for carrying a room" -- frontend/app/view/agents/officecontrols.ts frontend/app/view/agents/officecontrols.test.ts
```

---

### Task 3: One floor in the plan

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `docs/superpowers/specs/2026-10-16-office-floors-design.md`

What each file is for:
- Modify: `frontend/app/view/agents/officeplanmodel.ts`
- Test: `frontend/app/view/agents/officeplanmodel.test.ts`
- Modify (only if the pitches change, see Global Constraints): `docs/superpowers/specs/2026-10-16-office-floors-design.md`

The plan builds one floor. Read `officeplanmodel.ts` whole first: `placeDesks`, `placeSeats`, the lounge spots and
`popupBox` stay; the band loop, the Home booth, `OTHER_RUNS` and the empty meeting room go.

- [ ] **Step 1: Rewrite the plan's tests for the floor** (`officeplanmodel.test.ts`)

Replace the band, booth and meeting-room tests; keep the lounge, poses (`agentLook`, `taskLook`, `screenCell`,
`runLit`) and `cut` tests. New cases, each through `buildPlan`:

- **Projects:** `projectsOf(agents, runs)` is Home first (when an agent or run has no project), then project names by
  `localeCompare`; agents and runs with no project are both Home's.
- **Slots:** with placements for 5 projects over floors 0 and 1, `buildPlan({ ..., floor: 0 })` has four rooms of kind
  `"agents"` at the four slots; slot 0 and 2 in the left column (door on the right, `doorSide: "right"`), 1 and 3 in
  the right column (`doorSide: "left"`); each door 60 px under its room's top. On floor 1 the three empty slots are
  rooms of kind `"empty"` titled `Empty room`, sub `Drag a room here`, `lit: false`.
- **Size:** at `width: 1050, height: 650` a room is about 390 × 300 (± the walls); at `1600 × 1000` about 660 × 480;
  at `900 × 400` a room is 317 wide and 300 tall (the minimum; the plan is taller than the view).
- **Capacity:** with 7 agents and 3 runs (one done): at 1050 × 650 the room seats 3 desks and 2 tables, the 2 tables
  the two runs at work, `room.chip` is `{ text: "+4 agents · +1 run", ask, key: "chip:<room key>" }`; at 1600 × 1000
  10 desks, 3 tables, chip `+1 run`. `ask` is true when a hidden agent asks or a hidden run's lead or task asks.
- **Stable places:** the same input with every working agent turned idle (and back) gives the same desks (key, x, y)
  and the same chip text.
- **Tables:** each run on a table is a room of kind `"meeting"` (key `meet:<run id>`, `runId`, `parent: <room key>`,
  box 190 × 124 at the room's foot, `table`, `screen` capped at 12 cells, `more` past 4 tasks); its seats have
  `room: <the project room's key>` and `zone: <the table's key>`; at most 5 seats (lead + 4).
- **No run, no table:** a project with no run has no `"meeting"` room, and its room has `plant` set.
- **No overlap:** in the 1050 × 650 and 1600 × 1000 floors, no two desks' boxes (desk + person + both label rows,
  `{ x: d.x - 8, y: d.y - 30, w: 96, h: 100 }`) overlap, and none overlaps a table zone.
- **The hall:** `plan.lounge` at the hall's top, `plan.board.box` under it (as the board plan placed it), `plan.lift`
  at the hall's foot: `lift.doors` (70 × 68), `lift.spot` on the hall's floor in front of them, `lift.dial` over them.
- **Floors summary:** `plan.floors` lists every floor that holds a room (from `floorsShown`), each `{ floor, label,
  rooms: string[], asks: number, lit: boolean }`; `plan.floor` is the floor built (clamped to the ones shown).
- **Asks elsewhere:** `plan.asks` holds this floor's asks (desks, seats, chips whose hidden ask makes them a stop);
  `plan.otherAsks` lists `{ key, floor }` for every ask on other floors, in floor order then office order.
- **Order:** `plan.order` walks the rooms by slot, each room's desks then its tables' seats then its chip.
- **G and above:** `plan.ground` is true only on floor 0, and `plan.entrance` is defined only then.
- **Popup side:** `popupBox` opens right of a left-column room and left of a right-column one (`doorSide`).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `PlanInput` gains `floor: number` and `at: Placements` (from `officelayout.ts`, `import type`).
- Export `projectsOf(agents, runs): string[]` (Home first, then names) — `cockpitoffice.tsx` passes it to
  `placeRooms`. Agents and runs with no project go to `HOME`; drop `OTHER_RUNS`.
- `RoomKind` becomes `"agents" | "meeting" | "lounge" | "empty"`; `Room` gains `parent?: string`, `chip?: { box: Box;
  spot: Point; key: string; text: string; ask: boolean; hidden: string[] }` (`hidden` the agent ids and run ids it
  holds, for its dialog), `plant?: Point`. `Seat` gains `zone: string`.
- Constants: `DESK_DX = 116`, `DESK_DY = 110`, `ROOM_TOP = 104`, `MEET_H = 124`, `TABLE_W = 190`, `ROOM_MIN_H = 300`,
  `TABLE_SEATS = 5` (lead + 4; replaces `MAX_SEATS`), `CHIP_KEY = (roomKey) => "chip:" + roomKey`, `LIFT_KEY =
  "lift"`. Remove `MEETING_H`, `BOOTH_W`, `OTHER_RUNS`.
- Geometry: `width` as today (≥ `MIN_W`), `colW` as today; `rowH = max(ROOM_MIN_H, floor((height − top − HWALL −
  FACADE_H − HWALL) / 2))`; `bodyH = 2 * rowH + HWALL`. Slot `s` is at column `s % 2`, row `floor(s / 2)`.
- Per slot on `input.floor`: the project placed there (from `input.at`) gets an `"agents"` room titled by its name
  with today's `sub` and lights rule (lit when an agent works or asks, or a run on a table is lit); no project, an
  `"empty"` room. Doors high on the hall-side wall (`y + 60`). Horizontal wall between the rows in each column.
- Capacity: `perRow = max(1, floor((w − 24) / DESK_DX))`, `rows = max(1, floor((h − MEET_H − 60) / DESK_DY))`,
  `tables = max(1, floor((w − 10) / TABLE_W))`. Seat the first `perRow * rows` agents by name with `placeDesks`
  (desk x `room.x + 24 + col * DESK_DX`, y `room.y + ROOM_TOP + row * DESK_DY`); runs sorted not-done first, then by
  start; the first `tables` get a `"meeting"` zone each (`x = room.x + 8 + i * TABLE_W`, `y = room.y + h − MEET_H`),
  pushed right after their room, with `placeSeats` (shown tasks `TABLE_SEATS − 1`) given the zone as its room and
  writing `room: <project room key>`, `zone: <zone key>` on each seat. The rest go in `chip` (text as the spec, `box`
  at the title row's right end, `spot` under it); the chip's key is in `order` (and in `asks` when `ask`).
- `plant`: when the first desk row is not full, at the room's top right (`{ x: room.x + w − 44, y: room.y + 64 }`);
  else when the room has no run, in the meeting strip's left. One plant at most.
- The hall: lounge and `board` as today; `hallFloor` is the whole hall (the booth is gone); `lift = { doors: { x:
  hallX + 20, y: top + bodyH − 68, w: 70, h: 68 }, dial: { x: hallX + 29, y: top + bodyH − 94, w: 52, h: 26 }, spot: {
  x: hallX + 55, y: top + bodyH − 84 } }` — adjust the spot so `canStand` holds for it (Task 4 tests it).
- `floors`, `floor`, `otherAsks`: build the per-floor summary from the cards and `input.at` without building the
  other floors' geometry (asks per room: asking agents + asking leads + asking tasks; lit as the room rule).
- `ground = input.floor === 0`; `entrance` only on G. `height = top + bodyH + FACADE_H` (the facade strip is drawn on
  every floor: brick on G, a plain wall above).
- `popupBox`: `right = room.doorSide !== "left"`.
- Update the file's header comment (one floor of four project rooms; see the floors spec).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(office): the plan builds one floor of four project rooms" -- frontend/app/view/agents/officeplanmodel.ts frontend/app/view/agents/officeplanmodel.test.ts docs/superpowers/specs/2026-10-16-office-floors-design.md
```

---

### Task 4: Walking a floor

**Depends on:** Task 3

**Files:** `frontend/app/view/agents/officeboss.ts`, `frontend/app/view/agents/officeboss.test.ts`

What each file is for:
- Modify: `frontend/app/view/agents/officeboss.ts`
- Test: `frontend/app/view/agents/officeboss.test.ts`

- [ ] **Step 1: Write the failing tests** (update `officeboss.test.ts` to floors built by `buildPlan` with placements)

- `roomAt` of a point in a table zone is the zone's project room (zones are not rooms one walks between).
- `pathBetween` from a desk's spot to a seat's spot in the same room is straight (`[from, to]`); between rooms in
  different columns it goes out one door, along the hall's lane, in the other.
- `deskAt(plan, seat.spot)` is the seat's key (its `room` is the project room).
- `deskAt(plan, room.chip.spot)` is the chip's key; `spotOf(plan, chipKey)` its spot; `cardAt` at the chip with the
  cursor on it returns `{ room, chip: true }`.
- `deskAt(plan, plan.lift.spot)` is `LIFT_KEY`, 60 px right of it `undefined`; `spotOf(plan, LIFT_KEY)` is the spot;
  `canStand(plan, plan.lift.spot)`.
- The board keeps its tests (it is on every floor).
- `furniture` includes each room's `plant` pot, not today's bottom-right one.
- An `"empty"` room can be walked into through its door.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeboss.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `roomAt`: skip rooms of kind `"lounge"` and `"meeting"`.
- `furniture`: plants from `room.plant`; tables from `"meeting"` rooms as today.
- `deskAt`: in a room, also consider the room's chip (reach as a desk); in the hall, the board (as the board plan
  did) and the lift. `spotOf` and `cardAt` learn the chip and the lift: `cardAt` returns `{ room, chip: true }` at a
  chip and `{ room: undefined, lift: true }` at the lift. Widen the return type the way the board plan widened it.
- `LANE_FROM_RIGHT`'s comment: the hall's walking lane, clear of the board and the lift.
- Header comment: walking one floor.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officeboss.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(office): the boss walks a floor: table zones, the chip and the lift" -- frontend/app/view/agents/officeboss.ts frontend/app/view/agents/officeboss.test.ts
```

---

### Task 5: Drawing a floor

**Depends on:** Task 3

**Files:** `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts`

What each file is for:
- Modify: `frontend/app/view/office/scenery.ts`
- Test: `frontend/app/view/office/scenery.test.ts`

Match the canvas's `Main`, `Room` and `Capacity` boards in the office's pixel art (the existing materials and ops).

- [ ] **Step 1: Write the failing tests** (update `scenery.test.ts`)

- An `"agents"` room's floor is `wood`; a `"meeting"` zone over it is `carpet` (drawn after its room); an `"empty"`
  room is `carpet` and is darkened (it is never lit).
- On G the foot strip is brick with the entrance's glass; above G it is the plain wall with windows and no entrance.
- The lift: the doors, the split between them, the call button, and the dial with its needle; the needle's angle
  follows `plan.floor` among `plan.floors` (G leftmost, the top floor rightmost).
- Plants are drawn at each `room.plant`, and nowhere else in the rooms.
- `sceneryKey` changes when `plan.floor` changes and when a room's chip text changes.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/office/scenery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Floors: `"agents"` → wood, `"meeting"` → carpet, `"empty"` → carpet; the Home booth's drawing goes.
- A meeting zone's screen: over its table (the zone's top), as today's wall screen but at the zone.
- The lift at `plan.lift`: steel doors (`metal`, `metalHi`), the split line, the call button beside them, the dial
  (`screen` face, `lamp` needle). Over the dial the label `Floor <n>` is the view's (Task 6), not the canvas's.
- The foot strip: on `plan.ground` today's facade (brick, the glass doors, the sign); otherwise the plain wall face
  with windows every 128 px.
- Plants from `room.plant`. Dark rooms: every room with `!lit` (empty rooms included), as today.
- Add `plan.floor`, the floors' labels and each room's `chip?.text` to `sceneryKey`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/office/scenery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(office): draw a floor: project rooms, table zones, the lift and the foot" -- frontend/app/view/office/scenery.ts frontend/app/view/office/scenery.test.ts
```

---

### Task 6: Floors and the lift in the Office

**Depends on:** Task 2, Task 4, Task 5

**Files:** `frontend/app/view/agents/officestore.ts`, `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `frontend/app/view/agents/officedialogmodel.ts`, `frontend/app/view/agents/officedialogmodel.test.ts`, `frontend/app/view/agents/cockpitofficedevhooks.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

What each file is for:
- Modify: `frontend/app/view/agents/officestore.ts`
- Modify: `frontend/app/view/agents/cockpitoffice.tsx`
- Modify: `frontend/app/view/agents/cockpitsurface.tsx`
- Modify: `frontend/app/view/agents/usecockpitkeyboard.ts`
- Modify: `frontend/app/view/agents/officedialogmodel.ts` (+ test)
- Modify: `frontend/app/view/agents/cockpitofficedevhooks.ts`
- Modify: `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

Shows in: the `cockpit-office-floors` scenario's steps 1–4 (Task 8), boards `Main`, `LiftPanel`, `Ride`.

- [ ] **Step 1: The atoms** (`officestore.ts`)

```ts
// the rooms' arrangement over the floors, per viewer (office floors spec, "The arrangement")
export const officeLayoutAtom = atomWithStorage<OfficeLayout>("cockpit.office.layout", EMPTY_LAYOUT, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<OfficeLayout>;
// the floor the office shows; not kept: the office opens on G
export const officeFloorAtom = atom(0) as PrimitiveAtom<number>;
```

Read the layout through `parseLayout` wherever it is used (atomWithStorage hands back whatever JSON was stored).

- [ ] **Step 2: Build the floor** (`cockpitoffice.tsx`, where `buildPlan` is called, ~line 511)

`const placed = useMemo(() => placeRooms(parseLayout(layout), projectsOf(agents, runs)), [...])`; pass `floor` (the
atom, clamped by the plan to the floors shown) and `placed.at` to `buildPlan`. In an effect, write `placed.layout` back
to `officeLayoutAtom` when it differs (`sameValues`), so a newcomer's place is saved.

- [ ] **Step 3: The lift panel's dialog** (`officedialogmodel.ts` + test, then `cockpitsurface.tsx`'s `dialogFor`)

Test first: `liftDialog(plan.floors, plan.floor)` gives `{ kind: "lift", title: "Lift", items }` with one item per
floor from the top down (`label: "Floor 2"` or `"Ground"`, `count` the floor's asks, `sub` its projects joined by `, `,
`current` on the shown floor, which cannot be picked), and the ▶ on the first floor that is not the current one.
Implement; `DeskKind` gains `"lift"`. In `dialogFor(LIFT_KEY)` return it. `OfficeDialogBox` draws a `"lift"` box as
the `LiftPanel` board: a round button per floor with its label (the current one lit), `! N` in the asking tone, the
projects' names under, and the keys line `PgUp PgDn ride · Esc stay`. Activating an item rides to it (Step 4).

- [ ] **Step 4: Ride** (`cockpitoffice.tsx`)

`ride(to)` on the handle: close the layer, then, with motion on, an overlay of two steel doors over the office's view
closes (`MOTION.durExit`), the dial label ticks floor by floor (`MOTION.durMacro` each), `officeFloorAtom` is set when
the doors are shut, and they open (`MOTION.durMacro`); the boss is placed at the new floor's `lift.spot`, facing down.
With reduced motion or the Office animation off: set the floor and place the boss at once. Draw over the dial the
label `Floor <n>` and beside the doors one amber line per other floor with asks (`▲ 1 on 2`, `▼ 2 on G`), from
`plan.floors`. The handle gains `ride(to: number)`, `floor(): number`, `floors(): FloorSummary[]`.

- [ ] **Step 5: Keys** (`usecockpitkeyboard.ts`)

`floor` → ride to the next shown floor up or down (no-op at the ends). `talk` at the lift opens the lift's dialog (as
`talk` at the board opens the board's). `nextAsk`: after this floor's asks, take `plan.otherAsks` in order; on another
floor, ride there and then `goTo` the key once the ride ends. The board stays in `order()` as the board plan left it.

- [ ] **Step 6: Menu** (`cockpitsurface.tsx`, `onOfficeMenu`)

`case "lift"`: `showPath(LIFT_KEY)` and open its dialog on arrival (as the board's menu item does). `"move"` and
`"arrange"` come in Task 7; until then they do nothing.

- [ ] **Step 7: Bindings and docs**

`bindings.ts`: `doc("cockpit:office-floor", "PageUp", "Office: ride the lift a floor up (PageDown: down); ↵ at the
lift opens its panel")`. `docs/keyboard-shortcuts.md`: the same line in the Office table.

- [ ] **Step 8: DEV hooks** (`cockpitofficedevhooks.ts`)

`__cockpitOffice({ floor: n })` sets the floor at once; `__cockpitOffice({ rideHold: true })` holds the next ride with
its doors shut until `{ rideHold: false }` (for the `Ride` board's shot). The probe gains `floor`, `floors` (labels),
`rooms` (each `{ key, kind, title, chip }`), `riding`.

- [ ] **Step 9: Typecheck, tests, try it**

Run: `npx vitest run frontend/app/view/agents/` and `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`.
Expected: PASS and exit 0. In the dev app with `npm run cockpit:fixtures -- office`, open Office, walk to the lift,
↵, ride to another floor and back with PageUp / PageDown.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(office): floors and the lift: the panel, the ride, PageUp / PageDown, next Needs you across floors" -- frontend/app/view/agents/officestore.ts frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/usecockpitkeyboard.ts frontend/app/view/agents/officedialogmodel.ts frontend/app/view/agents/officedialogmodel.test.ts frontend/app/view/agents/cockpitofficedevhooks.ts frontend/app/store/keybindings/bindings.ts docs/keyboard-shortcuts.md
```

---

### Task 7: Arranging rooms, and the chip's dialog

**Depends on:** Task 6

**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `frontend/app/view/agents/officedialogmodel.ts`, `frontend/app/view/agents/officedialogmodel.test.ts`, `frontend/app/view/agents/officestore.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

What each file is for:
- Modify: `frontend/app/view/agents/cockpitoffice.tsx`
- Modify: `frontend/app/view/agents/cockpitsurface.tsx`
- Modify: `frontend/app/view/agents/usecockpitkeyboard.ts`
- Modify: `frontend/app/view/agents/officedialogmodel.ts` (+ test)
- Modify: `frontend/app/view/agents/officestore.ts`
- Modify: `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

Shows in: the `cockpit-office-floors` scenario's steps 5–7 (Task 8), board `Drag`.

- [ ] **Step 1: The chip's dialog** (test first in `officedialogmodel.test.ts`)

`chipDialog(room, cards)` → `{ kind: "chip", title: "<room> · not at a desk", items }`, one item per hidden agent or
run (its name, its state word; asking ones first, in the asking tone). `dialogFor(chipKey)` returns it; activating an
item opens that card beside the chip (the popup machinery a desk uses, anchored at the chip's spot).

- [ ] **Step 2: Carrying a room by keyboard**

`officeCarryAtom = atom<Carry | null>(null)` in `officestore.ts`, `Carry = { project: string; from: RoomPlace; target:
RoomPlace | "new" }`. In `usecockpitkeyboard.ts`: `grab` in a project room (the boss's `roomAt`, an `"agents"` room)
sets it with `target = from` and the layer `"carry"`; outside a room it does nothing. `slot` → `stepSlot`; `floor` →
ride with the room to the next shown floor (past the top: `target = "new"`), the lift's dialog open as the map while
riding; `drop` → `swapRooms` (or, for `"new"`, place on `newFloor(at)` slot 0), write `officeLayoutAtom`, clear the
carry; `cancel` → clear it and ride back to `from.floor` when the floor changed. On a full floor the target stays on
its slots (a swap); the panel row says `Floor full` only for the mouse drop below.

Draw it as the `Drag` board: the origin slot dimmed with a dashed edge, the target slot grey with a dashed edge, and
in it the card `Moving <room>` / `Swap with <room>` (or `Put it here`) with the keys `← ↑ ↓ → slot · PgUp PgDn floor ·
↵ put down · Esc cancel`.

- [ ] **Step 3: Dragging by mouse**

Pointer down on a room's title label (in `Labels`), with a 4 px threshold, starts the same carry; the target follows
the slot under the pointer; the lift's dialog opens as drop targets (one row per floor, a full floor's row says
`Floor full` and takes no drop, `+ New floor` at the top); pointer up drops, Esc cancels. The card follows the pointer.

- [ ] **Step 4: Menu**

`case "move"`: as `g`. `case "arrange"`: set `officeLayoutAtom` to `EMPTY_LAYOUT` (the next build arranges
automatically). The menu item `Move this room` is disabled outside a project room.

- [ ] **Step 5: Bindings and docs**

`doc("cockpit:office-move", "g", "Office: pick up the room you are in to move it (← ↑ ↓ → a slot, PgUp PgDn a floor,
↵ put down, Esc cancel)")`, and the line in `docs/keyboard-shortcuts.md`.

- [ ] **Step 6: Typecheck, tests, try it**

Run: `npx vitest run frontend/app/view/agents/` and `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`.
Expected: PASS and exit 0. In the dev app: `g` in a room, ↓, ↵ swaps it; reload and the arrangement is still there;
`m` → Arrange automatically puts it back.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(office): arrange the rooms with g or by dragging, and the chip's dialog" -- frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/usecockpitkeyboard.ts frontend/app/view/agents/officedialogmodel.ts frontend/app/view/agents/officedialogmodel.test.ts frontend/app/view/agents/officestore.ts frontend/app/store/keybindings/bindings.ts docs/keyboard-shortcuts.md
```

---

### Task 8: The scenarios, the fixture, the changelog and the guide

**Depends on:** Task 7

**Files:** `scripts/cockpit-fixtures/scenarios.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/guide/cockpit.md`, `docs/open-issues.md`

What each file is for:
- Modify: `scripts/cockpit-fixtures/scenarios.mjs`
- Modify: `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cdp/scenarios.mjs`
- Modify: `CHANGELOG.md`, `docs/guide/cockpit.md`, `docs/open-issues.md`

- [ ] **Step 1: The `office-floors` fixture** (`scripts/cockpit-fixtures/scenarios.mjs`)

Nine projects over three floors as the canvas's `Main` board: Home, portfolio-journal, vnstock-js, vnstock-js-docs
(G); arcterm (7 agents, two asking, one of them past the desks), cuscofi-app (a lead asking, a task failed),
mit-thesis (one idle agent, no run), cuscofi-production (1); chotkeo (one asking) on floor 2. Runs through the office
runs hook the existing `OFFICE_RUNS` uses. Add it to the fixtures' scenario list; `npm run cockpit:fixtures` lists it.

- [ ] **Step 2: Update the existing office scenarios**

`cockpit-office`, `cockpit-office-controls`, `cockpit-office-bench` and `cockpit-office-board`
(`cockpitofficescenarios.mjs`) assert bands, meeting rooms and the Home booth today: rewrite those asserts for the
floor (rooms by slot, tables in rooms, Home a room). Clear `cockpit.office.layout` in each arrange step so every run
starts arranged automatically.

- [ ] **Step 3: The `cockpit-office-floors` scenario**, driven by keys (`Input.dispatchKeyEvent`), a shot per step:

1. Floor 1 at 1,440 × 900: four rooms; arcterm's chip `! +3 agents · +1 run`; `▲ 1 on 2` by the lift (board `Main`).
2. Walk to the lift, ↵: the lift's dialog with G, 1, 2 and `! 1` on 2 (board `LiftPanel`).
3. `rideHold`, ↓ then ↵ toward 2: the doors shut with the dial label (board `Ride`); release; floor 2 shows
   chotkeo and three empty rooms.
4. PageDown back to 1; `n` until the cursor is on chotkeo's ask: the office rides to 2.
5. In arcterm's room `g`, ↓, ↵: arcterm and mit-thesis swap (probe `rooms`); the shot taken before ↵ (board `Drag`).
6. Reload: the swap is still there; `m` → Arrange automatically puts it back.
7. The chip: walk to arcterm's chip, ↵: its dialog lists the hidden agents, the asking one first.
8. Capacity: `Emulation.setDeviceMetricsOverride` to 1,050 × 650 and to 1,600 × 1,000, one shot each (board
   `Capacity`): 3 desks + 2 tables, then 10 desks + 3 tables in arcterm's room.

Register it in `scripts/cdp/scenarios.mjs`. Run: `task verify:ui -- cockpit-office cockpit-office-controls
cockpit-office-board cockpit-office-floors` on the dev app; expected PASS.

- [ ] **Step 4: Bench and RAM watch**

Run `task verify:ui -- cockpit-office-bench`; write its numbers under **RAM watch** in `docs/open-issues.md`, dated,
next to the office's earlier line (one floor should draw fewer nodes than the whole plan did). A miss is reported, not
tuned away.

- [ ] **Step 5: Changelog and guide**

`CHANGELOG.md`, top section, `Changed`: "The Office is now a building of floors you ride a lift between: each project
is one room, its runs are meeting tables in it, and you arrange the rooms with g or by dragging." `docs/guide/cockpit.md`:
the Office section's floor plan paragraph rewritten for floors, the lift and arranging rooms, with the keys.

- [ ] **Step 6: Commit**

```bash
git commit -m "test(office): the floors scenario and fixture; changelog and guide" -- scripts/cockpit-fixtures/scenarios.mjs scripts/cdp/cockpitofficescenarios.mjs scripts/cdp/scenarios.mjs CHANGELOG.md docs/guide/cockpit.md docs/open-issues.md
```
