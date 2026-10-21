# Rail Changes: worktree, commits and commit — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo`

**Final:** `node scripts/cdp/final-verify.mjs rail-changes-commits rail-commit-mode agent-rail-tabs`

**Prototype:** .superpowers/design/rail-changes-commits/project/Main.dc.html

**Goal:** The right panel's Changes tab names where its diff is measured (branch · worktree), shows the commits of the
same range over the commit graph's lanes with an Uncommitted row on top, and commits ticked files in place.

**Architecture:** Frontend only; no Go change, no `task generate`. Pure model `railcommits.ts` (range, rows, where line),
a per-agent store `railcommitsstore.ts` over the existing `GitHistoryCommand`, the commit graph's existing
`assignLanes` / `graphGeometry` / `GraphGutter` with a `boundary` flag for the range's root row and a `stubs` option for
parents outside the list, and the Diff surface's commit state (`commitstore.ts`, keyed by cwd) reused as is. Boards in
the Prototype folder (`Main`, `CommitMode`, `MainCheckout`, `ManyCommits`, `States`).

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Rules that bite here (AGENTS.md / DESIGN.md):** colours only from `@theme` token utilities, never hex; `font-mono`
only for SHAs; pure logic in `.ts` with a `.test.ts` beside it, no render tests. Formatting: every `.ts` / `.tsx` file
this plan touches is prettier-clean at HEAD except `agentdiffnav.ts` (Task 6 fixes it), so run
`npx prettier --write <the .ts/.tsx files you touched>` and `npx eslint <them>`; never prettier on `scripts/*.mjs`
(hand-formatted 4-space files) and never on the tree. `task check:ts` takes ~2 min: give it a longer timeout. Commit
with a pathspec (`git commit -m "..." -- <paths>`), and `git add` each **new** file first: a pathspec git does not know
yet fails with "did not match any file(s) known to git". No Co-Authored-By trailer.

**Already in place, do not redo:** the rail re-reads git when a turn ends, when Changes opens and on window focus
(`rereadsOnState` and `loadRailForAgent(..., { silent: true })` in `railstore.ts`, wired in `agentdetailsrail.tsx`).
Each re-read writes a new `railStateAtom` object; Task 8 keys the commits read on that object, so the commits follow the
same triggers with no new poll.

---

### Task 1: The shared types: `GraphCommit.boundary` and `railcommits.ts`'s constants

**Depends on:** none
**Files:** `frontend/app/view/agents/gitgraph.ts`, `frontend/app/view/agents/railcommits.ts`

The interfaces the geometry, the model, the store and the section share, landed first so those four can be built side by
side. No behaviour.

**Step 1: `gitgraph.ts`**, in `GraphCommit` after `before?`:

```ts
    // the range's root on a scoped list (the rail's merge base or session start): not a commit of the range, drawn grey
    boundary?: boolean;
```

**Step 2: Create `railcommits.ts`** with the constants and types only (Task 3 adds the functions):

```ts
// frontend/app/view/agents/railcommits.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the rail's Changes tab says about where its diff is measured and which commits it spans
// (docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md). The commits are the files list's own range,
// so the two always agree. No React, no Wave runtime.

import type { HistoryRow } from "./historyrows";

export const RAIL_COMMITS_CAP = 20;
// a 300px rail: a third lane folds into the second
export const RAIL_MAX_LANES = 2;
export const RAIL_ROW_H = 26;

export interface RailWhere {
    branch: string;
    place: string; // the worktree's short name, or the checkout's project
    kind: "worktree" | "checkout";
    path: string; // the full cwd, for the tooltip
}

export interface CommitRange {
    from: string; // the commit the range starts after: the merge base, or the session's start
    root: "branch" | "session";
    base?: string; // the default branch, on Branch
}

export interface RailCommitRows {
    rows: HistoryRow[];
    count: number; // the commits shown, without the uncommitted and root rows
    more: boolean; // the read found more than the cap
}
```

**Step 3: Check it**

Run: `npx eslint frontend/app/view/agents/gitgraph.ts frontend/app/view/agents/railcommits.ts` and
`npx prettier --check` on the same two. Expected: clean.

**Step 4: Commit**

```bash
git add frontend/app/view/agents/railcommits.ts
git commit -m "feat(agents): the rail commits' shared types" -- frontend/app/view/agents/gitgraph.ts frontend/app/view/agents/railcommits.ts
```

---

### Task 2: The graph draws the root row and parents outside the list

**Depends on:** Task 1 (uses `GraphCommit.boundary`)
**Files:** `frontend/app/view/agents/gitgraphgeom.ts`, `frontend/app/view/agents/graphgutter.tsx`, `frontend/app/view/agents/gitgraphgeom.test.ts`

The range's root is not a commit of the range: it is drawn hollow, dashed and grey (`graphlane-fold`), and so is the
edge into it. On a scoped list (the rail) a parent outside the rows is drawn as a dashed stub one row down: an edge into
the commits before the range, and, past the cap, the line running on under the last row into the "More in Diff" row.
The Diff surface's Log does not ask for stubs and is unchanged.

**Step 1: Write the failing tests** (append inside `describe("graphGeometry", ...)`)

```ts
    it("draws the range's root, and the edge into it, as a boundary", () => {
        const g = graphGeometry(assignLanes([c("a", "root"), { hash: "root", parents: [], boundary: true }]), OPTS);
        expect(g.nodes[1].boundary).toBe(true);
        expect(g.nodes[0].boundary).toBe(false);
        expect(g.edges).toHaveLength(1);
        expect(g.edges[0]).toMatchObject({ boundary: true, dashed: true });
    });

    it("draws a parent outside the rows as a dashed stub one row down, only when asked", () => {
        const rows = assignLanes([c("a", "gone")]);
        expect(graphGeometry(rows, OPTS).edges).toHaveLength(0);
        const g = graphGeometry(rows, { ...OPTS, stubs: true });
        expect(g.edges).toHaveLength(1);
        expect(g.edges[0]).toMatchObject({ dashed: true, boundary: false, d: "M13 17 L13 51" });
        // the stub runs past the last row, so the svg is tall enough to hold it
        expect(g.height).toBeGreaterThanOrEqual(51);
    });
```

**Step 2: Run them to make sure they fail**

Run: `npx vitest run frontend/app/view/agents/gitgraphgeom.test.ts`
Expected: FAIL (`boundary` is undefined; no stub edge).

**Step 3: Implement**

`gitgraphgeom.ts`:
- `GeometryOpts` gains `stubs?: boolean;` with the comment "a parent outside the rows draws a dashed stub one row down
  (the rail's scoped list), instead of nothing (the Log's paged one)".
- `GraphEdge` and `GraphNode` gain `boundary: boolean;`.
- In `graphGeometry`, keep the lowest y a stub reaches (`let stubBottom = 0;`). The loop over parents becomes:

```ts
        for (const parent of row.parents) {
            const pi = rowOf.get(parent);
            if (pi === undefined) {
                // parent not in this page: the Log keeps the lane reserved and draws nothing; a scoped list runs on dashed
                if (opts.stubs) {
                    edges.push({
                        d: `M${x1} ${y1} L${x1} ${y1 + rowH}`,
                        lane: row.lane,
                        folded,
                        dashed: true,
                        boundary: false,
                    });
                    stubBottom = Math.max(stubBottom, y1 + rowH);
                }
                continue;
            }
            const par = rows[pi];
            edges.push({
                d: edgePath(x1, y1, x(par.lane), y(pi)),
                lane: Math.min(row.lane, par.lane),
                folded: folded || par.lane > lastLane,
                dashed: !!row.workingTree || !!par.boundary,
                boundary: !!par.boundary,
            });
        }
```

- The node push gains `boundary: !!row.boundary,`.
- The returned height becomes `rows.length === 0 ? 0 : Math.max(acc + BOTTOM_PAD, stubBottom)`.

`graphgutter.tsx`: a boundary edge strokes `FOLD_TOKEN`; a boundary node is hollow, `FOLD_TOKEN`, dashed:

```tsx
                    stroke={e.boundary ? FOLD_TOKEN : laneColor(e.lane, e.folded)}
```

