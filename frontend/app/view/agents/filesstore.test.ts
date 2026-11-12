import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gitChanges = vi.fn();
const resolveCwd = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitChangesCommand: (...a: any[]) => gitChanges(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: (...a: any[]) => resolveCwd(...a) }));
const ensureSessionStart = vi.fn();
vi.mock("./agentsessionstore", () => ({ ensureSessionStart: (...a: any[]) => ensureSessionStart(...a) }));

import { scopeKey, type DiffScope } from "./diffscope";
import {
    agentCwdOf,
    consumeFileLink,
    filesErrorAtom,
    filesRefreshFailedAtom,
    filesSelectedPathAtom,
    filesStateAtom,
    loadFilesForScope,
    reloadChanges,
    requestFileLink,
    selectFile,
    startChangesPoll,
} from "./filesstore";
import { lineCountsKnown } from "./filesstore";

const runScopeVal = (id: string, cwd = "/repo", base = "abc123"): DiffScope => ({
    repo: { origin: { kind: "run", runId: id, cwd, baseCommit: base }, label: `run ${base}` },
    range: { kind: "run", runId: id, baseCommit: base },
});
const agentScopeVal = (id: string): DiffScope => ({
    repo: { origin: { kind: "agent", id }, label: id },
    range: { kind: "session", agentId: id },
});
const projectScopeVal = (name: string, path = "/repo"): DiffScope => ({
    repo: { origin: { kind: "project", name, path }, label: name },
    range: { kind: "working" },
});

afterEach(() => {
    gitChanges.mockReset();
    resolveCwd.mockReset();
    ensureSessionStart.mockReset();
    globalStore.set(filesStateAtom, null);
    globalStore.set(filesSelectedPathAtom, null);
});

describe("loadFilesForScope, run range", () => {
    it("threads the base commit as ref into GitChanges and records it as the diff anchor", async () => {
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "M  x.ts\0", numstat: "1\t0\tx.ts\n" });

        await loadFilesForScope(runScopeVal("run-1"));
        // let the fire-and-forget selectFile settle
        await new Promise((r) => setTimeout(r, 0));

        expect(gitChanges).toHaveBeenCalledWith({}, { cwd: "/repo", ref: "abc123" });
        // the anchor the pane diffs against is this ref, so list and pane cannot disagree
        expect(globalStore.get(filesStateAtom)?.ref).toBe("abc123");
    });
});

describe("loadFilesForScope, upstream counts", () => {
    it("carries the upstream and both counts into the state the sync bar reads", async () => {
        gitChanges.mockResolvedValue({
            isrepo: true,
            branch: "main",
            statusz: "M  x.ts\0",
            numstat: "1\t0\tx.ts\n",
            upstream: "origin/main",
            upstreamahead: 2,
            upstreambehind: 1,
        });

        await loadFilesForScope(projectScopeVal("p"));
        await new Promise((r) => setTimeout(r, 0));

        const s = globalStore.get(filesStateAtom);
        expect([s?.upstream, s?.upstreamAhead, s?.upstreamBehind]).toEqual(["origin/main", 2, 1]);
    });

    it("reads a branch with no upstream as empty and 0/0 (the wire omits the zero values)", async () => {
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "M  x.ts\0", numstat: "1\t0\tx.ts\n" });

        await loadFilesForScope(projectScopeVal("p"));
        await new Promise((r) => setTimeout(r, 0));

        const s = globalStore.get(filesStateAtom);
        expect([s?.upstream, s?.upstreamAhead, s?.upstreamBehind]).toEqual(["", 0, 0]);
    });
});

