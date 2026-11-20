import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diffStatsFromChanges } from "./cardgitstore";

// refreshCardGit's reads: the cwd and the session start resolve at once, git answers what a case says
const gitChanges = vi.fn();
const gitAgentEdits = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitChangesCommand: (...a: any[]) => gitChanges(...a),
        GitAgentEditsCommand: (...a: any[]) => gitAgentEdits(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: () => Promise.resolve("/repo") }));
vi.mock("./agentsessionstore", () => ({ ensureSessionStart: () => Promise.resolve(777) }));

import { diffStatsByIdAtom, refreshCardGit, scheduleCardGit } from "./cardgitstore";
import type { GitChanges } from "./gitstatus";

describe("diffStatsFromChanges", () => {
    it("counts files from the change list and passes through add/del totals", () => {
        const ch: GitChanges = {
            files: [
                { path: "a.ts", status: "M", adds: 3, dels: 1 },
                { path: "b.ts", status: "A", adds: 10, dels: 0 },
            ],
            adds: 13,
            dels: 1,
        };
        expect(diffStatsFromChanges(ch)).toEqual({ files: 2, adds: 13, dels: 1 });
    });

    it("is zero across the board for a clean repo", () => {
        expect(diffStatsFromChanges({ files: [], adds: 0, dels: 0 })).toEqual({ files: 0, adds: 0, dels: 0 });
    });
});

describe("refreshCardGit when git cannot count lines", () => {
    afterEach(() => {
        gitChanges.mockReset();
        gitAgentEdits.mockReset();
        vi.restoreAllMocks();
        globalStore.set(diffStatsByIdAtom, {});
    });

    it("logs the numstat failure and leaves no stats rather than a +0 −0 chip", async () => {
        globalStore.set(diffStatsByIdAtom, { a1: { files: 3, adds: 4, dels: 5 } });
        gitChanges.mockResolvedValueOnce({
            branch: "main",
            statusz: " M src/old.py\0",
            numstat: "",
            isrepo: true,
            numstaterror: "git diff --numstat --relative HEAD: exit status 128: fatal: cannot hash src/old.py",
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await refreshCardGit("a1", "t.jsonl", undefined, "pi");
        expect("a1" in globalStore.get(diffStatsByIdAtom)).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("a1");
        expect(warn.mock.calls[0].join(" ")).toContain("cannot hash src/old.py");
    });

    it("still counts a read whose line counts came back", async () => {
        gitChanges.mockResolvedValueOnce({
            branch: "main",
            statusz: " M src/old.py\0",
            numstat: "2\t1\tsrc/old.py\n",
            isrepo: true,
        });
        await refreshCardGit("a2", "t.jsonl", undefined, "pi");
        expect(globalStore.get(diffStatsByIdAtom).a2).toEqual({ files: 1, adds: 2, dels: 1 });
    });
});

describe("refreshCardGit: whose changes the card counts", () => {
    // the checkout holds a file the agent never touched: only a claude agent's own edits keep it out
    const checkout = {
        branch: "main",
        statusz: " M src/own.ts\0 M other.ts\0",
        numstat: "2\t1\tsrc/own.ts\n5\t0\tother.ts\n",
        isrepo: true,
    };
    const own = {
        branch: "main",
        statusz: " M src/own.ts\0",
        numstat: "2\t1\tsrc/own.ts\n",
        isrepo: true,
    };

    afterEach(() => {
        gitChanges.mockReset();
        gitAgentEdits.mockReset();
        vi.useRealTimers();
        globalStore.set(diffStatsByIdAtom, {});
    });

    it("counts a claude agent's own edits, read as the B..H the backend rebuilt", async () => {
        gitAgentEdits.mockResolvedValueOnce({ base: "bbb", end: "hhh", files: [{ path: "src/own.ts" }], bashcalls: 0 });
        gitChanges.mockResolvedValueOnce(own);
        await refreshCardGit("c1", "t.jsonl", undefined, "claude");
        expect(gitAgentEdits.mock.calls[0][1]).toEqual({ cwd: "/repo", transcriptpath: "t.jsonl" });
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", ref: "bbb", end: "hhh" });
        expect(globalStore.get(diffStatsByIdAtom).c1).toEqual({ files: 1, adds: 2, dels: 1 });
    });

    it("counts an agent with no runtime as claude", async () => {
        gitAgentEdits.mockResolvedValueOnce({ base: "bbb", end: "hhh", files: [], bashcalls: 0 });
        gitChanges.mockResolvedValueOnce(own);
        await refreshCardGit("c2", "t.jsonl");
        expect(gitAgentEdits).toHaveBeenCalledTimes(1);
        expect(globalStore.get(diffStatsByIdAtom).c2).toEqual({ files: 1, adds: 2, dels: 1 });
    });

    it("shows no count for a claude agent that has made no edit, however dirty the checkout is", async () => {
        globalStore.set(diffStatsByIdAtom, { c3: { files: 2, adds: 7, dels: 1 } });
        gitAgentEdits.mockResolvedValueOnce({ base: "", end: "", files: [], bashcalls: 0, reason: "no edits to show" });
        gitChanges.mockResolvedValueOnce(checkout);
        await refreshCardGit("c3", "t.jsonl", undefined, "claude");
        expect("c3" in globalStore.get(diffStatsByIdAtom)).toBe(false);
    });

    it("counts any other agent's checkout since its session started", async () => {
        gitChanges.mockResolvedValueOnce(checkout);
        await refreshCardGit("c4", "t.jsonl", undefined, "codex");
        expect(gitAgentEdits).not.toHaveBeenCalled();
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", sessionstartts: 777 });
        expect(globalStore.get(diffStatsByIdAtom).c4).toEqual({ files: 2, adds: 7, dels: 1 });
    });

    it("hides the count when the edits read fails", async () => {
        globalStore.set(diffStatsByIdAtom, { c5: { files: 1, adds: 1, dels: 0 } });
        gitAgentEdits.mockRejectedValueOnce(new Error("timed out"));
        await refreshCardGit("c5", "t.jsonl", undefined, "claude");
        expect("c5" in globalStore.get(diffStatsByIdAtom)).toBe(false);
    });

    it("a debounced refresh keeps the agent's runtime", async () => {
        vi.useFakeTimers();
        gitChanges.mockResolvedValueOnce(checkout);
        scheduleCardGit("c6", "t.jsonl", undefined, "pi");
        await vi.advanceTimersByTimeAsync(4000);
        expect(gitAgentEdits).not.toHaveBeenCalled();
        expect(gitChanges).toHaveBeenCalledTimes(1);
    });
});
