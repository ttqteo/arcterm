# Office Controls, Pokémon Style — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cockpit's Office plays like a 2D pixel game: ↵ at a desk opens a dialog box at the edge of the office
holding what the agent says and its numbers, with a ▶ menu of what you can do there (↑ ↓ pick, ↵ does it, Esc steps
back, f the full card); m opens an office menu as START does; the office fills the surface, its filters and switches in
a HUD bar inside the view, the footer holding only `m menu` and the newest event, and the Events rail hidden until the
menu asks for it.

**Architecture:** Two pure models carry the rules: `officecontrols.ts` (what a key does over the layer that is up, the
office menu, how the ▶ steps, which edge the box takes) and `officedialogmodel.ts` (the ▶ menu at each kind of desk, the
box's words). `officedialog.tsx` draws the game boxes (pixel frame, ▶ list, dialog box, office menu, HUD bar). The
office (`cockpitoffice.tsx`) keeps one layer state (`walk` / `dialog` / `card`) plus the menu, places the boxes over its
scroller, and exposes them through its handle; the Cockpit surface builds each desk's dialog from the same view models
its cards use, hands the office its HUD controls, and routes keys through `officeKey`.

**Tech Stack:** React 19 + Tailwind 4 + jotai, vitest, the CDP scenario harness.

**Spec:** the canvas in the Prototype line (boards Main, Run, StartMenu, States) and
`docs/superpowers/specs/2026-10-15-cockpit-office-design.md` (Task 6 brings its Keys and popup sections up to date).

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-controls`
**Prototype:** .superpowers/design/office-controls/project/

## Global Constraints

- Frontend only. `Verify` names `./pkg/wconfig` only because `scripts/verify.mjs` needs one Go pattern; this plan
  changes no Go, so at each merge it runs the vitest files the merge can reach.
- Colours come only from `@theme` tokens (`frontend/tailwindsetup.css`): no hex or rgba in components. The footer's key
  chip uses `bg-pill`.
- Inter for all text; `font-mono` only on keycaps (`<kbd>`). Numbers carry `tabular-nums`.
- Copy is verbatim from the canvas boards: `Talk`, `Answer`, `Send`, `Open`, `Open lead`, `Reply`, `Terminal`,
  `Background`, `Adjust`, `Full card`, `Next Needs you`, `Next desk`, `Previous desk`, `Events`, `Hide events`,
  `Cards view`, `All keys`, `menu`, `N new`, `· N more new`, `N more in the full card`. Sentence case.
- The game boxes share one frame: a 2 px `border-edge-strong` box on `bg-background`, a 2 px gap, then a 1 px
  `border-edge-mid` line (`PixelFrame`, Task 3). No hand-rolled shadow recipes: `shadow-popover` / `shadow-popover-sm`.
- The ▶ is drawn on a 4 × 7 grid at 2 px a cell (`PixelArrow`, Task 3); only the item under it shows its key, faint
  (`text-ink-faint`). The office menu shows every item's key.
- No new animation. The ↵ prompt keeps its bob on the office's frame clock; reduced motion changes nothing else.
- The Cards view looks and behaves as before: its header, chips and rail are unchanged.
- No new npm packages. On this 8 GB Mac prefix the typecheck with `NODE_OPTIONS=--max-old-space-size=4096`.
- Commits carry no Co-Authored-By or other attribution trailer.

## Review Focus

- **The desk changes under an open box** (quill is answered and goes to work, a run finishes, a worker leaves): the box
  rebuilds from the new state, the ▶ lands on an item that exists (`clampSel`, Task 2 tests), and a desk with no dialog
  any more leaves the office walking instead of throwing (Task 5, Step 3's `dialogFor` null path).
- **Typing in the full card** (Reply's composer, a task row's Tell input): the input owns `m`, `j`, `f`, `Esc` — they
  type, not act. The hook's early return covers it; Task 6's controls scenario types `m` into the composer and checks
  the menu stays shut.
- **A modifier chord in the office** (Cmd+F, Ctrl+M, Alt+J) passes through untouched: Task 1's `officeKey` test.
- **A short view, the boss low in it**: the box moves to the head of the view and never covers the boss
  (`dialogEdge` tests in Task 1; Task 6 step 7 checks the rects).
- **A question in several parts**: ← → and h l switch it inside the box, and the ▶ menu shows that question's answers
  (Task 2's `dialogItems` test with `activeQuestion: 1`).

---

### Task 1: Office keys, menu and ▶ model

**Depends on:** none
**Files:** `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts`

**Interfaces:**
- Consumes: `Dir` from `./officeboss` (`"up" | "down" | "left" | "right"`).
- Produces: `OfficeLayer`, `OfficeKeyAction`, `KeyMods`, `officeKey(layer, menuOpen, key, mods?)`, `backFrom(layer)`,
  `stepSel(sel, delta, enabled)`, `firstSel(enabled)`, `dialogEdge(bossY, scrollTop, viewportH)`, `OfficeMenuId`,
  `OfficeMenuItem`, `officeMenuItems(asks, newEvents, eventsOpen)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/view/agents/officecontrols.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { backFrom, dialogEdge, firstSel, officeKey, officeMenuItems, stepSel } from "./officecontrols";

describe("officeKey", () => {
    it("walks on the arrows and talks on Enter when nothing is up", () => {
        expect(officeKey("walk", false, "ArrowLeft")).toEqual({ do: "walk", dir: "left" });
        expect(officeKey("walk", false, "ArrowUp")).toEqual({ do: "walk", dir: "up" });
        expect(officeKey("walk", false, "Enter")).toEqual({ do: "talk" });
    });

    it("moves the ▶ on ↑ ↓, switches the question on ← →, and activates on Enter in the dialog box", () => {
        expect(officeKey("dialog", false, "ArrowUp")).toEqual({ do: "move", delta: -1 });
        expect(officeKey("dialog", false, "ArrowDown")).toEqual({ do: "move", delta: 1 });
        expect(officeKey("dialog", false, "ArrowLeft")).toEqual({ do: "tab", delta: -1 });
        expect(officeKey("dialog", false, "ArrowRight")).toEqual({ do: "tab", delta: 1 });
        expect(officeKey("dialog", false, "Enter")).toEqual({ do: "activate" });
    });

    it("walks away from the full card on the arrows and leaves Enter to the card", () => {
        expect(officeKey("card", false, "ArrowDown")).toEqual({ do: "walk", dir: "down" });
        expect(officeKey("card", false, "Enter")).toEqual({ do: "pass" });
    });

    it("steps back on Esc in every layer", () => {
        for (const layer of ["walk", "dialog", "card"] as const) {
            expect(officeKey(layer, false, "Escape")).toEqual({ do: "back" });
        }
    });

    it("keeps j k n f h l and m in every layer", () => {
        for (const layer of ["walk", "dialog", "card"] as const) {
            expect(officeKey(layer, false, "j")).toEqual({ do: "desk", delta: 1 });
            expect(officeKey(layer, false, "k")).toEqual({ do: "desk", delta: -1 });
            expect(officeKey(layer, false, "n")).toEqual({ do: "nextAsk" });
            expect(officeKey(layer, false, "f")).toEqual({ do: "card" });
            expect(officeKey(layer, false, "h")).toEqual({ do: "tab", delta: -1 });
            expect(officeKey(layer, false, "l")).toEqual({ do: "tab", delta: 1 });
            expect(officeKey(layer, false, "m")).toEqual({ do: "menu" });
        }
    });

    it("leaves the Cockpit's own keys to it", () => {
        for (const k of ["1", "9", "t", "r", "b", " "]) {
            expect(officeKey("walk", false, k)).toEqual({ do: "pass" });
            expect(officeKey("dialog", false, k)).toEqual({ do: "pass" });
            expect(officeKey("card", false, k)).toEqual({ do: "pass" });
        }
    });

    it("lets a chord through: Cmd+F, Ctrl+M and Alt+J are not the office's", () => {
        expect(officeKey("walk", false, "f", { meta: true })).toEqual({ do: "pass" });
        expect(officeKey("dialog", false, "m", { ctrl: true })).toEqual({ do: "pass" });
        expect(officeKey("card", false, "j", { alt: true })).toEqual({ do: "pass" });
    });

    it("gives every key to the open menu: ↑ ↓ move, Enter picks, Esc and m shut it, the rest do nothing", () => {
        expect(officeKey("dialog", true, "ArrowUp")).toEqual({ do: "move", delta: -1 });
        expect(officeKey("walk", true, "ArrowDown")).toEqual({ do: "move", delta: 1 });
        expect(officeKey("walk", true, "Enter")).toEqual({ do: "activate" });
        expect(officeKey("card", true, "Escape")).toEqual({ do: "menu" });
        expect(officeKey("walk", true, "m")).toEqual({ do: "menu" });
        for (const k of ["ArrowLeft", "ArrowRight", "1", "j", "f", "t"]) {
            expect(officeKey("walk", true, k)).toEqual({ do: "none" });
        }
    });
});

describe("backFrom", () => {
    it("steps the full card back to the dialog box and the box back to walking", () => {
        expect(backFrom("card")).toBe("dialog");
        expect(backFrom("dialog")).toBe("walk");
        expect(backFrom("walk")).toBe("walk");
    });
});

describe("stepSel and firstSel", () => {
    const enabled = [true, true, false, true];

    it("steps over an item the ▶ cannot rest on", () => {
        expect(stepSel(1, 1, enabled)).toBe(3);
        expect(stepSel(3, -1, enabled)).toBe(1);
    });

    it("stays put at either end", () => {
        expect(stepSel(0, -1, enabled)).toBe(0);
        expect(stepSel(3, 1, enabled)).toBe(3);
        expect(stepSel(1, 1, [true, true, false])).toBe(1);
    });

    it("starts on the first item it can rest on, 0 when none", () => {
        expect(firstSel([false, true, true])).toBe(1);
        expect(firstSel([false, false])).toBe(0);
        expect(firstSel([])).toBe(0);
    });
});

describe("dialogEdge", () => {
    it("takes the foot of the view while the boss stands in its upper half, the head once it stands lower", () => {
        expect(dialogEdge(200, 0, 800)).toBe("bottom");
        expect(dialogEdge(500, 0, 800)).toBe("top");
    });

    it("reads the boss against what is scrolled into view", () => {
        expect(dialogEdge(1300, 900, 800)).toBe("bottom");
        expect(dialogEdge(1400, 900, 800)).toBe("top");
    });
});

describe("officeMenuItems", () => {
    it("lists START's items with their keys, the desks asking and the events not seen", () => {
        const items = officeMenuItems(2, 3, false);
        expect(items.map((i) => i.label)).toEqual([
            "Next Needs you",
            "Next desk",
            "Previous desk",
            "Events",
            "Cards view",
            "All keys",
        ]);
        expect(items.map((i) => i.key)).toEqual(["n", "j", "k", undefined, "o", "?"]);
        expect(items[0]).toMatchObject({ count: "2", ask: true });
        expect(items[3]).toMatchObject({ count: "3 new", rule: true });
    });

    it("drops a zero count, and names Events Hide events while the rail is open", () => {
        const items = officeMenuItems(0, 0, false);
        expect(items[0].count).toBeUndefined();
        expect(items[3].count).toBeUndefined();
        const open = officeMenuItems(1, 4, true);
        expect(open[3]).toMatchObject({ id: "events", label: "Hide events", count: undefined });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/app/view/agents/officecontrols.test.ts`
Expected: FAIL with "Failed to resolve import "./officecontrols""

- [ ] **Step 3: Write the implementation**

Create `frontend/app/view/agents/officecontrols.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's controls, a Game Boy's: the arrows, ↵ as A and Esc as B, with m opening the office menu as START does
// (canvas .superpowers/design/office-controls). Pure: what a key does over the layer that is up, the office menu's
// items, how the ▶ steps, and which edge the dialog box takes. No React, no Wave runtime imports.

import type { Dir } from "./officeboss";

/** What is up over the office: nothing (the boss walks), the desk's dialog box, or the desk's full card. */
export type OfficeLayer = "walk" | "dialog" | "card";

export type OfficeKeyAction =
    | { do: "walk"; dir: Dir }
    | { do: "move"; delta: -1 | 1 }
    | { do: "tab"; delta: -1 | 1 }
    | { do: "activate" }
    | { do: "talk" }
    | { do: "card" }
    | { do: "back" }
    | { do: "menu" }
    | { do: "desk"; delta: -1 | 1 }
    | { do: "nextAsk" }
    | { do: "none" }
    | { do: "pass" };

export interface KeyMods {
    meta?: boolean;
    ctrl?: boolean;
    alt?: boolean;
}

const ARROWS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** Pure: what a key does in the office. The open menu takes every key; then the layer decides. "pass" leaves the key
 *  to the Cockpit's own (1–9, t, r, b, Space, and Enter on the full card). */
export function officeKey(layer: OfficeLayer, menuOpen: boolean, key: string, mods: KeyMods = {}): OfficeKeyAction {
    const plain = !mods.meta && !mods.ctrl && !mods.alt;
    const dir = ARROWS[key];
    if (menuOpen) {
        if (dir === "up" || dir === "down") {
            return { do: "move", delta: dir === "up" ? -1 : 1 };
        }
        if (key === "Enter") {
            return { do: "activate" };
        }
        if (key === "Escape" || (plain && key === "m")) {
            return { do: "menu" };
        }
        return { do: "none" };
    }
    if (key === "Escape") {
        return { do: "back" };
    }
    if (plain && key === "m") {
        return { do: "menu" };
    }
    if (plain && (key === "j" || key === "k")) {
        return { do: "desk", delta: key === "j" ? 1 : -1 };
    }
    if (plain && key === "n") {
        return { do: "nextAsk" };
    }
    if (plain && key === "f") {
        return { do: "card" };
    }
    if (plain && (key === "h" || key === "l")) {
        return { do: "tab", delta: key === "h" ? -1 : 1 };
    }
    if (layer === "dialog") {
        if (dir === "up" || dir === "down") {
            return { do: "move", delta: dir === "up" ? -1 : 1 };
        }
        if (dir) {
            return { do: "tab", delta: dir === "left" ? -1 : 1 };
        }
        return key === "Enter" ? { do: "activate" } : { do: "pass" };
    }
    if (dir) {
        return { do: "walk", dir };
    }
    return key === "Enter" && layer === "walk" ? { do: "talk" } : { do: "pass" };
}

/** Pure: one step back, as B does: the full card goes back to the dialog box, the dialog box to walking. */
export function backFrom(layer: OfficeLayer): OfficeLayer {
    return layer === "card" ? "dialog" : "walk";
}

/** Pure: the ▶ moved one step, over the items it cannot rest on; at either end it stays put. */
export function stepSel(sel: number, delta: -1 | 1, enabled: readonly boolean[]): number {
    for (let i = sel + delta; i >= 0 && i < enabled.length; i += delta) {
        if (enabled[i]) {
            return i;
        }
    }
    return sel;
}

/** Pure: where the ▶ starts: the first item it can rest on, 0 when there is none. */
export function firstSel(enabled: readonly boolean[]): number {
    const i = enabled.indexOf(true);
    return i < 0 ? 0 : i;
}

/** Pure: the dialog box sits at the foot of the office's view, and at its head once the boss stands in the view's
 *  lower half, so the box never hides the desk it talks about. bossY and scrollTop are in the scroller's content px. */
export function dialogEdge(bossY: number, scrollTop: number, viewportH: number): "top" | "bottom" {
    return bossY - scrollTop > viewportH / 2 ? "top" : "bottom";
}

export type OfficeMenuId = "nextAsk" | "nextDesk" | "prevDesk" | "events" | "cards" | "keys";

export interface OfficeMenuItem {
    id: OfficeMenuId;
    label: string;
    key?: string;
    // a count beside the label: the desks asking (drawn in the asking colour) or the events not yet seen
    count?: string;
    ask?: boolean;
    rule?: boolean;
}

/** Pure: the office menu (m), START's list. It names each item's own key, so it is where the keys are learnt. */
export function officeMenuItems(asks: number, newEvents: number, eventsOpen: boolean): OfficeMenuItem[] {
    return [
        { id: "nextAsk", label: "Next Needs you", key: "n", count: asks > 0 ? String(asks) : undefined, ask: true },
        { id: "nextDesk", label: "Next desk", key: "j" },
        { id: "prevDesk", label: "Previous desk", key: "k" },
        {
            id: "events",
            label: eventsOpen ? "Hide events" : "Events",
            count: !eventsOpen && newEvents > 0 ? `${newEvents} new` : undefined,
            rule: true,
        },
        { id: "cards", label: "Cards view", key: "o" },
        { id: "keys", label: "All keys", key: "?" },
    ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/app/view/agents/officecontrols.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/officecontrols.ts frontend/app/view/agents/officecontrols.test.ts
git commit -m "feat(office): the office's keys, menu and ▶ steps as a pure model"
```

---

### Task 2: The dialog box's ▶ menu and words

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/officedialogmodel.ts`, `frontend/app/view/agents/officedialogmodel.test.ts`, `frontend/app/view/agents/leadcardmodel.ts`, `frontend/app/view/agents/leadcard.tsx`

**Interfaces:**
- Consumes: `firstSel(enabled)` from `./officecontrols` (Task 1); `canSubmitAsk`, `displayAgeMs`, `formatAgeShort`,
  `latestMessageText`, `terminalAskNote`, `AgentEntry`, `AgentVM` from `./agentsviewmodel`; `REVIEW_ACTIONS`,
  `RowAction` from `./leadcardmodel`.
- Produces: `ROW_ACTION_LABEL: Record<RowAction, string>` (moved from `leadcard.tsx` into `leadcardmodel.ts`);
  `DeskKind = "agent" | "lead" | "worker" | "leadless"`; `DialogItemId`; `DialogItem`; `DialogInput`;
  `rowActionLabel(id)`; `dialogItems(input): DialogItem[]`; `enabledOf(items): boolean[]`;
  `clampSel(items, sel): number`; `selAfterActivate(items, sel): number`; `DialogWords`;
  `dialogWords(agent, entries, activeQuestion): DialogWords`; `agentMeta(agent, now): string`;
  `runTaskList<T>(rows, waiting, done, max): { heading: string; shown: T[]; more: number }`.

- [ ] **Step 1: Move the row action labels into the model**

In `frontend/app/view/agents/leadcardmodel.ts`, below `REVIEW_ACTIONS`, add:

```ts
// what a task row's action buttons say (the card's buttons and the Office's dialog box)
export const ROW_ACTION_LABEL: Record<RowAction, string> = {
    retry: "Retry",
    skip: "Skip",
    takeover: "Take over",
    tell: "Tell",
    resolve: "Continue",
};
```

In `frontend/app/view/agents/leadcard.tsx`, delete the local `const ACTION_LABEL: Record<RowAction, string> = {…}` block,
add `ROW_ACTION_LABEL` to the existing import from `./leadcardmodel`, and change its one use (`{ACTION_LABEL[a]}`) to
`{ROW_ACTION_LABEL[a]}`. Drop `RowAction` from that import if nothing else in the file uses it.

- [ ] **Step 2: Write the failing test**

Create `frontend/app/view/agents/officedialogmodel.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import {
    agentMeta,
    clampSel,
    dialogItems,
    dialogWords,
    enabledOf,
    rowActionLabel,
    runTaskList,
    selAfterActivate,
    type DialogInput,
} from "./officedialogmodel";

const agent = (over: Partial<AgentVM> = {}): AgentVM => ({ id: "a1", name: "loom", task: "tray", state: "working", ...over });
const quill = agent({
    id: "q1",
    name: "quill",
    state: "asking",
    blockedMs: 180_000,
    ask: {
        questions: [
            { question: "Merge into main now?", options: [{ label: "Merge it" }, { label: "Rebase on main first" }, { label: "Not yet" }] },
        ],
    },
});
const twoParts = agent({
    id: "q2",
    state: "asking",
    ask: {
        questions: [
            { question: "Branch?", options: [{ label: "Keep feat/tray" }, { label: "Rename to feat/tray-popover" }] },
            { question: "Tests?", multiSelect: true, options: [{ label: "Unit" }, { label: "CDP" }] },
        ],
    },
});
const base = (over: Partial<DialogInput>): DialogInput => ({ kind: "agent", activeQuestion: 0, selections: {}, texts: {}, ...over });
const labels = (input: DialogInput) => dialogItems(input).map((i) => i.label);

describe("dialogItems", () => {
    it("gives an agent at work Open, Reply, Terminal, Background, then the full card under a line", () => {
        const items = dialogItems(base({ agent: agent() }));
        expect(items.map((i) => i.label)).toEqual(["Open", "Reply", "Terminal", "Background", "Full card"]);
        expect(items.map((i) => i.key)).toEqual(["↵", "r", "t", "b", "f"]);
        expect(items.map((i) => !!i.rule)).toEqual([false, false, false, false, true]);
    });

    it("gives an asking agent its answers and Send, dim until something is picked, then Terminal under a line", () => {
        const items = dialogItems(base({ agent: quill }));
        expect(items.map((i) => i.label)).toEqual(["Merge it", "Rebase on main first", "Not yet", "Send", "Terminal", "Full card"]);
        expect(items.map((i) => i.key)).toEqual(["1", "2", "3", "↵", "t", "f"]);
        expect(items[3].dim).toBe(true);
        expect(items[4].rule).toBe(true);
        expect(items[5].rule).toBeFalsy();
    });

    it("marks a picked answer and lights Send", () => {
        const items = dialogItems(base({ agent: quill, selections: { 0: new Set([0]) } }));
        expect(items[0].checked).toBe(true);
        expect(items[1].checked).toBe(false);
        expect(items[3].dim).toBe(false);
    });

    it("shows the answers of the question its tab is on, and marks them as taking several", () => {
        const items = dialogItems(base({ agent: twoParts, activeQuestion: 1, selections: { 0: new Set([1]) } }));
        expect(items.slice(0, 2).map((i) => i.label)).toEqual(["Unit", "CDP"]);
        expect(items[0].multi).toBe(true);
        expect(items[2]).toMatchObject({ id: "send", dim: true });
    });

    it("gives an agent asking in its terminal Open, Reply and Terminal, and no Background", () => {
        expect(labels(base({ agent: agent({ state: "asking" }) }))).toEqual(["Open", "Reply", "Terminal", "Full card"]);
    });

    it("gives a run's lead Open lead, Reply, Terminal and Adjust when the run takes it", () => {
        const lead = agent({ id: "l1", state: "idle" });
        expect(labels(base({ kind: "lead", agent: lead, adjustable: true }))).toEqual([
            "Open lead",
            "Reply",
            "Terminal",
            "Adjust",
            "Full card",
        ]);
        expect(labels(base({ kind: "lead", agent: lead }))).toEqual(["Open lead", "Reply", "Terminal", "Full card"]);
    });

    it("leads a worker's seat with its row's own actions, numbered, then Open and Terminal under a line", () => {
        const items = dialogItems(
            base({ kind: "worker", agent: agent({ id: "w1" }), rowActions: ["approve", "sendback", "retry", "skip"], canOpen: true })
        );
        expect(items.map((i) => i.label)).toEqual(["Approve", "Send back", "Retry", "Skip", "Open", "Terminal", "Full card"]);
        expect(items.slice(0, 4).map((i) => i.key)).toEqual(["1", "2", "3", "4"]);
        expect(items[4].rule).toBe(true);
    });

    it("gives an asking worker its answers, its row's actions after them with no number", () => {
        const items = dialogItems(base({ kind: "worker", agent: quill, rowActions: ["tell"], canOpen: true }));
        expect(items.map((i) => i.label)).toEqual(["Merge it", "Rebase on main first", "Not yet", "Send", "Tell", "Terminal", "Full card"]);
        expect(items[4].key).toBeUndefined();
    });

    it("gives a seat with no worker, and a leadless run, only what they have", () => {
        expect(labels(base({ kind: "worker" }))).toEqual(["Full card"]);
        expect(labels(base({ kind: "leadless", adjustable: true }))).toEqual(["Adjust", "Full card"]);
        expect(labels(base({ kind: "leadless" }))).toEqual(["Full card"]);
    });
});

describe("the ▶ over the items", () => {
    const items = dialogItems(base({ agent: quill }));

    it("cannot rest on a dim Send", () => {
        expect(enabledOf(items)).toEqual([true, true, true, false, true, true]);
    });

    it("moves from an answer of a one-answer question to Send, and stays on any other item", () => {
        expect(selAfterActivate(items, 1)).toBe(3);
        expect(selAfterActivate(items, 4)).toBe(4);
        const multi = dialogItems(base({ agent: twoParts, activeQuestion: 1 }));
        expect(selAfterActivate(multi, 0)).toBe(0);
    });

    it("clamps a ▶ left past the end or on a dim item to the first item it can rest on", () => {
        expect(clampSel(items, 2)).toBe(2);
        expect(clampSel(items, 9)).toBe(0);
        expect(clampSel(items, 3)).toBe(0);
        expect(clampSel(items, -1)).toBe(0);
    });
});

describe("rowActionLabel", () => {
    it("names a review's choices and a row's actions as the card does", () => {
        expect(rowActionLabel("sendback")).toBe("Send back");
        expect(rowActionLabel("takeover")).toBe("Take over");
        expect(rowActionLabel("resolve")).toBe("Continue");
    });
});

describe("dialogWords", () => {
    const said = (text: string): AgentEntry => ({ kind: "message", text });

    it("puts an asking agent's question under what it said last", () => {
        expect(dialogWords(quill, [said("The branch is ready.")], 0)).toEqual({
            said: "The branch is ready.",
            main: "Merge into main now?",
        });
    });

    it("follows the question tab", () => {
        expect(dialogWords(twoParts, [], 1).main).toBe("Tests?");
    });

    it("says why the terminal holds the choices when the ask has none", () => {
        expect(dialogWords(agent({ state: "asking" }), [], 0).main).toBe("It asked in its terminal; the choices are there.");
    });

    it("gives an idle agent its last words, or its idle reason when it said nothing", () => {
        expect(dialogWords(agent({ state: "idle", activity: "done" }), [said("Shipped.")], 0)).toEqual({ said: "Shipped." });
        expect(dialogWords(agent({ state: "idle", activity: "done" }), [], 0)).toEqual({ said: "done" });
        expect(dialogWords(agent({ activity: "running vitest" }), [], 0)).toEqual({ said: undefined });
    });
});

describe("agentMeta", () => {
    it("joins the model, the context used and how long it has waited, worked or idled", () => {
        expect(agentMeta({ ...quill, model: "opus 5.5", usage: { contextpct: 21.4 } }, 0)).toBe("opus 5.5 · 21% context · waiting 3m");
        expect(agentMeta(agent({ activeMs: 720_000 }), 0)).toBe("12m");
        expect(agentMeta(agent({ state: "idle", idleSince: 0 }), 360_000)).toBe("idle 6m");
    });
});

describe("runTaskList", () => {
    it("lists the live rows, then the waiting ones, under a heading that counts them", () => {
        expect(runTaskList(["a"], ["b", "c"], [], 4)).toEqual({ heading: "Working · 1, waiting · 2", shown: ["a", "b", "c"], more: 0 });
        expect(runTaskList([], ["b", "c", "d", "e", "f"], [], 4)).toEqual({ heading: "Waiting · 5", shown: ["b", "c", "d", "e"], more: 1 });
        expect(runTaskList(["a", "b"], [], ["z"], 4)).toEqual({ heading: "Working · 2", shown: ["a", "b"], more: 0 });
    });

    it("falls back to the done rows, and to nothing before a plan", () => {
        expect(runTaskList([], [], ["x", "y"], 4)).toEqual({ heading: "Done · 2", shown: ["x", "y"], more: 0 });
        expect(runTaskList([], [], [], 4)).toEqual({ heading: "", shown: [], more: 0 });
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run frontend/app/view/agents/officedialogmodel.test.ts`
Expected: FAIL with "Failed to resolve import "./officedialogmodel""

- [ ] **Step 4: Write the implementation**

Create `frontend/app/view/agents/officedialogmodel.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's dialog box (canvas .superpowers/design/office-controls: Main, Run, States): what the ▶ menu holds at
// each kind of desk, where the ▶ goes after a pick, and the box's words. Pure: no React, no Wave runtime imports.

import {
    canSubmitAsk,
    displayAgeMs,
    formatAgeShort,
    latestMessageText,
    terminalAskNote,
    type AgentEntry,
    type AgentVM,
} from "./agentsviewmodel";
import { REVIEW_ACTIONS, ROW_ACTION_LABEL, type RowAction } from "./leadcardmodel";
import { firstSel } from "./officecontrols";

export type DeskKind = "agent" | "lead" | "worker" | "leadless";

export type DialogItemId =
    | "open"
    | "reply"
    | "terminal"
    | "background"
    | "adjust"
    | "card"
    | "send"
    | `opt:${number}`
    | `row:${number}`;

export interface DialogItem {
    id: DialogItemId;
    label: string;
    // the shortcut the item shows while the ▶ is on it
    key?: string;
    // drawn, but the ▶ passes over it: Send before every question has an answer
    dim?: boolean;
    // an answer already picked
    checked?: boolean;
    // a line above it, between the answers and what else the desk offers
    rule?: boolean;
    // an answer of a question that takes several
    multi?: boolean;
}

export interface DialogInput {
    kind: DeskKind;
    // who talks: the desk's agent, the run's lead, or the task's worker; none for a leadless run or a seat with no worker
    agent?: AgentVM;
    activeQuestion: number;
    selections: Record<number, Set<number>>;
    texts: Record<number, string>;
    // a task row's actions, in the order its number keys run them (rowKeyActions)
    rowActions?: string[];
    // the task row opens its worker (TaskRowVM.openId is set)
    canOpen?: boolean;
    // the run takes Adjust (runAdjustable)
    adjustable?: boolean;
}

/** Pure: a task row action's name, as the card's buttons say it. */
export function rowActionLabel(id: string): string {
    return REVIEW_ACTIONS.find(([a]) => a === id)?.[1] ?? ROW_ACTION_LABEL[id as RowAction] ?? id;
}

/** Pure: the ▶ menu of the desk at the boss: the answers first when someone asks (and a task row's own actions), then
 *  what else the desk offers, then the full card. A line parts the answers from the rest, or the rest from the card. */
export function dialogItems(input: DialogInput): DialogItem[] {
    const { kind, agent } = input;
    const qs = agent?.state === "asking" ? (agent.ask?.questions ?? []) : [];
    const answers: DialogItem[] = [];
    if (qs.length > 0) {
        const qi = Math.min(Math.max(input.activeQuestion, 0), qs.length - 1);
        const q = qs[qi];
        const picked = input.selections[qi] ?? new Set<number>();
        (q.options ?? []).forEach((o, oi) =>
            answers.push({ id: `opt:${oi}`, label: o.label, key: String(oi + 1), checked: picked.has(oi), multi: !!q.multiSelect })
        );
        answers.push({ id: "send", label: "Send", key: "↵", dim: !canSubmitAsk(qs, input.selections, input.texts) });
    }
    // an asking worker's number keys answer it, so its row's actions take no number then
    (input.rowActions ?? []).forEach((a, i) =>
        answers.push({ id: `row:${i}`, label: rowActionLabel(a), key: qs.length > 0 ? undefined : String(i + 1) })
    );
    const acts: DialogItem[] = [];
    if (agent && (kind !== "worker" || input.canOpen)) {
        if (qs.length === 0) {
            acts.push({ id: "open", label: kind === "lead" ? "Open lead" : "Open", key: "↵" });
            if (kind !== "worker") {
                acts.push({ id: "reply", label: "Reply", key: "r" });
            }
        }
        acts.push({ id: "terminal", label: "Terminal", key: "t" });
        if (kind === "agent" && agent.state !== "asking") {
            acts.push({ id: "background", label: "Background", key: "b" });
        }
    }
    if ((kind === "lead" || kind === "leadless") && input.adjustable) {
        acts.push({ id: "adjust", label: "Adjust" });
    }
    const card: DialogItem = { id: "card", label: "Full card", key: "f" };
    if (answers.length > 0) {
        return [...answers, ...[...acts, card].map((it, i) => (i === 0 ? { ...it, rule: true } : it))];
    }
    return acts.length > 0 ? [...acts, { ...card, rule: true }] : [card];
}

/** Pure: which items the ▶ can rest on. */
export function enabledOf(items: readonly DialogItem[]): boolean[] {
    return items.map((it) => !it.dim);
}

/** Pure: the ▶ kept on an item it can rest on: one left past the end (the desk changed under it) or on a dim item goes
 *  to the first it can rest on. */
export function clampSel(items: readonly DialogItem[], sel: number): number {
    return sel >= 0 && sel < items.length && !items[sel].dim ? sel : firstSel(enabledOf(items));
}

/** Pure: where the ▶ goes after ↵ on items[sel]: from an answer of a one-answer question to Send, so a second ↵ sends
 *  it; anywhere else it stays. */
export function selAfterActivate(items: readonly DialogItem[], sel: number): number {
    const it = items[sel];
    if (!it || !it.id.startsWith("opt:") || it.multi) {
        return sel;
    }
    const send = items.findIndex((x) => x.id === "send");
    return send < 0 ? sel : send;
}

export interface DialogWords {
    // what the agent said last, above the main line
    said?: string;
    // the line that matters: the question it asks, or why its terminal holds the choices
    main?: string;
}

/** Pure: the dialog box's words for an agent: its question under what it said last when it asks; else what it said
 *  last (an idle agent with nothing said gives its idle reason; a working one's activity line is drawn apart). */
export function dialogWords(agent: AgentVM, entries: AgentEntry[], activeQuestion: number): DialogWords {
    const said = latestMessageText(entries);
    if (agent.state === "asking") {
        const qs = agent.ask?.questions ?? [];
        const q = qs.length > 0 ? qs[Math.min(Math.max(activeQuestion, 0), qs.length - 1)] : undefined;
        return { said, main: q?.question ?? terminalAskNote(agent) };
    }
    return { said: said ?? (agent.state === "idle" ? agent.activity : undefined) };
}

/** Pure: the dialog box's foot line for an agent: its model, the context it has used, and how long it has waited,
 *  worked or idled. */
export function agentMeta(agent: AgentVM, now: number): string {
    const ctx = agent.usage?.contextpct;
    const age = displayAgeMs(agent, now);
    const verb = agent.state === "asking" ? "waiting " : agent.state === "idle" ? "idle " : "";
    return [
        agent.model,
        ctx != null ? `${Math.round(ctx)}% context` : undefined,
        age != null ? `${verb}${formatAgeShort(age)}` : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
}

/** Pure: a run's task column in the dialog box: the live rows, then the waiting ones (the done ones when nothing else
 *  is left), at most `max`, under a heading that counts them. Empty before a plan. */
export function runTaskList<T>(
    rows: T[],
    waiting: T[],
    done: T[],
    max: number
): { heading: string; shown: T[]; more: number } {
    const all = rows.length + waiting.length > 0 ? [...rows, ...waiting] : done;
    if (all.length === 0) {
        return { heading: "", shown: [], more: 0 };
    }
    const heading =
        rows.length > 0 && waiting.length > 0
            ? `Working · ${rows.length}, waiting · ${waiting.length}`
            : rows.length > 0
              ? `Working · ${rows.length}`
              : waiting.length > 0
                ? `Waiting · ${waiting.length}`
                : `Done · ${done.length}`;
    return { heading, shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/app/view/agents/officedialogmodel.test.ts frontend/app/view/agents/leadcard`
Expected: PASS (the new file, and the lead card's existing tests unchanged)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/agents/officedialogmodel.ts frontend/app/view/agents/officedialogmodel.test.ts frontend/app/view/agents/leadcardmodel.ts frontend/app/view/agents/leadcard.tsx
git commit -m "feat(office): the dialog box's ▶ menu at each kind of desk, and its words"
```

---

### Task 3: The game boxes

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/officedialog.tsx`, `frontend/app/view/agents/leadcard.tsx`

**Interfaces:**
- Consumes: `OfficeMenuItem` (Task 1); `DeskKind`, `DialogItem`, `DialogItemId`, `dialogWords`, `agentMeta`,
  `runTaskList` (Task 2); `LeadCardVM`, `TaskRowVM` from `./leadcardmodel`; `recentActions`, `AgentVM` from
  `./agentsviewmodel`; `entriesToShow` from `./agentrowmodel`; `entriesAtomFor` from `./livetranscriptatoms`;
  `diffStatsByIdAtom` from `./cardgitstore`; `cleanLabel` from `./answerbar`; `NarrationTimeline` from
  `./narrationtimeline`; `StatusLine`, `ActivityLine` from `./statusline`; `SubLabel` from `./sectionlabel`.
- Produces (from `officedialog.tsx`): `OfficeDialogVM { kind: DeskKind; label: string; plate: ReactNode; body: ReactNode;
  items: DialogItem[]; run: (id: DialogItemId) => void }`; `PixelFrame`; `PixelArrow`; `PickList`;
  `OfficeDialogBox({ vm, sel, onPick })`; `AgentPlate({ agent, nowAtom })`; `AgentDialogBody({ agent, nowAtom,
  activeQuestion })`; `RunPlate({ lead, title, nowAtom })`; `RunDialogBody({ vm, lead, activeQuestion })`;
  `WorkerDialogBody({ row, worker, nowAtom, activeQuestion })`; `OfficeMenuBox({ items, sel, onPick })`;
  `OfficeHudBar({ children })`.
- Produces (from `leadcard.tsx`): `export function LeadBar`, `export const TONE_DOT`, and `LeadCardProps.initialPanel?:
  "adjust"` (the full card opened by the dialog's Adjust starts with its Adjust panel open).

The boxes are drawn by Task 6's scenario steps: `cockpit-office-controls` steps 0 (HUD bar, Main and Run boards), 1 and
3 (the asking agent's box, Main and States), 5 (an agent at work, States), 6 (a run's lead, Run), 8 (the office menu,
StartMenu).

- [ ] **Step 1: Export the lead card's bar, dot tones and an opening panel**

In `frontend/app/view/agents/leadcard.tsx`:
- `const TONE_DOT: Record<RowTone, string> = {` → `export const TONE_DOT: Record<RowTone, string> = {`
- `function LeadBar({ strip, label }: …` → `export function LeadBar({ strip, label }: …`
- In `export interface LeadCardProps`, add:

```ts
    // the Office's dialog box opened this card from its Adjust: start with the Adjust panel open
    initialPanel?: "adjust";
```

- In `LeadCard`, change `useState<"adjust" | "cancel" | null>(null)` to
  `useState<"adjust" | "cancel" | null>(p.initialPanel ?? null)`.

- [ ] **Step 2: Write the boxes**

Create `frontend/app/view/agents/officedialog.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's game boxes (canvas .superpowers/design/office-controls): the pixel frame they share, the ▶ list, the
// dialog box of the desk at the boss with its words for an agent, a run's lead and a task's worker, the office menu
// (m) and the HUD bar. The rules are officecontrols.ts and officedialogmodel.ts; cockpitoffice.tsx places the boxes and
// cockpitsurface.tsx builds each desk's dialog.

import { cn } from "@/util/util";
import { useAtomValue, type Atom } from "jotai";
import { Check } from "lucide-react";
import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { entriesToShow } from "./agentrowmodel";
import { recentActions, type AgentVM } from "./agentsviewmodel";
import { cleanLabel } from "./answerbar";
import { diffStatsByIdAtom } from "./cardgitstore";
import { LeadBar, TONE_DOT } from "./leadcard";
import type { LeadCardVM, TaskRowVM } from "./leadcardmodel";
import { entriesAtomFor } from "./livetranscriptatoms";
import { NarrationTimeline } from "./narrationtimeline";
import type { OfficeMenuItem } from "./officecontrols";
import { agentMeta, dialogWords, runTaskList, type DeskKind, type DialogItem, type DialogItemId } from "./officedialogmodel";
import { SubLabel } from "./sectionlabel";
import { ActivityLine, StatusLine } from "./statusline";

/** What cockpitsurface.tsx hands the office for a desk: who talks, the box's plate and words, and its ▶ menu. */
export interface OfficeDialogVM {
    kind: DeskKind;
    label: string;
    plate: ReactNode;
    body: ReactNode;
    items: DialogItem[];
    run: (id: DialogItemId) => void;
}

/** The double line of a Game Boy box: a 2 px outer border, a 2 px dark gap, a faint inner line. */
export function PixelFrame({
    className,
    innerClassName,
    children,
    ...rest
}: HTMLAttributes<HTMLDivElement> & { innerClassName?: string }) {
    return (
        <div {...rest} className={cn("rounded-[3px] border-2 border-edge-strong bg-background p-[2px] shadow-popover", className)}>
            <div className={cn("h-full rounded-[1px] border border-edge-mid", innerClassName)}>{children}</div>
        </div>
    );
}

/** The ▶ (or ◀), on a 4 x 7 grid at 2 px a cell, so it stays crisp at any zoom. */
export function PixelArrow({ dir = "right", className }: { dir?: "left" | "right"; className?: string }) {
    const d = dir === "right" ? "M0 0H1V1H2V2H3V3H4V4H3V5H2V6H1V7H0Z" : "M4 0H3V1H2V2H1V3H0V4H1V5H2V6H3V7H4Z";
    return (
        <svg width="8" height="14" viewBox="0 0 4 7" shapeRendering="crispEdges" aria-hidden className={className}>
            <path d={d} fill="currentColor" />
        </svg>
    );
}

export interface PickRow {
    label: string;
    key?: string;
    dim?: boolean;
    checked?: boolean;
    rule?: boolean;
    count?: ReactNode;
}

/** A ▶ list: the item under the ▶ is bright; keys show on that item only, or on every item for the office menu. */
export function PickList({
    rows,
    sel,
    onPick,
    label,
    keys,
}: {
    rows: PickRow[];
    sel: number;
    onPick: (i: number) => void;
    label: string;
    keys: "selected" | "all";
}) {
    return (
        <div role="menu" aria-label={label} className="flex flex-col gap-px">
            {rows.map((r, i) => (
                <Fragment key={i}>
                    {r.rule ? <span className="mx-1.5 my-1 h-px shrink-0 bg-edge-mid" /> : null}
                    <button
                        type="button"
                        role="menuitem"
                        data-office-pick={i}
                        aria-current={i === sel || undefined}
                        aria-disabled={r.dim || undefined}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!r.dim) {
                                onPick(i);
                            }
                        }}
                        className={cn(
                            "flex h-7 shrink-0 items-center gap-2 rounded-[4px] border-0 bg-transparent px-1.5 text-left text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            i === sel
                                ? "cursor-pointer font-semibold text-primary"
                                : r.dim
                                  ? "cursor-default font-medium text-ink-faint"
                                  : "cursor-pointer font-medium text-secondary hover:text-primary"
                        )}
                    >
                        <span className="flex w-2.5 shrink-0 justify-center text-primary">
                            {i === sel ? <PixelArrow /> : null}
                        </span>
                        {r.checked ? (
                            <span className="flex size-3 shrink-0 items-center justify-center rounded-[3px] bg-accent text-background">
                                <Check size={9} strokeWidth={4} aria-hidden />
                            </span>
                        ) : null}
                        <span className="min-w-0 truncate">{r.label}</span>
                        {r.count}
                        {r.key && (keys === "all" || i === sel) ? (
                            <kbd className="ml-auto shrink-0 font-mono text-[10.5px] font-normal text-ink-faint">{r.key}</kbd>
                        ) : null}
                    </button>
                </Fragment>
            ))}
        </div>
    );
}

/** The dialog box: the plate on its top edge, the words and numbers on the left, the ▶ menu in its own frame. */
export function OfficeDialogBox({ vm, sel, onPick }: { vm: OfficeDialogVM; sel: number; onPick: (i: number) => void }) {
    return (
        <PixelFrame
            role="dialog"
            aria-label={vm.label}
            data-office-dialog={vm.kind}
            className="pointer-events-auto relative"
            innerClassName="flex max-h-[262px] min-h-[150px] gap-[22px] pb-4 pl-6 pr-4 pt-[26px]"
        >
            <div className="absolute -top-[15px] left-[18px] flex max-w-[70%] items-center gap-2 rounded-[3px] border-2 border-edge-strong bg-surface-raised px-2.5 py-1">
                {vm.plate}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">{vm.body}</div>
            <PixelFrame className="w-[268px] shrink-0 self-start shadow-none" innerClassName="px-3 py-2.5">
                <PickList
                    label={vm.label}
                    keys="selected"
                    sel={sel}
                    onPick={onPick}
                    rows={vm.items.map((it) => ({ ...it, label: it.id.startsWith("opt:") ? cleanLabel(it.label) : it.label }))}
                />
            </PixelFrame>
        </PixelFrame>
    );
}

/** An agent's plate: its status line (dot, runtime, name, project), its task, and Needs you while it asks. */
export function AgentPlate({ agent, nowAtom }: { agent: AgentVM; nowAtom: Atom<number> }) {
    return (
        <>
            <StatusLine agent={agent} nowAtom={nowAtom} className="min-w-0 shrink" />
            {agent.task ? <span className="min-w-0 truncate text-[12px] text-muted">{agent.task}</span> : null}
            {agent.state === "asking" ? (
                <span className="shrink-0 text-[11.5px] font-semibold text-warning">Needs you</span>
            ) : null}
        </>
    );
}

/** An agent's words: its live activity, what it said last, its question, its last steps and changes, then its model,
 *  context and age. */
export function AgentDialogBody({
    agent,
    nowAtom,
    activeQuestion,
}: {
    agent: AgentVM;
    nowAtom: Atom<number>;
    activeQuestion: number;
}) {
    const live = useAtomValue(entriesAtomFor(agent.id));
    const entries = entriesToShow(live, agent.previousInfo);
    const now = useAtomValue(nowAtom);
    const diff = useAtomValue(diffStatsByIdAtom)[agent.id];
    const words = dialogWords(agent, entries, activeQuestion);
    const steps = recentActions(entries, 3);
    return (
        <>
            {agent.state === "working" ? <ActivityLine agent={agent} nowAtom={nowAtom} /> : null}
            {words.said ? <p className="m-0 line-clamp-2 text-[14.5px] leading-[22px] text-secondary">{words.said}</p> : null}
            {words.main ? (
                <p className="m-0 line-clamp-2 text-[17px] font-semibold leading-6 text-primary">{words.main}</p>
            ) : null}
            {steps.length > 0 || diff ? (
                <div className="mt-1 flex min-h-0 flex-col gap-1 overflow-hidden rounded-md bg-surface-code px-3 py-2">
                    {steps.length > 0 ? <NarrationTimeline entries={steps} active={agent.state !== "idle"} /> : null}
                    {diff ? (
                        <span className="text-[12px] tabular-nums text-muted">
                            <span className="text-diff-added">+{diff.adds}</span>{" "}
                            <span className="text-diff-removed">−{diff.dels}</span>
                        </span>
                    ) : null}
                </div>
            ) : null}
            <div className="mt-auto truncate text-[11.5px] tabular-nums text-muted">{agentMeta(agent, now)}</div>
        </>
    );
}

/** A run's plate: its lead's status line, or the run's title when it has no lead. */
export function RunPlate({ lead, title, nowAtom }: { lead?: AgentVM; title: string; nowAtom: Atom<number> }) {
    return lead ? (
        <>
            <StatusLine agent={lead} nowAtom={nowAtom} className="min-w-0 shrink" />
            <span className="shrink-0 text-[12px] text-muted">lead</span>
        </>
    ) : (
        <b className="min-w-0 truncate text-[13.5px] font-semibold text-primary">{title}</b>
    );
}

function TaskLine({ row }: { row: TaskRowVM }) {
    return (
        <div data-office-task={row.taskId} className="flex h-7 shrink-0 items-center gap-2.5 px-1 text-[13px] text-secondary">
            <span className={cn("size-[7px] shrink-0 rounded-full", TONE_DOT[row.tone])} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className={cn("shrink-0 text-[11.5px] tabular-nums", row.needsYou ? "text-warning" : "text-muted")}>
                {row.tag ?? row.age ?? ""}
            </span>
        </div>
    );
}

/** A run's words: the lead's last line (and its question when it asks), the task bar and counts, the run's settings,
 *  and a column of its tasks. */
export function RunDialogBody({
    vm,
    lead,
    activeQuestion,
}: {
    vm: LeadCardVM;
    lead?: AgentVM;
    activeQuestion: number;
}) {
    const live = useAtomValue(entriesAtomFor(lead?.id ?? ""));
    const words = lead ? dialogWords(lead, entriesToShow(live, lead.previousInfo), activeQuestion) : {};
    const said = words.said ?? lead?.activity;
    const tasks = runTaskList(vm.rows, vm.waiting, vm.done, 4);
    return (
        <div className="flex min-h-0 flex-1 gap-[22px]">
            <div className="flex w-[330px] shrink-0 flex-col gap-2.5">
                {said ? <p className="m-0 line-clamp-3 text-[15px] leading-[22px] text-primary">{said}</p> : null}
                {words.main ? (
                    <p className="m-0 line-clamp-2 text-[15px] font-semibold leading-[22px] text-primary">{words.main}</p>
                ) : null}
                {vm.bar ? <LeadBar strip={vm.bar.strip} label={vm.bar.label} /> : null}
                <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate first-letter:uppercase",
                            vm.complete ? "text-success" : "text-accent-soft"
                        )}
                    >
                        {vm.activity}
                    </span>
                    <span className="shrink-0 tabular-nums">
                        {[vm.progress.total > 0 ? `${vm.progress.done}/${vm.progress.total}` : "", vm.elapsed, vm.cost]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                </div>
                <div title={vm.settingsTitle} className="mt-auto truncate text-[11.5px] tabular-nums text-muted">
                    {vm.settings}
                </div>
            </div>
            {tasks.shown.length > 0 ? (
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <SubLabel className="px-1 pb-1">{tasks.heading}</SubLabel>
                    {tasks.shown.map((r) => (
                        <TaskLine key={r.key} row={r} />
                    ))}
                    {tasks.more > 0 ? (
                        <span className="pl-[21px] pt-0.5 text-[11.5px] text-ink-faint">{tasks.more} more in the full card</span>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/** A task's seat: the task row's line and note, then its worker's words when it has one. */
export function WorkerDialogBody({
    row,
    worker,
    nowAtom,
    activeQuestion,
}: {
    row: TaskRowVM;
    worker?: AgentVM;
    nowAtom: Atom<number>;
    activeQuestion: number;
}) {
    return (
        <>
            <TaskLine row={row} />
            {row.sub ? <p className="m-0 line-clamp-2 px-1 text-[12.5px] text-muted">{row.sub}</p> : null}
            {worker ? <AgentDialogBody agent={worker} nowAtom={nowAtom} activeQuestion={activeQuestion} /> : null}
        </>
    );
}

/** The office menu (m): START's list, every item with its key. */
export function OfficeMenuBox({
    items,
    sel,
    onPick,
}: {
    items: OfficeMenuItem[];
    sel: number;
    onPick: (i: number) => void;
}) {
    return (
        <PixelFrame data-office-menu="" className="pointer-events-auto w-[268px]" innerClassName="px-3.5 py-3">
            <PickList
                label="Office"
                keys="all"
                sel={sel}
                onPick={onPick}
                rows={items.map((it) => ({
                    label: it.label,
                    key: it.key,
                    rule: it.rule,
                    count: it.count ? (
                        <span
                            className={cn(
                                "shrink-0 text-[11.5px] tabular-nums",
                                it.ask ? "font-semibold text-warning" : "font-normal text-muted"
                            )}
                        >
                            {it.count}
                        </span>
                    ) : undefined,
                }))}
            />
        </PixelFrame>
    );
}

/** The HUD bar inside the office's view: the office's clock and energy, then the Cockpit's filters and switches. */
export function OfficeHudBar({ children }: { children: ReactNode }) {
    return (
        <PixelFrame
            data-office-hud=""
            className="pointer-events-auto shadow-popover-sm"
            innerClassName="flex h-[42px] min-w-0 items-center gap-3.5 pl-4 pr-2.5 text-[12px] text-muted"
        >
            {children}
        </PixelFrame>
    );
}
```

- [ ] **Step 3: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 300000)
Expected: exit 0. Nothing renders these boxes yet; Task 5 wires them.

- [ ] **Step 4: Run the lead card's tests**

Run: `npx vitest run frontend/app/view/agents/leadcard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/officedialog.tsx frontend/app/view/agents/leadcard.tsx
git commit -m "feat(office): the game boxes: pixel frame, ▶ list, dialog box, office menu, HUD bar"
```

---

### Task 4: The footer's office line and the Events list hook

**Depends on:** none
**Files:** `frontend/app/view/agents/cockpitevents.ts`, `frontend/app/view/agents/cockpitevents.test.ts`, `frontend/app/view/agents/cockpiteventsrail.tsx`, `frontend/app/view/agents/cockpithelp.tsx`, `frontend/app/view/agents/officestore.ts`

**Interfaces:**
- Consumes: `RailEvent` (existing, `./cockpitevents`); `formatAgeShort` from `./agentsviewmodel`.
- Produces: `footerEvent(all: RailEvent[], fresh: RailEvent[]): FooterEvent | null` and `FooterEvent { event:
  RailEvent; moreNew: number }` in `cockpitevents.ts`; `useRailEvents(lineage, runEvents): { all: RailEvent[]; fresh:
  RailEvent[]; old: RailEvent[] }` and `RAIL_KIND` (the rail's `KIND`, renamed and exported) in
  `cockpiteventsrail.tsx`; `OfficeFooter { event: FooterEvent | null; onMenu: () => void; onEvents: () => void }` and
  `HintsBar`'s new optional `office?: OfficeFooter` prop in `cockpithelp.tsx`; `officeEventsOpenAtom` in
  `officestore.ts`.

The footer is drawn by Task 6's `cockpit-office-controls` steps 0 and 10.

- [ ] **Step 1: Write the failing test**

Append to `frontend/app/view/agents/cockpitevents.test.ts` (add `footerEvent` to its import from `./cockpitevents`):

```ts
describe("footerEvent", () => {
    const ev = (key: string, ts: number): RailEvent => ({ key, who: "loom", kind: "finished", text: "", ts });

    it("is nothing while there are no events", () => {
        expect(footerEvent([], [])).toBeNull();
    });

    it("gives the newest event and how many more came since the rail was last read", () => {
        const a = ev("a", 3);
        const b = ev("b", 2);
        const c = ev("c", 1);
        expect(footerEvent([a, b, c], [a, b, c])).toEqual({ event: a, moreNew: 2 });
        expect(footerEvent([a, b, c], [a])).toEqual({ event: a, moreNew: 0 });
    });

    it("counts none more when everything was read", () => {
        const a = ev("a", 3);
        expect(footerEvent([a], [])).toEqual({ event: a, moreNew: 0 });
    });
});
```

If the test file does not import `RailEvent` yet, add `type RailEvent` to that import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/app/view/agents/cockpitevents.test.ts`
Expected: FAIL with "footerEvent is not a function" (or an import error naming `footerEvent`)

- [ ] **Step 3: Add `footerEvent`**

Append to `frontend/app/view/agents/cockpitevents.ts`:

```ts
export interface FooterEvent {
    event: RailEvent;
    moreNew: number;
}

/** Pure: the Office footer's line: the newest event, and how many more came since the rail was last read. */
export function footerEvent(all: RailEvent[], fresh: RailEvent[]): FooterEvent | null {
    if (all.length === 0) {
        return null;
    }
    return { event: all[0], moreNew: Math.max(0, fresh.length - (fresh.includes(all[0]) ? 1 : 0)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/app/view/agents/cockpitevents.test.ts`
Expected: PASS

- [ ] **Step 5: Lift the rail's list into a hook, and export its kinds**

In `frontend/app/view/agents/cockpiteventsrail.tsx`:
- Rename `const KIND` to `export const RAIL_KIND` and update its uses in the file.
- Add, above `CockpitEventsRail`:

```tsx
/** The Events rail's list: plain agents' changes and every run's engine events, newest first, split at the last read.
 *  The rail draws it; the Office's footer shows its newest line. */
export function useRailEvents(
    lineage: Lineage,
    runEvents: Record<string, RunEvent[]>
): { all: RailEvent[]; fresh: RailEvent[]; old: RailEvent[] } {
    const agentEvents = useAtomValue(agentEventsAtom);
    const seenTs = useAtomValue(seenTsAtom);
    const all = useMemo(() => {
        const leadOf = (runId: string) =>
            Object.entries(lineage.roles).find(([, r]) => r.kind === "lead" && r.runId === runId)?.[0];
        const runLists = Object.values(lineage.runs).map((r) =>
            runRailEvents(r, runEvents[r.runId] ?? [], leadOf(r.runId))
        );
        return mergeRailEvents([agentEvents, ...runLists]);
    }, [agentEvents, lineage, runEvents]);
    return { all, ...splitUnread(all, seenTs) };
}
```

- In `CockpitEventsRail`, replace the `agentEvents` / `seenTs` reads, the `all` memo and the `splitUnread` line with
  `const { all, fresh, old } = useRailEvents(lineage, runEvents);`. Keep `seenTsAtom` writes (the mark-all-read button)
  as they are.

- [ ] **Step 6: Add the Office events atom**

Append to `frontend/app/view/agents/officestore.ts` (add `atom` to the jotai import):

```ts
// the Events rail while the Cockpit shows Office: hidden there until the office menu's Events (or the footer's event
// line) shows it; Esc while walking hides it again. Not kept: Office opens with the rail hidden.
export const officeEventsOpenAtom = atom(false) as PrimitiveAtom<boolean>;
```

- [ ] **Step 7: Give the hints bar its Office line**

In `frontend/app/view/agents/cockpithelp.tsx`, add the imports
`import { useAtomValue } from "jotai";`, `import { cn } from "@/util/util";`,
`import { formatAgeShort } from "./agentsviewmodel";`, `import type { FooterEvent } from "./cockpitevents";` and
`import { RAIL_KIND } from "./cockpiteventsrail";`, then:

```tsx
/** What the hints bar shows while the Cockpit shows Office: the office menu's key and the newest event. */
export interface OfficeFooter {
    event: FooterEvent | null;
    onMenu: () => void;
    onEvents: () => void;
}

// in Office the bar teaches one key, m, as a game shows START; the office menu lists the rest. The newest event sits
// beside it, so the hidden Events rail still says that something happened
function OfficeFooterLine({ model, office }: { model: AgentsViewModel; office: OfficeFooter }) {
    const now = useAtomValue(model.structuralNowAtom);
    const e = office.event?.event;
    const k = e ? RAIL_KIND[e.kind] : undefined;
    const more = office.event?.moreNew ?? 0;
    return (
        <>
            <button
                type="button"
                data-office-footer-menu=""
                onClick={office.onMenu}
                title="Office menu (m)"
                className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-muted hover:text-primary"
            >
                <span className="rounded-[4px] bg-pill px-1.5 py-0.5 font-mono text-secondary">m</span>
                menu
            </button>
            {e && k ? (
                <button
                    type="button"
                    data-office-footer-event=""
                    onClick={office.onEvents}
                    title="Show the Events rail"
                    className="flex h-[22px] min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 border-l border-solid border-edge-mid bg-transparent py-0 pl-3 pr-0 text-left text-[11px] text-muted hover:text-secondary"
                >
                    <k.icon size={12} aria-hidden className={cn("shrink-0", k.tone)} />
                    <span className="shrink-0 font-medium text-primary">{e.who}</span>
                    <span className="min-w-0 truncate">
                        {k.verb}
                        {e.text ? ` · ${e.text}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatAgeShort(now - e.ts)}</span>
                    {more > 0 ? <span className="shrink-0 text-ink-faint">· {more} more new</span> : null}
                </button>
            ) : null}
        </>
    );
}
```

Change `HintsBar`'s signature to
`export function HintsBar({ model, hints, office }: { model: AgentsViewModel; hints: boolean; office?: OfficeFooter })`
and the inner row's children to:

```tsx
                {office ? (
                    <OfficeFooterLine model={model} office={office} />
                ) : (
                    (hints ? HINTS : []).map(([k, d]) => (
                        <span key={k} className="flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap">
                            <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-secondary">
                                {k}
                            </span>
                            {d}
                        </span>
                    ))
                )}
```

(The Cards chips keep their existing class string untouched.)

- [ ] **Step 8: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 300000), then
`npx vitest run frontend/app/view/agents/cockpitevents.test.ts frontend/app/view/agents/officestore.test.ts`
Expected: exit 0; PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/app/view/agents/cockpitevents.ts frontend/app/view/agents/cockpitevents.test.ts frontend/app/view/agents/cockpiteventsrail.tsx frontend/app/view/agents/cockpithelp.tsx frontend/app/view/agents/officestore.ts
git commit -m "feat(office): the footer's office line: m menu and the newest event"
```

---

### Task 5: Wire the office: layers, dialog box, menu, HUD bar, keys

**Depends on:** Task 3, Task 4
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything Tasks 1–4 produce.
- Produces: `OfficeHandle` (below), `CockpitOfficeProps` (below), `OfficeKeys` (below); probe fields `layer`, `dialog`,
  `items`, `dims`, `sel`, `edge`, `menu`, `menuItems`, `menuSel` beside the existing `popup`, `prompt`, `big` (Task 6's
  scenarios read them through `window.__cockpitOfficeProbe`).

The office's views are drawn by Task 6's scenario steps (`cockpit-office` 0–10 and `cockpit-office-controls` 0–10).

- [ ] **Step 1: The office's layer state**

In `frontend/app/view/agents/cockpitoffice.tsx`, replace `const cardOpenAtom = atom(false) …` and its comment with:

```ts
// what is up over the office (officecontrols.ts): the desk's dialog box (↵, or a click on the desk), its full card (f,
// or the box's Full card), or nothing; any walk shuts both. The office menu (m) opens over any of them
const layerAtom = atom<OfficeLayer>("walk") as PrimitiveAtom<OfficeLayer>;
const selAtom = atom(0) as PrimitiveAtom<number>;
const menuOpenAtom = atom(false) as PrimitiveAtom<boolean>;
const menuSelAtom = atom(0) as PrimitiveAtom<number>;
// the full card the box's Adjust opened: a run's card with its Adjust panel open
const cardAdjustAtom = atom(false) as PrimitiveAtom<boolean>;
const HUD_SPACE_PX = 66; // the HUD bar (10 px from the top, 46 px tall) and a 10 px gap under it
```

Add imports: `backFrom, dialogEdge, officeMenuItems, stepSel, type OfficeLayer, type OfficeMenuId` from
`./officecontrols`; `clampSel, enabledOf, selAfterActivate, type DeskKind` from `./officedialogmodel`;
`OfficeDialogBox, OfficeHudBar, OfficeMenuBox, type OfficeDialogVM` from `./officedialog`.

Every `globalStore.set(cardOpenAtom, false)` becomes `globalStore.set(layerAtom, "walk")` (in `goTo`, `walk`, `walkTo`,
the unmount cleanup). Delete `dismiss`, `openCard` and `toggleBig` from the handle; Step 3 replaces them.

Add to the `probe` object: `layer: "walk" as OfficeLayer, dialog: "" as "" | DeskKind, items: [] as string[], dims: [] as
number[], sel: -1, edge: "" as "" | "top" | "bottom", menu: false, menuItems: [] as string[], menuSel: -1,`.

- [ ] **Step 2: The handle and the props**

Replace `export interface OfficeHandle` and extend `CockpitOfficeProps`:

```ts
export interface OfficeHandle {
    walk(dir: Dir): void;
    release(dir: Dir): void;
    goTo(key: string): void;
    showPath(key: string): void;
    layer(): OfficeLayer;
    menuOpen(): boolean;
    /** ↵ at the desk the boss stands at: opens its dialog box; false when the boss stands at no desk. */
    talk(): boolean;
    /** f and the box's Full card: opens the desk's full card big, or grows or shrinks the open one; Adjust opens a
     *  run's card with its Adjust panel. False when the boss stands at no desk. */
    card(opts?: { adjust?: boolean }): boolean;
    /** ↑ ↓ in the dialog box or the office menu. */
    move(delta: -1 | 1): void;
    /** ↵ on the ▶ item of the office menu, or else of the dialog box. */
    activate(): void;
    /** Esc: one step back (the menu shuts; the card goes back to the box, the box to walking); false when nothing was up. */
    back(): boolean;
    toggleMenu(): void;
    order(): string[];
    asks(): string[];
}

export interface CockpitOfficeProps {
    agents: PlanAgent[];
    runs: PlanRun[];
    now: number;
    // only FiveHourLeaf reads it: the 5-hour meter ticks every second
    model: AgentsViewModel;
    cursorId?: string;
    onCursor: (key: string) => void;
    renderCard: (key: string, opts?: { adjust?: boolean }) => ReactNode;
    // the dialog box of a desk, built from the view models its card draws from (cockpitsurface.tsx)
    dialogFor: (key: string) => OfficeDialogVM | null;
    // the Cockpit's filters and switches, drawn in the HUD bar after the office's clock and energy
    hud: ReactNode;
    // the office menu's Events count and label, and what its items do
    newEvents: number;
    eventsOpen: boolean;
    onMenu: (id: OfficeMenuId) => void;
    handleRef: MutableRefObject<OfficeHandle | null>;
}
```

- [ ] **Step 3: The handle's new methods**

In `CockpitOffice`, after `planRef` (so `plan` is defined), keep the latest props for the handle and add the helpers;
then fill the handle (keep `walk`, `release`, `goTo`, `showPath`, `order`, `asks` as they are):

```tsx
    const dialogRef = useRef(props.dialogFor);
    dialogRef.current = props.dialogFor;
    const onMenuRef = useRef(props.onMenu);
    onMenuRef.current = props.onMenu;
    const menuItems = officeMenuItems(plan.asks.length, props.newEvents, props.eventsOpen);
    const menuItemsRef = useRef(menuItems);
    menuItemsRef.current = menuItems;

    // the desk the boss stands at, when it stands still at the cursor's desk
    const deskAtBoss = (): string | undefined => {
        const key = cursorRef.current;
        return key && cardAt(planRef.current, globalStore.get(bossAtom), key) ? key : undefined;
    };
    // a desk's dialog box, the ▶ on its first item
    const openDialog = (key: string): boolean => {
        const vm = dialogRef.current(key);
        if (!vm) {
            return false;
        }
        globalStore.set(selAtom, clampSel(vm.items, -1));
        globalStore.set(layerAtom, "dialog");
        return true;
    };
```

```tsx
        layer: () => globalStore.get(layerAtom),
        menuOpen: () => globalStore.get(menuOpenAtom),
        talk: () => {
            const key = deskAtBoss();
            return key != null && openDialog(key);
        },
        card: (opts) => {
            const key = deskAtBoss();
            if (!key || renderCard(key) == null) {
                return false;
            }
            if (globalStore.get(layerAtom) === "card" && !opts?.adjust) {
                globalStore.set(officeBigCardAtom, !globalStore.get(officeBigCardAtom));
                return true;
            }
            globalStore.set(cardAdjustAtom, !!opts?.adjust);
            globalStore.set(officeBigCardAtom, true);
            globalStore.set(layerAtom, "card");
            return true;
        },
        move: (delta) => {
            if (globalStore.get(menuOpenAtom)) {
                const all = menuItemsRef.current.map(() => true);
                globalStore.set(menuSelAtom, stepSel(globalStore.get(menuSelAtom), delta, all));
                return;
            }
            const key = cursorRef.current;
            const vm = key && globalStore.get(layerAtom) === "dialog" ? dialogRef.current(key) : null;
            if (vm) {
                const sel = clampSel(vm.items, globalStore.get(selAtom));
                globalStore.set(selAtom, stepSel(sel, delta, enabledOf(vm.items)));
            }
        },
        activate: () => {
            if (globalStore.get(menuOpenAtom)) {
                const it = menuItemsRef.current[globalStore.get(menuSelAtom)];
                globalStore.set(menuOpenAtom, false);
                if (it) {
                    onMenuRef.current(it.id);
                }
                return;
            }
            const key = cursorRef.current;
            const vm = key && globalStore.get(layerAtom) === "dialog" ? dialogRef.current(key) : null;
            if (!vm) {
                return;
            }
            const sel = clampSel(vm.items, globalStore.get(selAtom));
            const it = vm.items[sel];
            if (!it || it.dim) {
                return;
            }
            vm.run(it.id);
            globalStore.set(selAtom, selAfterActivate(vm.items, sel));
        },
        back: () => {
            if (globalStore.get(menuOpenAtom)) {
                globalStore.set(menuOpenAtom, false);
                return true;
            }
            const layer = globalStore.get(layerAtom);
            if (layer === "walk") {
                return false;
            }
            const key = cursorRef.current;
            const next = backFrom(layer);
            // a desk whose dialog is gone (the agent left) goes straight back to walking
            globalStore.set(layerAtom, next === "dialog" && !(key && dialogRef.current(key)) ? "walk" : next);
            return true;
        },
        toggleMenu: () => {
            const open = !globalStore.get(menuOpenAtom);
            if (open) {
                globalStore.set(menuSelAtom, 0);
            }
            globalStore.set(menuOpenAtom, open);
        },
```

A click on a desk opens its dialog box, not its card. Change the second `pickRef.current = …` assignment to:

```tsx
    pickRef.current = (key: string) => {
        goTo(key);
        openDialog(key);
        onCursor(key);
    };
```

In the unmount cleanup add `globalStore.set(selAtom, 0); globalStore.set(menuOpenAtom, false);
globalStore.set(menuSelAtom, 0); globalStore.set(cardAdjustAtom, false);` beside the layer reset.

- [ ] **Step 4: The HUD bar replaces the heading; the office fills its scroller**

Delete `OfficeHeading` and its `<OfficeHeading … />`; in its place export the clock and energy for the HUD bar:

```tsx
// the office's clock and energy, first in the HUD bar
function OfficeClock({ now, night, pct }: { now: number; night: boolean; pct?: number }) {
    const time = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    // energy reads the window the other way: what is left of it, as a battery would
    const left = pct == null ? undefined : Math.min(100, Math.max(0, 100 - pct));
    const tired = left != null && left <= 10;
    return (
        <>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                {night ? <Moon size={14} className="text-ink-mid" /> : <Sun size={14} className="text-graphlane-3" />}
                <span className="tabular-nums text-primary">{time}</span>
                {night ? "after hours" : "work hours"}
            </span>
            <span
                title="Energy: what is left of Claude's 5-hour window (the app bar meter shows what is used)"
                className={cn("flex shrink-0 items-center gap-1.5 tabular-nums", tired && "text-asking")}
            >
                <Zap size={14} />
                {left == null ? "—" : `${Math.round(left)} %`}
            </span>
        </>
    );
}
```

The measuring effect no longer has a heading to measure against. Replace its body with:

```tsx
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        // the content box: the scroller's 20 px gutters each side; the HUD bar's space above, its 12 px foot below,
        // so a short office still fills the view
        const measure = () => {
            setWidth(el.clientWidth - 40);
            setHeight(Math.floor(el.clientHeight - HUD_SPACE_PX - 12));
        };
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);
```

Change the returned tree's outer element: the scroller moves inside a positioned wrapper that also holds the HUD bar,
the dialog box and the menu, so they stay put while the office scrolls:

```tsx
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div
                ref={scrollRef}
                data-cockpit-office
                className="min-h-0 flex-1 overflow-auto px-5 pb-3"
                style={{ paddingTop: HUD_SPACE_PX }}
            >
                <FiveHourLeaf model={props.model} />
                {width > 0 ? (
                    <div
                        ref={rootRef}
                        data-office-root
                        className="relative isolate"
                        style={{ width: plan.width, height: plan.height }}
                        onClick={/* unchanged */}
                    >
                        {/* everything the root drew before, unchanged, ending with: */}
                        <OfficePopup plan={plan} cursorId={cursorId} renderCard={renderCard} />
                        {dev?.sheet ? <PoseSheet phase={phase} /> : null}
                    </div>
                ) : null}
            </div>
            <div className="pointer-events-none absolute inset-x-3 top-2.5 z-[9]">
                <OfficeHudBar>
                    <OfficeClock now={now} night={night} pct={pct} />
                    {props.hud}
                </OfficeHudBar>
            </div>
            <OfficeDialogLayer
                plan={plan}
                cursorId={cursorId}
                dialogFor={props.dialogFor}
                scrollRef={scrollRef}
                rootRef={rootRef}
                onPick={(i) => {
                    globalStore.set(selAtom, i);
                    handleRef.current?.activate();
                }}
            />
            <OfficeMenuLayer
                items={menuItems}
                onPick={(i) => {
                    globalStore.set(menuSelAtom, i);
                    handleRef.current?.activate();
                }}
            />
        </div>
    );
```

The root loses its `mt-2` (the heading it spaced from is gone).

- [ ] **Step 5: Draw each layer**

In `OfficePopup`, replace `const open = useAtomValue(cardOpenAtom);` with:

```tsx
    const layer = useAtomValue(layerAtom);
    const adjust = useAtomValue(cardAdjustAtom);
    const open = layer === "card";
```

render the card with `renderCard(cursorId, { adjust })`, set `probe.prompt = card && layer === "walk" ? kind : "";`
(the ↵ prompt shows only while walking: the dialog box hides it), and early-return `null` when
`layer === "dialog"` after the probe lines. In `OfficePrompt`, change the click to `onClick={() =>
handle.talk()}` — pass `onTalk: () => void` from `OfficePopup` (which gets it as a prop from `CockpitOffice`:
`onTalk={() => handleRef.current?.talk()}`) — and the verb: `verb={at.desk?.light === "asking" ? "Answer" : "Talk"}`.

Add the two layers:

```tsx
// the dialog box of the desk at the boss, at the foot of the office's view, or at its head when the boss stands low in
// it; it shows only while the boss stands still at the cursor's desk, as the card does
function OfficeDialogLayer({
    plan,
    cursorId,
    dialogFor,
    scrollRef,
    rootRef,
    onPick,
}: {
    plan: Plan;
    cursorId?: string;
    dialogFor: (key: string) => OfficeDialogVM | null;
    scrollRef: RefObject<HTMLDivElement | null>;
    rootRef: RefObject<HTMLDivElement | null>;
    onPick: (i: number) => void;
}) {
    const look = useAtomValue(bossLookAtom);
    const layer = useAtomValue(layerAtom);
    const rawSel = useAtomValue(selAtom);
    const at = cardAt(plan, look?.rest ? { at: look.rest, path: [] } : null, cursorId);
    const vm = layer === "dialog" && at && cursorId ? dialogFor(cursorId) : null;
    const sel = vm ? clampSel(vm.items, rawSel) : -1;
    probe.layer = layer;
    probe.dialog = vm ? vm.kind : "";
    probe.items = vm ? vm.items.map((i) => i.label) : [];
    probe.dims = vm ? vm.items.flatMap((it, i) => (it.dim ? [i] : [])) : [];
    probe.sel = sel;
    const el = scrollRef.current;
    const edge =
        vm && look?.rest && el
            ? dialogEdge((rootRef.current?.offsetTop ?? 0) + look.rest.y, el.scrollTop, el.clientHeight)
            : undefined;
    probe.edge = edge ?? "";
    if (!vm || !edge) {
        return null;
    }
    return (
        <div
            data-office-dialog-edge={edge}
            className={cn("pointer-events-none absolute inset-x-3 z-[9] mx-auto max-w-[1180px]", edge === "top" ? "" : "bottom-3")}
            style={edge === "top" ? { top: HUD_SPACE_PX } : undefined}
        >
            <OfficeDialogBox vm={vm} sel={sel} onPick={onPick} />
        </div>
    );
}

// the office menu (m), under the HUD bar's right end
function OfficeMenuLayer({ items, onPick }: { items: OfficeMenuItem[]; onPick: (i: number) => void }) {
    const open = useAtomValue(menuOpenAtom);
    const sel = useAtomValue(menuSelAtom);
    probe.menu = open;
    probe.menuItems = open ? items.map((i) => i.label) : [];
    probe.menuSel = open ? sel : -1;
    if (!open) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute right-3 z-[10]" style={{ top: HUD_SPACE_PX }}>
            <OfficeMenuBox items={items} sel={sel} onPick={onPick} />
        </div>
    );
}
```

Import `RefObject` from react and `OfficeMenuItem` from `./officecontrols`.

- [ ] **Step 6: The Cockpit surface builds the dialogs, the HUD and the footer**

In `frontend/app/view/agents/cockpitsurface.tsx`:

1. Imports: `officeEventsOpenAtom` from `./officestore`; `useRailEvents` from `./cockpiteventsrail`; `footerEvent` from
   `./cockpitevents`; `dialogItems, type DeskKind, type DialogInput, type DialogItemId` from `./officedialogmodel`;
   `AgentDialogBody, AgentPlate, RunDialogBody, RunPlate, WorkerDialogBody, type OfficeDialogVM` from
   `./officedialog`; `type OfficeMenuId` from `./officecontrols`; `runAdjustable, rowKeyActions` from
   `./leadcardmodel` (extend the existing import); `cheatsheetOpenAtom` from `@/app/cockpit/shortcuts-cheatsheet`;
   `moveCursor, nextAskId` from `./agentsviewmodel` if not imported yet.

2. Hoist the chip list and the right-hand controls out of the header JSX so the HUD reuses them:

```tsx
    const chipDefs: [ChipFilter, string, number][] = [
        ["asking", "need you", liveAsking],
        ["working", "working", liveWorking],
        ["idle", "ready for review", readyCount],
        ["all", "live", liveCount],
    ];
    const viewControls = (
        <>
            {/* the existing role="group" Cards | Office toggle, <ProjectSwitcher … />, and the Live only button,
                moved here verbatim from the header's right-hand div */}
        </>
    );
```

   The header's chip `.map` reads `chipDefs`; its right-hand `div` holds `{viewControls}`. Render the whole sticky
   header only when `view !== "office"`.

3. The HUD bar's controls:

```tsx
    // the HUD bar inside the office's view: the same filters and switches as the Cards header, as compact pills
    const officeHud = (
        <>
            <span className="h-4 w-px shrink-0 bg-edge-mid" />
            <div role="group" aria-label="Show" className="flex min-w-0 items-center gap-0.5">
                {chipDefs.map(([key, label, count]) => (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={chip === key}
                        onClick={() => setChip(toggleChip(chip, key))}
                        className={cn(
                            "flex shrink-0 cursor-pointer items-baseline gap-1.5 rounded-[5px] border-0 px-2 py-[3px] hover:bg-surface-hover",
                            chip === key ? "bg-surface-selected" : "bg-transparent"
                        )}
                    >
                        <RollingCount
                            value={count}
                            className={cn(
                                "text-[13.5px] font-semibold",
                                count > 0 || chip === key ? TAB_TONE[key].text : "text-muted"
                            )}
                        />
                        <span className={cn("text-[12px] font-medium", chip === key ? "text-primary" : "text-ink-mid")}>
                            {label}
                        </span>
                    </button>
                ))}
            </div>
            <div className="ml-auto flex flex-none items-center gap-2">{viewControls}</div>
        </>
    );
```

4. The dialogs. Keep a ref of the cursor for the handle's callbacks (`const cursorIdRef = useRef(cursorId);
   cursorIdRef.current = cursorId;`), then:

```tsx
    // what a ▶ item does for an agent: the same calls the card's buttons and the Cockpit's keys make. openId is the tab
    // a worker's row opens, the agent's own id otherwise
    const runAgentItem = (a: AgentVM, id: DialogItemId, qi: number, openId = a.id) => {
        if (id.startsWith("opt:")) {
            toggleAnswer(a.id, qi, Number(id.slice(4)));
            return;
        }
        switch (id) {
            case "send":
                submitAnswer(a.id);
                return;
            case "open":
                openFocus(openId, false);
                return;
            case "reply":
                setOpenComposerId(a.id);
                officeRef.current?.card();
                requestAnimationFrame(() => focusRowComposer(a.id));
                return;
            case "terminal":
                model.openTerminal(openId);
                return;
            case "background":
                toggleBackground(a.id);
                return;
            case "card":
                officeRef.current?.card();
                return;
        }
    };

    const agentInput = (a: AgentVM): Pick<DialogInput, "activeQuestion" | "selections" | "texts"> => ({
        activeQuestion: answerTab[a.id] ?? 0,
        selections: answerSel[a.id] ?? {},
        texts: answerText[a.id] ?? {},
    });

    const agentDialog = (a: AgentVM): OfficeDialogVM => {
        const input = { kind: "agent" as DeskKind, agent: a, ...agentInput(a) };
        return {
            kind: "agent",
            label: a.name,
            items: dialogItems(input),
            plate: <AgentPlate agent={a} nowAtom={model.nowAtom} />,
            body: <AgentDialogBody agent={a} nowAtom={model.nowAtom} activeQuestion={input.activeQuestion} />,
            run: (id) => runAgentItem(a, id, input.activeQuestion),
        };
    };

    // the dialog box of the desk at the boss (office controls canvas): the same card lookup as renderOfficeCard
    const dialogFor = (key: string): OfficeDialogVM | null => {
        const c = cards.find((x) =>
            x.kind === "agent"
                ? x.id === key
                : x.id === key || key.startsWith(`${x.id}:`) || rowsOf(x).some((r) => r.key === key)
        );
        if (!c) {
            const parked = shownParkedIdle.find((a) => a.id === key);
            return parked ? agentDialog(parked) : null;
        }
        if (c.kind === "agent") {
            return agentDialog(c.agent);
        }
        const vm = leadVMs.get(c.id);
        if (!vm) {
            return null;
        }
        const adjustable = runAdjustable(c.run);
        const row = rowsOf(c).find((r) => r.key === key);
        if (row || key !== c.id) {
            // a worker's seat: its task row (a seat the card shows no row for has only the full card)
            const worker = row?.worker;
            const actions = row ? rowKeyActions(row) : [];
            const input = worker ? agentInput(worker) : { activeQuestion: 0, selections: {}, texts: {} };
            return {
                kind: "worker",
                label: row?.label ?? c.run.title,
                items: dialogItems({ kind: "worker", agent: worker, rowActions: actions, canOpen: !!row?.openId, ...input }),
                plate: worker ? (
                    <AgentPlate agent={worker} nowAtom={model.nowAtom} />
                ) : (
                    <RunPlate title={c.run.title} nowAtom={model.nowAtom} />
                ),
                body: row ? (
                    <WorkerDialogBody row={row} worker={worker} nowAtom={model.nowAtom} activeQuestion={input.activeQuestion} />
                ) : null,
                run: (id) => {
                    if (id.startsWith("row:")) {
                        const i = Number(id.slice(4));
                        rowTargets[row!.key]?.actions[i]?.();
                        // Tell asks for words: its input is on the card
                        if (actions[i] === "tell") {
                            officeRef.current?.card();
                        }
                        return;
                    }
                    if (worker) {
                        runAgentItem(worker, id, input.activeQuestion, row?.openId ?? worker.id);
                    } else if (id === "card") {
                        officeRef.current?.card();
                    }
                },
            };
        }
        const lead = c.lead;
        const input = lead ? agentInput(lead) : { activeQuestion: 0, selections: {}, texts: {} };
        return {
            kind: lead ? "lead" : "leadless",
            label: c.run.title,
            items: dialogItems({ kind: lead ? "lead" : "leadless", agent: lead, adjustable, ...input }),
            plate: <RunPlate lead={lead} title={c.run.title} nowAtom={model.nowAtom} />,
            body: <RunDialogBody vm={vm} lead={lead} activeQuestion={input.activeQuestion} />,
            run: (id) => {
                if (id === "adjust") {
                    officeRef.current?.card({ adjust: true });
                } else if (lead) {
                    runAgentItem(lead, id, input.activeQuestion);
                } else if (id === "card") {
                    officeRef.current?.card();
                }
            },
        };
    };
```

   `renderCard` takes a third parameter `adjust?: boolean` and passes `initialPanel={adjust ? "adjust" : undefined}` to
   `LeadCard`; `renderOfficeCard = (key: string, opts?: { adjust?: boolean }): ReactNode` passes `opts?.adjust` on.

5. The office keys, the menu and the Events rail:

```tsx
    const eventsOpen = useAtomValue(officeEventsOpenAtom);
    const railEvents = useRailEvents(lineage, runEvents);
    const setOfficeEvents = (open: boolean) => {
        if (open) {
            globalStore.set(model.railOpenAtom, true);
        }
        globalStore.set(officeEventsOpenAtom, open);
    };

    const officeKeys = useMemo<OfficeKeys>(
        () => ({
            layer: () => officeRef.current?.layer() ?? "walk",
            menuOpen: () => officeRef.current?.menuOpen() ?? false,
            walk: (d) => officeRef.current?.walk(d),
            talk: () => officeRef.current?.talk() ?? false,
            card: () => officeRef.current?.card() ?? false,
            move: (d) => officeRef.current?.move(d),
            activate: () => officeRef.current?.activate(),
            back: () => {
                // walking already: Esc hides the Events rail the menu showed
                if (!officeRef.current?.back() && globalStore.get(officeEventsOpenAtom)) {
                    globalStore.set(officeEventsOpenAtom, false);
                }
            },
            toggleMenu: () => officeRef.current?.toggleMenu(),
            desk: (d) => {
                const next = moveCursor(officeRef.current?.order() ?? [], cursorIdRef.current, d);
                if (next) {
                    setCursorId(next);
                    officeRef.current?.goTo(next);
                }
            },
            nextAsk: () => {
                const target = nextAskId(officeRef.current?.asks() ?? [], lastJumpRef.current);
                if (target) {
                    lastJumpRef.current = target;
                    setCursorId(target);
                    officeRef.current?.showPath(target);
                }
            },
        }),
        []
    );

    const onOfficeMenu = (id: OfficeMenuId) => {
        switch (id) {
            case "nextAsk":
                officeKeys.nextAsk();
                return;
            case "nextDesk":
                officeKeys.desk(1);
                return;
            case "prevDesk":
                officeKeys.desk(-1);
                return;
            case "events":
                setOfficeEvents(!globalStore.get(officeEventsOpenAtom));
                return;
            case "cards":
                toggleView();
                return;
            case "keys":
                globalStore.set(cheatsheetOpenAtom, true);
                return;
        }
    };
```

   Pass the new props to `<CockpitOffice …>`: `renderCard={renderOfficeCard}`, `dialogFor={dialogFor}`,
   `hud={officeHud}`, `newEvents={railEvents.fresh.length}`, `eventsOpen={eventsOpen}`, `onMenu={onOfficeMenu}`.

   Render the rail only when it is wanted: `{view !== "office" || eventsOpen ? <CockpitRail … /> : null}`.

   Give the hints bar its Office line:

```tsx
                <HintsBar
                    model={model}
                    hints={phase === "ready"}
                    office={
                        view === "office"
                            ? {
                                  event: footerEvent(railEvents.all, railEvents.fresh),
                                  onMenu: () => officeRef.current?.toggleMenu(),
                                  onEvents: () => setOfficeEvents(true),
                              }
                            : undefined
                    }
                />
```

- [ ] **Step 7: The keyboard routes the office's keys through `officeKey`**

In `frontend/app/view/agents/usecockpitkeyboard.ts`, import `officeKey` and `type OfficeLayer` from
`./officecontrols`, replace `OfficeKeys` with:

```ts
/** What the Cockpit's keys can ask of the office while it shows Office (cockpitsurface.tsx binds it to the office's
 *  handle). officecontrols.ts decides what each key does. */
export interface OfficeKeys {
    layer(): OfficeLayer;
    menuOpen(): boolean;
    walk(dir: Dir): void;
    talk(): boolean;
    card(): boolean;
    move(delta: -1 | 1): void;
    activate(): void;
    back(): void;
    toggleMenu(): void;
    desk(delta: -1 | 1): void;
    nextAsk(): void;
}
```

and replace the whole `if (office) { … }` block with:

```ts
        if (office) {
            const act = officeKey(office.layer(), office.menuOpen(), e.key, {
                meta: e.metaKey,
                ctrl: e.ctrlKey,
                alt: e.altKey,
            });
            switch (act.do) {
                case "walk":
                    e.preventDefault();
                    office.walk(act.dir);
                    return;
                case "move":
                    e.preventDefault();
                    office.move(act.delta);
                    return;
                case "activate":
                    e.preventDefault();
                    office.activate();
                    return;
                case "talk":
                    // the ↵ over the boss's desk; at no desk, Enter opens the cursor's agent as below
                    if (office.talk()) {
                        e.preventDefault();
                        return;
                    }
                    break;
                case "card":
                    if (office.card()) {
                        e.preventDefault();
                    }
                    return;
                case "back":
                    office.back();
                    return;
                case "menu":
                    e.preventDefault();
                    office.toggleMenu();
                    return;
                case "desk":
                    e.preventDefault();
                    office.desk(act.delta);
                    return;
                case "nextAsk":
                    e.preventDefault();
                    office.nextAsk();
                    return;
                case "tab": {
                    // a question with several parts switches question (h l, and ← → in the dialog box)
                    const asker = askerAt(cursorId, roster, rowTargets);
                    const n = asker?.ask?.questions?.length ?? 0;
                    if (asker?.state === "asking" && n > 1) {
                        e.preventDefault();
                        const curTab = Math.min(answerTab[asker.id] ?? 0, n - 1);
                        selectQuestion(asker.id, Math.max(0, Math.min(n - 1, curTab + act.delta)));
                    }
                    return;
                }
                case "none":
                    e.preventDefault();
                    return;
                case "pass":
                    // r's composer lives on the card: show the card first, then the reply below opens it
                    if (e.key === "r" && office.layer() !== "card") {
                        office.card();
                    }
                    break;
            }
        }
```

`moveCursor` and `nextAskId` may now be unused in the hook; drop them from its import if so.

- [ ] **Step 8: Typecheck, tests, and a live look**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 300000)
Expected: exit 0

Run: `npx vitest run frontend/app/view/agents`
Expected: PASS

Run the existing office scenario (it still expects the card on a click; Task 6 updates it), to see the office load:
`task dev:browser` in the background, then `node --experimental-websocket scripts/cdp/verify.mjs cockpit-office`.
Expected: step 0 and 1b–1e PASS; steps that open the card on a click FAIL until Task 6 (note which in the report).

- [ ] **Step 9: The changelog**

In `CHANGELOG.md`, under `## Unreleased` → `### Changed`, add at the top:

```markdown
- **The Office plays like a pixel game**: ↵ at a desk opens a dialog box at the edge of the office with what the agent
  says, its question and its numbers, and a ▶ menu of what you can do there: ↑ ↓ pick, ↵ does it, Esc steps back, and
  Full card (f) shows the whole card. A run's room offers Open lead and Adjust, a worker's seat its task's own buttons.
  <!-- big -->
- **The Office fills the Cockpit**: its counts, Cards/Office, projects and Live only sit in a bar inside the office,
  the footer shows only `m menu` and the newest event, and `m` opens the office menu (Events shows the Events rail,
  which Office now hides).
```

Run: `npx vitest run frontend/app/view/agents/whatsnew`
Expected: PASS (`whatsnew.test.ts` allows at most 5 big lines in Unreleased; this adds the third)

- [ ] **Step 10: Commit**

```bash
git add frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/usecockpitkeyboard.ts CHANGELOG.md
git commit -m "feat(office): dialog box, office menu, HUD bar and Game Boy keys in the Office"
```

---

### Task 6: Scenarios, keys docs, guide and spec

**Depends on:** Task 5
**Files:** `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cdp/scenarios.mjs`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `docs/guide/cockpit.md`, `docs/superpowers/specs/2026-10-15-cockpit-office-design.md`

**Interfaces:**
- Consumes: the probe fields and DOM hooks Task 5 adds (`data-office-hud`, `data-office-dialog`,
  `data-office-dialog-edge`, `data-office-menu`, `data-office-pick`, `data-office-footer-menu`,
  `data-office-footer-event`, `data-office-boss`).
- Produces: scenario `cockpit-office-controls`; `cockpit-office` updated to the dialog box.

Board to step: **Main** → controls steps 1 and 3 (`cockpit-office-dialog.png`, `cockpit-office-dialog-picked.png`);
**Run** → step 6 (`cockpit-office-dialog-run.png`); **StartMenu** → step 8 (`cockpit-office-menu.png`); **States** →
step 4 (the ↵ chip, `cockpit-office-talk.png`), step 5 (an agent at work, `cockpit-office-dialog-working.png`), steps 1,
3 and 6; the HUD bar and footer of every board → step 0 (`cockpit-office-hud.png`).

- [ ] **Step 1: Bring `cockpit-office` up to the dialog box**

In `scripts/cdp/cockpitofficescenarios.mjs`, inside `cockpitOffice.assert`:
- Step 0: keep as is (`p.popup === "" && p.prompt !== ""` still holds: walking, the ↵ offered).
- Step 1: rename to `"1. a click on quill's desk walks the boss there and opens its dialog box"`, assert
  `p?.cursor === "fx-office-quill" && p.dialog === "agent"`, detail `{ cursor, dialog: p?.dialog, boss }`.
- Step 3: rename to `"3. a click on a meeting room opens its run's dialog box"`; read
  `document.querySelector('[data-office-dialog]')?.textContent` for `runText`; assert
  `(p?.dialog === "lead" || p?.dialog === "leadless") && runText > 0`.
- Step 5: the comment becomes `// quill holds the answer step 2 picked: Enter here opens the dialog box, it does not
  send the answer`; assert `… && atAsk.dialog === "" && atAsk.prompt === "agent" && p?.dialog === "agent"`; rename the
  step's "Enter opens it" to "Enter opens its dialog box".
- Step 6: Esc now closes the dialog box: `hid?.dialog === "" && hid.prompt !== "" && … && next.dialog === "" &&
  next.prompt !== "" && opened?.dialog !== "" && back?.cursor === hid.cursor && back.dialog === "" && back.prompt !== ""`;
  rename "Esc shuts the card" → "Esc shuts the dialog box", "Enter opens it" stays.
- Step 6b: unchanged (f from walking opens the full card big).
- Step 7: add `p.dialog === ""` to the assertion.
- Step 10: read the HUD instead of the heading:
  `document.querySelector("[data-office-hud]")?.textContent ?? ""`; assert `p.dialog === "agent"` in place of
  `p.popup === "agent"`; rename "its card open" → "its dialog box open" and "the heading says" → "the HUD says".

- [ ] **Step 2: Add `cockpit-office-controls`**

Add `m: 77` to `KEY_CODES` at the top of the file. Then, in `makeCockpitOfficeScenarios`, after `cockpitOffice`, add
(and return it beside the other two):

```js
    // the office controls canvas (.superpowers/design/office-controls): the HUD bar and footer, the dialog box and its
    // ▶ menu, the full card and Esc's steps back, the box's edge, the office menu and the Events rail
    const cockpitOfficeControls = {
        name: "cockpit-office-controls",
        surface: "cockpit",
        arrange: (h) => cockpitOffice.arrange(h),
        teardown: (h, ctx) => cockpitOffice.teardown(h, ctx),
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }
            await settleBoss(h);
            const press = async (k, n = 1) => {
                for (let i = 0; i < n; i++) {
                    await focusCockpit(h);
                    await key(h, k);
                    await sleep(120);
                }
                return probe(h);
            };

            // 0. the office fills the surface: no Cockpit title, the filters and switches in the HUD bar inside the
            // view, m menu alone in the footer, no Events rail
            const chrome = await h.ev(`(() => {
                const s = document.querySelector("[data-cockpit-surface]");
                const hud = s?.querySelector("[data-office-hud]");
                const foot = s?.querySelector("[data-cockpit-hints]");
                return {
                    title: [...(s?.querySelectorAll("h1") ?? [])].some((e) => e.textContent.trim() === "Cockpit"),
                    hud: hud?.textContent ?? "",
                    toggle: !!hud?.querySelector("[data-cockpit-view-toggle]"),
                    menu: !!foot?.querySelector("[data-office-footer-menu]"),
                    foot: foot?.textContent ?? "",
                    rail: !!document.querySelector('[aria-label="Events"]'),
                };
            })()`);
            rec(
                "0. the office fills the surface: no Cockpit title, the counts, Cards/Office and Live only in the HUD bar, only m menu in the footer, no Events rail",
                !chrome.title &&
                    chrome.hud.includes("work hours") &&
                    chrome.hud.includes("need you") &&
                    chrome.hud.includes("Live only") &&
                    chrome.toggle &&
                    chrome.menu &&
                    !chrome.foot.includes("column") &&
                    !chrome.rail,
                JSON.stringify(chrome)
            );
            await h.shot("cdp-shots/cockpit-office-hud.png");

            // 1. quill's dialog box: its question and what it said, its answers as the ▶ menu, Send dim
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            let p = await settleBoss(h);
            const words = await h.ev(`document.querySelector('[data-office-dialog="agent"]')?.textContent ?? ""`);
            rec(
                "1. a click on quill's desk opens its dialog box: the question under what it said, the answers, Send dim, Terminal and Full card",
                p?.dialog === "agent" &&
                    JSON.stringify(p.items) ===
                        JSON.stringify(["Merge now", "Wait for the Final shots", "Show me the diff first", "Send", "Terminal", "Full card"]) &&
                    JSON.stringify(p.dims) === "[3]" &&
                    p.sel === 0 &&
                    words.includes("Merge wave/7c1e into main now") &&
                    words.includes("The branch is ready."),
                JSON.stringify({ dialog: p?.dialog, items: p?.items, dims: p?.dims, sel: p?.sel, words: words.slice(0, 160) })
            );
            await h.shot("cdp-shots/cockpit-office-dialog.png");

            // 2. ↓ steps the ▶ over the dim Send; ↑ comes back
            const sels = [];
            for (let i = 0; i < 3; i++) sels.push((await press("ArrowDown"))?.sel);
            sels.push((await press("ArrowUp"))?.sel);
            rec("2. ↓ ↓ ↓ steps the ▶ 1, 2, then over the dim Send to Terminal; ↑ goes back to 2", JSON.stringify(sels) === "[1,2,4,2]", JSON.stringify(sels));

            // 3. ↵ on an answer picks it and moves the ▶ to Send, which lights (no second ↵: it would send)
            await press("ArrowUp", 2);
            p = await press("Enter");
            rec(
                "3. ↵ on the first answer picks it and moves the ▶ to Send, now lit",
                JSON.stringify(p?.answerSel?.["0"]) === "[0]" && p.sel === 3 && JSON.stringify(p.dims) === "[]",
                JSON.stringify({ answerSel: p?.answerSel, sel: p?.sel, dims: p?.dims })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-picked.png");

            // 4. f opens the full card; Esc goes back to the box, Esc again to walking with the ↵ offered
            const card = await press("f");
            const back1 = await press("Escape");
            const back2 = await press("Escape");
            rec(
                "4. f opens the full card over the box; Esc goes back to the box, a second Esc to walking, the ↵ offered",
                card?.popup === "agent" && card.dialog === "" && back1?.dialog === "agent" && back1.popup === "" && back2?.dialog === "" && back2.prompt === "agent",
                JSON.stringify({ card: [card?.popup, card?.dialog], back1: [back1?.dialog, back1?.popup], back2: [back2?.dialog, back2?.prompt] })
            );
            await h.shot("cdp-shots/cockpit-office-talk.png");

            // 5. loom at work: Open, Reply, Terminal, Background, Full card; the ▶ stops at the last
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-loom"))})?.click()`);
            await settleBoss(h);
            p = await press("ArrowDown", 6);
            rec(
                "5. an agent at work offers Open, Reply, Terminal, Background and Full card; the ▶ stops at the last",
                p?.dialog === "agent" && JSON.stringify(p.items) === JSON.stringify(["Open", "Reply", "Terminal", "Background", "Full card"]) && p.sel === 4,
                JSON.stringify({ items: p?.items, sel: p?.sel })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-working.png");

            // 5b. Reply opens the full card with its composer focused; m typed there types, the menu stays shut
            await press("ArrowUp", 3);
            await press("Enter");
            await sleep(300);
            const focused = await h.ev(`document.activeElement?.tagName ?? ""`);
            await key(h, "m");
            await sleep(150);
            const typed = await h.ev(`({ menu: window.__cockpitOfficeProbe().menu, value: document.activeElement?.value ?? null })`);
            rec(
                "5b. Reply opens the full card with its composer focused; m typed there types and the office menu stays shut",
                focused === "TEXTAREA" && typed.menu === false && (typed.value ?? "").includes("m"),
                JSON.stringify({ focused, typed })
            );
            await key(h, "Escape");
            await press("Escape", 2);

            // 6. the real run's meeting room: its lead's box, Open lead first, Full card last
            await h.ev(`[...document.querySelectorAll("[data-office-room]")].find((b) => !b.dataset.officeRoom.includes("fx-office-run"))?.click()`);
            p = await settleBoss(h);
            rec(
                "6. a meeting room opens its run's box: Open lead first, Full card last",
                p?.dialog === "lead" && p.items[0] === "Open lead" && p.items[p.items.length - 1] === "Full card",
                JSON.stringify({ dialog: p?.dialog, items: p?.items })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-run.png");

            // 7. a short view, the boss low in it: the box takes the head of the view and never covers the boss
            const w = await h.ev("window.innerWidth");
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: 760, deviceScaleFactor: 1, mobile: false });
            await sleep(500);
            await press("Escape");
            const low = await h.ev(`(() => {
                const el = document.querySelector("[data-cockpit-office]");
                el.scrollTop = el.scrollHeight;
                const v = el.getBoundingClientRect();
                const spots = [...document.querySelectorAll("[data-office-desk], [data-office-seat]")]
                    .map((d) => ({ d, r: d.getBoundingClientRect() }))
                    .filter(({ r }) => r.top >= v.top && r.bottom <= v.bottom);
                spots.sort((a, b) => b.r.bottom - a.r.bottom);
                spots[0]?.d.click();
                return spots.length;
            })()`);
            p = await settleBoss(h, 5000);
            const geo = await h.ev(`(() => {
                const v = document.querySelector("[data-cockpit-office]").getBoundingClientRect();
                const box = document.querySelector("[data-office-dialog]")?.getBoundingClientRect();
                const boss = document.querySelector("[data-office-boss]")?.getBoundingClientRect();
                if (!box || !boss) return { box: !!box, boss: !!boss };
                const overlap = !(box.right <= boss.left || box.left >= boss.right || box.bottom <= boss.top || box.top >= boss.bottom);
                return { overlap, bossMid: (boss.top + boss.bottom) / 2 - v.top, half: v.height / 2 };
            })()`);
            await h.cdp("Emulation.clearDeviceMetricsOverride", {});
            await sleep(400);
            rec(
                "7. in a short view the box sits at the head when the boss stands in the lower half, the foot otherwise, and never covers the boss",
                low > 0 && geo.overlap === false && p?.edge === (geo.bossMid > geo.half ? "top" : "bottom"),
                JSON.stringify({ low, edge: p?.edge, geo })
            );

            // 8. m opens the office menu over the box: START's items with their keys; ↓ moves; Esc shuts it
            await press("Escape", 2);
            const menu = await press("m");
            await h.shot("cdp-shots/cockpit-office-menu.png");
            const moved = await press("ArrowDown");
            const shut = await press("Escape");
            rec(
                "8. m opens the office menu: Next Needs you, Next desk, Previous desk, Events, Cards view, All keys; ↓ moves the ▶; Esc shuts it",
                menu?.menu === true &&
                    JSON.stringify(menu.menuItems) === JSON.stringify(["Next Needs you", "Next desk", "Previous desk", "Events", "Cards view", "All keys"]) &&
                    menu.menuSel === 0 &&
                    moved?.menuSel === 1 &&
                    shut?.menu === false,
                JSON.stringify({ items: menu?.menuItems, sel: [menu?.menuSel, moved?.menuSel], shut: shut?.menu })
            );

            // 9. the menu's Events shows the rail; Esc while walking hides it again
            await press("m");
            await press("ArrowDown", 3);
            await press("Enter");
            const shown = await h.ev(`!!document.querySelector('[aria-label="Events"]')`);
            await press("Escape");
            const hidden = await h.ev(`!document.querySelector('[aria-label="Events"]')`);
            rec("9. the menu's Events shows the Events rail; Esc while walking hides it", shown && hidden, JSON.stringify({ shown, hidden }));

            // 10. the footer's m opens and shuts the menu with the mouse
            await h.ev(`document.querySelector("[data-office-footer-menu]")?.click()`);
            await sleep(150);
            const opened = (await probe(h))?.menu;
            await h.ev(`document.querySelector("[data-office-footer-menu]")?.click()`);
            await sleep(150);
            const closed = (await probe(h))?.menu;
            const line = await h.ev(`document.querySelector("[data-office-footer-event]")?.textContent ?? null`);
            rec(
                "10. the footer's m opens and shuts the office menu; its event line, when there is one, names who and what",
                opened === true && closed === false && (line === null || line.trim().length > 0),
                JSON.stringify({ opened, closed, line })
            );

            return steps;
        },
    };
```

Return `{ cockpitOffice, cockpitOfficeControls, cockpitOfficeBench }`. In `scripts/cdp/scenarios.mjs`, destructure
`cockpitOfficeControls` from `makeCockpitOfficeScenarios(…)` and list it after `cockpitOffice` in the scenarios array.

If `data-office-boss` is not the boss sprite's attribute, use the one `afterStop`'s `scrollIntoView` queries
(`[data-office-boss]` there), which Task 5 leaves unchanged.

- [ ] **Step 3: Run both scenarios**

Run: `task dev:browser` in the background (wait for its CDP line), then
`node --experimental-websocket scripts/cdp/verify.mjs cockpit-office cockpit-office-controls`
Expected: every step PASS; `cdp-shots/index.html` holds the shots named above. Look at `cockpit-office-dialog.png`,
`cockpit-office-dialog-run.png` and `cockpit-office-menu.png` beside the canvas's Main, Run and StartMenu boards: the
frame, the plate on the box's top edge, the ▶ menu on the right, the HUD bar inside the view.

- [ ] **Step 4: The keys' docs**

In `frontend/app/store/keybindings/bindings.ts` (`buildCockpitBindings`):
- `cockpit:open` label → `"Confirm answer, else open focus; on a task row, open its worker; in Office, first open the dialog box ↵ offers"`
- `cockpit:office-walk` label → `"Office: walk the boss (← ↑ ↓ →); in the dialog box ↑ ↓ move the ▶; j / k go desk by desk"`
- `cockpit:office-big` label → `"Office: the desk's full card; on the card, bigger or smaller"`
- add after it: `doc("cockpit:office-menu", "m", "Office: the office menu (next Needs you, desks, Events, Cards view, all keys)"),`

Run: `npx vitest run frontend/app/store/keybindings`
Expected: PASS (no key conflict: `m` is the Cockpit surface's, the canvas's `m` the Agent surface's)

In `docs/keyboard-shortcuts.md`, replace the Office rows (from `` `←` `↑` `↓` `→` (Office) `` through
`` `Esc` (Office) ``) with:

```markdown
| `←` `↑` `↓` `→` (Office) | Walk the boss; walls stop it, doors let it through. In the dialog box `↑` `↓` move the ▶ and `←` `→` switch the question |
| `j` / `k` (Office) | The boss walks to the next / previous desk or seat |
| `n` (Office) | Show the way to the next Needs you for a second, then walk there |
| `Enter` (Office) | At a desk, open its dialog box; in the box, do what the ▶ points at (an answer, then Send); on the full card, Enter works as above |
| `f` (Office) | Open the desk's full card big; on the card, grow or shrink it (the size stays for the next card) |
| `Esc` (Office) | One step back: the full card to the dialog box, the box to walking; walking, hide the Events rail the menu showed |
| `m` (Office) | The office menu: next Needs you, next or previous desk, Events, Cards view, all keys |
```

- [ ] **Step 5: The guide (Vietnamese)**

In `docs/guide/cockpit.md`, section `### Văn phòng (Office)`, replace the `- **Bạn là sếp**: …` bullet with:

```markdown
- **Bạn là sếp, chơi như game Pokémon**: `←` `↑` `↓` `→` để đi (tường chặn, cửa đi qua được), `j` / `k` tới bàn kế,
  `n` hiện lối đi chấm chấm tới câu hỏi kế tiếp trong một giây rồi đi tới đó. Đứng ở bàn nào thì trên đầu người đó có
  `↵ Talk` (hay `↵ Answer` nếu đang hỏi): bấm `↵` mở **hộp thoại** ở mép văn phòng, chứa điều agent nói, câu hỏi, các
  bước gần nhất và số liệu của nó, kèm menu ▶ bên phải. `↑` `↓` chọn, `↵` làm, `Esc` lùi một bước: hộp thoại có các
  câu trả lời rồi **Send**, hay **Open**, **Reply**, **Terminal**, **Background**; ở phòng họp là **Open lead**, **Adjust**;
  ở ghế worker là các nút của task đó. **Full card** (hay `f`) mở thẻ đầy đủ cạnh bàn; `Esc` quay về hộp thoại.
  `1`–`9`, `r`, `t`, `b` vẫn dùng được như trước. Bấm vào bàn hay phòng họp cũng mở hộp thoại.
- **Văn phòng chiếm hết màn**: không còn tiêu đề Cockpit; số đếm (need you, working…), Cards | Office, project và
  **Live only** nằm trong thanh HUD trong văn phòng. Footer chỉ còn `m menu` và event mới nhất; rail Events ẩn trong
  Office. `m` mở **menu văn phòng** (như START): next Needs you, bàn kế / trước, **Events** (hiện rail), Cards view, và
  danh sách phím.
```

Also change "`⚡` ở đầu văn phòng" to "`⚡` trên thanh HUD" in the energy bullet.

- [ ] **Step 6: The spec**

In `docs/superpowers/specs/2026-10-15-cockpit-office-design.md`, replace the `- **Keys in Office** …` bullet list
(through the `1`–`9`, `Enter`, `Space`, `r`, `t`, `b` line) with:

```markdown
- **Keys in Office** (only while the Cockpit owns the keyboard), a Game Boy's: the arrows, `↵` as A, `Esc` as B, `m`
  as START (2026-10-15, canvas `office-controls`; rules in `officecontrols.ts`).
  - Walking: `←` `↑` `↓` `→` walk (held, the boss keeps walking; walls stop it, doors let it through); `↵` at a desk
    opens its dialog box; `f` its full card, big.
  - Dialog box: `↑` `↓` move the ▶ (over a dim item), `↵` does it, `←` `→` and `h` `l` switch the question of a
    several-part ask, `f` the full card, `Esc` back to walking.
  - Full card: the arrows walk away (shutting it), `↵` works as on a card, `f` grows or shrinks it, `Esc` back to the
    dialog box.
  - Everywhere: `j` `k` the next or previous desk in office order, `n` the next Needs you (its dotted path first),
    `m` the office menu (`↑` `↓` `↵`, `Esc` or `m` shut it); `1`–`9`, `r`, `t`, `b`, Space act on the desk at the boss.
    A key with Cmd, Ctrl or Alt is never the office's.
```

and replace the body of `## The popup` with:

```markdown
- **The dialog box** (↵ or a click on a desk) sits at the foot of the office's view, or at its head when the boss stands
  in the view's lower half, so it never covers the desk. A plate on its top edge names who talks; the left holds what
  they say (an agent's question under its last words and its last steps, its model, context and age; a run's lead's
  last line, the task bar, the counts and a column of tasks; a seat's task row and its worker), the right a ▶ menu:
  the answers then Send (dim until every question has one), or the row's own actions, then Open, Reply, Terminal,
  Background (Open lead and Adjust at a run), and Full card. Only the item under the ▶ shows its key.
- **The full card** (Full card or `f`) is the grid's own `AgentRow` or `LeadCard` beside the desk, as before; Adjust
  opens a run's card with its Adjust panel. No card is rewritten for the office.
- **The office menu** (`m`, or the footer's `m menu`) lists Next Needs you, Next desk, Previous desk, Events, Cards
  view and All keys, each with its key.
- **The office fills the Cockpit**: no title; the counts that filter, Cards | Office, the project switcher and Live only
  sit in a HUD bar inside the view, after the clock and energy. The footer holds `m menu` and the newest event; the
  Events rail is hidden in Office until the menu's Events shows it (Esc while walking hides it).
```

- [ ] **Step 7: Run what the docs touch**

Run: `npx vitest run frontend/app/store/keybindings`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/cdp/cockpitofficescenarios.mjs scripts/cdp/scenarios.mjs frontend/app/store/keybindings/bindings.ts docs/keyboard-shortcuts.md docs/guide/cockpit.md docs/superpowers/specs/2026-10-15-cockpit-office-design.md
git commit -m "test(office): the controls scenario; keys docs, guide and spec for the Office's dialog box"
```