describe("loadFilesForScope, session range", () => {
    it("resolves the session-start ts, sends it as sessionstartts, and records the echoed base as the anchor", async () => {
        resolveCwd.mockResolvedValue("/wt");
        ensureSessionStart.mockResolvedValue(1719000000);
        // backend resolved the session-start commit and echoed it back as `ref`
        gitChanges.mockResolvedValue({
            isrepo: true,
            branch: "feat",
            statusz: "M  y.ts\0",
            numstat: "2\t0\ty.ts\n",
            ref: "base9",
        });

        await loadFilesForScope(agentScopeVal("a1"), { transcriptPath: "/t.jsonl" });
        await new Promise((r) => setTimeout(r, 0));

        expect(gitChanges).toHaveBeenCalledWith({}, { cwd: "/wt", sessionstartts: 1719000000 });
        // the pane diffs against the SAME base the list did, not "" — else pill/list/diff disagree
        expect(globalStore.get(filesStateAtom)?.ref).toBe("base9");
    });

    it("falls back to a live diff (no base) when the session start can't be resolved", async () => {
        resolveCwd.mockResolvedValue("/wt");
        ensureSessionStart.mockResolvedValue(null);
        gitChanges.mockResolvedValue({
            isrepo: true,
            branch: "main",
            statusz: "M  y.ts\0",
            numstat: "2\t0\ty.ts\n",
            ref: "",
        });

        await loadFilesForScope(agentScopeVal("a2"), { transcriptPath: "/t.jsonl" });
        await new Promise((r) => setTimeout(r, 0));

        expect(gitChanges).toHaveBeenCalledWith({}, { cwd: "/wt" });
        expect(globalStore.get(filesStateAtom)?.ref).toBe("");
    });
});

describe("loadFilesForScope, working range on an agent", () => {
    // Newly expressible: an agent's own worktree read with no anchor. Reaching this today would mean
    // selecting a registered project, which means clearing the agent.
    it("sends neither ref nor sessionstartts", async () => {
        resolveCwd.mockResolvedValue("/wt");
        gitChanges.mockResolvedValue({
            isrepo: true,
            branch: "main",
            statusz: "M  y.ts\0",
            numstat: "2\t0\ty.ts\n",
            ref: "",
        });

        await loadFilesForScope({ ...agentScopeVal("a3"), range: { kind: "working" } }, { transcriptPath: "/t.jsonl" });
        await new Promise((r) => setTimeout(r, 0));

        expect(gitChanges).toHaveBeenCalledWith({}, { cwd: "/wt" });
        expect(ensureSessionStart).not.toHaveBeenCalled();
    });
});

describe("reloadChanges", () => {
    it("does not move the selection back to the first file on a refresh", async () => {
        gitChanges.mockResolvedValueOnce({
            isrepo: true,
            branch: "main",
            statusz: "M  a.ts\0M  b.ts\0",
            numstat: "1\t0\ta.ts\n1\t0\tb.ts\n",
        });

        await loadFilesForScope(projectScopeVal("proj"));
        await new Promise((r) => setTimeout(r, 0));
        expect(globalStore.get(filesSelectedPathAtom)).toBe("a.ts");

        // user navigates away from the auto-selected first file
        selectFile("b.ts");
        expect(globalStore.get(filesSelectedPathAtom)).toBe("b.ts");

        gitChanges.mockResolvedValueOnce({
            isrepo: true,
            branch: "main",
            statusz: "M  a.ts\0M  b.ts\0",
            numstat: "2\t0\ta.ts\n1\t0\tb.ts\n",
        });

        await reloadChanges("/repo");
        await new Promise((r) => setTimeout(r, 0));

        expect(globalStore.get(filesSelectedPathAtom)).toBe("b.ts");
    });

    it("leaves the selection in place when the selected file drops out of the change set", async () => {
        gitChanges.mockResolvedValueOnce({
            isrepo: true,
            branch: "main",
            statusz: "M  a.ts\0M  b.ts\0",
            numstat: "1\t0\ta.ts\n1\t0\tb.ts\n",
        });

        await loadFilesForScope(projectScopeVal("proj"));
        await new Promise((r) => setTimeout(r, 0));
        selectFile("b.ts");

        gitChanges.mockResolvedValueOnce({
            isrepo: true,
            branch: "main",
            statusz: "M  a.ts\0",
            numstat: "1\t0\ta.ts\n",
        });

        await reloadChanges("/repo");
        await new Promise((r) => setTimeout(r, 0));

        expect(globalStore.get(filesSelectedPathAtom)).toBe("b.ts");
    });
});

