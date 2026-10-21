# Sidebar split row Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Agent sidebar draws each project's split (2+ cells) as one framed row laid out like the grid on screen,
in place of the cells' own rows (spec: `docs/superpowers/specs/2026-10-21-sidebar-split-row-design.md`).

**Architecture:** `projectTree` (pure, `agentsidebarmodel.ts`) takes the reconciled `ProjectGrids` and the roster, pulls
each split's cell rows out of its folder and puts one `split` row at the first pulled row's place. `gridstore.ts` gains
one helper that reconciles the grids for the tree (shared by `agenttree.tsx` and `activenav.ts`) and split operations
that act on any project's split. `agenttree.tsx` draws `SplitRow` / `SplitCell`; `SplitMark` and the `inSplit` prop go.

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, vitest, the CDP scenario harness (`scripts/cdp/scenarios.mjs`).

**Verify:** `npx vitest run frontend/app/view/agents`

**Final:** `node scripts/cdp/final-verify.mjs tools-split`

---

### Task 1: `split` rows in the pure tree model

**Depends on:** none
**Files:** `frontend/app/view/agents/agentgrid.ts`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentgrid.test.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`

Where: `agentgrid.ts` gets `splitGrids` after `shownGrid` (~line 520); `agentsidebarmodel.ts` changes `ProjectTreeRow`
(~303), `projectTree` (~341), `terminalShows` (~503) and `treeNavIds` (~521).

**Step 1: Write the failing tests**

In `agentgrid.test.ts` (import `splitGrids`):

```ts
describe("splitGrids", () => {
    it("keeps the grids of two cells or more, by project", () => {
        const state = {
            project: "a",
            grids: { a: { ids: ["x", "y"], focused: "x" }, b: { ids: ["z"], focused: "z" } },
        };
        expect([...splitGrids(state).keys()]).toEqual(["a"]);
    });
});
```

In `agentsidebarmodel.test.ts`, inside `describe("projectTree", …)`: extend `shape` with
`case "split": return \`split:${r.project}:${r.shown ? "shown" : "saved"}:${r.cells.map((c) => c.id).join(",")}\`;`
and add:

