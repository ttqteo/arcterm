import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diffStatsFromChanges } from "./cardgitstore";

// refreshCardGit's reads: the cwd and the session start resolve at once, git answers what a case says
const gitChanges = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GitChangesCommand: (...a: any[]) => gitChanges(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: () => Promise.resolve("/repo") }));
vi.mock("./agentsessionstore", () => ({ ensureSessionStart: () => Promise.resolve(null) }));

import { diffStatsByIdAtom, refreshCardGit } from "./cardgitstore";
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
        await refreshCardGit("a1", "t.jsonl");
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
        await refreshCardGit("a2", "t.jsonl");
        expect(globalStore.get(diffStatsByIdAtom).a2).toEqual({ files: 1, adds: 2, dels: 1 });
    });
});