```tsx
                    fill={
                        n.merge || n.workingTree || n.boundary
                            ? i === selectedIndex
                                ? "var(--color-surface-selected)"
                                : "var(--color-background)"
                            : laneColor(n.lane, n.folded)
                    }
                    stroke={n.boundary ? FOLD_TOKEN : laneColor(n.lane, n.folded)}
                    strokeWidth={2}
                    strokeDasharray={n.workingTree || n.boundary ? "2.5 2.5" : undefined}
```

Update the comment above `fill` to name the boundary too.

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/gitgraphgeom.test.ts frontend/app/view/agents/gitgraph.test.ts`
Expected: PASS. Then `npx prettier --write` and `npx eslint` on the three files: clean. The rail's CDP scenario (Task 10
step 1) asserts the root circle's `stroke-dasharray` and fold stroke and the stubs.

**Step 5: Commit**

```bash
git commit -m "feat(agents): the commit graph draws a scoped list's root and the parents outside it" -- frontend/app/view/agents/gitgraphgeom.ts frontend/app/view/agents/graphgutter.tsx frontend/app/view/agents/gitgraphgeom.test.ts
```

---

### Task 3: The pure model, `railcommits.ts`

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/railcommits.ts`, `frontend/app/view/agents/railcommits.test.ts`

**Step 1: Write the failing test**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    commitRange,
    commitsOpenByDefault,
    commitsSummary,
    RAIL_COMMITS_CAP,
    railCommitRows,
    railCommitTitle,
    railWhere,
} from "./railcommits";

const NOW = 1_800_000_000_000;
const commit = (hash: string, parents: string[], minsAgo = 5): HistoryCommit => ({
    hash,
    parents,
    author: "ttqteo",
    email: "t@example.invalid",
    ts: NOW - minsAgo * 60_000,
    subject: `subject ${hash}`,
});

describe("railWhere", () => {
    const repo = { cwd: "D:\\src\\arcterm\\.worktrees\\97938ba4", branch: "wave/97938ba4", isRepo: true };

    it("names a linked worktree by its short name, the path in full", () => {
        expect(railWhere({ ...repo, worktree: ".worktrees/97938ba4" }, "arcterm")).toEqual({
            branch: "wave/97938ba4",
            place: "97938ba4",
            kind: "worktree",
            path: repo.cwd,
        });
    });

    it("names the main checkout by its project, else its folder", () => {
        const main = { cwd: "D:\\src\\arcterm", branch: "main", isRepo: true };
        expect(railWhere(main, "arcterm")).toMatchObject({ place: "arcterm", kind: "checkout" });
        expect(railWhere(main, "")).toMatchObject({ place: "arcterm", kind: "checkout" });
    });

    it("has nothing to say without a cwd or outside a repository", () => {
        expect(railWhere({ ...repo, cwd: null }, "arcterm")).toBeNull();
        expect(railWhere({ ...repo, isRepo: false }, "arcterm")).toBeNull();
    });
});

describe("commitRange", () => {
    const branchDiff = { base: "main", ref: "mb123", changes: { files: [], adds: 0, dels: 0 } };

    it("is the merge base on Branch, the session start on Session", () => {
        expect(commitRange("branch", { ref: "s0", branchDiff })).toEqual({ from: "mb123", root: "branch", base: "main" });
        expect(commitRange("session", { ref: "s0", branchDiff })).toEqual({ from: "s0", root: "session" });
    });

    it("falls back to Session where there is no branch view, as the files list does", () => {
        expect(commitRange("branch", { ref: "s0" })).toEqual({ from: "s0", root: "session" });
    });

    it("has no range when the session start is unknown", () => {
        expect(commitRange("session", { ref: "" })).toBeNull();
        expect(commitRange("session", {})).toBeNull();
    });
});

describe("railCommitRows", () => {
    const branch = { from: "m1", root: "branch" as const, base: "main" };

    it("puts the uncommitted row on top, the commits, then the range's root", () => {
        const v = railCommitRows([commit("c2", ["c1"]), commit("c1", ["m1"])], branch, {
            head: "c2",
            uncommitted: 3,
            now: NOW,
        });
        expect(v.rows.map((r) => r.hash)).toEqual(["", "c2", "c1", "m1"]);
        expect(v.rows[0]).toMatchObject({ workingTree: true, fileCount: 3, parents: ["c2"] });
        expect(v.rows[3]).toMatchObject({ boundary: true, subject: "branched off here", parents: [] });
        expect(v.rows[3].refs).toEqual([{ label: "main", kind: "branch" }]);
        expect(v.count).toBe(2);
        expect(v.more).toBe(false);
    });

    it("roots a session range at the session's start", () => {
        const v = railCommitRows([commit("c1", ["s0"])], { from: "s0", root: "session" }, { head: "c1", uncommitted: 0, now: NOW });
        expect(v.rows.map((r) => r.hash)).toEqual(["c1", "s0"]);
        expect(v.rows[1]).toMatchObject({ boundary: true, subject: "session started here", refs: [] });
    });

    it("caps the list and drops the root, which is no longer next to the last row", () => {
        const many = Array.from({ length: RAIL_COMMITS_CAP + 1 }, (_, i) => commit(`c${i}`, [`c${i + 1}`]));
        const v = railCommitRows(many, branch, { head: "c0", uncommitted: 0, now: NOW });
        expect(v.count).toBe(RAIL_COMMITS_CAP);
        expect(v.more).toBe(true);
        expect(v.rows.some((r) => r.boundary)).toBe(false);
    });

    it("is empty with no commits and nothing uncommitted, and holds the uncommitted row alone otherwise", () => {
        expect(railCommitRows([], branch, { head: "m1", uncommitted: 0, now: NOW }).rows).toEqual([]);
        const v = railCommitRows([], branch, { head: "m1", uncommitted: 2, now: NOW });
        expect(v.rows.map((r) => r.hash)).toEqual(["", "m1"]);
        expect(v.count).toBe(0);
    });
});

describe("railCommitTitle", () => {
    it("is sha · subject · author · age", () => {
        const v = railCommitRows([commit("abcdef1234", ["m1"], 12)], { from: "m1", root: "session" }, {
            head: "abcdef1234",
            uncommitted: 0,
            now: NOW,
        });
        expect(railCommitTitle(v.rows[0])).toBe(`abcdef1 · subject abcdef1234 · ttqteo · ${v.rows[0].when}`);
    });
});

describe("folding", () => {
    it("opens at five commits or fewer", () => {
        expect(commitsOpenByDefault(5)).toBe(true);
        expect(commitsOpenByDefault(6)).toBe(false);
    });

    it("sums a folded section up by its newest commit and, on Branch, its base", () => {
        const v = railCommitRows([commit("c1", ["m1"], 12)], { from: "m1", root: "branch", base: "main" }, {
            head: "c1",
            uncommitted: 0,
            now: NOW,
        });
        expect(commitsSummary(v, { from: "m1", root: "branch", base: "main" })).toBe(`newest ${v.rows[0].when} · since main`);
        expect(commitsSummary(v, { from: "m1", root: "session" })).toBe(`newest ${v.rows[0].when}`);
        expect(commitsSummary({ rows: [], count: 0, more: false }, { from: "m1", root: "session" })).toBe("");
    });
});
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run frontend/app/view/agents/railcommits.test.ts`
Expected: FAIL, the functions are not exported.

**Step 3: Write the implementation** — add to `railcommits.ts` (Task 1's constants and types stay as they are; the
`HistoryRow` import becomes `import { buildRows, type HistoryRow } from "./historyrows";`):

```ts
import { worktreeName } from "./agentrailmodel";
import type { RailChangesRange, RailGitState } from "./railstore";

const FOLD_ABOVE = 5;

export function railWhere(
    s: Pick<RailGitState, "cwd" | "branch" | "isRepo" | "worktree">,
    project: string
): RailWhere | null {
    if (s.cwd == null || !s.isRepo) {
        return null;
    }
    if (s.worktree) {
        return { branch: s.branch, place: worktreeName(s.worktree), kind: "worktree", path: s.cwd };
    }
    const folder = s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd;
    return { branch: s.branch, place: project || folder, kind: "checkout", path: s.cwd };
}