```ts
    describe("splits", () => {
        const grids = (project: string | null, all: Record<string, string[]>) => ({
            project,
            grids: Object.fromEntries(Object.entries(all).map(([p, ids]) => [p, { ids, focused: ids[0] }])),
        });
        const withSplits = (agents: AgentVM[], terminals: AgentVM[], splits: ReturnType<typeof grids>, over = {}) =>
            build(agents, terminals, { splits, roster: [...agents, ...terminals], ...over });

        it("puts one split row where the topmost cell's row was, and drops the cells' rows", () => {
            const rows = withSplits([agent("a"), agent("b"), agent("c")], [term("t1")], grids("waveterm", { waveterm: ["c", "a"] }));
            expect(shape(rows)).toEqual([
                "group:waveterm:3a:1t",
                "split:waveterm:shown:c,a",
                "a:b",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("takes an agent and a terminal together, and drops a divider left with nothing on one side", () => {
            const rows = withSplits([agent("a")], [term("t1")], grids("waveterm", { waveterm: ["a", "t1"] }));
            expect(shape(rows)).toEqual(["group:waveterm:1a:1t", "split:waveterm:shown:a,t1"]);
        });

        it("draws another project's saved split too, not shown", () => {
            const rows = withSplits(
                [agent("a"), agent("b"), agent("c", undefined, "loom"), agent("d", undefined, "loom")],
                [],
                grids("waveterm", { waveterm: ["a", "b"], loom: ["c", "d"] })
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:2a:0t",
                "split:waveterm:shown:a,b",
                "group:loom:2a:0t",
                "split:loom:saved:c,d",
            ]);
        });

        it("leaves a grid of one cell as plain rows", () => {
            const rows = withSplits([agent("a"), agent("b")], [], grids("waveterm", { waveterm: ["a"] }));
            expect(shape(rows)).toEqual(["group:waveterm:2a:0t", "a:a", "a:b"]);
        });

        it("draws nothing for a collapsed folder", () => {
            const rows = withSplits([agent("a"), agent("b")], [], grids("waveterm", { waveterm: ["a", "b"] }), {
                collapsed: ["waveterm"],
            });
            expect(shape(rows)).toEqual(["group:waveterm:2a:0t:closed"]);
        });

        it("puts a split whose cells have no row at the top of the folder's body, from the roster", () => {
            // "x" and "y" are live cells the tree draws no row for (workers of a folded run, say)
            const rows = build([agent("a")], [], {
                splits: grids("waveterm", { waveterm: ["x", "y"] }),
                roster: [agent("a"), agent("x"), agent("y")],
            });
            expect(shape(rows)).toEqual(["group:waveterm:1a:0t", "split:waveterm:shown:x,y", "a:a"]);
        });

        it("folds the filtered project's split", () => {
            const rows = withSplits([agent("a"), agent("b")], [term("t1")], grids("waveterm", { waveterm: ["b", "t1"] }), {
                filter: "waveterm",
            });
            expect(shape(rows)).toEqual(["a:a", "split:waveterm:shown:b,t1"]);
        });

        const placesIn = (rows: ProjectTreeRow[]) => {
            const split = rows.find((r) => r.kind === "split");
            return split?.kind === "split" ? split.cells.map((c) => c.place) : null;
        };

        it("places each cell as the grid does on screen: 2 side by side, 3 and 4 by the template", () => {
            const four = [agent("a"), agent("b"), agent("c"), agent("d")];
            for (const n of [2, 3, 4]) {
                const ids = four.slice(0, n).map((a) => a.id);
                expect(placesIn(withSplits(four, [], grids("waveterm", { waveterm: ids })))).toEqual(placementFor(n));
            }
            const rows = withSplits(four, [], grids("waveterm", { waveterm: ["a", "b", "c", "d"] }));
            expect(shape(rows)).toEqual(["group:waveterm:4a:0t", "split:waveterm:shown:a,b,c,d"]);
        });

        it("keeps a grid's stored places: one tall cell and two stacked", () => {
            const places = [
                { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
                { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
                { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
            ];
            const rows = withSplits([agent("a"), agent("b"), agent("c")], [], {
                project: "waveterm",
                grids: { waveterm: { ids: ["a", "b", "c"], focused: "a", places } },
            });
            expect(placesIn(rows)).toEqual(places);
        });

        describe("a cell inside a run", () => {
            // a hand-made tree: the run's lead, its worker (only while the run is unfolded), then a plain agent
            const run = { runId: "r1" };
            const lead = agent("l");
            const w = { ...agent("w"), runId: "r1" };
            const tree = (open: boolean) =>
                [
                    { kind: "group", project: "waveterm", count: 3, attn: 0, running: 0 },
                    { kind: "lead", agent: lead, project: "waveterm", run, open, live: 1 },
                    ...(open ? [{ kind: "worker", agent: w, project: "waveterm", run, task: {} }] : []),
                    { kind: "parent", agent: agent("a"), project: "waveterm" },
                ] as unknown as AgentTreeRow[];
            const menus = (rows: ProjectTreeRow[]) => {
                const split = rows.find((r) => r.kind === "split");
                return split?.kind === "split" ? split.cells.map((c) => `${c.id}:${c.menu}:${c.run?.runId ?? "-"}`) : null;
            };

            it("pulls an unfolded run's worker row out, the split at the worker's place, with the task menu", () => {
                const rows = build([], [], {
                    tree: tree(true),
                    splits: grids("waveterm", { waveterm: ["a", "w"] }),
                    roster: [lead, w, agent("a")],
                });
                expect(shape(rows)).toEqual(["group:waveterm:3a:0t", "lead", "split:waveterm:shown:a,w"]);
                expect(menus(rows)).toEqual(["a:agent:-", "w:task:-"]);
            });

            it("takes a folded run's worker from the roster, with the task menu; the lead's cell has the run's", () => {
                const rows = build([], [], {
                    tree: tree(false),
                    splits: grids("waveterm", { waveterm: ["l", "w"] }),
                    roster: [lead, w, agent("a")],
                });
                expect(shape(rows)).toEqual(["group:waveterm:3a:0t", "split:waveterm:shown:l,w", "a:a"]);
                expect(menus(rows)).toEqual(["l:lead:r1", "w:task:-"]);
            });
        });
    });
```

(import `placementFor` from `./agentgrid`, and `type AgentTreeRow` from `./agenttreemodel` if the file does not
import it yet.) In `describe("treeNavIds", …)` add:

```ts
    it("walks a split row's cells in reading order where the row sits", () => {
        const rows = projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
            splits: { project: "waveterm", grids: { waveterm: { ids: ["t1", "a"], focused: "a" } } },
            roster: [...agents, ...terminals],
        });
        expect(treeNavIds(rows)).toEqual(["t1", "a", "b", "c", "t2"]);
    });
```

