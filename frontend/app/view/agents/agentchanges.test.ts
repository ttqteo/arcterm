// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const gitChanges = vi.fn();
const gitAgentEdits = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitChangesCommand: (...a: any[]) => gitChanges(...a),
        GitAgentEditsCommand: (...a: any[]) => gitAgentEdits(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { readAgentChanges } from "./agentchanges";

const plain: CommandGitChangesRtnData = {
    branch: "main",
    statusz: " M a.ts\0 M b.ts\0",
    numstat: "1\t1\ta.ts\n2\t0\tb.ts\n",
    isrepo: true,
    numstaterror: undefined,
};

afterEach(() => {
    gitChanges.mockReset();
    gitAgentEdits.mockReset();
});

describe("readAgentChanges", () => {
    it("reads a non-claude agent's checkout since its session started, and never asks for edits", async () => {
        gitChanges.mockResolvedValueOnce(plain);
        const r = await readAgentChanges("/repo", { transcriptPath: "t.jsonl", runtime: "pi" }, 1234);
        expect(gitChanges).toHaveBeenCalledTimes(1);
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", sessionstartts: 1234 });
        expect(gitAgentEdits).not.toHaveBeenCalled();
        expect(r).toEqual({ ch: plain, edits: false, end: "" });
    });

    it("leaves the session start out of a non-claude read when there is none yet", async () => {
        gitChanges.mockResolvedValueOnce(plain);
        await readAgentChanges("/repo", { runtime: "opencode" }, null);
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", sessionstartts: undefined });
    });

    it("reads a claude agent's B..H from the base and end its edits came back with", async () => {
        gitAgentEdits.mockResolvedValueOnce({ base: "bbb", end: "hhh", files: [{ path: "a.ts" }], bashcalls: 0 });
        gitChanges.mockResolvedValueOnce(plain);
        const r = await readAgentChanges("/repo", { transcriptPath: "t.jsonl", runtime: "claude" }, 1234);
        expect(gitAgentEdits.mock.calls[0][1]).toEqual({ cwd: "/repo", transcriptpath: "t.jsonl" });
        expect(gitChanges).toHaveBeenCalledTimes(1);
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", ref: "bbb", end: "hhh" });
        expect(r).toEqual({ ch: plain, edits: true, end: "hhh" });
    });

    it("treats an agent with no runtime as claude", async () => {
        gitAgentEdits.mockResolvedValueOnce({ base: "bbb", end: "hhh", files: [], bashcalls: 0 });
        gitChanges.mockResolvedValueOnce(plain);
        const r = await readAgentChanges("/repo", { transcriptPath: "t.jsonl" }, null);
        expect(r.edits).toBe(true);
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", ref: "bbb", end: "hhh" });
    });

    it("lists nothing for a claude agent with no edits yet, keeping the checkout read's branch, repo flag and session start", async () => {
        gitAgentEdits.mockResolvedValueOnce({ base: "", end: "", files: [], bashcalls: 0, reason: "no edits to show" });
        gitChanges.mockResolvedValueOnce({ ...plain, ref: "sess", numstaterror: "numstat broke" });
        const r = await readAgentChanges("/repo", { transcriptPath: "t.jsonl", runtime: "claude" }, 1234);
        // it names no base or end: the read only says which branch, whether this is a repository and where the session began
        expect(gitChanges.mock.calls[0][1]).toEqual({ cwd: "/repo", sessionstartts: 1234 });
        expect(r.edits).toBe(true);
        expect(r.end).toBe("");
        expect(r.ch.branch).toBe("main");
        expect(r.ch.isrepo).toBe(true);
        expect(r.ch.ref).toBe("sess");
        expect(r.ch.statusz).toBe("");
        expect(r.ch.numstat).toBe("");
        expect(r.ch.numstaterror).toBeUndefined();
    });

    it("shares one read between asks made while it is in flight, and reads again for the next one", async () => {
        let release: (r: any) => void = () => {};
        gitAgentEdits.mockReturnValueOnce(new Promise((res) => (release = res)));
        gitChanges.mockResolvedValue(plain);
        const agent = { transcriptPath: "t.jsonl", runtime: "claude" };
        const first = readAgentChanges("/repo", agent, 1);
        const second = readAgentChanges("/repo", agent, 1);
        // another agent, or the same one in another folder, is its own read
        gitAgentEdits.mockResolvedValueOnce({ base: "", end: "", files: [], bashcalls: 0 });
        gitAgentEdits.mockResolvedValueOnce({ base: "", end: "", files: [], bashcalls: 0 });
        await Promise.all([
            readAgentChanges("/repo", { transcriptPath: "other.jsonl", runtime: "claude" }, 1),
            readAgentChanges("/elsewhere", agent, 1),
        ]);
        expect(gitAgentEdits).toHaveBeenCalledTimes(3);
        release({ base: "bbb", end: "hhh", files: [], bashcalls: 0 });
        const [a, b] = await Promise.all([first, second]);
        expect(a).toBe(b);
        expect(gitAgentEdits).toHaveBeenCalledTimes(3);
        gitAgentEdits.mockResolvedValueOnce({ base: "bbb", end: "hhh", files: [], bashcalls: 0 });
        await readAgentChanges("/repo", agent, 1);
        expect(gitAgentEdits).toHaveBeenCalledTimes(4);
    });

    it("does not keep a failed read: the next ask tries again", async () => {
        const agent = { transcriptPath: "t.jsonl", runtime: "claude" };
        gitAgentEdits.mockRejectedValueOnce(new Error("timed out"));
        await expect(readAgentChanges("/repo", agent, null)).rejects.toThrow("timed out");
        gitAgentEdits.mockResolvedValueOnce({ base: "bbb", end: "hhh", files: [], bashcalls: 0 });
        gitChanges.mockResolvedValueOnce(plain);
        const r = await readAgentChanges("/repo", agent, null);
        expect(r.edits).toBe(true);
    });

    it("lets the edits read's failure through: the caller decides what an unreadable range shows", async () => {
        gitAgentEdits.mockRejectedValueOnce(new Error("timed out"));
        await expect(readAgentChanges("/repo", { transcriptPath: "t.jsonl", runtime: "claude" }, null)).rejects.toThrow(
            "timed out"
        );
        expect(gitChanges).not.toHaveBeenCalled();
    });
});