// a landed run is bounded at its own tip: the list stops there, and a later refresh keeps asking for the same bound
describe("loadFilesForScope, a landed run", () => {
    const landedScope = (): DiffScope => ({
        repo: {
            origin: { kind: "run", runId: "run-9", cwd: "/repo", baseCommit: "abc123", headCommit: "c0ffee1" },
            label: "run abc123",
        },
        range: { kind: "run", runId: "run-9", baseCommit: "abc123", headCommit: "c0ffee1" },
    });

    it("sends the tip as end and records it, and a refresh keeps the bound", async () => {
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "M  x.ts\0", numstat: "1\t0\tx.ts\n" });

        await loadFilesForScope(landedScope());
        await new Promise((r) => setTimeout(r, 0));
        expect(gitChanges).toHaveBeenLastCalledWith({}, { cwd: "/repo", ref: "abc123", end: "c0ffee1" });
        expect(globalStore.get(filesStateAtom)?.end).toBe("c0ffee1");

        await reloadChanges("/repo");
        expect(gitChanges).toHaveBeenLastCalledWith({}, { cwd: "/repo", ref: "abc123", end: "c0ffee1" });
    });

    it("sends no end for an unbounded run", async () => {
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "", numstat: "" });
        await loadFilesForScope(runScopeVal("run-1"));
        expect(gitChanges).toHaveBeenLastCalledWith({}, { cwd: "/repo", ref: "abc123" });
        expect(globalStore.get(filesStateAtom)).not.toHaveProperty("end");
    });
});

// one failed poll tick must not wipe the working-tree row; only a scope's first read takes over the surface
describe("a failed refresh", () => {
    it("keeps the last good read on screen and flags that it is stale", async () => {
        gitChanges.mockResolvedValueOnce({ isrepo: true, branch: "main", statusz: "M  a.ts\0", numstat: "1\t0\ta.ts\n" });
        await loadFilesForScope(projectScopeVal("proj"));
        const good = globalStore.get(filesStateAtom);
        expect(good?.changes?.files).toHaveLength(1);

        gitChanges.mockRejectedValueOnce(new Error("git timed out"));
        await reloadChanges("/repo");

        expect(globalStore.get(filesStateAtom)).toBe(good);
        expect(globalStore.get(filesErrorAtom)).toBe(false);
        expect(globalStore.get(filesRefreshFailedAtom)).toBe(true);

        gitChanges.mockResolvedValueOnce({ isrepo: true, branch: "main", statusz: "M  a.ts\0", numstat: "2\t0\ta.ts\n" });
        await reloadChanges("/repo");
        expect(globalStore.get(filesRefreshFailedAtom)).toBe(false);
    });

    it("takes over the surface when the first read of a scope fails", async () => {
        gitChanges.mockRejectedValueOnce(new Error("not readable"));
        await loadFilesForScope(projectScopeVal("proj"));
        expect(globalStore.get(filesErrorAtom)).toBe(true);
        expect(globalStore.get(filesRefreshFailedAtom)).toBe(false);
        expect(globalStore.get(filesStateAtom)).toMatchObject({ cwd: "/repo", isRepo: false, changes: null });
    });
});

describe("an agent's remembered folder", () => {
    it("is kept once the agent's scope resolves, so an ended agent can still point at its changes", async () => {
        resolveCwd.mockResolvedValue("/work/agent-tree");
        ensureSessionStart.mockResolvedValue(null);
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "", numstat: "" });
        expect(agentCwdOf("ended-1")).toBeUndefined();
        await loadFilesForScope(agentScopeVal("ended-1"), { transcriptPath: "/t.jsonl" });
        expect(agentCwdOf("ended-1")).toBe("/work/agent-tree");
    });
});

describe("startChangesPoll", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("re-fetches changes for the active cwd on every tick", async () => {
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "", numstat: "" });
        await loadFilesForScope(projectScopeVal("proj"));
        gitChanges.mockClear();

        const stop = startChangesPoll(1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(gitChanges).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(gitChanges).toHaveBeenCalledTimes(2);

        stop();
    });

    it("stops ticking once stopped", async () => {
        gitChanges.mockResolvedValue({ isrepo: true, branch: "main", statusz: "", numstat: "" });
        await loadFilesForScope(projectScopeVal("proj"));
        gitChanges.mockClear();

        const stop = startChangesPoll(1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(gitChanges).toHaveBeenCalledTimes(1);

        stop();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(gitChanges).toHaveBeenCalledTimes(1);
    });

    it("is a harmless no-op tick before anything has loaded", async () => {
        const stop = startChangesPoll(1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(gitChanges).not.toHaveBeenCalled();
        stop();
    });
});