// the files list's own choice: Branch only where there is a branch view, else Session
export function commitRange(
    range: RailChangesRange,
    s: Pick<RailGitState, "ref" | "branchDiff">
): CommitRange | null {
    if (range === "branch" && s.branchDiff != null) {
        return { from: s.branchDiff.ref, root: "branch", base: s.branchDiff.base };
    }
    return s.ref ? { from: s.ref, root: "session" } : null;
}

// commits: newest first, as GitHistoryCommand reads `<from>..HEAD` with a limit of the cap plus one
export function railCommitRows(
    commits: HistoryCommit[],
    range: CommitRange,
    opts: { head: string; uncommitted: number; now: number }
): RailCommitRows {
    const more = commits.length > RAIL_COMMITS_CAP;
    const shown = commits.slice(0, RAIL_COMMITS_CAP);
    if (shown.length === 0 && opts.uncommitted <= 0) {
        return { rows: [], count: 0, more: false };
    }
    const rows = buildRows(shown, {
        head: opts.head,
        dirtyFileCount: opts.uncommitted,
        rowLabel: "Uncommitted changes",
        now: opts.now,
    });
    // the root is drawn only next to the commit it parents; past the cap the list runs on instead
    if (!more) {
        rows.push({
            hash: range.from,
            parents: [],
            boundary: true,
            subject: range.root === "branch" ? "branched off here" : "session started here",
            author: "",
            email: "",
            ts: 0,
            when: "",
            refs: range.root === "branch" && range.base ? [{ label: range.base, kind: "branch" }] : [],
            before: false,
        });
    }
    return { rows, count: shown.length, more };
}

// a commit row's tooltip: the rail draws no author mark, so the author is here
export function railCommitTitle(row: HistoryRow): string {
    return [row.hash.slice(0, 7), row.subject, row.author, row.when].filter(Boolean).join(" · ");
}

export function commitsOpenByDefault(count: number): boolean {
    return count <= FOLD_ABOVE;
}

// the folded header's one line
export function commitsSummary(v: RailCommitRows, range: CommitRange): string {
    const newest = v.rows.find((r) => !r.workingTree && !r.boundary);
    if (newest == null) {
        return "";
    }
    return range.root === "branch" && range.base ? `newest ${newest.when} · since ${range.base}` : `newest ${newest.when}`;
}
```

Keep the imports at the top of the file, in the order prettier's organize-imports gives.

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/railcommits.test.ts`
Expected: PASS (all). Then `npx prettier --write` and `npx eslint` on the two files: clean.

**Step 5: Commit**

```bash
git add frontend/app/view/agents/railcommits.test.ts
git commit -m "feat(agents): the rail's commits model: range, rows and where line" -- frontend/app/view/agents/railcommits.ts frontend/app/view/agents/railcommits.test.ts
```

---

### Task 4: The per-agent store, `railcommitsstore.ts`

**Depends on:** Task 1 (uses `RAIL_COMMITS_CAP`)
**Files:** `frontend/app/view/agents/railcommitsstore.ts`, `frontend/app/view/agents/railcommitsstore.test.ts`, `frontend/app/view/agents/changesstatus.ts`

The read goes through the existing DEV fault hook (`devCommitFault()`, `changesstatus.ts`), so the CDP scenario can hold a
read (the skeleton) and fail one (the failure panel and Retry), as it does for the Diff surface's lists.