Rewrite all three `it()` blocks of `describe("terminalShows", …)` (~1047-1059) to the 2-argument form, since every
3-argument call breaks once `cells` goes: `terminalShows("t1", "t1")` is `"panel"`; `terminalShows("t1", "t2")`,
`terminalShows("t1", null)` and `terminalShows("t1", undefined)` are undefined (the "split" answer goes: a cell no longer
has a terminal row).

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/agentgrid.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts`
Expected: FAIL (`splitGrids` is not exported; `splits` is not a `projectTree` input).

**Step 3: Implement**

`agentgrid.ts`, after `shownGrid`:

```ts
// The splits the sidebar draws as one row each: every project's grid of two cells or more (a grid of one is no split).
export function splitGrids(state: ProjectGrids): Map<string, GridState> {
    const out = new Map<string, GridState>();
    for (const [project, grid] of Object.entries(state.grids)) {
        const g = normalizeGrid(grid);
        if (g.ids.length > 1) {
            out.set(project, g);
        }
    }
    return out;
}
```

`agentsidebarmodel.ts`:

- Import `placesOf, splitGrids, type CellPlacement, type GridState, type ProjectGrids` from `./agentgrid`.
- Add to `ProjectTreeRow`:

```ts
    // a project's split (2+ cells) as one row, where the topmost of its cells' rows was: each cell its tab and its place
    // in the 2x2 the surface draws. `shown` is the split on screen; another project's saved split is drawn too.
    | { kind: "split"; project: string; shown: boolean; cells: SplitRowCell[] }
```

  and

```ts
// One cell of a split row. `menu` is the row menu its right-click opens, the one its own row in the tree has: an
// agent's, a lead's (with its run's items, from `run`), a worker's or a stage's ("task", the short one), a terminal's.
export interface SplitRowCell {
    id: string;
    vm: AgentVM;
    place: CellPlacement;
    menu: "agent" | "lead" | "task" | "terminal";
    run?: RunInfo;
}
```

  (`RunInfo` imported as a type from where `agenttreemodel.ts` imports it.)
- Add pure helpers above `projectTree`:

```ts
// the tab a row stands for, when it is one a split cell can hold
function rowTabId(r: ProjectTreeRow): string | undefined {
    if (r.kind === "terminal") {
        return r.terminal.id;
    }
    if (r.kind === "parent" || r.kind === "lead" || r.kind === "stage" || r.kind === "worker") {
        return r.agent?.id;
    }
    return undefined;
}

// The menu a cell opens: its row's when it has one; with none (a worker of a folded run), a run's tab takes the
// worker's and any other its kind's.
function cellMenu(vm: AgentVM, row: ProjectTreeRow | undefined): Pick<SplitRowCell, "menu" | "run"> {
    if (row?.kind === "lead") {
        return { menu: "lead", run: row.run };
    }
    if (row?.kind === "worker" || row?.kind === "stage") {
        return { menu: "task" };
    }
    if (vm.kind === "terminal") {
        return { menu: "terminal" };
    }
    return { menu: row == null && vm.runId != null ? "task" : "agent" };
}

// One folder's body with its split folded in: the cells' rows pulled out, one split row where the first of them was
// (the top of the body when none had a row), and a divider left with nothing above or below it dropped. A cell the
// roster does not hold is left out; fewer than two left, the body is returned as it was.
function foldSplit(
    body: ProjectTreeRow[],
    project: string,
    grid: GridState,
    shown: boolean,
    byId: ReadonlyMap<string, AgentVM>
): ProjectTreeRow[] {
    const places = placesOf(grid);
    const rowOf = new Map<string, ProjectTreeRow>();
    for (const r of body) {
        const id = rowTabId(r);
        if (id != null && !rowOf.has(id)) {
            rowOf.set(id, r);
        }
    }
    const cells: SplitRowCell[] = grid.ids.flatMap((id, i) => {
        const vm = byId.get(id);
        return vm != null ? [{ id, vm, place: places[i], ...cellMenu(vm, rowOf.get(id)) }] : [];
    });
    if (cells.length < 2) {
        return body;
    }
    const ids = new Set(cells.map((c) => c.id));
    const at = body.findIndex((r) => ids.has(rowTabId(r) ?? ""));
    const kept: ProjectTreeRow[] = [];
    body.forEach((r, i) => {
        if (i === at) {
            kept.push({ kind: "split", project, shown, cells });
        }
        if (!ids.has(rowTabId(r) ?? "")) {
            kept.push(r);
        }
    });
    if (at < 0) {
        kept.unshift({ kind: "split", project, shown, cells });
    }
    return kept.filter((r, i) => r.kind !== "divider" || (i > 0 && i < kept.length - 1));
}
```

- `projectTree` input gains (document both in the doc comment, and replace its paragraph "The surface's split moves
  nothing here…" with: "Each project's split (`splits`, its grids of 2+ cells) is one row in its folder, where the
  topmost of its cells' rows was; the cells' own rows go. `roster` is every live agent and terminal, read for a cell
  the tree draws no row for."):

```ts
    splits?: ProjectGrids; // the grids as the surface reconciles them (gridstore treeSplits)
    roster?: readonly AgentVM[];
