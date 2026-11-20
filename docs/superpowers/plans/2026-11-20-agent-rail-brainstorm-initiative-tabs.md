# Brainstorm and Initiative rail tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Chat band's brainstorm and initiative parts into two conditional tabs of the Agent rail, delete the
band, and make the header's ◇ chip and `i` open the Initiative tab in Chat and Terminal alike.

**Architecture:** The rail's tab model (`agentrailtabs.ts`) learns two tabs that show only while the agent has the
thing, like Council. Their bodies are two new panes (`railbrainstormpane.tsx`, `railinitiativepane.tsx`); the brainstorm
timeline is a pure model (`railbrainstorm.ts`), the initiative pane reuses the band's model (`initiativeband.ts`) and
its writes (`initiativebandstore.ts`'s `switchAgentChunk` / `switchAndTell`). Then the band, the ◇ popover's linked
view and Overview's Plan to review section are deleted.

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, lucide-react, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md`

**Verify:** `node scripts/verify.mjs`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs rail-brainstorm-tab rail-initiative-tab rail-tabs-split`

**Prototype:** <checkout>/.superpowers/design/agent-rail-brainstorm-initiative/project

---

Read before starting: `AGENTS.md` (Frontend conventions, Visual verification), `DESIGN.md` (rail, tokens), and the
canvas boards `D-timeline.dc.html` (Brainstorm tab), `B-initiative-tab.dc.html` (Initiative tab), `C-split-cells.dc.html`
(split of four). Colors come from `@theme` tokens only. Single test files: `npx vitest run <file>`.

Rail Verify (run de501e59, landed after this plan was written) changed the same rail files: `agentrailsections.ts` has a
`verify` section and a `verify` stat (the last count in the strip, with its own tone and label), `agentdetailsrail.tsx`
builds a `verify` tile and its `revealSection` calls `selectRailTab(agent.id, "overview", hasTree, hasTranscript)` (a
Task 1 caller to update), and `RailStats` takes `verifyTitle`. Keep all of it: Task 4 removes only `plan`. The tab strip
and the counts share one row, so with Council, Brainstorm, Initiative and the Verify count all present it must still not
clip at 300px (Task 6's hand-check line).

### Task 1: The rail's tab model learns Brainstorm and Initiative

**Depends on:** none
**Files:** `frontend/app/view/agents/agentrailtabs.ts`, `frontend/app/view/agents/agentrailtabs.test.ts`, `frontend/app/view/agents/agentrailstore.ts`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`

The model passes `hasTree, hasTranscript, hasCouncil` as positional booleans through `visibleTabs`, `shownTab`,
`selectTab`, `stripKeys`, `shownKey`, `selectKey` (`agentrailtabs.ts`) and `selectRailTab`, `selectRailKey`
(`agentrailstore.ts`). Two more booleans would make five; replace them with one object.

Modify `agentrailtabs.ts` and `agentrailstore.ts`; in `agentrailpanel.tsx` and `agentdetailsrail.tsx` the callers only;
test in `agentrailtabs.test.ts`.

**Step 1: Write the failing tests** (add to `agentrailtabs.test.ts`; adapt the existing calls to the new signature in the
same edit)

```ts
const has = (o: Partial<RailHas> = {}): RailHas => ({
    tree: false, transcript: false, council: false, brainstorm: false, initiative: false, ...o,
});

describe("brainstorm and initiative tabs", () => {
    const p = panelFor({}, "a", "overview");
    it("list after Council and before Summary, only while the agent has them", () => {
        expect(visibleTabs(p, has())).toEqual(["overview", "changes"]);
        expect(visibleTabs({ ...p, summary: true }, has({ council: true, brainstorm: true, initiative: true }))).toEqual([
            "overview", "changes", "council", "brainstorm", "initiative", "summary",
        ]);
    });
    it("fall back to Overview when the thing is gone, keeping the stored tab", () => {
        const q = selectTab(p, "initiative", has({ initiative: true }));
        expect(q.tab).toBe("initiative");
        expect(shownTab(q, has())).toBe("overview");
        expect(shownTab(q, has({ initiative: true }))).toBe("initiative");
    });
    it("are never a panel's default", () => {
        expect(panelFor({}, "a", "brainstorm").tab).toBe("overview");
        expect(panelFor({}, "a", "initiative").tab).toBe("overview");
    });
});
```

**Step 2: Run** `npx vitest run frontend/app/view/agents/agentrailtabs.test.ts` — expect FAIL (`RailHas` not exported).

**Step 3: Implement** in `agentrailtabs.ts`:

```ts
export type RailTab =
    | "overview" | "tree" | "changes" | "transcript" | "council" | "brainstorm" | "initiative" | "file" | "summary";

/** What the agent has that a conditional tab needs: a worktree to list (and no subagent interior open), its own
 *  transcript, a council it started, an attached brainstorm, a linked initiative. */
export type RailHas = { tree: boolean; transcript: boolean; council: boolean; brainstorm: boolean; initiative: boolean };

export const RAIL_HAS_NONE: RailHas = { tree: false, transcript: false, council: false, brainstorm: false, initiative: false };
```

- `visibleTabs(p, has)`: push order overview, tree?, changes, transcript?, council?, brainstorm?, initiative?, summary?,
  file?.
- `shownTab(p, has)`: add `(p.tab === "brainstorm" && !has.brainstorm) || (p.tab === "initiative" && !has.initiative)`.
- `panelFor`: add `"brainstorm"` and `"initiative"` to the never-default list (update its comment).
- `selectTab(p, tab, has)`, `stripKeys(p, has)`, `shownKey(p, has)`, `selectKey(p, key, has)`: same bodies, the object
  in place of the booleans.
- `wideTabOf`: both new tabs are fixed width (return null), like Overview.

In `agentrailstore.ts`: `selectRailTab(agentId, tab, has)`, `selectRailKey(agentId, key, has)`. `openRailTranscript`
and `openRailCouncil` pass `{ ...RAIL_HAS_NONE, transcript: true }` / `{ ...RAIL_HAS_NONE, council: true }`. Add:

```ts
// Opens the rail on the agent's Brainstorm tab. The caller has checked that a brainstorm is attached.
export function openRailBrainstorm(agentId: string): void {
    update(agentId, (p) => selectTab(p, "brainstorm", { ...RAIL_HAS_NONE, brainstorm: true }));
    globalStore.set(railVisibleAtom, true);
}

// Opens the rail on the agent's Initiative tab (the ◇ chip, `i`, "Review on the rail"). The caller has checked that the
// agent is linked. `section` unfolds that section and scrolls it into view (railInitiativeSectionAtom).
export function openRailInitiative(agentId: string, section?: "plan"): void {
    update(agentId, (p) => selectTab(p, "initiative", { ...RAIL_HAS_NONE, initiative: true }));
    globalStore.set(railVisibleAtom, true);
    if (section != null) {
        globalStore.set(railInitiativeSectionAtom, { ...globalStore.get(railInitiativeSectionAtom), [agentId]: section });
    }
}

// the Initiative tab section a caller asked to show, per agent; the pane clears it once it has unfolded it
export const railInitiativeSectionAtom = atom<Record<string, "plan">>({}) as PrimitiveAtom<Record<string, "plan">>;
```

Also a `toggleRailInitiative(agentId)`: when the panel shows Initiative and the rail is visible, select `prevTab`;
otherwise `openRailInitiative(agentId)`. Test it through `selectTab`'s `prevTab` behaviour if it is pure enough;
otherwise leave it to the CDP scenario.

Update the callers in `agentrailpanel.tsx` (`RailTabStrip` builds `has` from its props) and `agentdetailsrail.tsx`
(builds `has` once: `tree: hasTree, transcript: hasTranscript, council: council != null, brainstorm:
useAtomValue(brainstormAtom(agent.id)) != null, initiative: agent.effortId != null` — `brainstormAtom` is in
`brainstormstore.ts`). No new tab is drawn yet.

**Step 4: Run** the test file — expect PASS. Run `npx vitest run frontend/app/view/agents/agentrail` — PASS.

**Step 5: Commit** `refactor(rail): one RailHas in place of the tab booleans; Brainstorm and Initiative tabs in the model`

### Task 2: The brainstorm timeline model

**Depends on:** none
**Files:** `frontend/app/view/agents/railbrainstorm.ts`, `frontend/app/view/agents/railbrainstorm.test.ts`

Create both files.

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { BrainstormBandModel } from "./brainstormband";
import { railBrainstormRows } from "./railbrainstorm";

const model = (o: Partial<BrainstormBandModel> = {}): BrainstormBandModel => ({
    title: "Lịch 3 ngày tới trên Overview",
    newCount: 0,
    boards: [],
    decided: [],
    ...o,
});

describe("railBrainstormRows", () => {
    it("numbers the decisions in the design's order and hangs each board under its part", () => {
        const r = railBrainstormRows(
            model({
                decided: [
                    { id: "p1", title: "Mục đích", gist: "Overview có thêm khối lịch." },
                    { id: "p5", title: "Vị trí", gist: "Cột trái." },
                ],
                boards: [{ name: "A-left.dc.html", part: "Vị trí", isNew: false }],
            })
        );
        expect(r.rows.map((x) => [x.n, x.title, x.boards.map((b) => b.name)])).toEqual([
            [1, "Mục đích", []],
            [2, "Vị trí", ["A-left.dc.html"]],
        ]);
        expect(r.openParts).toEqual([]);
    });
    it("marks a decision whose board is new", () => {
        const r = railBrainstormRows(
            model({
                decided: [{ id: "p6", title: "Lịch 30 ngày", gist: "Lưới 5 tuần." }],
                boards: [{ name: "M-B.dc.html", part: "Lịch 30 ngày", isNew: true }],
                newCount: 1,
            })
        );
        expect(r.rows[0].hasNew).toBe(true);
    });
    it("lists boards of undecided parts under Open parts, in board order", () => {
        const r = railBrainstormRows(
            model({ boards: [{ name: "Q.dc.html", part: "Bấm vào một ngày", isNew: true }], newCount: 1 })
        );
        expect(r.rows).toEqual([]);
        expect(r.openParts.map((b) => b.name)).toEqual(["Q.dc.html"]);
    });
    it("orders every board for ← / → as drawn: timeline first, then Open parts", () => {
        const r = railBrainstormRows(
            model({
                decided: [{ id: "p1", title: "A", gist: "" }],
                boards: [
                    { name: "open.dc.html", part: "Z", isNew: false },
                    { name: "a.dc.html", part: "A", isNew: false },
                ],
            })
        );
        expect(r.boardOrder).toEqual(["a.dc.html", "open.dc.html"]);
    });
});
```

**Step 2: Run** `npx vitest run frontend/app/view/agents/railbrainstorm.test.ts` — FAIL (module missing).

**Step 3: Implement**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent rail's Brainstorm tab as one timeline (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-
// tabs-design.md, canvas board D-timeline): the decisions that are the user's, numbered in the design's order, each with
// the boards of its part under it; boards whose part is not decided yet list after it as Open parts. Pure.

import type { BandBoard, BrainstormBandModel } from "./brainstormband";

export type RailBrainstormRow = { id: string; n: number; title: string; gist: string; boards: BandBoard[]; hasNew: boolean };

export type RailBrainstormView = {
    rows: RailBrainstormRow[];
    openParts: BandBoard[];
    /** every board in the order the tab draws them, for the board dialog's ← / → */
    boardOrder: string[];
};

export function railBrainstormRows(m: BrainstormBandModel): RailBrainstormView {
    const byPart = new Map<string, BandBoard[]>();
    for (const b of m.boards) {
        byPart.set(b.part, [...(byPart.get(b.part) ?? []), b]);
    }
    const decidedParts = new Set(m.decided.map((d) => d.title));
    const rows = m.decided.map((d, i) => {
        const boards = byPart.get(d.title) ?? [];
        return { id: d.id, n: i + 1, title: d.title, gist: d.gist, boards, hasNew: boards.some((b) => b.isNew) };
    });
    const openParts = m.boards.filter((b) => !decidedParts.has(b.part));
    return { rows, openParts, boardOrder: [...rows.flatMap((r) => r.boards), ...openParts].map((b) => b.name) };
}
```

**Step 4: Run** the test — PASS.

**Step 5: Commit** `feat(rail): the brainstorm timeline model`

### Task 3: The Brainstorm tab

**Depends on:** Task 1, Task 2 (railBrainstormRows draws the timeline and orders the boards for ← / →)
**Files:** `frontend/app/view/agents/railbrainstormpane.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/brainstormbandview.tsx`, `frontend/app/view/agents/chatband.tsx`, `frontend/app/view/agents/agentsurface.tsx`

Create `railbrainstormpane.tsx`. In `agentdetailsrail.tsx` the strip entry and body; in `agentrailpanel.tsx` the tab's
dot, like `RailCouncilTab`. The board dialog moves from `chatband.tsx` into `brainstormbandview.tsx` and renders from
`agentsurface.tsx`, beside `<ChatLayer>` in the cell (step 3).

**Step 1: The pane.** `RailBrainstormPane({ model, agent })` reads `brainstormBandAtom(agent.id)` and
`brainstormAtom(agent.id)` (`brainstormstore.ts`) and draws board D:
- Head: title (13px semibold, truncate), `Open` with a `KeyCap` `b` that calls `openBrainstorm(agent.id)`
  (`brainstormbandview.tsx`); meta line `<state> · Decided N · M boards` in `text-muted`.
- Timeline from `railBrainstormRows`: an 18px number circle per row (`border-edge-strong text-muted`; filled
  `bg-accent text-background` when `hasNew`), a 1px `bg-edge-mid` line joining circles (none after the last), the title
  `text-[12px] font-semibold text-ink-hi` with a `new` tag (`text-accent`) when `hasNew`, the gist `line-clamp-2
  text-[11.5px] text-ink-mid`, then one chip per board (`LayoutTemplate` icon, the name truncated, `new` when
  `isNew`; `border-edge-mid bg-surface-raised rounded-[6px] h-[22px]`). A chip is a `<button>` calling
  `openChatBoard(agent.id, name)`.
- `Open parts` heading and the same chips after the timeline when `openParts` is not empty.
- States: `bs == null` with a brainstorm attached → `Reading brainstorm.json…`; the store's `error` → its text in
  `text-error`; no rows → `Nothing decided yet` above Open parts.
- The body scrolls (`overflow-y-auto`, `[scrollbar-gutter:stable]`, as the Changes tab).

**Step 2: The tab.** In `agentdetailsrail.tsx` add a strip entry after Council when `has.brainstorm`: key
`brainstorm`, `Lightbulb` 17/1.8, aria-label `Brainstorm`, onClick `selectRailTab(agent.id, "brainstorm", has)` then
`showRail()`; body `shown === "brainstorm"` → `<RailBrainstormPane model={model} agent={agent} />`. In `RailTabStrip`
draw the icon with an accent dot (as `RailCouncilTab` draws its dot) while `newCount > 0`.

**Step 3: The board dialog leaves the band.** Today `BoardDialog` + `BoardPreview` are children of `ChatBandRoot`
(`chatband.tsx:278-288`) and its key handler owns Esc, ← / →, `b` (`chatband.tsx:166-186`). Move them into a
`ChatBoardDialog({ agent })` component in `brainstormbandview.tsx` that renders over the agent's cell in both views:
render it in the cell beside `<ChatLayer>` (`agentsurface.tsx`, ~line 890), where the chat layer and the terminal are
siblings, positioned against the cell. It reads `chatBoardPreviewAtom(agent.id)`; its root is `data-owns-keys`,
takes focus when a board opens, and handles Esc (close), `b` (close + `openBrainstorm`), ← / → (the neighbour in
`railBrainstormRows(...).boardOrder`, through `startBoardPreview`). Keep `chatband.tsx` compiling for now (it may
import the moved pieces); Task 5 deletes it.

**Step 4: Check in the dev app** with a fixture agent that has a brainstorm (the arrange of
`scripts/cdp/scenarios-chat-brainstorm-band.mjs` shows how to attach one): the tab shows, the dot shows with a new
board, a chip opens the dialog over the cell, ← / → step, Esc closes. Run `task check:ts`.

**Step 5: Commit** `feat(rail): the Brainstorm tab, one timeline with each board under its decision`

### Task 4: The Initiative tab, with Plan to review moved into it

**Depends on:** Task 1, Task 3
**Files:** `frontend/app/view/agents/railinitiativepane.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentrailsections.ts`, `frontend/app/view/agents/agentrailsections.test.ts`, `frontend/app/view/agents/railsection.ts`, `frontend/app/view/agents/railsection.test.ts`, `frontend/app/view/agents/initiativepopover.tsx`, `frontend/app/view/agents/initiativebandview.tsx`

Create `railinitiativepane.tsx`. It waits for Task 3 only because both add a strip entry and a body to
`agentdetailsrail.tsx` and `agentrailpanel.tsx`. `initiativepopover.tsx:217` is `reviewOnRail`; `initiativebandview.tsx`
gives up `useInitiativePart` (step 2).

**Step 1: Overview loses Plan to review (test first).** In `agentrailsections.test.ts` change the cases that expect a
`plan` section to expect none; run, see them fail; remove the `plan` id and its push (`agentrailsections.ts:19, 87-88`),
`proposed` from `AgentRailInput` if nothing else reads it, and the `plan:` renderer (`agentdetailsrail.tsx:1192`).
`openRailSection(agentId, "plan")` callers (`initiativebandview.tsx:350`, `initiativepopover.tsx:217`) call
`openRailInitiative(agentId, "plan")` instead; drop `"plan"` from `railsection.ts` and its test.

**Step 2: The pane.** `RailInitiativePane({ model, agent })` draws board B from the band's pieces. Move, don't copy:
`useInitiativePart` (`initiativebandview.tsx:123`) already returns the line, the body, the keys (`menuKey`, `rowKey`,
`markDone`, `startNote`) and the error. Split it so the rail can lay them out vertically:
- **Head:** title + `Open in Jarvis ↗` (`openInJarvis`), the `↳ Part of` parent link, project · status, `SegmentBar`
  with `done/total`, `On N · <chunk>` and `Mark done` with `KeyCap m` (or `Pick a chunk…` when on no chunk).
- **Sections** with `RailSectionHeader` (`@/app/element/railsections`), each folding: `Chunks` (the band's window rows,
  status / rename menu `initiativechunkmenu.tsx`, `Work on this` `w`, `All chunks (N)`), `Plan to review` (render
  `<PlanReviewSection agent={agent} />` while `usePlanReview(agent.effortId)` has rows and no subagent interior is
  open; count in `text-asking`), `Latest note on N` (note, `Add note` `n`).
- The rows drop the band's 2-column grid and `narrow` switch: the rail is always one column.
- The pane's root is `data-owns-keys` with the band's handler for `m`, `n`, `w`, arrows, Enter, the menu keys; Esc
  hands focus to the message box (`focusChatBox`) or blurs.
- `railInitiativeSectionAtom[agent.id] === "plan"` unfolds Plan to review, scrolls it into view, then clears the entry.
- States: loading → `Loading the initiative…`; error → the band's error line with Retry.
- Drop the band's first-use hint (`useBandHint`, "How the band works"): the rail needs none.

**Step 3: The tab.** Strip entry after Brainstorm when `has.initiative`: key `initiative`, the ◇ icon the header chip
uses (lucide `Diamond`), aria-label `Initiative (i)`; body `shown === "initiative"` → `<RailInitiativePane .../>`.
In `RailTabStrip` an asking dot while Plan to review has proposed rows.

**Step 4:** `npx vitest run frontend/app/view/agents/agentrailsections.test.ts frontend/app/view/agents/railsection.test.ts`
PASS; `task check:ts` clean; check the tab in the dev app on a linked fixture agent (`scenarios-chat-initiative-band.mjs`
shows how to link one): Mark done, Work on this, Add note, the status menu, Plan to review Accept.

**Step 5: Commit** `feat(rail): the Initiative tab; Plan to review moves from Overview into it`

### Task 5: Delete the band and the ◇ popover; the chip and `i` open the tab

**Depends on:** Task 3, Task 4
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatband.tsx`, `frontend/app/view/agents/brainstormbandview.tsx`, `frontend/app/view/agents/initiativebandview.tsx`, `frontend/app/view/agents/initiativebandstore.ts`, `frontend/app/view/agents/initiativebandstore.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/initiativepopover.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/store/keybindings/whenstate.test.ts`, `docs/keyboard-shortcuts.md`

- `chatpane.tsx:56,1224`: drop `ChatBand`
- Delete `chatband.tsx`
- Trim: `brainstormbandview.tsx` (drop `BrainstormLine`, `BrainstormBody`), `initiativebandview.tsx` (drop the
  line/body code the pane did not take; delete the file if nothing is left), `initiativebandstore.ts` (drop the band
  part state `bandPartsAtom`, `useBandPart`, `setBandPart`, `toggleBandPart`, `BAND_STORAGE_KEY`, the hint; keep
  `switchAgentChunk`, `switchAndTell`) and its test
- `agentheader.tsx` (the ◇ chip and `<InitiativePopover>`), `initiativepopover.tsx`
- `bindings.ts` (`agent:initiative`, ~2039), `whenstate.ts` (+ its test), `bindings.test.ts`, `docs/keyboard-shortcuts.md`

**Step 1:** Grep every import of each symbol and file you remove, `import type` and re-exports included
(`chatband`, `ChatBand`, `BrainstormLine`, `BrainstormBody`, `useInitiativePart`, `bandPartsAtom`, `useBandPart`,
`setBandPart`, `toggleBandPart`, `InitiativePopover`, `initiativePopoverAtom`, `data-chat-band`, `data-initiative-band`,
`chatsuggest.ts`, `chatbrainstormcard.tsx`, `chatinitiativecard.tsx`, `initiativechunkmenu.tsx`).

**Step 2: The header.** The ◇ chip shows in Chat and Terminal (`<initiative> · done/total`); its click focuses the
agent and calls `openRailInitiative(agent.id)`. Remove `<InitiativePopover>` and the linked-agent half of
`initiativepopover.tsx`; keep the Link to initiative picker (`initiativeLinkPickerAtom`, `openInitiativeLinkPicker`).
The header's `Brainstorm` view switch shows the accent dot by `brainstormTabDot` as today; confirm it still reads
`newCount` with the band gone.

**Step 3: `i`.** `agent:initiative`: linked agent → `toggleRailInitiative(agent.id)`; not linked →
`openInitiativeLinkPicker` as today; otherwise pass. Rewrite its comment; update `bindings.test.ts`; drop the
`[data-initiative-band]` read from `whenstate.ts` if nothing else uses it. Update `docs/keyboard-shortcuts.md`.

**Step 4:** `npx vitest run frontend/app/store/keybindings frontend/app/view/agents/initiativebandstore.test.ts` PASS;
`task check:ts` clean; in the dev app Chat starts under the header, the chip and `i` open and close the tab in Chat and
Terminal, a split of four shows the chip in each linked cell.

**Step 5: Commit** `feat(agent): the Chat band and the ◇ popover go; the chip and i open the rail's Initiative tab`

### Task 6: CDP scenarios, What's new, docs

**Depends on:** Task 5 (the scenarios assert the band is gone and the chip and i open the Initiative tab)
**Files:** `scripts/cdp/scenarios-rail-brainstorm-initiative.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-chat-brainstorm-band.mjs`, `scripts/cdp/scenarios-chat-initiative-band.mjs`, `scripts/cdp/scenarios-chat-suggest-card.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`, `public/whatsnew/`

Create `scenarios-rail-brainstorm-initiative.mjs` and register it in `scenarios.mjs`. Delete
`scenarios-chat-brainstorm-band.mjs` and `scenarios-chat-initiative-band.mjs` (unregister them; reuse their arrange and
teardown helpers in the new file). Edit `scenarios-chat-suggest-card.mjs` only if it reads the band. The What's new
picture lands in `public/whatsnew/`.

**Step 1: Scenarios**, each arrange → goto → shot → assert → teardown:
- `rail-brainstorm-tab`: a fixture agent with a brainstorm of several decisions and two boards, one new and one on an
  undecided part. Select the Brainstorm tab. Assert: the strip has the tab with its dot; numbered rows; the new board's
  chip under its decision with `new`; the Open parts heading. Shot the rail. Then click a chip: the dialog shows; `→`
  moves to the next board; Esc closes; shot.
- `rail-initiative-tab`: a linked fixture agent with proposed chunks. Press `i`: the rail shows the Initiative tab with
  head, Chunks, Plan to review (count, asking dot on the tab), Latest note; shot. Fold Chunks; shot. Press `i` again:
  the previous tab returns. Assert no `[data-chat-band]` in the page.
- `rail-tabs-split`: a split of four, two linked agents, one with a brainstorm with a new board. Assert each linked
  cell's header has the ◇ chip and the Brainstorm switch has its dot; shot.

Run them: `task verify:ui -- rail-brainstorm-tab rail-initiative-tab rail-tabs-split` against the dev app — PASS.

**Step 2: What's new.** Under `## Unreleased` → `Changed` in `CHANGELOG.md`:
`- Brainstorm and initiative moved out of the band above Chat into two tabs of the agent's right panel: the brainstorm
as one timeline with each board under its decision, the initiative with its chunks, plan to review and notes. The ◇
chip and i open it. <!-- big --> <!-- try: agent:initiative --> <!-- shot: <file> -->` — make the picture in the
`rail-brainstorm-tab` scenario with `await h.whatsnewShot("rail-tabs", { selector: <the rail's selector> })`.

**Step 3:** Add `- [ ] (arcterm) …` lines to `docs/hand-checks.md` for what the scenarios cannot reach (the dialog's
focus over a terminal cell; the strip with every tab present at 300px not clipping).

**Step 4: Commit** `test(cdp): rail Brainstorm and Initiative scenarios; changelog`
