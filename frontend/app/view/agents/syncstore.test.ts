// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { toastsAtom } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gitPull = vi.fn();
const gitPush = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitPullCommand: (...a: any[]) => gitPull(...a),
        GitPushCommand: (...a: any[]) => gitPush(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
const reloadChanges = vi.fn();
vi.mock("./filesstore", async (orig) => ({
    ...(await orig<typeof import("./filesstore")>()),
    reloadChanges: (...a: any[]) => reloadChanges(...a),
}));
const refreshHistory = vi.fn();
vi.mock("./githistorystore", () => ({ refreshHistory: () => refreshHistory() }));
const runFetch = vi.fn();
vi.mock("./comparestore", () => ({ runFetch: (...a: any[]) => runFetch(...a) }));
const loadCommitList = vi.fn();
vi.mock("./commitstore", () => ({ loadCommitList: (...a: any[]) => loadCommitList(...a) }));

import { filesStateAtom, type FilesState } from "./filesstore";
import { dismissSyncFailure, fetchNow, runPull, runPush, syncRunAtom, syncRunOf } from "./syncstore";

const CWD = "D:/repo";

function surface(over: Partial<FilesState> = {}): FilesState {
    return {
        cwd: CWD,
        branch: "main",
        isRepo: true,
        changes: null,
        ref: "",
        head: "abc",
        upstream: "origin/main",
        upstreamAhead: 0,
        upstreamBehind: 0,
        ...over,
    };
}

const toasts = () => globalStore.get(toastsAtom).map((t) => t.title);
const run = () => syncRunOf(globalStore.get(syncRunAtom), CWD);

beforeEach(() => {
    for (const m of [gitPull, gitPush, reloadChanges, refreshHistory, runFetch, loadCommitList]) {
        m.mockReset();
    }
    globalStore.set(syncRunAtom, {});
    globalStore.set(toastsAtom, []);
    globalStore.set(filesStateAtom, surface());
});

describe("runPull", () => {
    it("pulls with the long budget, toasts what moved and reads everything it touched again", async () => {
        gitPull.mockResolvedValue({ moved: 2 });
        await runPull(CWD);
        expect(gitPull).toHaveBeenCalledWith({}, { cwd: CWD }, { timeout: 60000 });
        expect(toasts()).toEqual(["Pulled 2 commits"]);
        expect(runFetch).toHaveBeenCalledWith(CWD);
        expect(reloadChanges).toHaveBeenCalledWith(CWD);
        expect(refreshHistory).toHaveBeenCalledTimes(1);
        expect(loadCommitList).toHaveBeenCalledWith(CWD);
        expect(run()).toEqual({ running: null, failure: null });
    });

    it("keeps git's refusal as the worktree's failure, with no toast and nothing re-read", async () => {
        const failure = { command: "git pull --ff-only", exitcode: 128, stderr: "fatal: Not possible to fast-forward" };
        gitPull.mockResolvedValue({ moved: 0, failure });
        await runPull(CWD);
        expect(run()).toEqual({ running: null, failure: { kind: "pull", failure } });
        expect(toasts()).toEqual([]);
        expect(runFetch).not.toHaveBeenCalled();
        expect(reloadChanges).not.toHaveBeenCalled();
    });

    it("turns a call that throws into a failure with no exit code", async () => {
        gitPull.mockRejectedValue(new Error("socket closed"));
        await runPull(CWD);
        expect(run().failure).toEqual({
            kind: "pull",
            failure: { command: "git pull --ff-only", exitcode: -1, stderr: "the pull did not complete" },
        });
        expect(run().running).toBeNull();
    });

    it("runs one action at a time per worktree", async () => {
        let finish: (v: unknown) => void = () => {};
        gitPull.mockReturnValue(new Promise((r) => (finish = r)));
        const first = runPull(CWD);
        expect(run().running).toBe("pull");
        await runPush(CWD);
        await runPull(CWD);
        expect(gitPush).not.toHaveBeenCalled();
        expect(gitPull).toHaveBeenCalledTimes(1);
        finish({ moved: 1 });
        await first;
        expect(run().running).toBeNull();
    });

    it("clears the last failure when the next action starts", async () => {
        gitPull.mockResolvedValueOnce({
            moved: 0,
            failure: { command: "git pull --ff-only", exitcode: 1, stderr: "x" },
        });
        await runPull(CWD);
        expect(run().failure).not.toBeNull();
        gitPull.mockResolvedValueOnce({ moved: 1 });
        await runPull(CWD);
        expect(run().failure).toBeNull();
    });
});

describe("runPush", () => {
    it("pushes with the long budget and toasts the commits sent to the upstream", async () => {
        gitPush.mockResolvedValue({ moved: 1, branch: "main" });
        await runPush(CWD);
        expect(gitPush).toHaveBeenCalledWith({}, { cwd: CWD }, { timeout: 125000 });
        expect(globalStore.get(toastsAtom).map((t) => [t.title, t.message])).toEqual([
            ["Pushed 1 commit", "to origin/main"],
        ]);
        expect(runFetch).toHaveBeenCalledWith(CWD);
        expect(loadCommitList).toHaveBeenCalledWith(CWD);
    });

    it("says Published when the branch had no upstream to push to", async () => {
        globalStore.set(filesStateAtom, surface({ branch: "feature", upstream: "" }));
        gitPush.mockResolvedValue({ moved: 0, branch: "feature" });
        await runPush(CWD);
        expect(toasts()).toEqual(["Published feature"]);
    });

    it("shows a rejected push as a push failure", async () => {
        const failure = { command: "git push", exitcode: 1, stderr: "! [rejected] main -> main (fetch first)" };
        gitPush.mockResolvedValue({ moved: 0, failure });
        await runPush(CWD);
        expect(run().failure).toEqual({ kind: "push", failure });
    });
});

describe("fetchNow", () => {
    it("fetches, then reads the change list so the counts follow the new refs", async () => {
        const order: string[] = [];
        runFetch.mockImplementation(async () => void order.push("fetch"));
        reloadChanges.mockImplementation(async () => void order.push("reload"));
        await fetchNow(CWD);
        expect(order).toEqual(["fetch", "reload"]);
    });
});

describe("dismissSyncFailure", () => {
    it("clears the failure and leaves the rest of the worktree's state", async () => {
        gitPush.mockRejectedValue(new Error("down"));
        await runPush(CWD);
        expect(run().failure?.kind).toBe("push");
        dismissSyncFailure(CWD);
        expect(run()).toEqual({ running: null, failure: null });
    });
});