```

- In `projectTree` build once: `const splits = input.splits != null ? splitGrids(input.splits) : new Map<string, GridState>();`
  and `const byId = new Map((input.roster ?? []).map((a) => [a.id, a]));`, and a local
  `const fold = (project: string, body: ProjectTreeRow[]) => { const grid = splits.get(project); return grid == null ? body : foldSplit(body, project, grid, input.splits?.project === project, byId); };`
- Filtered branch: `return fold(filter, out);` instead of `return out;`.
- All-projects branch: gather the folder's rows into a local `body` array (`[...body, ...waiting]`, the divider, then
  `...held, ...termRows(project, list)`) and push `...fold(project, body)` after the group row.
- `terminalShows(id, dockedId)`: drop the `cells` parameter and the `"split"` answer; `TerminalShows` becomes `"panel"`.
- `treeNavIds`: `else if (r.kind === "split") { ids.push(...r.cells.map((c) => c.id)); }`.

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/agentgrid.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts`
Expected: PASS. (`agenttree.tsx` still passes `cells` to `terminalShows`; Task 3 fixes the call, so do not run the
typecheck yet.)

**Step 5: Commit**

```bash
git commit -m "feat(agents): the tree model folds a split's cells into one row" -- frontend/app/view/agents/agentgrid.ts frontend/app/view/agents/agentgrid.test.ts frontend/app/view/agents/agentsidebarmodel.ts frontend/app/view/agents/agentsidebarmodel.test.ts
```

### Task 2: split operations on any project's split

**Depends on:** none
**Files:** `frontend/app/view/agents/gridstore.ts`, `frontend/app/view/agents/gridstore.test.ts`

**Step 1: Write the failing tests**

```ts
describe("splits of another project", () => {
    // a and b are project p's, c and d project q's; q's split is shown
    function twoProjects(focus: string): GridModel {
        return {
            focusIdAtom: atom<string | undefined>(focus),
            agentsAtom: atom([
                { id: "a", blockId: "blk-a", project: "p" },
                { id: "b", blockId: "blk-b", project: "p" },
                { id: "c", blockId: "blk-c", project: "q" },
                { id: "d", blockId: "blk-d", project: "q" },
            ]),
            terminalsAtom: atom([]),
        };
    }
    beforeEach(() => {
        globalStore.set(projectGridsAtom, { project: "q", grids: { p: g(["a", "b"]), q: g(["c", "d"]) } });
    });

    it("isInSplit is true for a cell of a split not on screen", () => {
        expect(isInSplit(twoProjects("c"), "a")).toBe(true);
    });
    it("removeFromSplit takes a cell out of its own project's split and leaves the focus", () => {
        const m = twoProjects("c");
        removeFromSplit(m, "a");
        expect(globalStore.get(projectGridsAtom).grids.p.ids).toEqual(["b"]);
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c", "d"]);
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("removeFromSplit on the shown split is removeFromGrid", () => {
        const m = twoProjects("c");
        removeFromSplit(m, "d");
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c"]);
    });
    it("endSplitOf keeps only the focused cell of the cell's project", () => {
        const m = twoProjects("c");
        endSplitOf(m, "b");
        expect(globalStore.get(projectGridsAtom).grids.p.ids).toEqual(["a"]);
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c", "d"]);
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("endSplitOf on the shown split is endSplit: the focused cell stays", () => {
        const m = twoProjects("c");
        endSplitOf(m, "d");
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c"]);
        expect(globalStore.get(projectGridsAtom).grids.p.ids).toEqual(["a", "b"]);
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
});

describe("treeSplits", () => {
    it("reconciles every grid against the roster, the docked terminal pruned", () => {
        const grids = { project: "p", grids: { p: g(["a", "t"]) } };
        const out = treeSplits(grids, {
            focusId: "a",
            agents: [{ id: "a", blockId: "blk-a", project: "p" }],
            terminals: [{ id: "t", blockId: "blk-t", project: "p" }],
            dockedId: "t",
            seeded: true,
        });
        expect(out.grids.p.ids).toEqual(["a"]);
    });
});
```

