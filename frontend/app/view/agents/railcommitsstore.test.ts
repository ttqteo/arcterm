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
        expect(globalStore.get(railCommitsAtom).a1.failure).toMatchObject({
            command: "git log m1..HEAD",
            exitcode: -1,
        });
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
