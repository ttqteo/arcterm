// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";

const requestFileLink = vi.fn();
vi.mock("./filesstore", () => ({ requestFileLink: (...a: any[]) => requestFileLink(...a) }));
const listWorktrees = vi.fn();
const gitHistory = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitListWorktreesCommand: (...a: any[]) => listWorktrees(...a),
        GitHistoryCommand: (...a: any[]) => gitHistory(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { agentDiffScope, diffScopeOfRun, landedRunTip, openDiff, openRunDiff, runDiffScope } from "./agentdiffnav";
import { scopeKey } from "./diffscope";
import { diffScopeAtom } from "./diffscopeatom";

const surfaceAtom = atom("cockpit");
const model = { diffScopeAtom, surfaceAtom } as any;

describe("openDiff", () => {
    it("stores the scope and switches to the Diff surface", () => {
        const scope = agentDiffScope("a1", "jarvis-recall");
        openDiff(model, scope);
        expect(globalStore.get(diffScopeAtom)).toEqual(scope);
        expect(globalStore.get(surfaceAtom)).toBe("files");
    });

    // The link and the load must name the scope with the same string, or the request is never claimed
    // and the surface opens on its first file instead of the one that was clicked.
    it("requests the file link under the same key the loader will use", () => {
        requestFileLink.mockClear();
        const scope = runDiffScope("r1", "/repo", "9f2c1de");
        openDiff(model, scope, "pkg/jarvis/evidence.go");
        expect(requestFileLink).toHaveBeenCalledWith(scopeKey(scope), "pkg/jarvis/evidence.go");
    });

    it("skips the link request when no file was named", () => {
        requestFileLink.mockClear();
        openDiff(model, agentDiffScope("a1", "jarvis-recall"));
        expect(requestFileLink).not.toHaveBeenCalled();
    });

    it("opens a run on the run range and an agent on its session range", () => {
        expect(runDiffScope("r1", "/repo", "9f2c1de").range).toEqual({
            kind: "run",
            runId: "r1",
            baseCommit: "9f2c1de",
        });
        expect(agentDiffScope("a1", "n").range).toEqual({ kind: "session", agentId: "a1" });
    });

    it("carries the run's directory and base commit, which exist nowhere else to be re-resolved", () => {
        expect(runDiffScope("r1", "/repo", "9f2c1de").repo.origin).toEqual({
            kind: "run",
            runId: "r1",
            cwd: "/repo",
            baseCommit: "9f2c1de",
        });
    });

    // a run landing on its own branch did its work in that tree; the checkout holds the human's edits
    it("diffs a run where its lanes landed", () => {
        const run = { id: "r3", projectpath: "/repo", basecommit: "9f2c1de" } as Run;
        expect(diffScopeOfRun(run).repo.origin).toMatchObject({ cwd: "/repo" });
        const landed = { ...run, landpath: "/repo/.waveterm/worktrees/r3" } as Run;
        expect(diffScopeOfRun(landed)).toEqual(runDiffScope("r3", "/repo/.waveterm/worktrees/r3", "9f2c1de"));
    });

    it("degrades a missing base commit to the live diff rather than undefined", () => {
        expect(runDiffScope("r2", "/repo").repo.origin).toEqual({
            kind: "run",
            runId: "r2",
            cwd: "/repo",
            baseCommit: "",
        });
    });

    // an unbounded run keeps the origin and range it always had, so its review marks stay under the same key
    it("bounds a landed run at its tip, and leaves an unbounded one without the field", () => {
        const bounded = runDiffScope("r5", "/repo", "9f2c1de", "c0ffee1");
        expect(bounded.repo.origin).toEqual({
            kind: "run",
            runId: "r5",
            cwd: "/repo",
            baseCommit: "9f2c1de",
            headCommit: "c0ffee1",
        });
        expect(bounded.range).toEqual({ kind: "run", runId: "r5", baseCommit: "9f2c1de", headCommit: "c0ffee1" });
        expect(runDiffScope("r5", "/repo", "9f2c1de", "").repo.origin).not.toHaveProperty("headCommit");
        expect(runDiffScope("r5", "/repo", "9f2c1de", "").range).not.toHaveProperty("headCommit");
    });
});

// a land is a --no-ff merge, so the run branch's tip is its second parent; the tip is what bounds the run's diff
describe("landedRunTip", () => {
    it("takes the second parent of a merge land", () => {
        expect(landedRunTip("land1", ["main1", "tip1"], "end1")).toBe("tip1");
    });
    it("takes the land commit itself when it has one parent (a fast-forward)", () => {
        expect(landedRunTip("land1", ["main1"], "end1")).toBe("land1");
    });
    it("falls back to the run's end commit, then to unbounded", () => {
        expect(landedRunTip("land1", undefined, "end1")).toBe("end1");
        expect(landedRunTip(undefined, undefined, "end1")).toBe("end1");
        expect(landedRunTip(undefined, undefined, undefined)).toBe("");
        expect(landedRunTip("land1", [], undefined)).toBe("");
    });
});

// landing removes the run's tree; its commits are then in the checkout, and the tree was a worktree of the whole
// repository even when the project is a subfolder of it
describe("openRunDiff", () => {
    const run = { id: "r4", projectpath: "C:/SIEM/webapp", landpath: "C:/arc-wt/r4", basecommit: "9f2c1de" } as Run;
    const landed = { ...run, endcommit: "end9", land: { state: "landed", commit: "land1" } } as Run;
    const repoRoot = {
        worktrees: [
            { path: "C:/arc-wt/other", branch: "wave/x" },
            { path: "C:/SIEM", branch: "main", ismain: true },
        ],
    };

    it("opens a landed run on the checkout's repo root, bounded at its tip", async () => {
        listWorktrees.mockResolvedValueOnce(repoRoot);
        gitHistory.mockResolvedValueOnce({ commits: [{ hash: "land1", parents: ["main1", "tip1"] }] });
        await openRunDiff(model, landed);
        expect(listWorktrees).toHaveBeenLastCalledWith({}, { cwd: "C:/SIEM/webapp" });
        expect(gitHistory).toHaveBeenLastCalledWith(
            {},
            { cwd: "C:/SIEM", ref: "land1", limit: 1 },
            { timeout: 15_000 }
        );
        expect(globalStore.get(diffScopeAtom)).toEqual(runDiffScope("r4", "C:/SIEM", "9f2c1de", "tip1"));
    });

    it("falls back to the project when the repo root cannot be read", async () => {
        listWorktrees.mockRejectedValueOnce(new Error("boom"));
        gitHistory.mockResolvedValueOnce({ commits: [{ hash: "land1", parents: ["main1", "tip1"] }] });
        await openRunDiff(model, landed);
        expect(globalStore.get(diffScopeAtom)).toEqual(runDiffScope("r4", "C:/SIEM/webapp", "9f2c1de", "tip1"));
    });

    it("falls back to the run's end commit when the land commit's parents cannot be read", async () => {
        listWorktrees.mockResolvedValueOnce(repoRoot);
        gitHistory.mockResolvedValueOnce({ commits: [], failure: { command: "git log", exitcode: 128, stderr: "" } });
        await openRunDiff(model, landed);
        expect(globalStore.get(diffScopeAtom)).toEqual(runDiffScope("r4", "C:/SIEM", "9f2c1de", "end9"));
    });

    it("opens a landed run with no land commit and no end commit unbounded", async () => {
        listWorktrees.mockResolvedValueOnce(repoRoot);
        gitHistory.mockClear();
        await openRunDiff(model, { ...run, land: { state: "landed" } } as Run);
        expect(gitHistory).not.toHaveBeenCalled();
        expect(globalStore.get(diffScopeAtom)).toEqual(runDiffScope("r4", "C:/SIEM", "9f2c1de"));
    });

    it("opens a run not yet landed on its landing tree, without asking git", async () => {
        listWorktrees.mockClear();
        gitHistory.mockClear();
        await openRunDiff(model, run);
        expect(listWorktrees).not.toHaveBeenCalled();
        expect(gitHistory).not.toHaveBeenCalled();
        expect(globalStore.get(diffScopeAtom)).toEqual(runDiffScope("r4", "C:/arc-wt/r4", "9f2c1de"));
    });
});
