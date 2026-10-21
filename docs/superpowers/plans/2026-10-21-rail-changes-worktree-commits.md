# Rail Changes: worktree, commits and commit — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo`

**Final:** `node scripts/cdp/final-verify.mjs rail-changes-commits agent-rail-tabs`

**Prototype:** .superpowers/design/rail-changes-commits/project/Main.dc.html

**Goal:** The right panel's Changes tab names where its diff is measured (branch · worktree), shows the commits of the
same range over the commit graph's lanes with an Uncommitted row on top, and commits ticked files in place.

**Architecture:** Frontend only; no Go change, no `task generate`. Pure model `railcommits.ts` (range, rows, where line),
a per-agent store `railcommitsstore.ts` over the existing `GitHistoryCommand`, the commit graph's existing
`assignLanes` / `graphGeometry` / `GraphGutter` with one new `boundary` flag for the range's root row, and the Diff
surface's commit state (`commitstore.ts`, keyed by cwd) reused as is. Spec:
`docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md`; boards in the Prototype folder (`Main`,
`CommitMode`, `MainCheckout`, `ManyCommits`, `States`).

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Rules that bite here (AGENTS.md / DESIGN.md):** colours only from `@theme` token utilities, never hex; `font-mono`
only for SHAs; pure logic in `.ts` with a `.test.ts` beside it, no render tests; check only the files you touched
(`npx eslint <paths>`, `npx prettier --check <paths>`), never `--write` the tree; `task check:ts` takes ~2 min;
commit with a pathspec (`git commit -m "..." -- <paths>`), no Co-Authored-By trailer.

**Already in place, do not redo:** the rail re-reads git when a turn ends, when Changes opens and on window focus
(`rereadsOnState` and `loadRailForAgent(..., { silent: true })` in `railstore.ts`, wired in `agentdetailsrail.tsx`).
Each re-read writes a new `railStateAtom` object; Task 5 keys the commits read on that object, so the commits follow the
same triggers with no new poll.

---

### Task 1: The graph's root row (`boundary`)

**Depends on:** none
**Files:** `frontend/app/view/agents/gitgraph.ts`, `frontend/app/view/agents/gitgraphgeom.ts`, `frontend/app/view/agents/graphgutter.tsx`, `frontend/app/view/agents/gitgraphgeom.test.ts`

The range's root is not a commit of the range: it is drawn hollow, dashed and grey (`graphlane-fold`), and so is the
edge into it.

Changes:
- Modify: `frontend/app/view/agents/gitgraph.ts` (`GraphCommit`)
- Modify: `frontend/app/view/agents/gitgraphgeom.ts` (`GraphEdge`, `GraphNode`, `graphGeometry`)
- Modify: `frontend/app/view/agents/graphgutter.tsx`
- Test: `frontend/app/view/agents/gitgraphgeom.test.ts`

**Step 1: Write the failing test** (append inside `describe("graphGeometry", ...)`)

```ts
    it("draws the range's root, and the edge into it, as a boundary", () => {
        const g = graphGeometry(assignLanes([c("a", "root"), { hash: "root", parents: [], boundary: true }]), OPTS);
        expect(g.nodes[1].boundary).toBe(true);
        expect(g.nodes[0].boundary).toBe(false);
        expect(g.edges).toHaveLength(1);
        expect(g.edges[0]).toMatchObject({ boundary: true, dashed: true });
    });
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run frontend/app/view/agents/gitgraphgeom.test.ts`
Expected: FAIL (`boundary` is undefined; the object literal is also a type error).

**Step 3: Implement**

`gitgraph.ts`, in `GraphCommit` after `before?`:

```ts
    // the range's root on a scoped list (the rail's merge base or session start): not a commit of the range, drawn grey
    boundary?: boolean;
```

`gitgraphgeom.ts`: add `boundary: boolean;` to both `GraphEdge` and `GraphNode`; in `graphGeometry`, the edge push
becomes