(import `isInSplit`, `removeFromSplit`, `endSplitOf`, `treeSplits`.)

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/gridstore.test.ts`
Expected: FAIL (`removeFromSplit` is not exported; `isInSplit` is false for `a`).

**Step 3: Implement**

In `gridstore.ts` (import `collapseToFocused` is already there):

```ts
// The grids the sidebar draws its split rows from, as the surface reconciles them: the docked terminal is no cell.
// Takes the values rather than the atoms so the tree (hooks) and activeNavOrder (globalStore) read it alike.
export function treeSplits(
    grids: ProjectGrids,
    input: {
        focusId: string | undefined;
        agents: ReadonlyArray<GridTab>;
        terminals: ReadonlyArray<GridTab>;
        dockedId: string | null | undefined;
        seeded: boolean;
    }
): ProjectGrids {
    const tabs = [...input.agents, ...input.terminals];
    return reconcileProjectGrids(grids, {
        focusId: input.focusId,
        eligible: eligibleIds([...input.agents, ...input.terminals.filter((t) => t.id !== input.dockedId)]),
        projectOf: gridProjects(tabs),
        seeded: input.seeded,
    });
}

// The project whose split (2+ cells) `id` is a cell of, shown or not.
function splitProject(grids: ProjectGrids, id: string): string | undefined {
    return Object.keys(grids.grids).find((p) => grids.grids[p].ids.length > 1 && grids.grids[p].ids.includes(id));
}

// `next` as `project`'s grid when that project is not the one shown: focus and the centre stay as they are.
function commitHidden(grids: ProjectGrids, project: string, next: GridState): void {
    const all = { ...grids.grids };
    if (next.ids.length > 0) {
        all[project] = next;
    } else {
        delete all[project];
    }
    globalStore.set(projectGridsAtom, { project: grids.project, grids: all });
}

// Remove from split, for a cell of any project's split (its row in the sidebar's split row, its menu): on the split on
// screen it is removeFromGrid; on another project's it changes that grid only.
export function removeFromSplit(model: GridModel, id: string): void {
    const grids = currentGrids(model);
    const project = splitProject(grids, id);
    if (project == null) {
        return;
    }
    if (project === grids.project) {
        removeFromGrid(model, id);
        return;
    }
    commitHidden(grids, project, removeCell(grids.grids[project], id));
}

// End split, for the split `id` is a cell of: that project's grid keeps only its focused cell.
export function endSplitOf(model: GridModel, id: string): void {
    const grids = currentGrids(model);
    const project = splitProject(grids, id);
    if (project == null) {
        return;
    }
    if (project === grids.project) {
        endSplit(model);
        return;
    }
    commitHidden(grids, project, collapseToFocused(grids.grids[project]));
}
```

Change `isInSplit` to `return splitProject(currentGrids(model), id) != null;` and its comment to "a cell of any
project's split (a grid of one cell is no split)". `GridTab` gains `export`.

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/gridstore.test.ts`
Expected: PASS, the existing tests too.

**Step 5: Commit**

```bash
git commit -m "feat(agents): split operations reach any project's split" -- frontend/app/view/agents/gridstore.ts frontend/app/view/agents/gridstore.test.ts
```

### Task 3: draw the split row

**Depends on:** Task 1 (uses the `split` row, the `splits`/`roster` inputs and the new `terminalShows`), Task 2 (uses `treeSplits`, `removeFromSplit` and `endSplitOf`)
**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/terminalsrail.tsx`, `frontend/app/view/agents/activenav.ts`

Where: `agenttree.tsx` imports (~102-206), `splitMenuItem` (~272), `ParentRow` (~768-1043), `TerminalRow`
(~2012-2097), `AgentTree` (~2495-2760); `terminalsrail.tsx` `SplitMark` (~53), `splitCellMenuItems` (~79).

**Step 1: Menus act on the cell's project**

`terminalsrail.tsx` `splitCellMenuItems`: `removeFromGrid(model, id)` → `removeFromSplit(model, id)`, `endSplit(model)`
→ `endSplitOf(model, id)`; fix the imports. Delete `SplitMark` (and `Columns2` only if nothing else in the file uses it).

**Step 2: The tree reads the splits**

In `AgentTree`, replace the `cells = shownGrid(reconcileProjectGrids(…)).ids` block with

```ts
    // every project's split as the surface reconciles it: each is one row in its folder (projectTree)
    const splits = treeSplits(projectGrids, { focusId, agents, terminals, dockedId, seeded });