describe("scoped file deep link", () => {
    const AVAILABLE = ["docs/open-issues.md", "pkg/jarvis/evidence.go"];

    it("hands the requested path to the scope that asked for it", () => {
        requestFileLink(scopeKey(runScopeVal("r1")), "pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), AVAILABLE)).toBe("pkg/jarvis/evidence.go");
    });

    // the agent details rail used to have its own mechanism, which wrote an atom no pane renders —
    // clicking the third file there opened the surface on the scope's first file instead
    it("works for an agent scope, not only a run", () => {
        requestFileLink(scopeKey(agentScopeVal("a1")), "pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(agentScopeVal("a1")), AVAILABLE)).toBe("pkg/jarvis/evidence.go");
    });

    it("is one-shot, so returning to the Diff surface keeps the user's later selection", () => {
        requestFileLink(scopeKey(runScopeVal("r1")), "pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), AVAILABLE)).toBe("pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), AVAILABLE)).toBeUndefined();
    });

    it("does not leak one scope's request into another scope's load", () => {
        requestFileLink(scopeKey(runScopeVal("r1")), "pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(runScopeVal("r2")), AVAILABLE)).toBeUndefined();
        // still pending for the scope that asked
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), AVAILABLE)).toBe("pkg/jarvis/evidence.go");
    });

    // an agent id and a run id could collide as bare strings; the origin prefix is what keeps them apart
    it("does not confuse an agent with a run or project of the same id", () => {
        const agentX: DiffScope = {
            repo: { origin: { kind: "agent", id: "x" }, label: "x" },
            range: { kind: "working" },
        };
        const runX: DiffScope = {
            repo: { origin: { kind: "run", runId: "x", cwd: "/x", baseCommit: "" }, label: "x" },
            range: { kind: "working" },
        };
        const projectX = projectScopeVal("x", "/x");
        requestFileLink(scopeKey(agentX), "pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(runX), AVAILABLE)).toBeUndefined();
        expect(consumeFileLink(scopeKey(projectX), AVAILABLE)).toBeUndefined();
        expect(consumeFileLink(scopeKey(agentX), AVAILABLE)).toBe("pkg/jarvis/evidence.go");
    });

    it("survives a load whose change set is not in yet, so the next load can honour it", () => {
        // the Diff surface fires one history read per mount against the state captured in that render,
        // which on a remount is still the outgoing scope's — an empty/foreign set must not eat the link
        requestFileLink(scopeKey(runScopeVal("r1")), "pkg/jarvis/evidence.go");
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), [])).toBeUndefined();
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), ["some/other/file.ts"])).toBeUndefined();
        expect(consumeFileLink(scopeKey(runScopeVal("r1")), AVAILABLE)).toBe("pkg/jarvis/evidence.go");
    });

    it("has nothing pending when no link was followed", () => {
        expect(consumeFileLink(scopeKey(runScopeVal("r-none")), AVAILABLE)).toBeUndefined();
    });

    it("an absent scope claims nothing", () => {
        requestFileLink(scopeKey(agentScopeVal("a1")), "pkg/jarvis/evidence.go");
        expect(consumeFileLink("", AVAILABLE)).toBeUndefined();
    });
});

describe("a working tree whose line counts git could not read", () => {
    const listed = { isrepo: true, branch: "main", statusz: " M src/old.py\0", numstat: "" };
    const numstaterror = "git diff --numstat --relative HEAD: exit status 128: fatal: cannot hash src/old.py";

    it("keeps the change list and carries the numstat failure beside it, not as a failed read", async () => {
        gitChanges.mockResolvedValue({ ...listed, numstaterror });
        await loadFilesForScope(projectScopeVal("proj"));

        const state = globalStore.get(filesStateAtom);
        expect(state?.changes?.files.map((f) => f.path)).toEqual(["src/old.py"]);
        expect(state?.numstatError).toBe(numstaterror);
        expect(globalStore.get(filesErrorAtom)).toBe(false);
        expect(globalStore.get(filesRefreshFailedAtom)).toBe(false);

        gitChanges.mockResolvedValue(listed);
        await reloadChanges("/repo");
        expect(globalStore.get(filesStateAtom)?.numstatError).toBeUndefined();
    });

    it("hides the counts only while the working tree is shown and its numstat failed", async () => {
        gitChanges.mockResolvedValue({ ...listed, numstaterror });
        await loadFilesForScope(projectScopeVal("proj"));
        const failed = globalStore.get(filesStateAtom);
        expect(lineCountsKnown(failed, true)).toBe(false);
        // a commit or a comparison is counted by its own read
        expect(lineCountsKnown(failed, false)).toBe(true);
        expect(lineCountsKnown(null, true)).toBe(true);

        gitChanges.mockResolvedValue(listed);
        await reloadChanges("/repo");
        expect(lineCountsKnown(globalStore.get(filesStateAtom), true)).toBe(true);
    });
});