```ts
            edges.push({
                d: edgePath(x1, y1, x(par.lane), y(pi)),
                lane: Math.min(row.lane, par.lane),
                folded: folded || par.lane > lastLane,
                dashed: !!row.workingTree || !!par.boundary,
                boundary: !!par.boundary,
            });
```

and the node push gains `boundary: !!row.boundary,`.

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
Expected: PASS.

**Step 5: Commit**

```bash
git commit -m "feat(agents): the commit graph draws a scoped list's root as a boundary" -- frontend/app/view/agents/gitgraph.ts frontend/app/view/agents/gitgraphgeom.ts frontend/app/view/agents/graphgutter.tsx frontend/app/view/agents/gitgraphgeom.test.ts
```

---

### Task 2: The pure model, `railcommits.ts`

**Depends on:** Task 1 (uses `GraphCommit`'s `boundary` field)
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
Expected: FAIL, `Failed to resolve import "./railcommits"`.

**Step 3: Write the implementation**

```ts
// frontend/app/view/agents/railcommits.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the rail's Changes tab says about where its diff is measured and which commits it spans
// (docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md). The commits are the files list's own range,
// so the two always agree. No React, no Wave runtime.

import { worktreeName } from "./agentrailmodel";
import { buildRows, type HistoryRow } from "./historyrows";
import type { RailChangesRange, RailGitState } from "./railstore";

export const RAIL_COMMITS_CAP = 20;
// a 300px rail: a third lane folds into the second
export const RAIL_MAX_LANES = 2;
export const RAIL_ROW_H = 26;
const FOLD_ABOVE = 5;

export interface RailWhere {
    branch: string;
    place: string; // the worktree's short name, or the checkout's project
    kind: "worktree" | "checkout";
    path: string; // the full cwd, for the tooltip
}

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

export interface CommitRange {
    from: string; // the commit the range starts after: the merge base, or the session's start
    root: "branch" | "session";
    base?: string; // the default branch, on Branch
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

export interface RailCommitRows {
    rows: HistoryRow[];
    count: number; // the commits shown, without the uncommitted and root rows
    more: boolean; // the read found more than the cap
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

`boundary` on a row is `GraphCommit`'s field from Task 1.

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/railcommits.test.ts`
Expected: PASS (all).

**Step 5: Commit**

```bash
git add frontend/app/view/agents/railcommits.ts frontend/app/view/agents/railcommits.test.ts
git commit -m "feat(agents): the rail's commits model: range, rows and where line" -- frontend/app/view/agents/railcommits.ts frontend/app/view/agents/railcommits.test.ts
```

---

### Task 3: The per-agent store, `railcommitsstore.ts`

**Depends on:** Task 2 (uses `RAIL_COMMITS_CAP`)
**Files:** `frontend/app/view/agents/railcommitsstore.ts`, `frontend/app/view/agents/railcommitsstore.test.ts`

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

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/railcommitsstore.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git commit -m "feat(agents): the rail's per-agent commits store" -- frontend/app/view/agents/railcommitsstore.ts frontend/app/view/agents/railcommitsstore.test.ts
```

---

### Task 4: Share the commit box's pieces

**Depends on:** none
**Files:** `frontend/app/view/agents/commitbox.tsx`, `frontend/app/view/agents/committab.tsx`, `frontend/app/view/agents/commitstore.ts`

The rail's commit box (Task 6) draws the Commit tab's failure panel and grows its textarea the same way. Move them out of
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
Expected: PASS. Then `npx eslint frontend/app/view/agents/commitbox.tsx frontend/app/view/agents/committab.tsx frontend/app/view/agents/commitstore.ts`: clean.

**Step 5: Commit**

```bash
git commit -m "refactor(agents): share the commit box's failure panel and sizing" -- frontend/app/view/agents/commitbox.tsx frontend/app/view/agents/committab.tsx frontend/app/view/agents/commitstore.ts
```

---

### Task 5: The where line and the Commits section on the rail

**Depends on:** Task 1 (the gutter's boundary root), Task 2 (the rows and where line), Task 3 (the commits store), Task 4 (`showInLog`, exported there)
**Files:** `frontend/app/view/agents/railcommitssection.tsx`, `frontend/app/view/agents/agentdiffnav.ts`, `frontend/app/view/agents/agentdetailsrail.tsx`

Boards: `Main` (linked worktree, Branch and Session), `MainCheckout`, `ManyCommits`, `States`. The Commit… button and
commit mode are Task 6: leave them out here.

Changes:
- Create: `frontend/app/view/agents/railcommitssection.tsx`
- Modify: `frontend/app/view/agents/agentdiffnav.ts` (`openBranchDiff` takes a commit to select)
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`filesContent`, `ChangesRangeSwitch`, a `RailWhereLine`, a
  Files header)

**Step 1: `openBranchDiff` selects a commit when asked**

In `agentdiffnav.ts`, add an optional last parameter and select after the compare's refs are set (they reset the
selection):

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

(`selectCompareRow` from `./comparestore`.) Read `setCompareRefs` first: if it loads the compare's sides without
awaiting them, the selection must wait for that load instead; the CDP step in Task 7 asserts the row ends up selected.

**Step 2: `railcommitssection.tsx`**

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
import { refChipClass, rowTitle } from "./historyrows";
import { RAIL_MAX_LANES, RAIL_ROW_H, type RailCommitRows } from "./railcommits";

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
    const geom = graphGeometry(laned, { rowH: RAIL_ROW_H, maxLanes: RAIL_MAX_LANES });
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
                <div aria-hidden className="flex flex-col pt-[4px]">
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
                                title={rowTitle(row)}
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

The canvas's "3 more in Diff" has no number here: a read of cap + 1 knows only that there are more. `GraphGutter`
positions itself absolutely; check in the CDP shot that its nodes sit on the rows' centres (the wrapper's `top-[4px]`
matches the list's `pt-[4px]`), and adjust the wrapper, not the geometry.

**Step 3: Wire it in `agentdetailsrail.tsx`**

1. `ChangesRangeSwitch` takes `disabled?: boolean` (Task 6 sets it): when set, the group gets `aria-disabled` and the
   title "Commit or cancel first: committing lists what is not committed yet", each option is `disabled` and drawn
   `text-ink-faint`, the selected one without its `bg-surface-raised`.
2. A `RailWhereLine` beside `FactsLine`, the same `line` classes (`flex min-w-0 items-center gap-[6px] text-[11.5px]
   font-medium text-secondary`), `mb-[8px]`, `data-rail-changes-where`, `title={where.path}`: `GitBranch` 11 + the branch
   (`shortIds(branch)`), a `·` (`text-ink-faint`), then `FolderTree` 11 + `where.place` for a worktree, or `Folder` 11 +
   `where.place` + `·` + "main checkout" (`text-muted`) for a checkout. Icons `text-muted`, values `truncate`.
3. `filesContent(listed, full = false)`: only `full` (the Changes tab, `filesContent(changes, true)`) draws the where
   line, the Commits section and a Files header; Overview's `filesContent(shownFiles)` stays exactly as it is.
4. In the component body, before `filesContent`:

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
    // read on Changes, and again whenever the rail's state is read again (a turn's end, Changes opened, the window back)
    useEffect(() => {
        if (shown === "changes" && railState?.cwd && range) {
            fireAndForget(() => loadRailCommits(agent.id, railState.cwd!, range.from));
        }
    }, [shown, railState, range?.from, agent.id]);
```

`project` is computed further down today (`agentProject(lineage, agents, agent)`, ~line 761): move that line up above
this block. Hooks stay unconditional (no early return sits between them).

5. Row actions:

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
```

6. In `filesContent` when `full`, after the switch:

```tsx
                {commitsView && commitsView.rows.length > 0 ? (
                    <RailCommitsSection
                        view={commitsView}
                        status={commitsState!.status}
                        failure={commitsState!.failure}
                        open={openChoice ?? commitsOpenByDefault(commitsView.count)}
                        summary={commitsSummary(commitsView, range!)}
                        committing={false}
                        onToggle={() => setRailCommitsOpen(agent.id, !(openChoice ?? commitsOpenByDefault(commitsView.count)))}
                        onOpenCommit={(h) => openRailCommit(h)}
                        onUncommitted={() => {}}
                        onMore={() => openRailCommit()}
                        onRetry={() => railState?.cwd && range && fireAndForget(() => loadRailCommits(agent.id, railState.cwd!, range.from))}
                    />
                ) : commitsState?.status === "loading" && commitsState.key === commitsKey ? (
                    /* the first read: draw the section's skeleton so the files do not jump when it lands */
                    <RailCommitsSection view={{ rows: [], count: 0, more: false }} status="loading" failure={null} open summary="" committing={false} onToggle={() => {}} onOpenCommit={() => {}} onUncommitted={() => {}} onMore={() => {}} onRetry={() => {}} />
                ) : commitsState?.status === "failed" && commitsState.key === commitsKey ? (
                    <RailCommitsSection view={{ rows: [], count: 0, more: false }} status="failed" failure={commitsState.failure} open summary="" committing={false} onToggle={() => {}} onOpenCommit={() => {}} onUncommitted={() => {}} onMore={() => {}} onRetry={() => railState?.cwd && range && fireAndForget(() => loadRailCommits(agent.id, railState.cwd!, range.from))} />
                ) : null}
```

(Task 6 replaces `committing={false}` and `onUncommitted`.) Before the files list, when `full`, a header drawn as the
section headers are (`flex items-center gap-[8px] py-[5px] text-[12px] font-medium text-secondary`, `FileDiff` 13,
"Files", the count in `text-[11px] tabular-nums text-muted`), `data-rail-files-header`.

**Step 4: Check it**

Run: `npx eslint` and `npx prettier --check` on the three files, then `task check:ts` (allow ~3 min).
Expected: clean, exit 0. Then `npx vitest run frontend/app/view/agents/` — PASS.

**Step 5: Commit**

```bash
git commit -m "feat(agents): the rail's Changes tab names its worktree and draws its commits" -- frontend/app/view/agents/railcommitssection.tsx frontend/app/view/agents/agentdiffnav.ts frontend/app/view/agents/agentdetailsrail.tsx
```

---

### Task 6: Commit mode in the rail

**Depends on:** Task 3 (the commit-mode atom), Task 4, Task 5
**Files:** `frontend/app/view/agents/railcommitbox.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/committab.tsx`

Board: `CommitMode`. In commit mode the list is the uncommitted one (`commitstore`'s, working tree against HEAD), the
switch rests, and the commit box is pinned to the tab's foot.

**Step 1: `railcommitbox.tsx`**: two exports.

`RailCommitFiles({ cwd })`: reads `commitListAtom[cwd]` and `commitTicksAtom[cwd]` (`NO_TICKS` when unset). A header
like Task 5's Files header but with a `TickBox` in place of the icon (`state={groupTickState(ticks, files)}`,
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
p-[10px]`, `data-rail-commit-box`.
- The textarea (`data-rail-commit-message`, `aria-label="Commit message"`, `placeholder="Commit message"`, `rows={3}`,
  the Commit tab's classes), its value `commitDraftAtom[cwd]`, `onChange` → `setDraft`, sized by `growMessageBox` in a
  layout effect on the draft; Ctrl/⌘+Enter → `commit()`.
- A row: `workingAgents(cwd, agents, agentCwds)` as "N agents running here" (`text-[10.5px] text-muted`, title the
  names) when any; a spacer; "More in Diff" + `ArrowUpRight` 11 (`text-accent-soft`, title "Amend, folders and
  unversioned files"), `onClick={onMore}`.
- Cancel (secondary button classes from DESIGN.md: `border border-edge-mid bg-surface-raised text-ink-mid
  hover:border-edge-strong`, `h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold`) → `onCancel`, and the
  Commit button exactly as the Commit tab's (`data-rail-commit-button`, `commitLabel(n, amend)` so an amend turned on in
  Diff reads "Amend with N files", the `Ctrl+Enter` hint, the spinner while `run.running`), `flex-1`.
- `run.failure` → `<CommitFailure failure onDismiss={() => dismissCommitFailure(cwd)} />` under the buttons.
- `useEffect(() => startCommitPoll(cwd), [cwd])`: the list is read every 10 s while the mode is open.
- `commit()`:

```tsx
    const commit = async () => {
        await commitNow(cwd);
        // commitNow clears the draft only on success; a refusal leaves it, with the failure under the button
        const run = commitRunOf(globalStore.get(commitRunAtom), cwd);
        if (run.failure == null && (globalStore.get(commitDraftAtom)[cwd] ?? "") === "") {
            onDone();
        }
    };
```

**Step 2: Wire it in `agentdetailsrail.tsx`**

- `const committing = useAtomValue(railCommitModeAtom)[agent.id] === true && !ended && railState?.cwd != null;`
- `ChangesRangeSwitch disabled={committing}`.
- `RailCommitsSection committing={committing}` and `onUncommitted={() => setRailCommitMode(agent.id, true)}`.
- In `filesContent` when `full`: `committing ? <RailCommitFiles cwd={railState.cwd} /> : (the existing empty line or
  Files header + FilesChangedList)`.
- `FilesChangedList` takes `onCommit?: () => void`; when set, a **Commit…** button sits before View diff in its footer
  (`data-rail-commit-open`, `rounded-[6px] border border-edge-mid bg-surface-raised px-[8px] py-[2px] text-[10.5px]
  font-semibold text-ink-hi hover:border-edge-strong`, title "Tick files and commit them here"). Pass it only when
  `full && uncommitted > 0`.
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

  `agents` is the roster already in scope in `AgentDetailsRail` (what `agentProject` reads); `CommitTab` takes the same
  `AgentVM[]`. If the name differs, use the one `agentProject(lineage, agents, agent)` is given.
- Leaving Changes or switching agent keeps the mode per agent (the atom); Cancel keeps ticks and draft (they are
  `commitstore`'s).

**Step 3: Check it**

`npx eslint` / `npx prettier --check` on `railcommitbox.tsx`, `agentdetailsrail.tsx`, `committab.tsx`; `task check:ts`;
`npx vitest run frontend/app/view/agents/` — all clean / PASS.

**Step 4: Commit**

```bash
git commit -m "feat(agents): commit ticked files from the rail's Changes tab" -- frontend/app/view/agents/railcommitbox.tsx frontend/app/view/agents/agentdetailsrail.tsx frontend/app/view/agents/committab.tsx
```

---

### Task 7: The CDP scenario, the changelog

**Depends on:** Task 6 (the rail it drives)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Changes:
- Modify: `scripts/cdp/scenarios.mjs` (a `railChangesCommits` scenario, registered in `SCENARIOS` after
  `agentRailWorktreeFiles`)
- Modify: `CHANGELOG.md` (top `## Unreleased`, `### Added`)

**Step 1: The scenario** `name: "rail-changes-commits"`, `surface: "agent"`. Scenario shape and helpers as in
`agentRailWorktreeFiles` (`scenarios.mjs` ~32111): `arrange(h)` returns `ctx`, `assert(h, ctx)` returns
`[{ step, ok, detail }]`, `teardown(h, ctx)`; `waveService`, `polishWaitFor` and `UI_ROUTE` are module helpers there.
A working ad-hoc version of the agent set-up is in this session's scratch script (the rail re-read check); its steps:

- **arrange:** `mkdtempSync(join(tmpdir(), "vrcc-"))`; `git init -b main`, user name/email set locally; commit `a.txt`
  on main; `git switch -c feat/x`; commit `f1.txt`, then `f2.txt`; `git switch main`, commit `m1.txt`;
  `git switch feat/x`; `git merge --no-edit main`; then edit `f1.txt` uncommitted. So the range `m1..HEAD` holds f1, f2
  and the merge, the root is m1, and one file is uncommitted. Create a tab with `waveService(h, "workspace",
  "CreateTab", [workspaceId, "railcommits", false])`; its block: `setmeta` `{ view: "term", controller: "shell",
  "cmd:cwd": repo }`; the tab: `{ "session:project": "railcommits", "session:agent": "claude" }`. Publish the agent's
  status: `h.rpc("eventpublish", { event: "agent:status", scopes: ["block:" + blockId], persist: 1, data: { oref:
  "block:" + blockId, state: "idle", agent: "claude", cwd: repo, title: "rail commits", ts: Date.now() } })`. Keep the
  prior values of `localStorage` keys `agent.rail.visible` and `agent.rail.changesRange` in ctx, then set them to
  `"true"` and `"\"branch\""`, reload (`h.reload()`), `h.goto("agent")`, `h.rpc("uireveal", { address: "agent:" + tabId
  }, UI_ROUTE)`, and click `aside[aria-label="Agent details"] [data-rail-key="changes"]` until `[data-rail-commits]`
  shows (the rail loads after the switch).
- **assert** (shot each to `cdp-shots/rail-changes-commits-<n>.png`):
  1. `[data-rail-changes-where]` text contains `feat/x` and "main checkout".
  2. `[data-rail-commit]` count is 3, `[data-rail-commit-uncommitted]` says "1 file", `[data-rail-commit-root]` contains
     `main`; `[data-rail-commits] [data-graph-gutter] circle` count is 5.
  3. Click the Commits header button: `aria-expanded="false"` and the header text contains "since main"; click again:
     open.
  4. Click `[data-rail-commit-uncommitted]`: `[data-rail-commit-box]` shows, `[data-rail-commit-tick]` count is 1, the
     switch's radios are `disabled`.
  5. Untick and tick `f1.txt` via its `[data-rail-commit-tick]`: `aria-checked` goes false then true.
  6. Set the message (React-controlled: the native value setter, then an `input` event) to "rail commit", click
     `[data-rail-commit-button]`: within 10 s the box is gone, `[data-rail-commit]` count is 4, no
     `[data-rail-commit-uncommitted]`; in node, `git -C repo log -1 --format=%s` is "rail commit".
  7. Click the newest `[data-rail-commit]` row: `h.activeSurfaceLabel()` is "Diff", and the compare column's selected
     row is that commit (read the selection the column marks; find its attribute in `comparecolumn.tsx`).
- **teardown:** restore the two localStorage keys, close the tab (`waveService(h, "workspace", "CloseTab", [workspaceId,
  tabId, false])`), go back to the agent surface, `rmSync(repo, { recursive: true, force: true, maxRetries: 10,
  retryDelay: 200 })` (the closed shell may hold the folder a moment).

**Step 2: Run it** against a dev app (`task dev`, or on a machine where that is too heavy `task dev:browser`):
`task verify:ui -- rail-changes-commits agent-rail-tabs`. Expected: PASS. Look at the shots against the Prototype boards
(`Main`, `CommitMode`). If no dev app can run, say so and add a `- [ ] (arcterm) ...` line to `docs/open-issues.md`
"0 · Waiting on a hand check" naming what was not seen.

**Step 3: Changelog** — under the top section's `### Added`:

```markdown
- The side panel's Changes tab says which branch and worktree its list is measured in, lists that range's commits over
  their graph with what is not committed yet on top, and commits ticked files without leaving the agent.
```

**Step 4: Commit**

```bash
git commit -m "test(cdp): rail-changes-commits scenario; changelog" -- scripts/cdp/scenarios.mjs CHANGELOG.md
```