**Step 1: Write the failing test**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ GitHistoryCommand: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
const loadCommitList = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./commitstore", () => ({ loadCommitList }));
vi.mock("./changesstatus", () => ({ devCommitFault: async () => {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { loadRailCommits, railCommitModeAtom, railCommitsAtom, setRailCommitMode } from "./railcommitsstore";

const c = (hash: string): HistoryCommit => ({ hash, parents: [], author: "a", email: "", ts: 0, subject: hash });

beforeEach(() => {
    rpc.GitHistoryCommand.mockReset();
    loadCommitList.mockClear();
    globalStore.set(railCommitsAtom, {});
});

describe("loadRailCommits", () => {
    it("reads <from>..HEAD, one past the cap, and the worktree's uncommitted list", async () => {
        rpc.GitHistoryCommand.mockResolvedValue({ commits: [c("c1")], head: "c1", isrepo: true });
        await loadRailCommits("a1", "/repo", "m1");
        expect(rpc.GitHistoryCommand).toHaveBeenCalledWith({}, { cwd: "/repo", ref: "m1..HEAD", limit: 21 });
        expect(loadCommitList).toHaveBeenCalledWith("/repo");
        expect(globalStore.get(railCommitsAtom).a1).toMatchObject({ key: "/repo|m1", status: "ready", head: "c1" });
    });

    it("shows loading for a new range, but keeps the rows of the same range while it reads again", async () => {
        let release: (v: unknown) => void = () => {};
        rpc.GitHistoryCommand.mockResolvedValueOnce({ commits: [c("c1")], head: "c1", isrepo: true });
        await loadRailCommits("a1", "/repo", "m1");
        rpc.GitHistoryCommand.mockReturnValueOnce(new Promise((r) => (release = r)));
        const again = loadRailCommits("a1", "/repo", "m1");
        expect(globalStore.get(railCommitsAtom).a1.status).toBe("ready");
        release({ commits: [c("c2"), c("c1")], head: "c2", isrepo: true });
        await again;
        expect(globalStore.get(railCommitsAtom).a1.commits.map((x) => x.hash)).toEqual(["c2", "c1"]);

        rpc.GitHistoryCommand.mockReturnValueOnce(new Promise(() => {}));
        void loadRailCommits("a1", "/repo", "s0");
        expect(globalStore.get(railCommitsAtom).a1).toMatchObject({ key: "/repo|s0", status: "loading", commits: [] });
    });

    it("drops a read a newer one overtook", async () => {
        let first: (v: unknown) => void = () => {};
        rpc.GitHistoryCommand.mockReturnValueOnce(new Promise((r) => (first = r)));
        const older = loadRailCommits("a1", "/repo", "m1");
        rpc.GitHistoryCommand.mockResolvedValueOnce({ commits: [c("new")], head: "new", isrepo: true });
        await loadRailCommits("a1", "/repo", "m1");
        first({ commits: [c("old")], head: "old", isrepo: true });
        await older;
        expect(globalStore.get(railCommitsAtom).a1.commits.map((x) => x.hash)).toEqual(["new"]);
    });

    it("keeps git's failure, and a thrown call as one", async () => {
        const failure = { command: "git log m1..HEAD", exitcode: 128, stderr: "unknown revision" };
        rpc.GitHistoryCommand.mockResolvedValueOnce({ commits: [], head: "", isrepo: true, failure });
        await loadRailCommits("a1", "/repo", "m1");
        expect(globalStore.get(railCommitsAtom).a1).toMatchObject({ status: "failed", failure });

        rpc.GitHistoryCommand.mockRejectedValueOnce(new Error("timeout"));
        await loadRailCommits("a1", "/repo", "m1");
        expect(globalStore.get(railCommitsAtom).a1.failure).toMatchObject({ command: "git log m1..HEAD", exitcode: -1 });
    });
});

describe("commit mode", () => {
    it("is per agent", () => {
        setRailCommitMode("a1", true);
        expect(globalStore.get(railCommitModeAtom)).toEqual({ a1: true });
        setRailCommitMode("a1", false);
        expect(globalStore.get(railCommitModeAtom)).toEqual({});
    });
});
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run frontend/app/view/agents/railcommitsstore.test.ts`
Expected: FAIL, the module does not exist.

**Step 3: Implement**

```ts
// frontend/app/view/agents/railcommitsstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The rail's Commits section and commit mode, per agent: the commits of the files list's range (railcommits.ts), whether
// the section is open, and whether the tab is committing. Module atoms written through globalStore, like railstore.ts: the
// rail unmounts with its surface. The uncommitted list and everything a commit needs are commitstore.ts's, keyed by cwd,
// shared with the Diff surface's Commit tab.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { devCommitFault } from "./changesstatus";
import { loadCommitList } from "./commitstore";
import { RAIL_COMMITS_CAP } from "./railcommits";

export interface RailCommitsState {
    key: string; // cwd|from: the range the commits belong to
    status: "loading" | "ready" | "failed";
    commits: HistoryCommit[];
    head: string;
    failure: GitFailure | null;
}

export const railCommitsAtom = atom<Record<string, RailCommitsState>>({}) as PrimitiveAtom<
    Record<string, RailCommitsState>
>;
// the person's fold choice per agent; absent, the section takes commitsOpenByDefault
export const railCommitsOpenAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;
export const railCommitModeAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;

function putFor<T>(a: PrimitiveAtom<Record<string, T>>, id: string, value: T | undefined): void {
    globalStore.set(a, (prev) => {
        const next = { ...prev };
        if (value === undefined) {
            delete next[id];
        } else {
            next[id] = value;
        }
        return next;
    });
}

// a newer read of an agent's commits supersedes one still in flight
const seq = new Map<string, number>();

// The commits after `from`, newest first, one past the cap so the section knows there are more. A read of the range
// already shown keeps its rows until the answer lands; a new range starts from a skeleton.
export async function loadRailCommits(agentId: string, cwd: string, from: string): Promise<void> {
    const key = `${cwd}|${from}`;
    const n = (seq.get(agentId) ?? 0) + 1;
    seq.set(agentId, n);
    if (globalStore.get(railCommitsAtom)[agentId]?.key !== key) {
        putFor(railCommitsAtom, agentId, { key, status: "loading", commits: [], head: "", failure: null });
    }
    // the Uncommitted row's count; its own sequence guard keeps the newest
    void loadCommitList(cwd);
    const command = `git log ${from}..HEAD`;
    try {
        await devCommitFault();
        const r = await RpcApi.GitHistoryCommand(TabRpcClient, { cwd, ref: `${from}..HEAD`, limit: RAIL_COMMITS_CAP + 1 });
        if (seq.get(agentId) !== n) {
            return;
        }
        if (r.failure != null) {
            putFor(railCommitsAtom, agentId, { key, status: "failed", commits: [], head: "", failure: r.failure });
            return;
        }
        putFor(railCommitsAtom, agentId, { key, status: "ready", commits: r.commits ?? [], head: r.head ?? "", failure: null });
    } catch (e) {
        if (seq.get(agentId) === n) {
            putFor(railCommitsAtom, agentId, {
                key,
                status: "failed",
                commits: [],
                head: "",
                failure: { command, exitcode: -1, stderr: String((e as Error)?.message ?? e) },
            });
        }
    }
}

export function setRailCommitsOpen(agentId: string, open: boolean): void {
    putFor(railCommitsOpenAtom, agentId, open);
}

export function setRailCommitMode(agentId: string, on: boolean): void {
    putFor(railCommitModeAtom, agentId, on ? true : undefined);
}
```

In `changesstatus.ts`, the comment above `devCommitFault` names the rail's commits read beside the history and compare
stores.

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/railcommitsstore.test.ts`
Expected: PASS. Then `npx prettier --write` and `npx eslint` on the three files: clean.

**Step 5: Commit**

```bash
git add frontend/app/view/agents/railcommitsstore.ts frontend/app/view/agents/railcommitsstore.test.ts
git commit -m "feat(agents): the rail's per-agent commits store" -- frontend/app/view/agents/railcommitsstore.ts frontend/app/view/agents/railcommitsstore.test.ts frontend/app/view/agents/changesstatus.ts
```

---

### Task 5: Share the commit box's pieces

**Depends on:** none
**Files:** `frontend/app/view/agents/commitbox.tsx`, `frontend/app/view/agents/committab.tsx`, `frontend/app/view/agents/commitstore.ts`

The rail's commit box (Task 9) draws the Commit tab's failure panel and grows its textarea the same way. Move them out of
`committab.tsx` rather than copy them, and export `showInLog`. No behaviour changes.

Changes:
- Create: `frontend/app/view/agents/commitbox.tsx`
- Modify: `frontend/app/view/agents/committab.tsx` (remove `CommitFailure`, `MIN_BOX_PX`, `MAX_BOX_PX`; import them)
- Modify: `frontend/app/view/agents/commitstore.ts:259` (`function showInLog` → `export function showInLog`)

**Step 1: Create `commitbox.tsx`**

Move `CommitFailure` (`committab.tsx:266-298`) into it verbatim, exported, with its imports (`CircleAlert`, `X` from
`lucide-react`), plus:

```tsx
const MIN_BOX_PX = 72; // three lines
const MAX_BOX_PX = 198; // ten lines

// a commit message box grows from three lines to ten with what is typed
export function growMessageBox(el: HTMLTextAreaElement): void {
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_BOX_PX, Math.max(MIN_BOX_PX, el.scrollHeight + 2))}px`;
}
```

Header comment: "The commit box's pieces shared by the Diff surface's Commit tab and the rail's commit mode."

**Step 2: Use them in `committab.tsx`**

Delete the moved code and the two constants; `import { CommitFailure, growMessageBox } from "./commitbox";`; the
layout effect becomes

```tsx
    useLayoutEffect(() => {
        if (boxRef.current != null) {
            growMessageBox(boxRef.current);
        }
    }, [draft, cwd, boxShown]);
```

Drop `CircleAlert` / `X` from its lucide import only if nothing else there uses them (`grep -n "CircleAlert\|<X " committab.tsx`).

**Step 3: Export `showInLog`** in `commitstore.ts`.

**Step 4: Check nothing moved**

Run: `npx vitest run frontend/app/view/agents/commitstore.test.ts frontend/app/view/agents/commitselection.test.ts`
Expected: PASS. Then `npx prettier --write` and `npx eslint` on the three files: clean.

**Step 5: Commit**

```bash
git add frontend/app/view/agents/commitbox.tsx
git commit -m "refactor(agents): share the commit box's failure panel and sizing" -- frontend/app/view/agents/commitbox.tsx frontend/app/view/agents/committab.tsx frontend/app/view/agents/commitstore.ts
```

---

### Task 6: The Diff surface opens a branch compare on a chosen commit

**Depends on:** none
**Files:** `frontend/app/view/agents/agentdiffnav.ts`, `frontend/app/view/agents/comparecolumn.tsx`

A rail row opens the Diff surface on the branch compare with that commit selected (spec, Commits, "Click a row").

**Step 1: `openBranchDiff` selects a commit when asked**

In `agentdiffnav.ts`, add an optional last parameter. `setCompareRefs` resets the selection to the aggregate before its
reads, so the commit is selected after it resolves:

```ts
export function openBranchDiff(
    model: AgentsViewModel,
    scope: DiffScope,
    cwd: string,
    base: string,
    head: string,
    select?: string
): void {
    openDiff(model, { ...scope, range: { kind: "compare", base, head, form: "mergebase", from: scope.range } });
    fireAndForget(async () => {
        await setCompareRefs(cwd, base, head);
        if (select) {
            await selectCompareRow(cwd, select);
        }
    });
}
```

(`selectCompareRow` from `./comparestore`, beside `setCompareRefs`.) Read the rest of `setCompareRefs` first: if it
returns before the compare's sides are loaded and a later load resets `compareSelectionAtom` again, wait for that load
instead. `agentdiffnav.ts` fails `prettier --check` at HEAD on its import order (`fireAndForget`'s import); the
`prettier --write` in Step 3 fixes it in this edit.

**Step 2: The compare column marks its commit rows**

In `comparecolumn.tsx`, `CommitRowView`'s button gains `data-compare-commit={row.hash}` and
`data-selected={selected || undefined}`, so the scenario (Task 10 step 7) can read which commit is selected. Nothing
else changes.

**Step 3: Check it**

Run: `npx prettier --write` and `npx eslint` on the two files; `npx vitest run frontend/app/view/agents/comparestore.test.ts`.
Expected: clean, PASS.

**Step 4: Commit**

```bash
git commit -m "feat(agents): open the branch compare on a chosen commit" -- frontend/app/view/agents/agentdiffnav.ts frontend/app/view/agents/comparecolumn.tsx
```

---

### Task 7: The Commits section component

**Depends on:** Task 2 (uses the `stubs` option and the boundary drawing), Task 3 (uses `railCommitTitle`)
**Files:** `frontend/app/view/agents/railcommitssection.tsx`

Boards: `Main`, `ManyCommits`, `States`. A view over `railcommits.ts`'s rows; Task 8 wires it, Task 10's scenario shows
each of its states (steps 1-6).

**Step 1: Create `railcommitssection.tsx`**

```tsx
// frontend/app/view/agents/railcommitssection.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Changes tab's Commits section: the commits of the files list's range over the graph's lanes, the uncommitted row on
// top, the range's root at the foot. A view over railcommits.ts and railcommitsstore.ts.

import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { ArrowUpRight, ChevronRight, CircleAlert, GitCommitHorizontal } from "lucide-react";
import { assignLanes } from "./gitgraph";
import { graphGeometry } from "./gitgraphgeom";
import { GraphGutter } from "./graphgutter";
import { refChipClass } from "./historyrows";
import { RAIL_MAX_LANES, RAIL_ROW_H, railCommitTitle, type RailCommitRows } from "./railcommits";

export function RailCommitsSection({
    view,
    status,
    failure,
    open,
    summary,
    committing,
    onToggle,
    onOpenCommit,
    onUncommitted,
    onMore,
    onRetry,
}: {
    view: RailCommitRows;
    status: "loading" | "ready" | "failed";
    failure: GitFailure | null;
    open: boolean;
    summary: string;
    committing: boolean; // commit mode is open: the uncommitted row is what it commits
    onToggle: () => void;
    onOpenCommit: (hash: string) => void;
    onUncommitted: () => void;
    onMore: () => void;
    onRetry: () => void;
}) {
    const laned = assignLanes(view.rows);
    // stubs: an edge into the commits before the range, and past the cap the line running on into the More row
    const geom = graphGeometry(laned, { rowH: RAIL_ROW_H, maxLanes: RAIL_MAX_LANES, stubs: true });
    const pad = { height: RAIL_ROW_H, paddingLeft: geom.gutter };
    const selectedIndex = committing ? view.rows.findIndex((r) => r.workingTree) : -1;
    return (
        <section data-rail-commits className="mb-[6px]">
            <h3 className="text-[12px] font-medium">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={onToggle}
                    className="group flex w-full cursor-pointer items-center gap-[8px] rounded-[6px] py-[5px] text-left text-secondary hover:text-primary"
                >
                    <GitCommitHorizontal size={13} aria-hidden className="flex-none" />
                    Commits
                    {view.count > 0 ? (
                        <span className="text-[11px] tabular-nums text-muted">
                            {view.count}
                            {view.more ? "+" : ""}
                        </span>
                    ) : null}
                    {!open && summary ? (
                        <span className="min-w-0 truncate text-[11px] font-normal text-ink-faint">{summary}</span>
                    ) : null}
                    <ChevronRight size={12} aria-hidden className={cn("flex-none text-muted transition-transform", open && "rotate-90")} />
                </button>
            </h3>
            {!open ? null : status === "loading" && view.count === 0 ? (
                <div aria-hidden data-rail-commits-skeleton className="flex flex-col pt-[4px]">
                    {["w-[70%]", "w-[55%]", "w-[62%]"].map((w, i) => (
                        <div key={i} style={{ height: RAIL_ROW_H }} className="flex items-center gap-[10px] pl-[6px]">
                            <SkeletonLine className="h-[9px] w-[9px] rounded-full" />
                            <SkeletonLine className={cn("h-[8px]", w)} />
                        </div>
                    ))}
                </div>
            ) : status === "failed" && failure ? (
                <div role="alert" data-rail-commits-failure className="mt-[4px] flex items-start gap-[8px] rounded-[8px] border border-edge-mid bg-surface px-[10px] py-[8px]">
                    <CircleAlert size={13} aria-hidden className="mt-[1px] flex-none text-error" />
                    <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] font-semibold text-ink-hi">Couldn't read the commits</div>
                        <div className="mt-[2px] break-words text-[10.5px] text-muted">
                            <span className="font-mono">{failure.command}</span>
                            {failure.stderr ? `: ${failure.stderr.trim()}` : ""}
                        </div>
                    </div>
                    <button
                        type="button"
                        data-rail-commits-retry
                        onClick={onRetry}
                        className="flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[8px] py-[3px] text-[11px] font-semibold text-ink-hi hover:border-edge-strong"
                    >
                        Retry
                    </button>
                </div>
            ) : (
                <div className="relative flex flex-col pt-[4px]">
                    <div className="absolute left-0 top-[4px]">
                        <GraphGutter geom={geom} selectedIndex={selectedIndex} />
                    </div>
                    {view.rows.map((row, i) =>
                        row.workingTree ? (
                            <button
                                key="uncommitted"
                                type="button"
                                data-rail-commit-uncommitted
                                onClick={onUncommitted}
                                title="Tick the files and commit them here"
                                style={pad}
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-[7px] rounded-[7px] pr-[6px] text-left hover:bg-surface-hover",
                                    i === selectedIndex && "bg-surface-selected"
                                )}
                            >
                                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-warning">{row.subject}</span>
                                <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">
                                    {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
                                </span>
                            </button>
                        ) : row.boundary ? (
                            <div key="root" data-rail-commit-root style={pad} className="flex items-center gap-[7px] pr-[6px]">
                                <span className="flex-none font-mono text-[10.5px] text-ink-faint">{row.hash.slice(0, 7)}</span>
                                {row.refs.map((r) => (
                                    <span
                                        key={r.label}
                                        className={cn(
                                            "max-w-[90px] flex-none truncate rounded-[5px] border px-[5px] text-[10px] font-semibold leading-[16px]",
                                            refChipClass(r.kind)
                                        )}
                                    >
                                        {r.label}
                                    </span>
                                ))}
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{row.subject}</span>
                            </div>
                        ) : (
                            <button
                                key={row.hash}
                                type="button"
                                data-rail-commit={row.hash}
                                onClick={() => onOpenCommit(row.hash)}
                                title={railCommitTitle(row)}
                                style={pad}
                                className="flex w-full cursor-pointer items-center gap-[7px] rounded-[7px] pr-[6px] text-left hover:bg-surface-hover"
                            >
                                <span className="flex-none font-mono text-[10.5px] text-muted">{row.hash.slice(0, 7)}</span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">{row.subject}</span>
                                <span className="flex-none text-[10.5px] tabular-nums text-muted">{row.when}</span>
                            </button>
                        )
                    )}
                    {view.more ? (
                        <div style={pad} className="flex items-center">
                            <button
                                type="button"
                                data-rail-commits-more
                                onClick={onMore}
                                className="inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                            >
                                More in Diff
                                <ArrowUpRight size={11} aria-hidden />
                            </button>
                        </div>
                    ) : null}
                </div>
            )}
        </section>
    );
}
```

"More in Diff" carries no number: a read of cap + 1 knows only that there are more (spec, Commits). `GraphGutter`
positions itself absolutely; the wrapper's `top-[4px]` matches the list's `pt-[4px]` so its nodes sit on the rows'
centres (Task 10's shot checks it; adjust the wrapper, not the geometry). The More row sits under the last commit row,
where that row's stub (Task 2) ends.

**Step 2: Check it**

Run: `npx prettier --write frontend/app/view/agents/railcommitssection.tsx`, then `npx eslint` on it: clean. The type
check runs in Task 8, where the component is first used.

**Step 3: Commit**

```bash
git add frontend/app/view/agents/railcommitssection.tsx
git commit -m "feat(agents): the rail's Commits section" -- frontend/app/view/agents/railcommitssection.tsx
```

---

### Task 8: The where line, the Commits section and the Files header on the rail

**Depends on:** Task 3 (uses the model's functions), Task 4 (uses the store), Task 5 (uses `showInLog`), Task 6 (uses `openBranchDiff`'s `select`), Task 7 (uses `RailCommitsSection`)
**Files:** `frontend/app/view/agents/agentdetailsrail.tsx`

Boards: `Main` (linked worktree, Branch and Session), `MainCheckout`, `ManyCommits`, `States`. The Commit… button and
commit mode are Task 9: leave them out here. Task 10's scenario shows each (steps 1-7).

**Step 1: `ChangesRangeSwitch` takes `disabled?: boolean`** (Task 9 sets it): when set, the group gets `aria-disabled`
and the title "Commit or cancel first: committing lists what is not committed yet", each option is `disabled` and drawn
`text-ink-faint`, the selected one without its `bg-surface-raised`.

**Step 2: A `RailWhereLine`** beside `FactsLine`, the same `line` classes (`flex min-w-0 items-center gap-[6px]
text-[11.5px] font-medium text-secondary`), `mb-[8px]`, `data-rail-changes-where`, `title={where.path}`: `GitBranch` 11 +
the branch (`shortIds(branch)`), a `·` (`text-ink-faint`), then `FolderTree` 11 + `where.place` for a worktree, or
`Folder` 11 + `where.place` + `·` + "main checkout" (`text-muted`) for a checkout. Icons `text-muted`, values `truncate`.

**Step 3: `filesContent(listed, full = false)`**: only `full` (the Changes tab, `filesContent(changes, true)`) draws the
where line, the Commits section and a Files header; Overview's `filesContent(shownFiles)` stays exactly as it is. When
`full`, the order is: **the where line first, the tab's first line**, then the Session / Branch switch, then the Commits
section, then the Files header and the list.

**Step 4: State and reads**, in the component body before `filesContent`:

```tsx
    const where = railState && !ended ? railWhere(railState, project) : null;
    const range = railState && !ended ? commitRange(changesRange, railState) : null;
    const commitsState = useAtomValue(railCommitsAtom)[agent.id];
    const openChoice = useAtomValue(railCommitsOpenAtom)[agent.id];
    const uncommitted = useAtomValue(commitListAtom)[railState?.cwd ?? ""]?.changes.files.length ?? 0;
    const commitsKey = railState?.cwd && range ? `${railState.cwd}|${range.from}` : null;
    const commitsView =
        range && commitsState?.key === commitsKey
            ? railCommitRows(commitsState.commits, range, { head: commitsState.head, uncommitted, now: Date.now() })
            : null;
    // read on Changes, and again whenever the rail's state is read again (a turn's end, Changes opened, the window back).
    // With no range (Session, no start recorded) there are no commits, but the uncommitted list still feeds Commit…
    useEffect(() => {
        const cwd = railState?.cwd;
        if (shown !== "changes" || !cwd || ended) {
            return;
        }
        if (range) {
            fireAndForget(() => loadRailCommits(agent.id, cwd, range.from));
        } else {
            fireAndForget(() => loadCommitList(cwd));
        }
    }, [shown, railState, range?.from, agent.id, ended]);
```

`project` is computed further down today (`agentProject(lineage, agents, agent)`, ~line 761): move that line up above
this block. Hooks stay unconditional (no early return sits between them). `loadCommitList` and `commitListAtom` come
from `./commitstore`.

**Step 5: Row actions**

```tsx
    const openRailCommit = (hash?: string) => {
        const cwd = railState?.cwd;
        if (!cwd) {
            return;
        }
        globalStore.set(model.focusIdAtom, agent.id);
        const scope = agentDiffScope(agent.id, agent.name);
        if (branchDiff) {
            openBranchDiff(model, scope, cwd, branchDiff.base, railState.branch || "HEAD", hash);
            return;
        }
        openDiff(model, scope);
        if (hash) {
            showInLog(cwd, hash);
        }
    };
    const retryCommits = () => {
        const cwd = railState?.cwd;
        if (cwd && range) {
            fireAndForget(() => loadRailCommits(agent.id, cwd, range.from));
        }
    };
    const commitsOpen = openChoice ?? commitsOpenByDefault(commitsView?.count ?? 0);
```

**Step 6: The section in `filesContent` when `full`**, after the switch. One element, its props chosen by state, so
the long attribute lists are not written three times:

```tsx
                {commitsView && commitsView.rows.length > 0 ? (
                    <RailCommitsSection
                        view={commitsView}
                        status={commitsState!.status}
                        failure={commitsState!.failure}
                        open={commitsOpen}
                        summary={commitsSummary(commitsView, range!)}
                        committing={false}
                        onToggle={() => setRailCommitsOpen(agent.id, !commitsOpen)}
                        onOpenCommit={(h) => openRailCommit(h)}
                        onUncommitted={() => {}}
                        onMore={() => openRailCommit()}
                        onRetry={retryCommits}
                    />
                ) : commitsState?.key === commitsKey && commitsState.status !== "ready" ? (
                    // the first read draws the skeleton, so the files do not jump when it lands; a failed one its panel
                    <RailCommitsSection
                        view={EMPTY_COMMITS}
                        status={commitsState.status}
                        failure={commitsState.failure}
                        open
                        summary=""
                        committing={false}
                        onToggle={() => {}}
                        onOpenCommit={() => {}}
                        onUncommitted={() => {}}
                        onMore={() => {}}
                        onRetry={retryCommits}
                    />
                ) : null}
```

with a module constant `const EMPTY_COMMITS: RailCommitRows = { rows: [], count: 0, more: false };`. (Task 9 replaces
`committing={false}` and `onUncommitted` on the first.) Before the files list, when `full`, a header drawn as the
section headers are (`flex items-center gap-[8px] py-[5px] text-[12px] font-medium text-secondary`, `FileDiff` 13,
"Files", the count in `text-[11px] tabular-nums text-muted`), `data-rail-files-header`.

**Step 7: Check it**

Run: `npx prettier --write frontend/app/view/agents/agentdetailsrail.tsx` (clean at HEAD, so it formats only this
edit) and `npx eslint` on it; then `task check:ts` (allow ~3 min). Expected: clean, exit 0. Then
`npx vitest run frontend/app/view/agents/` — PASS.

**Step 8: Commit**

```bash
git commit -m "feat(agents): the rail's Changes tab names its worktree and draws its commits" -- frontend/app/view/agents/agentdetailsrail.tsx
```

---

### Task 9: Commit mode in the rail

**Depends on:** Task 5, Task 8
**Files:** `frontend/app/view/agents/railcommitbox.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/committab.tsx`

Board: `CommitMode`. In commit mode the list is the uncommitted one (`commitstore`'s, working tree against HEAD), the
switch rests, and the commit box is pinned to the tab's foot. Task 11's scenario shows each part (steps 1-6).

**Step 1: `railcommitbox.tsx`**: two exports.

`RailCommitFiles({ cwd })`: reads `commitListAtom[cwd]` and `commitTicksAtom[cwd]` (`NO_TICKS` when unset). A header
like Task 8's Files header but with a `TickBox` in place of the icon (`state={groupTickState(ticks, files)}`,
`label="Commit every changed file"`, `onToggle={() => setAllTicked(cwd, files, state !== "all")}`,
`attrs={{ "data-rail-commit-tick-all": "" }}`), the label "Uncommitted" (title "What differs from HEAD: the files a
commit can take") and the count. Then one row per file, drawn as `FileRow` in `agentdetailsrail.tsx` (same classes),
with a `TickBox` first (`state={isTicked(ticks, f) ? "all" : "none"}`, `label={`Commit ${f.path}`}`,
`disabled={!committable(f)}`, `title={f.note && !committable(f) ? CHANGE_NOTE_TITLE[f.note] : undefined}`,
`onToggle={() => toggleTick(cwd, f, !isTicked(ticks, f))}`, `attrs={{ "data-rail-commit-tick": f.path }}`); an
untracked row's status `?` is `text-muted`; a row with a note shows its note's words in place of +N −N, as
`CountsOrNote` in `committab.tsx` does (export it from there rather than copying). A row click toggles its tick too. No
keyboard handling: Space and ↑/↓ stay the terminal's.

`RailCommitBox({ cwd, agents, onDone, onCancel, onMore })`: the Commit tab's box, drawn with its classes
(`committab.tsx` `data-commit-box` block): `flex flex-none flex-col gap-[8px] border-t border-border bg-surface
p-[10px]`, `data-rail-commit-box`. It reads:
- `draft = commitDraftAtom[cwd] ?? ""`, `files = commitListAtom[cwd]?.changes.files ?? []`, `ticks`,
  `n = tickedCount(ticks, files)`, `run = commitRunOf(commitRunAtom, cwd)`, and `amend = commitAmendAtom[cwd] === true`
  (`commitstore.ts`): amend is turned on only in the Diff surface's Commit tab, and the label says so;
- `agentCwds = useAtomValue(agentCwdsAtom)` from `./worktreesidebarstore`, as `committab.tsx:318` does.

It draws:
- The textarea (`data-rail-commit-message`, `aria-label="Commit message"`, `placeholder="Commit message"`, `rows={3}`,
  the Commit tab's classes), its value `draft`, `onChange` → `setDraft`, sized by `growMessageBox` in a layout effect
  on the draft; Ctrl/⌘+Enter → `commit()`.
- A row: `workingAgents(cwd, agents, agentCwds)` as "N agents running here" (`text-[10.5px] text-muted`, title the
  names) when any; a spacer; "More in Diff" + `ArrowUpRight` 11 (`text-accent-soft`, title "Amend, folders and
  unversioned files"), `onClick={onMore}`.
- Cancel (secondary button classes from DESIGN.md: `border border-edge-mid bg-surface-raised text-ink-mid
  hover:border-edge-strong`, `h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold`, `data-rail-commit-cancel`)
  → `onCancel`, and the Commit button exactly as the Commit tab's (`data-rail-commit-button`, `commitLabel(n, amend)` so
  an amend turned on in Diff reads "Amend with N files", the `Ctrl+Enter` hint, the spinner while `run.running`,
  primary only while `canCommit(draft, n)`), `flex-1`.
- `run.failure` → `<CommitFailure failure onDismiss={() => dismissCommitFailure(cwd)} />` under the buttons.
- `useEffect(() => startCommitPoll(cwd), [cwd])`: the list is read every 10 s while the mode is open.
- `commit()` checks first, so Ctrl+Enter with no message or no tick does nothing (`commitNow` returns early then, with
  no failure and the draft empty, which would otherwise read as done and leave the mode):

```tsx
    const commit = async () => {
        if (run.running || !canCommit(draft, n)) {
            return;
        }
        await commitNow(cwd);
        // commitNow clears the draft only on success; a refusal leaves it, with the failure under the button
        const after = commitRunOf(globalStore.get(commitRunAtom), cwd);
        if (after.failure == null && (globalStore.get(commitDraftAtom)[cwd] ?? "") === "") {
            onDone();
        }
    };
```

`canCommit`, `tickedCount` and `commitLabel` come from where `commitstore.ts` / `committab.tsx` import them
(`commitselection.ts`).

**Step 2: Wire it in `agentdetailsrail.tsx`**

- `const committing = useAtomValue(railCommitModeAtom)[agent.id] === true && !ended && railState?.cwd != null;`
- `ChangesRangeSwitch disabled={committing}`.
- `RailCommitsSection committing={committing}` and `onUncommitted={() => setRailCommitMode(agent.id, true)}`.
- In `filesContent` when `full`: `committing ? <RailCommitFiles cwd={railState.cwd} /> : (the existing empty line or
  Files header + FilesChangedList)`.
- `FilesChangedList` takes `onCommit?: () => void`; when set, a **Commit…** button sits before View diff in its footer
  (`data-rail-commit-open`, `rounded-[6px] border border-edge-mid bg-surface-raised px-[8px] py-[2px] text-[10.5px]
  font-semibold text-ink-hi hover:border-edge-strong`, title "Tick files and commit them here"). Pass it only when
  `full && uncommitted > 0`; it works with no range too (Task 8's effect loads the uncommitted list then).
- The Changes body becomes a column so the box pins to the foot:

```tsx
                ) : shown === "changes" ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div
                            data-rail-changes
                            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[18px] pb-[40px] pt-[12px]"
                        >
                            {filesContent(changes, true)}
                        </div>
                        {committing && railState?.cwd ? (
                            <RailCommitBox
                                cwd={railState.cwd}
                                agents={agents}
                                onCancel={() => setRailCommitMode(agent.id, false)}
                                onMore={() => openRailCommit()}
                                onDone={() => {
                                    setRailCommitMode(agent.id, false);
                                    fireAndForget(() =>
                                        loadRailForAgent(agent.id, agent.transcriptPath, agent.blockId, { silent: true })
                                    );
                                }}
                            />
                        ) : null}
                    </div>
                ) : undefined