```

pass `splits` and `roster: [...agents, ...terminals]` to `projectTree`, delete `splitIds` and its comment, call
`terminalShows(r.terminal.id, dockedId)`, and drop the `inSplit` props. In `activenav.ts` pass the same two inputs:
`splits: treeSplits(globalStore.get(projectGridsAtom), { focusId, agents, terminals, dockedId: globalStore.get(dockedTerminalAtom), seeded: globalStore.get(rosterSeededAtom) })`
and `roster: [...agents, ...terminals]` (imports from `./gridstore`, `./railstore`, `./liveagents`).

**Step 3: Remove the old mark**

`ParentRow`: delete the `inSplit` prop, its comment and `{inSplit ? <SplitMark /> : null}`. `TerminalRow`: `shows` is
only `"panel"` now; replace the `shows === "split" ? <SplitMark /> : …` ternary with the `shows != null` branch alone.
Drop unused imports (`SplitMark`, `reconcileProjectGrids`, `shownGrid`, `eligibleIds`, `gridProjects` if unused).

**Step 4: `SplitRow` and `SplitCell`**

Extract the agent row's menu from `ParentRow.onContextMenu` into
`function agentRowMenuItems(model, agent, lead: RunInfo | undefined, later: boolean): ContextMenuItem[]` (the same list,
the run's items when `lead` is given; `ParentRow` passes `lead?.run`), and the identical short menu of `WorkerRow`
(~1269) and `StageRow` (~1377) into `function taskRowMenuItems(model, agent, ended = false): ContextMenuItem[]` (the split
items unless `ended`, a separator, Close agent), so the rows and `SplitCell` share them. A cell opens the menu its
`menu` names (`SplitRowCell.menu`, set by `projectTree`): `agent` → `agentRowMenuItems(…, undefined, …)`, `lead` →
`agentRowMenuItems(…, cell.run, …)`, `task` → `taskRowMenuItems`, `terminal` → `showTerminalMenu`. Rename works in a
cell as in a row: while `renamingRowAtom` names the cell's id it draws `RenameBox` in place of the name, and its drag
source is off. Then, beside `TerminalRow`:

```tsx
// A project's split as one row (projectTree's "split"): the cells laid out as the 2x2 the surface draws, the split on
// screen in an accent frame. A cell is the tab's glyph, name and what wants you; its meta stays in the right panel.
function SplitRow({
    model,
    row,
    digits,
    tools,
}: {
    model: AgentsViewModel;
    row: Extract<ProjectTreeRow, { kind: "split" }>;
    digits: ReadonlyMap<string, number>;
    tools: ToolStatus[];
}) {
    const rows = Math.max(...row.cells.map((c) => c.place.row + c.place.rowSpan - 1));
    return (
        <div
            data-split-row={row.project}
            data-split-shown={row.shown ? "true" : undefined}
            className={cn(
                "grid gap-px overflow-hidden rounded-[7px] border",
                row.shown ? "border-accent/60 bg-accent/25" : "border-border bg-border"
            )}
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridTemplateRows: `repeat(${rows}, auto)` }}
        >
            {row.cells.map((c) => (
                <div key={c.id} style={placementStyle(c.place)} className="min-w-0 bg-surface">
                    <SplitCell model={model} cell={c} navDigit={digits.get(c.id)} tools={tools} />
                </div>
            ))}
        </div>
    );
}

