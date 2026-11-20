# Rail tabs fix round 1: the chip and the Brainstorm dot on each split cell

Goal: the final stage failed on one finding. An unfocused cell of a split draws only `GridCellBar`
(`frontend/app/view/agents/gridcellbar.tsx`: grip, status dot, name, Chat | Terminal, x), so it no longer says it has an
initiative or a new brainstorm board. Before this run the Chat band said so inside every cell; Task 5 deleted the band.
The spec ("The header and the split": "so an unfocused cell of a split still says so"), board `C-split-cells` (each cell
shows the chip and the dot; a click focuses the cell and opens its rail tab) and `docs/keyboard-shortcuts.md` ("in a
split on the cell it sits in") all ask for it. Build it in the cell bar, and make `rail-tabs-split` check it on a cell
that is NOT focused.

Lead's call (autonomous run): the chip and the marker go in `GridCellBar`, on every cell of a split (focused or not, as
board C draws them), not in a second `AgentHeader` per cell. Why: the cell bar is the one thing each cell already has,
it stays 26px, and a header per cell would move every pane's terminal down and refit it.

Principles: simple and direct; one source of truth (the header and the cell bar share the chip's words and count); no
new store; tokens only, no raw colours.

**Spec:** `docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md`
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-brainstorm-tab rail-initiative-tab rail-tabs-split initiative-plan-review initiative-link`
**Prototype:** <checkout>/.superpowers/design/agent-rail-brainstorm-initiative/project

### Task 1: The ◇ chip and the Brainstorm marker in a split cell's bar
**Depends on:** none
**Files:** `frontend/app/view/agents/gridcellbar.tsx`, `frontend/app/view/agents/agentsurface.tsx`,
`frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/initiativepopovermodel.ts`,
`frontend/app/view/agents/initiativepopovermodel.test.ts`, `scripts/cdp/scenarios-rail-brainstorm-initiative.mjs`

Decisions:
- **One source for the chip's count.** `InitiativeLink` (`agentheader.tsx:207`) computes
  `count = progress.total > 0 ? "done/total" : null` inline. Move that into a pure exported `chipCount(effort)` in
  `initiativepopovermodel.ts` beside `popoverProgress` (null for no effort or a total of 0), with a vitest in
  `initiativepopovermodel.test.ts` (no effort, 0 chunks, 1/3). `InitiativeLink` and the cell bar both call it; the
  header's look does not change.
- **`GridCellBar` takes `model: AgentsViewModel`.** `agentsurface.tsx` (the `<GridCellBar` at ~856) passes its `model`.
- **The ◇ chip** shows in the bar when `agent.effortId` is set (not for a terminal cell), after the name and before
  `ChatSwitch`:
  - a `<button>` with `data-agent-cell-initiative={agent.id}`, the `Diamond` icon (12px, as the header's chip), the
    title from `initiativeTitle(agent.name, effort)` (`headermodel.ts`) in a span `data-agent-cell-initiative-title` (`truncate`,
    `max-w-[120px]`), and the count from `chipCount` in a span `data-agent-cell-initiative-progress` (`tabular-nums`,
    `text-ink-mid`). Effort from `effortDetailAtom` with the same `loadEffortDetail(oref).catch(() => {})` effect as
    `InitiativeLink`; a failed load leaves the icon and the plain word `initiative`.
  - `aria-label` `"<title>, <done>/<total> chunks done. Open the Initiative tab"` (count part left out with no count),
    `title` the same words.
  - Click: `globalStore.set(model.focusIdAtom, agent.id)`, then `openRailInitiative(agent.id)`. Do not move DOM focus
    yourself: `openRailInitiative` hands it to the pane (Task 4/5's note).
  - Height `h-[18px]`, `text-[11px]`, `rounded-[5px]`, hover `bg-surface-hover`, focus ring as `BAR_BUTTON`. The
    name keeps `min-w-0 flex-1 truncate` and gives up width first; under a narrow cell the title truncates and the
    icon and count stay.
- **The Brainstorm marker** shows when the agent has a brainstorm (`brainstormAtom(agent.id)` not null), after the chip:
  - a `BAR_BUTTON` with `data-agent-cell-brainstorm={agent.id}`, the `Lightbulb` icon (the rail's Brainstorm icon,
    12px), and its dot from the same `brainstormTabDot(newCount, asking, false)` the header uses
    (`brainstormBandAtom(agent.id)?.newCount`, asking as the header computes it from `shownBrainstormFile` /
    `waitsOnUser` / `agent.state === "asking"`). The dot is a 5px span `data-agent-cell-brainstorm-dot="new|asking"`
    at the icon's top right, `bg-accent` for new, `bg-asking` for asking, drawn only when the dot is not null.
  - `aria-label` `"Brainstorm: <N> new board(s). Open the Brainstorm tab"` with the dot, else
    `"Open the Brainstorm tab"`.
  - Click: set `model.focusIdAtom` to the agent, then `openRailBrainstorm(agent.id)`.
  - The cell never shows the Brainstorm view itself (`chatswitch.tsx`'s header comment): the marker opens the rail tab,
    not the view.
- Both buttons stop `onDragStart` from starting a drag of the bar (`draggable={false}` on the button, or
  `onDragStart={(e) => e.stopPropagation()}`), and keep the bar's `title` from covering theirs.
- Update `gridcellbar.tsx`'s header comment to name the two new things.

Scenario (`rail-tabs-split` in `scripts/cdp/scenarios-rail-brainstorm-initiative.mjs`):
- Fix the scenario's header comment (lines ~14–17): each linked cell's bar holds the chip and the dot; drop "a split
  cell's own bar has neither".
- New step after step 1 (number it so the existing ones keep theirs, e.g. `1b`): with cell A focused, read cell B's bar
  (`[data-agent-cell-bar="<B>"]`, B a linked agent that is NOT focused): `[data-agent-cell-initiative="<B>"]` exists,
  its progress span reads the fixture's `done/total`, and its title span the initiative's title. Then the brainstorm
  agent's bar while another cell is focused: `[data-agent-cell-brainstorm-dot="new"]` is there (the fixture has a new
  board); a cell with no brainstorm has no `[data-agent-cell-brainstorm]`; a plain unlinked cell has no
  `[data-agent-cell-initiative]`.
- Rework step 3 to click the chip in an UNFOCUSED cell's bar (rail hidden first): after the click, that agent is
  focused (`focusIdAtom` or the cell's focused marker the scenario already reads), the rail is shown, the Initiative tab
  is selected and the pane names that agent's initiative. Then, from another focused cell, click the brainstorm cell's
  marker and check that cell takes focus with the Brainstorm tab selected.
- Shot the split after step 1b so the screenshot shows the chip and the dot on an unfocused cell's bar.
- Keep every existing check (the 300px strip, the Verify count, the header chip as each cell takes focus).

Acceptance:
- `npx vitest run frontend/app/view/agents/initiativepopovermodel.test.ts` passes with the new `chipCount` cases.
- `task check:ts` exits 0.
- `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs rail-tabs-split rail-initiative-tab` passes, with step 1b and
  the reworked step 3 in the table, and the split screenshot shows the chip (`· done/total`) and the accent dot in an
  unfocused cell's 26px bar, no wrap, at the scenario's 1900px window.
- The header's chip still reads `<title> · done/total` (rail-initiative-tab's chip step).