```

  `agents` is the roster already in scope in `AgentDetailsRail` (`model.agentsAtom`, ~line 566); `CommitTab` takes the
  same `AgentVM[]`. The re-read writes a new rail state, so Task 8's effect reads the commits again.
- Leaving Changes or switching agent keeps the mode per agent (the atom); Cancel keeps ticks and draft (they are
  `commitstore`'s).

**Step 3: Check it**

`npx prettier --write` and `npx eslint` on `railcommitbox.tsx`, `agentdetailsrail.tsx`, `committab.tsx` (the last two
are clean at HEAD); `task check:ts`; `npx vitest run frontend/app/view/agents/` — all clean / PASS.

**Step 4: Commit**

```bash
git add frontend/app/view/agents/railcommitbox.tsx
git commit -m "feat(agents): commit ticked files from the rail's Changes tab" -- frontend/app/view/agents/railcommitbox.tsx frontend/app/view/agents/agentdetailsrail.tsx frontend/app/view/agents/committab.tsx
```

---

### Task 10: The `rail-changes-commits` scenario

**Depends on:** Task 8 (drives the rail it wires)
**Files:** `scripts/cdp/scenarios.mjs`

Boards `Main`, `ManyCommits`, `States`, and the row click. A new `railChangesCommits` scenario, registered in
`SCENARIOS` after `agentRailWorktreeFiles`. Never run prettier on this file.

**Step 1: The scenario** `name: "rail-changes-commits"`, `surface: "agent"`. Build it on `agentRailWorktreeFiles`
(`scenarios.mjs` ~32110) and its helpers: a fixture roster written to `TREE_RAIL_FIXTURE` (as `rwfRoster`: agents with
a fake `blockId` and a `transcriptPath` need no terminal, and the transcript's first record gives the rail the agent's
`cwd` and its session start, `sessionStartTs` reading `timestamp`), `ahReload`, `rwfShow`, `polishWaitFor`, `UI_ROUTE`,
and a click-until-shown loop like `rwfOpenFilesTab` on `aside[aria-label="Agent details"] [data-rail-tab="changes"]`
until `[data-rail-commits]` (or, for the States step, the tab body) shows. `arrange(h)` returns `ctx`,
`assert(h, ctx)` returns `[{ step, ok, detail }]` and survives a thrown call (as rwf's does), `teardown(h, ctx)`.

- **arrange:** `base = mkdtempSync(join(tmpdir(), "vrcc-"))` holding `repo`, `rcc-wt`, `rcc-many`, `transcripts`. A git
  helper that dates each commit (`GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` = `@<T0 + min*60> +0000`, `T0` two hours
  ago, `-c user.email=v@v -c user.name=v`), so the session start is deterministic (`gitinfo.CommitBefore` is
  `rev-list -1 --first-parent --before=<ts> HEAD`):
  - `repo`: `git init --initial-branch=main`; commit `a.txt` (+0).
  - `git worktree add -b feat/x <base>/rcc-wt`; in it commit `f1.txt` (+10).
  - in `repo` (main) commit `m1.txt` (+20).
  - in `rcc-wt` commit `f2.txt` (+30); `git merge --no-edit main` (+40); then edit `f1.txt`, uncommitted.
    Branch range: merge base m1, so `m1..HEAD` = merge, f2, f1 (f1's parent a.txt's commit is outside: a stub); one
    uncommitted file. Session (start +35, so f2): `f2..HEAD` = merge, m1.
  - `git worktree add -b feat/many <base>/rcc-many main`; in it 23 commits `n00.txt`..`n22.txt` (+50..+72).
  - transcripts `w.jsonl` (`cwd` rcc-wt, `timestamp` T0 +35 min, ISO) and `m.jsonl` (`cwd` rcc-many, T0 +45 min), each a
    one-line user record as `rwfFixture`'s `transcript()` writes, plus the `timestamp`.
  - roster: `RCC_AGENT_W` "rail commits agent" and `RCC_AGENT_M` "many commits agent", fake block ids, idle.
  - keep the prior `TREE_RAIL_FIXTURE` text and the localStorage keys `agent.rail.visible`, `agent.rail.changesRange`,
    `agent.rail.tab`; set `agent.rail.visible` "true" and `agent.rail.changesRange` `"\"branch\""`; `ahReload`,
    `h.goto("agent")`, wait for both `[data-agent-terminal]`, `rwfShow(RCC_AGENT_W)`, open Changes.
- **assert** (shot each to `cdp-shots/rail-changes-commits-<n>.png`):
  1. Main, Branch: `[data-rail-changes-where]` contains `feat/x` and `rcc-wt`, not "main checkout", and comes before the
     `[role="radiogroup"]` in the document; `[data-rail-commit]` count 3; `[data-rail-commit-uncommitted]` says
     "1 file"; `[data-rail-commit-root]` contains "main" and "branched off here"; in `[data-rail-commits]
     [data-graph-gutter]`: 5 circles, the last one's `stroke-dasharray` set and its `stroke` the fold token
     (`var(--color-graphlane-fold)`), and at least 3 dashed paths (the uncommitted edge, the root edge, f1's stub).
  2. The first `[data-rail-commit]`'s `title` contains its short sha, its subject and the author `v`.
  3. Main, Session: click `[data-changes-range="session"]`: the root row contains "session started here" and no ref
     chip, `[data-rail-commit]` count 2; shot; click `[data-changes-range="branch"]` again, 3 rows back.
  4. Fold: the header button reads `aria-expanded="true"` (3 commits); click it: `"false"`, the header text contains
     "since main"; click again: open.
  5. ManyCommits: `rwfShow(RCC_AGENT_M)`, open Changes: the header button `aria-expanded="false"` on arrival and its
     count reads `20+`; click it open: 20 `[data-rail-commit]`, `[data-rail-commits-more]` shown, no
     `[data-rail-commit-root]`, and the gutter's last path (the last row's stub) is dashed; shot; click More:
     `h.activeSurfaceLabel()` is "Diff"; `h.goto("agent")`, `rwfShow(RCC_AGENT_W)`, Changes.
  6. States: `window.__commitChangesFault = "hang"`, click Session: `[data-rail-commits-skeleton]` shows with 3 rows;
     shot. `window.__commitChangesFault = "error"`, click Branch: `[data-rail-commits-failure]` contains "Couldn't read
     the commits" and "injected", and `[data-rail-files-header]` still shows; shot. Click `[data-rail-commits-retry]`:
     within 10 s 3 `[data-rail-commit]`. Clear `window.__commitChangesFault` whatever happened.
  7. Row click: click the first `[data-rail-commit]` (the merge): within 10 s `h.activeSurfaceLabel()` is "Diff" and
     `[data-compare-commit="<its hash>"][data-selected]` exists; `h.goto("agent")`.
- **teardown:** clear `window.__commitChangesFault`, restore the three localStorage keys and the fixture file (write the
  prior text, or remove the file when there was none), `ahReload`, `h.goto("agent")`, then
  `rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })`. Log a failed step with
  `console.error` and go on, as rwf's teardown does.

**Step 2: Run it** against a dev app (`task dev`, or `task dev:browser` where that is too heavy):
`task verify:ui -- rail-changes-commits`. Expected: PASS. Look at the shots against the Prototype boards `Main`,
`ManyCommits` and `States`. If no dev app can run here, say so in the task report: Final runs it.

**Step 3: Commit**

```bash
git commit -m "test(cdp): rail-changes-commits scenario" -- scripts/cdp/scenarios.mjs
```

---

### Task 11: The `rail-commit-mode` scenario, the changelog

**Depends on:** Task 9 (drives the commit mode it adds), Task 10
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Boards `CommitMode` and `MainCheckout`. A second scenario, `railCommitMode`, registered after `railChangesCommits`,
reusing Task 10's git helper and roster pattern. Never run prettier on `scenarios.mjs`.

**Step 1: The scenario** `name: "rail-commit-mode"`, `surface: "agent"`.

- **arrange:** `base = mkdtempSync(join(tmpdir(), "vrcm-"))`; `repo` on main with `a.txt` committed (+0) and
  `b.txt` (+5); `git worktree add -b feat/c <base>/rcm-wt`; in it commit `f1.txt` (+10); then in `rcm-wt` edit `f1.txt`
  and create `n.txt` (untracked); in `repo` edit `a.txt` (uncommitted). A `commit-msg` hook in `repo/.git/hooks`
  (shared by the worktree; `#!/bin/sh`, written with `mode: 0o755`) that refuses a message containing `REFUSE`:
  `if grep -q REFUSE "$1"; then echo "refused by the test hook" >&2; exit 1; fi`. Register the project
  (`h.rpc("createproject", { name: RCM_PROJECT, path: repo })`, then `waitForProjectInConfig`), so the main checkout's
  where line names it. Transcripts: `c.jsonl` (`cwd` rcm-wt, T0 +7 min: session start b.txt's commit) and `k.jsonl`
  (`cwd` repo, T0 +20 min: start = main's HEAD). Roster: `RCM_AGENT_C` (rcm-wt) and `RCM_AGENT_K` (repo), project
  `RCM_PROJECT`. Keep and set the same localStorage keys as Task 10 (Branch range), `ahReload`, `h.goto("agent")`,
  `rwfShow(RCM_AGENT_C)`, open Changes.
- **assert** (shots to `cdp-shots/rail-commit-mode-<n>.png`):
  1. `[data-rail-commit-open]` shows in the files footer; click it: `[data-rail-commit-box]` shows, the
     `[data-rail-commit-uncommitted]` row has `bg-surface-selected`, every `[data-changes-range]` is `disabled`;
     `[data-rail-commit-tick]` count 2: `f1.txt` `aria-checked="true"`, `n.txt` (untracked, `?`) `"false"`; the
     `[data-rail-commit-tick-all]` box reads `aria-checked="mixed"`; shot (the `CommitMode` board).
  2. Click `n.txt`'s tick: tick-all reads `"true"`; click it again: `"mixed"`.
  3. Set the message to "draft kept" (React-controlled: the native value setter, then an `input` event), click
     `[data-rail-commit-cancel]`: the box is gone, the radios are enabled; click `[data-rail-commit-open]` again: the
     message is "draft kept", `f1.txt` ticked, `n.txt` not.
  4. Empty message, Ctrl+Enter: clear the message, focus `[data-rail-commit-message]`, dispatch Ctrl+Enter
     (`Input.dispatchKeyEvent` with `modifiers: 2`, as `railTabsKey` sends keys): the box is still there, no
     `[data-commit-failure]`.
  5. Refused: message "REFUSE this", click `[data-rail-commit-button]`: within 10 s the box holds `[data-commit-failure]`
     with "refused by the test hook", and stays open; shot.
  6. Done: message "rail commit", click the button: within 10 s the box is gone, `git -C rcm-wt log -1 --format=%s` is
     "rail commit", `[data-rail-commit]` count is one more than before, and `[data-rail-commit-uncommitted]` says
     "1 file" (`n.txt`, still untracked); shot.
  7. MainCheckout: `rwfShow(RCM_AGENT_K)`, open Changes: `[data-rail-changes-where]` contains "main", `RCM_PROJECT` and
     "main checkout"; no `[role="radiogroup"]`; no `[data-rail-commit]`; `[data-rail-commit-uncommitted]` says "1 file";
     `[data-rail-commit-root]` says "session started here"; `[data-rail-commit-open]` shows; shot (the `MainCheckout`
     board).
- **teardown:** as Task 10's, plus remove the project: `h.rpc("deleteproject", { name: RCM_PROJECT })` and the channel
  `createproject` made, as the teardown at `scenarios.mjs` ~6009 does.

**Step 2: Run it**: `task verify:ui -- rail-changes-commits rail-commit-mode agent-rail-tabs`. Expected: PASS. Look at
the shots against the `CommitMode` and `MainCheckout` boards. If no dev app can run here, say so in the task report:
Final runs them.

**Step 3: Changelog** — under the top section's `### Added`:

```markdown
- The side panel's Changes tab says which branch and worktree its list is measured in, lists that range's commits over
  their graph with what is not committed yet on top, and commits ticked files without leaving the agent.
```

**Step 4: Commit**

```bash
git commit -m "test(cdp): rail-commit-mode scenario; changelog" -- scripts/cdp/scenarios.mjs CHANGELOG.md
```
