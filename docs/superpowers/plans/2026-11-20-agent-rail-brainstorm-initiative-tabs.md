# Brainstorm and Initiative rail tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Chat band's brainstorm and initiative parts into two conditional tabs of the Agent rail, delete the
band, and make the header's ◇ chip and `i` open the Initiative tab in Chat and Terminal alike.

**Architecture:** The rail's tab model (`agentrailtabs.ts`) learns two tabs that show only while the agent has the
thing, like Council. Task 1 lands the model, both strip entries with their dots, and the two body cases with stub panes,
so the two panes (`railbrainstormpane.tsx`, `railinitiativepane.tsx`) are filled in parallel by Tasks 3 and 4. The
brainstorm timeline is a pure model (`railbrainstorm.ts`); the initiative pane reuses the band's model
(`initiativeband.ts`) and its writes (`initiativebandstore.ts`'s `switchAgentChunk` / `switchAndTell`). Then the band, the
◇ popover's linked view, Overview's Plan to review section and the `railsection.ts` request it was the last user of are
deleted.

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, lucide-react, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md`

**Verify:** `node scripts/verify.mjs`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs rail-brainstorm-tab rail-initiative-tab rail-tabs-split initiative-plan-review initiative-link`

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
clip at 300px (asserted in Task 6's `rail-tabs-split`).

### Task 1: The rail's tab model, strip entries and stub panes for Brainstorm and Initiative

**Depends on:** none
**Files:** `frontend/app/view/agents/agentrailtabs.ts`, `frontend/app/view/agents/agentrailtabs.test.ts`, `frontend/app/view/agents/agentrailstore.ts`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/railbrainstormpane.tsx`, `frontend/app/view/agents/railinitiativepane.tsx`

The model passes `hasTree, hasTranscript, hasCouncil` as positional booleans through `visibleTabs`, `shownTab`,
`selectTab`, `stripKeys`, `shownKey`, `selectKey` (`agentrailtabs.ts`) and `selectRailTab`, `selectRailKey`
(`agentrailstore.ts`). Two more booleans would make five; replace them with one object.

This task also lands everything the two later panes share in `agentrailpanel.tsx` and `agentdetailsrail.tsx` (the strip
entries, their dots, the body cases), so Task 3 and Task 4 each fill only their own pane file and run in parallel.

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
    it("toggle back from Initiative to the tab before it, whatever that tab needs", () => {
        const q = selectTab({ ...p, tab: "transcript" }, "initiative", has({ initiative: true }));
        expect(backFromInitiative(q)).toMatchObject({ tab: "transcript" });
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

/** `i` on a shown Initiative tab: back to the tab before it, set directly (not through selectTab, which would refuse a
 *  conditional tab without knowing what the agent has); shownTab falls back to Overview if that tab is gone. */
export function backFromInitiative(p: PanelState): PanelState {
    const back = p.prevTab === "initiative" ? "overview" : p.prevTab;
    return { ...p, tab: back, prevTab: "initiative" };
}
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

// Opens the rail on the agent's Initiative tab (the ◇ chip, `i`, the header's "N to review" chip, "Review on the
// rail"). The caller has checked that the agent is linked. `section` unfolds that section and scrolls it into view
// (railInitiativeSectionAtom). The pane takes focus when it shows from here (railInitiativeFocusAtom), so its keys work
// at once.
export function openRailInitiative(agentId: string, section?: "plan"): void {
    update(agentId, (p) => selectTab(p, "initiative", { ...RAIL_HAS_NONE, initiative: true }));
    globalStore.set(railVisibleAtom, true);
    globalStore.set(railInitiativeFocusAtom, agentId);
    if (section != null) {
        globalStore.set(railInitiativeSectionAtom, { ...globalStore.get(railInitiativeSectionAtom), [agentId]: section });
    }
}

// `i`: the Initiative tab when it is not on show (or the rail is hidden), else back to the tab before it.
export function toggleRailInitiative(agentId: string): void { /* shown & visible → update(agentId, backFromInitiative) */ }

// the Initiative tab section a caller asked to show, per agent; the pane clears it once it has unfolded it
export const railInitiativeSectionAtom = atom<Record<string, "plan">>({}) as PrimitiveAtom<Record<string, "plan">>;
// the agent whose Initiative pane should take focus when it next shows; the pane clears it
export const railInitiativeFocusAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
```

`toggleRailInitiative` reads the panel's stored `tab` (not `shownTab`): the caller has checked the agent is linked, so a
stored Initiative tab is the shown one.

**Step 4: Strip entries, dots and body cases.** `RailTabStrip` (`agentrailpanel.tsx`) takes `has: RailHas` in place of
`hasTree` / `hasTranscript` (it keeps `council: Council | null` for `RailCouncilTab`) plus `brainstormNew: boolean` and
`initiativeAsking: boolean`, and draws after the Council tab:
- `has.brainstorm` → a `brainstorm` tab: lucide `Lightbulb` 16/1.8, aria-label and title `Brainstorm`, with an accent dot
  while `brainstormNew` (drawn as `RailCouncilTab` draws its dot).
- `has.initiative` → an `initiative` tab: lucide `Diamond` (the ◇ the header chip uses) 16/1.8, aria-label and title
  `Initiative (i)`, with an asking-colour dot while `initiativeAsking`.

`agentdetailsrail.tsx` builds `has` once: `tree: hasTree, transcript: hasTranscript, council: council != null,
brainstorm: useAtomValue(brainstormAtom(agent.id)) != null, initiative: agent.effortId != null` (`brainstormAtom` in
`brainstormstore.ts`), and passes `brainstormNew = (useAtomValue(brainstormBandAtom(agent.id))?.newCount ?? 0) > 0` and
`initiativeAsking = usePlanReview(agent.effortId).proposed > 0` (`planreviewstore.ts`). Every caller of the changed
functions in this file takes `has` (including `revealSection`'s `selectRailTab`). The body adds `shown === "brainstorm"`
→ `<RailBrainstormPane model={model} agent={agent} />` and `shown === "initiative"` → `<RailInitiativePane model={model}
agent={agent} />`.

Create `railbrainstormpane.tsx` and `railinitiativepane.tsx` as stubs with those exports and props, each rendering an
empty root with `data-rail-brainstorm={agent.id}` / `data-rail-initiative={agent.id}`; Tasks 3 and 4 fill them.

**Step 5: Run** the test file — expect PASS. Run `npx vitest run frontend/app/view/agents/agentrail` — PASS.

**Step 6: Commit** `refactor(rail): one RailHas in place of the tab booleans; Brainstorm and Initiative tabs in the strip`

### Task 2: The brainstorm timeline model

**Depends on:** none
**Files:** `frontend/app/view/agents/railbrainstorm.ts`, `frontend/app/view/agents/railbrainstorm.test.ts`

Create both files. The one flag a row carries is `hasNew` (a board under it is new); there is no separate "newest"
flag (spec, Tests).

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

**Depends on:** Task 1, Task 2
**Files:** `frontend/app/view/agents/railbrainstormpane.tsx`, `frontend/app/view/agents/brainstormbandview.tsx`, `frontend/app/view/agents/chatband.tsx`, `frontend/app/view/agents/agentsurface.tsx`

Fill the stub `railbrainstormpane.tsx` Task 1 created (the strip entry, its dot and the body case are already there).
The board dialog moves from `chatband.tsx` into `brainstormbandview.tsx` and renders from `agentsurface.tsx`, beside
`<ChatLayer>` in the cell (step 2).

**Step 1: The pane.** `RailBrainstormPane({ model, agent })` reads `brainstormBandAtom(agent.id)` and
`brainstormAtom(agent.id)` (`brainstormstore.ts`) and draws board D. Keep the root's `data-rail-brainstorm={agent.id}`
and put these markers on for the scenarios: `data-rail-brainstorm-row={n}` (with `data-has-new` when `hasNew`) on each
timeline row, `data-rail-board={name}` (with `data-new` when `isNew`) on each chip, `data-rail-brainstorm-open-parts` on
the Open parts heading, `data-rail-brainstorm-state` on the state line.
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
- The root is `data-owns-keys` and handles `b` (open the Brainstorm view).
- The body scrolls (`overflow-y-auto`, `[scrollbar-gutter:stable]`, as the Changes tab).

**Step 2: The board dialog leaves the band.** Today `BoardDialog` (`brainstormrail.tsx:443`) + `BoardPreview`
(`brainstormbandview.tsx:271`) are children of `ChatBandRoot` (`chatband.tsx:278-288`) and its key handler owns Esc,
← / →, `b` (`chatband.tsx:166-186`). Move them into a `ChatBoardDialog({ agent })` component in `brainstormbandview.tsx`
that renders over the agent's cell in both views: render it in the cell beside `<ChatLayer>` (`agentsurface.tsx`,
~line 890), where the chat layer and the terminal are siblings, positioned against the cell. It reads
`chatBoardPreviewAtom(agent.id)`; its root is `data-owns-keys` and carries `data-chat-board-dialog={agent.id}`, takes
focus when a board opens, and handles Esc (close, focus back where it was), `b` (close + `openBrainstorm`), ← / → (the
neighbour in `railBrainstormRows(...).boardOrder`, through `startBoardPreview`). Remove the dialog from `chatband.tsx`
so it is not drawn twice; keep `chatband.tsx` otherwise compiling (Task 5 deletes it).

**Step 3: Check in the dev app** with a fixture agent that has a brainstorm (the arrange of
`scripts/cdp/scenarios-chat-brainstorm-band.mjs` shows how to attach one): the tab shows, the dot shows with a new
board, a chip opens the dialog over the cell (also with the agent in Terminal view), ← / → step, Esc closes, `b` opens
the Brainstorm view. Run `task check:ts`.

**Step 4: Commit** `feat(rail): the Brainstorm tab, one timeline with each board under its decision`

### Task 4: The Initiative tab, with Plan to review moved into it

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/railinitiativepane.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentrailsections.ts`, `frontend/app/view/agents/agentrailsections.test.ts`, `frontend/app/view/agents/railsection.ts`, `frontend/app/view/agents/railsection.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/initiativepopover.tsx`, `frontend/app/view/agents/initiativebandview.tsx`, `frontend/app/element/collapsiblerail.tsx`

Fill the stub `railinitiativepane.tsx` Task 1 created (strip entry, asking dot and body case are already there).

**Step 1: Overview loses Plan to review (test first).** In `agentrailsections.test.ts` change the cases that expect a
`plan` section to expect none; run, see them fail; remove the `plan` id and its push (`agentrailsections.ts:19, 87-88`),
`proposed` from `AgentRailInput` if nothing else reads it, and in `agentdetailsrail.tsx` the `plan:` renderer (~1192)
and the `plan` entries of the `LABEL` / `ICON` maps keyed by `AgentRailSectionId` (~1064, ~1078).

The three `openRailSection(agentId, "plan")` callers call `openRailInitiative(agentId, "plan")` instead:
`agentheader.tsx:361` (`PlanReviewChip`, the header's "N to review" chip), `initiativebandview.tsx:350` and
`initiativepopover.tsx:218` (both deleted in Task 5). `plan` was the only section ever requested, so
`railsection.ts`, `railsection.test.ts` and the request effect in `agentdetailsrail.tsx` (~1055-1062, with its
`railSectionRequestAtom` read and imports) go: grep `railsection`, `openRailSection`, `railSectionRequestAtom`,
`clearRailSectionRequest` first, `import type` included.

**Step 2: The folding section header.** The rail's folding section header is `HeadedSection`, unexported, in
`frontend/app/element/collapsiblerail.tsx:40` (it takes a `RailSection` and a `RailSectionHeader` from
`element/railsections.ts`, and keeps open/closed in `railSectionOpenAtom`). Export it unchanged; the pane draws its
sections through it, with ids `initiative-chunks`, `initiative-plan`, `initiative-note`.

**Step 3: The pane.** `RailInitiativePane({ model, agent })` draws board B from the band's pieces. `useInitiativePart`
(`initiativebandview.tsx:123`) returns the line, the body, the keys (`menuKey`, `rowKey`, `markDone`, `startNote`) and the
error. `chatband.tsx:45,99` still uses it until Task 5, so keep it exported and working: extract what the pane needs
(the rows, the key handler, the writes) into pieces both can import from `initiativebandview.tsx`, or import them as
they are; Task 5 moves whatever the pane still imports from that file into `railinitiativepane.tsx` and deletes the rest.
Keep the root's `data-rail-initiative={agent.id}` and put on `data-rail-initiative-section={id}` per section,
`data-rail-initiative-row={chunk label}` per chunk row, `data-rail-initiative-state` on a state line.
- **Head:** title + `Open in Jarvis ↗` (`openInJarvis`), the `↳ Part of` parent link, project · status, `SegmentBar`
  with `done/total`, `On N · <chunk>` and `Mark done` with `KeyCap m` (or `Pick a chunk…` when on no chunk).
- **Sections**, each through `HeadedSection`: `Chunks` (the band's window rows, status / rename menu
  `initiativechunkmenu.tsx`, `Work on this` `w`, `All chunks (N)`), `Plan to review` (render
  `<PlanReviewSection agent={agent} />` while `usePlanReview(agent.effortId)` has rows and no subagent interior is
  open; count in `text-asking`), `Latest note on N` (note, `Add note` `n`).
- The rows drop the band's 2-column grid and `narrow` switch: the rail is always one column.
- The pane's root is `data-owns-keys` (so the global single-key bindings stand down while it has focus) with the band's
  handler for `m`, `n`, `w`, arrows, Enter, the menu keys, plus `i` (`toggleRailInitiative(agent.id)`, then focus the
  cell's message box or terminal); Esc hands focus to the message box (`focusChatBox`) or blurs.
- Focus: when `railInitiativeFocusAtom === agent.id` the pane focuses its root once it shows, then clears the atom.
- `railInitiativeSectionAtom[agent.id] === "plan"` unfolds Plan to review, scrolls it into view, then clears the entry.
- States: loading → `Loading the initiative…`; error → the band's error line with Retry.
- Drop the band's first-use hint (`useBandHint`, "How the band works"): the rail needs none.

**Step 4:** `npx vitest run frontend/app/view/agents/agentrailsections.test.ts` PASS; `task check:ts` clean; check the
tab in the dev app on a linked fixture agent (`scenarios-chat-initiative-band.mjs` shows how to link one): Mark done,
Work on this, Add note, the status menu, Plan to review Accept, the "N to review" chip opening Plan to review unfolded.

**Step 5: Commit** `feat(rail): the Initiative tab; Plan to review moves from Overview into it`

### Task 5: Delete the band and the ◇ popover; the chip and `i` open the tab

**Depends on:** Task 3, Task 4
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatband.tsx`, `frontend/app/view/agents/brainstormbandview.tsx`, `frontend/app/view/agents/initiativebandview.tsx`, `frontend/app/view/agents/railinitiativepane.tsx`, `frontend/app/view/agents/initiativebandstore.ts`, `frontend/app/view/agents/initiativebandstore.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/initiativepopover.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/store/keybindings/whenstate.test.ts`, `docs/keyboard-shortcuts.md`

- `chatpane.tsx:56,1224`: drop `ChatBand`
- Delete `chatband.tsx`
- Trim: `brainstormbandview.tsx` (drop `BrainstormLine`, `BrainstormBody`), `initiativebandview.tsx` (move what
  `railinitiativepane.tsx` still imports from it into the pane, drop the rest; delete the file if nothing is left),
  `initiativebandstore.ts` (drop the band part state `bandPartsAtom`, `useBandPart`, `setBandPart`, `toggleBandPart`,
  `BAND_STORAGE_KEY`, the hint; keep `switchAgentChunk`, `switchAndTell`) and its test
- `agentheader.tsx` (the ◇ chip and `<InitiativePopover>`), `initiativepopover.tsx`
- `bindings.ts`, `bindings.test.ts`, `whenstate.ts` (+ its test), `docs/keyboard-shortcuts.md` (step 3)

**Step 1:** Grep every import of each symbol and file you remove, `import type` and re-exports included
(`chatband`, `ChatBand`, `BrainstormLine`, `BrainstormBody`, `useInitiativePart`, `bandPartsAtom`, `useBandPart`,
`setBandPart`, `toggleBandPart`, `InitiativePopover`, `initiativePopoverAtom`, `initiativePopoverClosed`,
`data-chat-band`, `data-initiative-band`, `data-initiative-popover`, `chatsuggest.ts`, `chatbrainstormcard.tsx`,
`chatinitiativecard.tsx`, `initiativechunkmenu.tsx`).

**Step 2: The header.** The ◇ chip shows in Chat and Terminal (`<initiative> · done/total`, keeping its
`data-initiative-link-open` marker); its click focuses the agent's cell and calls `openRailInitiative(agent.id)`.
Remove `<InitiativePopover>`, `initiativePopoverAtom` and the linked-agent half of `initiativepopover.tsx`
(`agentheader.tsx:105,220,249`); keep the Link to initiative picker (`initiativeLinkPickerAtom`,
`openInitiativeLinkPicker`). The header's `Brainstorm` view switch shows the accent dot by `brainstormTabDot` as today
(`agentheader.tsx:556`, reading `brainstormBandAtom`'s `newCount`); confirm it still does with the band gone.

**Step 3: `i` and the popover's key yield.**
- `agent:initiative` (`bindings.ts` ~2039-2070): linked agent → `toggleRailInitiative(agent.id)`; not linked →
  `openInitiativeLinkPicker` as today; otherwise pass. The `[data-initiative-band]` lookup and the
  `initiativePopoverAtom` set go; rewrite its comment.
- `initiativePopoverClosed` (`bindings.ts:1351`) and its uses (1353, 1401, 1410, 1423, 2764), and the import at 111: the
  popover is gone, so the single-key Agent bindings no longer yield to it. Remove the guard from each condition.
- `whenstate.ts:40,97`: drop `initiativePopoverAtom` from the atoms the when-state tracks (+ `whenstate.test.ts` if it
  names it).
- `bindings.test.ts`: the `initiativePopoverAtom` / `[data-initiative-band]` cases (~3300-3460) become cases of the new
  `i`: linked → the Initiative tab shown and the rail visible; again → the previous tab; unlinked → the picker.
- `docs/keyboard-shortcuts.md`: `i` opens or closes the agent's Initiative tab.

**Step 4:** `npx vitest run frontend/app/store/keybindings frontend/app/view/agents/initiativebandstore.test.ts` PASS;
`task check:ts` clean; in the dev app Chat starts under the header, the chip and `i` open and close the tab in Chat and
Terminal, a split of four shows the chip in each linked cell.

**Step 5: Commit** `feat(agent): the Chat band and the ◇ popover go; the chip and i open the rail's Initiative tab`

### Task 6: The rail tab scenarios and What's new

**Depends on:** Task 5
**Files:** `scripts/cdp/scenarios-rail-brainstorm-initiative.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-chat-brainstorm-band.mjs`, `scripts/cdp/scenarios-chat-initiative-band.mjs`, `scripts/cdp/scenarios-chat-suggest-card.mjs`, `CHANGELOG.md`, `public/whatsnew/`

Create `scenarios-rail-brainstorm-initiative.mjs` and register it in `scenarios.mjs` (the import list near line 79 and
the spread of scenario arrays). Delete `scenarios-chat-brainstorm-band.mjs` and `scenarios-chat-initiative-band.mjs`
(unregister them; reuse their arrange and teardown helpers in the new file, and carry over every check of theirs that
still has a home: m / n / w, the status menu, Plan Accept, Retry). Edit `scenarios-chat-suggest-card.mjs` only if it
reads the band. The What's new picture lands in `public/whatsnew/`.

**Step 1: Scenarios**, each arrange → goto → shot → assert → teardown:
- `rail-brainstorm-tab`: a fixture agent with a brainstorm of several decisions and two boards, one new and one on an
  undecided part. Select the Brainstorm tab. Assert: the strip has the tab with its dot; numbered rows; the new board's
  chip under its decision with `new` and the row's number filled; the Open parts heading. Shot the rail. Click a chip:
  the dialog shows and holds focus (`document.activeElement` inside `[data-chat-board-dialog]`); `→` moves to the next
  board; Esc closes; shot. Put the agent in Terminal view, open a chip again: the dialog shows over the terminal cell
  and holds focus; `b` closes it and opens the Brainstorm view. Then rewrite the fixture: no decisions → `Nothing
  decided yet` above the boards; an unreadable brainstorm.json → its error text.
- `rail-initiative-tab`: a linked fixture agent with chunks, a note and proposed chunks, in Chat. Press `i`: the rail
  shows the Initiative tab with focus inside it; head, Chunks, Plan to review (count, asking dot on the tab), Latest
  note; shot. In the tab: `m` marks the chunk done (its row and `done/total` change); `n` opens Add note, type and Enter
  adds it (Latest note shows it); `w` on a row offering it switches the agent's chunk; the status menu changes a row's
  status and renames one; `All chunks (N)` unfolds the full list; Accept on a Plan to review row accepts it. Fold
  Chunks; shot. Press `i`: the previous tab returns. Click the ◇ chip in the header: the cell is focused, the rail shows
  and the Initiative tab is selected. Hide the rail, click the header's "N to review" chip: the rail shows on the
  Initiative tab with Plan to review unfolded and in view. Put the agent in Terminal view: the chip and `i` open and
  close the tab there too. Unlink the agent's chunk: `Pick a chunk…` shows. Assert no `[data-chat-band]` and no
  `[data-initiative-popover]` in the page at any step.
- `rail-tabs-split`: a split of four, two linked agents, one with a brainstorm with a new board, one linked agent that
  also started a council and has a Verify tile (the arranges of `scenarios-rail-council.mjs` and
  `scenarios-rail-verify.mjs`). Assert each linked cell's header has the ◇ chip and the Brainstorm switch has its
  dot; shot. Select the council agent with the rail at its 300px: the strip holds Council, Brainstorm, Initiative and the
  Verify count, and the last tab's rect lies inside the strip's rect (no clip); shot. Click the ◇ chip of an unfocused
  cell: that cell takes focus, the rail shows and its Initiative tab is selected.

Not asserted: the transient `Reading brainstorm.json…` and `Loading the initiative…` lines (a scenario cannot hold the
read in flight).

Run them: `task verify:ui -- rail-brainstorm-tab rail-initiative-tab rail-tabs-split` against the dev app — PASS.

**Step 2: What's new.** Under `## Unreleased` → `Changed` in `CHANGELOG.md`:
`- Brainstorm and initiative moved out of the band above Chat into two tabs of the agent's right panel: the brainstorm
as one timeline with each board under its decision, the initiative with its chunks, plan to review and notes. The ◇
chip and i open it. <!-- big --> <!-- try: agent:initiative --> <!-- shot: <file> -->` — make the picture in the
`rail-brainstorm-tab` scenario with `await h.whatsnewShot("rail-tabs", { selector: <the rail's selector> })`.

**Step 3: Commit** `test(cdp): rail Brainstorm and Initiative scenarios; changelog`

### Task 7: Retarget the old initiative scenarios

**Depends on:** Task 6 (both edit `scenarios.mjs`)
**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/overlays-frost/agents.mjs`

Tasks 4 and 5 break three scenarios in `scenarios.mjs` and one overlay group:
- `initiative-plan-review` (~67502-67834): it asserts Overview's `[data-rail-section="plan"]` first and the header's
  "N to review" chip. Retarget to the Initiative tab: the chip opens it with Plan to review unfolded (`[data-rail-initiative-section="initiative-plan"]`),
  the decisions are made there, Overview has no `plan` section.
- `initiative-popover` (~67838-68073): the popover is gone, and `rail-initiative-tab` (Task 6) covers what it checked on
  the tab. Remove the scenario and its helpers (`POP`, its row readers) if nothing else uses them; grep first.
- `initiative-link` (~68076-68190): step 3 reads `[data-initiative-band]`. After linking, assert the ◇ chip shows and
  that `i` opens the Initiative tab (`[data-rail-initiative]`) instead.
- The shared initiative arrange (~67411) also closes `[data-initiative-popover]`: drop that selector.
- `overlays-frost/agents.mjs:125-150`: the `initiative` group runs `initiative-popover` to frost the popover, which no
  longer exists. Remove the group (and its entry in `GROUPS`, ~616, and the header comment line ~10); grep for other
  readers of the scenario name.

Run `task verify:ui -- initiative-plan-review initiative-link` against the dev app — PASS.

**Commit** `test(cdp): initiative scenarios follow Plan to review onto the rail; the popover's scenario goes`