function SplitCell({
    model,
    cell,
    navDigit,
    tools,
}: {
    model: AgentsViewModel;
    cell: SplitRowCell;
    navDigit?: number;
    tools: ToolStatus[];
}) {
    const vm = cell.vm;
    const selected = useSelectedRowId(model) === vm.id;
    const renaming = useAtomValue(renamingRowAtom) === vm.id;
    const digit = useHeldDigit(navDigit);
    const unreadCount = useAtomValue(unreadAgentsAtom).get(vm.id) ?? 0;
    const bgTasks = useAtomValue(backgroundTasksByIdAtom)[vm.id];
    const machineServers = useAtomValue(machineServersReadingAtom).servers;
    const laterAt = laterSince(useAtomValue(laterMarksAtom), vm.transcriptPath);
    const terminal = vm.kind === "terminal";
    const name = terminal ? toolTerminalName(vm, tools) : vm.name;
    const asking = vm.state === "asking";
    const onContextMenu = (e: React.MouseEvent) => {
        if (cell.menu === "terminal") {
            showTerminalMenu(model, vm, e, name);
            return;
        }
        const items =
            cell.menu === "task"
                ? taskRowMenuItems(model, vm)
                : agentRowMenuItems(model, vm, cell.menu === "lead" ? cell.run : undefined, laterAt != null);
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            data-split-cell={vm.id}
            onClick={() => selectAgentRow(model, vm.id)}
            onContextMenu={onContextMenu}
            {...dragSource(vm, !renaming)}
            className={cn(
                "group/cell flex h-full min-w-0 cursor-pointer items-center gap-[6px] px-[8px] py-[6px]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <DigitHint digit={digit}>
                {terminal ? (
                    <ToolGlyph name={toolIcon(tools.find((t) => t.id === vm.toolId))} className="text-muted" />
                ) : vm.sleeping ? (
                    <SleepGlyph id={vm.id} runtime={vm.agent} />
                ) : (
                    <RuntimeGlyph runtime={vm.agent} state={shownState(vm.state, backgroundActivity(bgTasks, machineServers))} />
                )}
            </DigitHint>
            {renaming ? (
                <RenameBox tabId={vm.id} shown={name} />
            ) : (
                <span
                    title={name}
                    className={cn(
                        "min-w-0 flex-1 truncate text-[12px]",
                        selected || unreadCount > 0 ? "text-primary" : "text-secondary",
                        unreadCount > 0 && "font-semibold"
                    )}
                >
                    {name}
                </span>
            )}
            {asking ? (
                <span aria-label="asking" className="h-[6px] w-[6px] flex-none rounded-full bg-warning" />
            ) : unreadCount > 0 ? (
                <span
                    data-agent-unread={unreadCount}
                    className="flex h-[14px] min-w-[14px] flex-none items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold tabular-nums text-background"
                >
                    {unreadLabel(unreadCount)}
                </span>
            ) : terminal && vm.running ? (
                <StatusDot state="working" pulse className="!h-[6px] !w-[6px]" />
            ) : null}
            <button
                type="button"
                data-split-cell-remove={vm.id}
                title="Remove from split"
                aria-label="Remove from split"
                onClick={(e) => {
                    e.stopPropagation();
                    removeFromSplit(model, vm.id);
                }}
                className="hidden h-[16px] w-[16px] flex-none cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-surface-hover hover:text-primary group-hover/cell:flex"
            >
                <X size={11} aria-hidden />
            </button>
        </div>
    );
}
```

Match the imports to what the file already has (`ToolStatus` is the type `toolsStatusAtom` holds; `toolTerminalName`,
`toolIcon`, `unreadLabel`, `StatusDot`, `RuntimeGlyph`, `SleepGlyph`, `shownState`, `backgroundActivity`, `RenameBox`,
`renamingRowAtom` are already used in this file). Add `placementStyle` to the `./agentgrid` import (the file does not
import it yet; that import line loses `reconcileProjectGrids` and `shownGrid` in Step 3), and `type SplitRowCell` to
the `./agentsidebarmodel` import. If a name differs, use the one `ParentRow` / `TerminalRow` use; do not add a second copy. The
`bg-accent/25` / `border-accent/60` tints must be tokens with an opacity modifier, never a raw color.

In the rows loop add, beside `case "terminal"`:

```tsx
                                case "split":
                                    return plain(
                                        `split-${r.project}`,
                                        <SplitRow model={model} row={r} digits={digits} tools={tools} />
                                    );
```

**Step 5: Typecheck and test**

Run: `task check:ts` (about 2 minutes; give it a 5-minute timeout). Expected: exit 0.
Run: `npx vitest run frontend/app/view/agents`. Expected: PASS.

Shown in the app by `tools-split` steps 1, 1b, 1c, 2, 3, 4 and 5 (the row, a click on a cell, three cells laid out as
the grid, the saved split unframed, a cell bringing it back, the × on a cell, End split from a saved split's cell menu).
Task 4 writes those steps and Final runs them in this run's own dev app; do not run them here.

**Step 6: Commit**

```bash
git commit -m "feat(agents): the sidebar draws a split as one row" -- frontend/app/view/agents/agenttree.tsx frontend/app/view/agents/terminalsrail.tsx frontend/app/view/agents/activenav.ts
```

### Task 4: scenario, changelog, hand check

**Depends on:** Task 3 (checks the split row it draws, by its `data-split-*` attributes)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

Where: `scenarios.mjs` `TT_TREE_SHAPE` (~40873), `toolsSplit` (~41361-41463).

**Step 1: Rewrite `tools-split` for the split row**

`TT_TREE_SHAPE`: add `[data-split-row]` to its selector and map it to `"split:" + el.getAttribute("data-split-row")`
(a split row holds no `[data-agent-row]` or `[data-tree-terminal-row]`, so the cells add nothing else; `tools-tree`, the
other user, makes no split and reads the same).

`ttArrange` gets a third terminal: `terminals: [{ key: "a", cwd: "root" }, { key: "b", cwd: "root" }, { key: "home",
project: null }]`, and `const [a, b, home] = ctx.terminals;`. Update the header comment: the cells leave their rows and
show as one `[data-split-row]` in the project's folder. Replace the `look` helper's `marked` with

```js
            splitRows: [...document.querySelectorAll("[data-agent-tree] [data-split-row]")].map((r) => ({
                project: r.getAttribute("data-split-row"),
                shown: r.getAttribute("data-split-shown") === "true",
                cells: [...r.querySelectorAll("[data-split-cell]")].map((c) => c.getAttribute("data-split-cell")),
            })),
```

and add a `layout(id)` evaluation that, for each `[data-split-cell]` of the row and each shown `[data-agent-cell]` of
`[data-agent-grid]` (keyed by `data-agent-terminal`), reads its place in its container's 2x2 from its rect: `col` 1 or
2 by its left edge against the container's middle, `row` likewise by its top edge, `colSpan` 2 when its width is over
60% of the container's, `rowSpan` likewise by height. The steps (each position check is on `TT_TREE_SHAPE`: the
`split:${TT_PROJECT}` entry comes right after `folder:${TT_PROJECT}`, where the agent's row was):

- **1.** After Open beside: two grid cells; `TT_TREE_SHAPE` holds `split:${TT_PROJECT}` right after
  `folder:${TT_PROJECT}` and no longer holds `agent:${TT_AGENT_ID}` nor `terminal:${a.tabId}`; exactly one split row,
  `shown: true`, whose cells are both ids. Shot `cdp-shots/tools-split-1-beside.png` (the sidebar shows the framed row).
- **1b.** Click `[data-split-cell="${TT_AGENT_ID}"]` (not the gone agent row): header, rail and cell width unchanged, as
  now.
- **1c.** Right-click `[data-tree-terminal-row="${b.tabId}"]` with `svcContextMenu` and click
  `[data-menu-item="Open in split"]`: `TT_GRID` holds three cells; the one split row holds the three ids and
  `terminal:${b.tabId}` is gone from `TT_TREE_SHAPE`; for every id the split cell's place equals its grid cell's place
  (`layout`), and exactly one of the three spans two squares. Shot `cdp-shots/tools-split-1c-three.png`.
- **2.** Click the Home terminal's row: the split row is still drawn right after `folder:${TT_PROJECT}` with
  `shown: false` and its three cells; the Home terminal shows alone (`TT_GRID` cells `[home]`). Shot
  `cdp-shots/tools-split-2-saved.png`.
- **3.** Click `[data-split-cell="${a.tabId}"]`: the project's split is back (`TT_GRID` holds the three ids) and the
  row is `shown: true`.
- **4.** `ttMouse(h, '[data-split-cell="${b.tabId}"]', "move")` to hover the cell, then
  `ttMouse(h, '[data-split-cell-remove="${b.tabId}"]')` to click its ×: the split row holds the agent and `a` only,
  `TT_GRID` holds those two, and `terminal:${b.tabId}` is back in the folder after the divider. Shot
  `cdp-shots/tools-split-3-removed.png`.
- **5.** Click the Home terminal's row again (the split is saved, `shown: false`), then right-click
  `[data-split-cell="${a.tabId}"]` with `svcContextMenu`: the menu (`SVC_MENU`) holds `Remove from split` and
  `End split`; click `[data-menu-item="End split"]`: no split row is left, `agent:${TT_AGENT_ID}` and
  `terminal:${a.tabId}` are back in the folder, and `TT_GRID` cells are still `[home]` (the focus did not move). Shot
  `cdp-shots/tools-split-4-ended.png`.

Use the file's helpers as the scenario already does (`ttClick`, `ttMouse`, `svcContextMenu`, `SVC_MENU`,
`polishWaitFor`, `polishNap`, `rec`). `ttClick`'s `el.click()` skips hover, so the × is reached with `ttMouse`: kind
`"move"` hovers, the default `"click"` clicks. The cell states (asking dot, unread count, sleeping glyph, a running
terminal's dot) reuse the rows' own components and are left to the hand check below.

**Step 2: CHANGELOG and the hand check**

`CHANGELOG.md`, top section, under `Changed`:

```markdown
- A split shows in the Agent sidebar as one row: its agents and terminals leave their places in the folder and sit
  together, laid out as on screen, with the split on screen framed. Every project's saved split keeps its row, so a
  click on one of its cells brings that split back; the × on a cell takes it out of the split.
```

`docs/open-issues.md`, section "0 · Waiting on a hand check":

```markdown
- [ ] (arcterm) Split row cells: put an asking agent, an agent with an unread turn, a sleeping agent and a terminal
  running a command into splits; each cell shows the warning dot, the unread count, the moon glyph and the working dot
  as its row did; Alt held shows the digits in reading order; right-click a worker's cell inside a run and a lead's
  cell: each opens its own row's menu. `agenttree.tsx` `SplitCell`.
```

**Step 3: Check the scenario file parses**

Run: `node --check scripts/cdp/scenarios.mjs`. Expected: exit 0. Do not run `task verify:ui` here: this tree has no
dev app of its own, and one on `:9222` runs another checkout's code. Final runs `tools-split` in the run's own dev app
and judges its five shots.

**Step 4: Commit**

```bash
git commit -m "test(agents): tools-split checks the sidebar's split row" -- scripts/cdp/scenarios.mjs CHANGELOG.md docs/open-issues.md
```
