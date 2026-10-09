// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { toastsAtom } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gitChanges = vi.fn();
const gitCommit = vi.fn();
const gitCommitMessage = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitChangesCommand: (...a: any[]) => gitChanges(...a),
        GitCommitCommand: (...a: any[]) => gitCommit(...a),
        GitCommitMessageCommand: (...a: any[]) => gitCommitMessage(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
const reloadChanges = vi.fn();
vi.mock("./filesstore", () => ({ FILES_POLL_MS: 10_000, reloadChanges: (...a: any[]) => reloadChanges(...a) }));
const refreshHistory = vi.fn();
const selectCommit = vi.fn();
vi.mock("./githistorystore", () => ({
    refreshHistory: () => refreshHistory(),
    selectCommit: (...a: any[]) => selectCommit(...a),
}));

import { NO_TICKS } from "./commitselection";
import {
    commitAmendAtom,
    commitDraftAtom,
    commitListAtom,
    commitNow,
    commitRows,
    commitRunAtom,
    commitSelectedAtom,
    commitShownPaths,
    commitTicksAtom,
    loadCommitList,
    setAmend,
    setDraft,
    splitChanges,
    toggleTick,
    workingAgents,
} from "./commitstore";
import { panelTabAtom } from "./difflayout";
import { parseGitChanges, type GitChange } from "./gitstatus";

const CWD = "D:/repo";
// a.txt modified, b.txt staged, an untracked new.txt and a nested repository
const STATUSZ = " M a.txt\0M  b.txt\0?? new.txt\0?? vendor/tool/\0";
const NUMSTAT = "1\t0\ta.txt\n2\t1\tb.txt\n3\t0\tnew.txt\n";
const FILES: GitChange[] = parseGitChanges(STATUSZ, NUMSTAT).files;

function read(over: Record<string, unknown> = {}) {
    return { branch: "main", statusz: STATUSZ, numstat: NUMSTAT, isrepo: true, head: "abc1234ffff", ...over };
}

beforeEach(() => {
    gitChanges.mockReset();
    gitCommit.mockReset();
    gitCommitMessage.mockReset();
    reloadChanges.mockReset();
    refreshHistory.mockReset();
    selectCommit.mockReset();
    for (const a of [
        commitListAtom,
        commitTicksAtom,
        commitDraftAtom,
        commitAmendAtom,
        commitSelectedAtom,
        commitRunAtom,
    ]) {
        globalStore.set(a as any, {});
    }
    globalStore.set(toastsAtom, []);
    globalStore.set(panelTabAtom, "commit");
});

describe("splitChanges and commitRows", () => {
    it("puts untracked files in Unversioned and everything git tracks in Changes", () => {
        const g = splitChanges(FILES);
        expect(g.tracked.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
        expect(g.unversioned.map((f) => f.path)).toEqual(["new.txt", "vendor/tool/"]);
    });

    it("draws a nested repository as a top-level row under its whole path, after the tree", () => {
        const rows = commitRows(splitChanges(FILES).unversioned, true, new Set());
        expect(rows.map((r) => [r.kind, r.id, r.label, r.depth])).toEqual([
            ["file", "new.txt", "new.txt", 0],
            ["file", "vendor/tool/", "vendor/tool/", 0],
        ]);
    });

    it("gives a directory the files below it, and a flat row its muted parent", () => {
        const files: GitChange[] = [
            { path: "src/a.ts", status: "M", adds: 1, dels: 0 },
            { path: "src/deep/b.ts", status: "M", adds: 1, dels: 0 },
            { path: "top.ts", status: "M", adds: 1, dels: 0 },
        ];
        const tree = commitRows(files, true, new Set());
        const dir = tree.find((r) => r.kind === "dir" && r.id === "src")!;
        expect(dir.under?.map((f) => f.path)).toEqual(["src/a.ts", "src/deep/b.ts"]);
        const flat = commitRows(files, false, new Set());
        expect(flat.map((r) => [r.dir, r.label])).toEqual([
            ["src/", "a.ts"],
            ["src/deep/", "b.ts"],
            ["", "top.ts"],
        ]);
    });

    it("steps through the open groups in draw order, skipping what a folded directory or group hides", () => {
        const files: GitChange[] = [
            { path: "src/a.ts", status: "M", adds: 1, dels: 0 },
            { path: "top.ts", status: "M", adds: 1, dels: 0 },
            { path: "new.txt", status: "?", adds: 1, dels: 0 },
        ];
        expect(commitShownPaths(files, true, new Set(), false)).toEqual(["src/a.ts", "top.ts"]);
        expect(commitShownPaths(files, true, new Set(), true)).toEqual(["src/a.ts", "top.ts", "new.txt"]);
        expect(commitShownPaths(files, true, new Set(["src"]), false)).toEqual(["top.ts"]);
    });
});

describe("loadCommitList", () => {
    it("stores the live list and opens the first Changes file when nothing is selected", async () => {
        gitChanges.mockResolvedValue(read({ upstream: "origin/main", upstreamahead: 2 }));
        await loadCommitList(CWD);
        expect(gitChanges).toHaveBeenCalledWith({}, { cwd: CWD }); // no ref: the working tree against HEAD
        const entry = globalStore.get(commitListAtom)[CWD]!;
        expect(entry.changes.files.map((f) => f.path)).toEqual(["a.txt", "b.txt", "new.txt", "vendor/tool/"]);
        expect([entry.head, entry.upstream, entry.upstreamAhead]).toEqual(["abc1234ffff", "origin/main", 2]);
        expect(globalStore.get(commitSelectedAtom)[CWD]).toBe("a.txt");
    });

    it("keeps a selection that is still listed, and hands a file that left the list to the top row", async () => {
        gitChanges.mockResolvedValue(read());
        globalStore.set(commitSelectedAtom, { [CWD]: "b.txt" });
        await loadCommitList(CWD);
        expect(globalStore.get(commitSelectedAtom)[CWD]).toBe("b.txt");
        gitChanges.mockResolvedValue(read({ statusz: " M a.txt\0", numstat: "1\t0\ta.txt\n" }));
        await loadCommitList(CWD);
        expect(globalStore.get(commitSelectedAtom)[CWD]).toBe("a.txt");
    });

    it("prunes ticks for files that left the list, and stores a new entry on every read", async () => {
        gitChanges.mockResolvedValue(read());
        await loadCommitList(CWD);
        const b = FILES.find((f) => f.path === "b.txt")!;
        const n = FILES.find((f) => f.path === "new.txt")!;
        toggleTick(CWD, b, false);
        toggleTick(CWD, n, true);
        const first = globalStore.get(commitListAtom)[CWD];
        gitChanges.mockResolvedValue(
            read({ statusz: " M a.txt\0?? new.txt\0", numstat: "1\t0\ta.txt\n3\t0\tnew.txt\n" })
        );
        await loadCommitList(CWD);
        expect(globalStore.get(commitTicksAtom)[CWD]).toEqual({ off: [], on: ["new.txt"] });
        expect(globalStore.get(commitListAtom)[CWD]).not.toBe(first);
    });

    it("leaves what is on screen alone when a read fails", async () => {
        gitChanges.mockResolvedValueOnce(read());
        await loadCommitList(CWD);
        const before = globalStore.get(commitListAtom)[CWD];
        gitChanges.mockRejectedValueOnce(new Error("rpc"));
        await loadCommitList(CWD);
        expect(globalStore.get(commitListAtom)[CWD]).toBe(before);
    });
});

describe("setAmend", () => {
    it("loads HEAD's message into the draft, and clears it again only while it is still HEAD's", async () => {
        gitCommitMessage.mockResolvedValue({ message: "fix the thing\n\nwith a body\n" });
        await setAmend(CWD, true);
        expect(gitCommitMessage).toHaveBeenCalledWith({}, { cwd: CWD, ref: "" });
        expect(globalStore.get(commitAmendAtom)[CWD]).toBe(true);
        expect(globalStore.get(commitDraftAtom)[CWD]).toBe("fix the thing\n\nwith a body");
        await setAmend(CWD, false);
        expect(globalStore.get(commitAmendAtom)[CWD]).toBe(false);
        expect(globalStore.get(commitDraftAtom)[CWD]).toBe("");

        await setAmend(CWD, true);
        setDraft(CWD, "my own words");
        await setAmend(CWD, false);
        expect(globalStore.get(commitDraftAtom)[CWD]).toBe("my own words");
    });

    it("unticks itself and says so when HEAD's message cannot be read", async () => {
        gitCommitMessage.mockRejectedValue(new Error("rpc"));
        await setAmend(CWD, true);
        expect(globalStore.get(commitAmendAtom)[CWD]).toBe(false);
        expect(globalStore.get(commitRunAtom)[CWD]?.failure?.stderr).toContain("HEAD's message");
    });
});

describe("commitNow", () => {
    async function ready() {
        gitChanges.mockResolvedValue(read());
        await loadCommitList(CWD);
        setDraft(CWD, "ship it");
    }

    it("commits the default ticks, clears the box, and the toast opens the new commit in the Log tab", async () => {
        await ready();
        gitCommit.mockResolvedValue({ hash: "abc1234" });
        await commitNow(CWD);
        expect(gitCommit).toHaveBeenCalledWith(
            {},
            { cwd: CWD, message: "ship it", paths: ["a.txt", "b.txt"] },
            { timeout: 65000 }
        );
        expect(globalStore.get(commitDraftAtom)[CWD]).toBe("");
        expect(globalStore.get(commitTicksAtom)[CWD]).toEqual(NO_TICKS);
        expect(reloadChanges).toHaveBeenCalledWith(CWD);
        expect(refreshHistory).toHaveBeenCalled();
        const toast = globalStore.get(toastsAtom)[0];
        expect([toast.title, toast.message]).toEqual(["Committed abc1234", "2 files"]);
        toast.onOpen!();
        expect(globalStore.get(panelTabAtom)).toBe("log");
        expect(selectCommit).toHaveBeenCalledWith(CWD, "abc1234ffff"); // the full sha the history rows are keyed by
    });

    it("sends the ticked untracked file too, and a rename's old path with it", async () => {
        gitChanges.mockResolvedValue(read({ statusz: "R  new.ts\0old.ts\0?? n.txt\0", numstat: "1\t0\tnew.ts\n" }));
        await loadCommitList(CWD);
        toggleTick(CWD, globalStore.get(commitListAtom)[CWD]!.changes.files.find((f) => f.path === "n.txt")!, true);
        setDraft(CWD, "rename");
        gitCommit.mockResolvedValue({ hash: "abc1234" });
        await commitNow(CWD);
        expect(gitCommit.mock.calls[0][1].paths).toEqual(["new.ts", "old.ts", "n.txt"]);
    });

    it("keeps the message and the ticks when git refuses, and shows git's words", async () => {
        await ready();
        toggleTick(CWD, FILES.find((f) => f.path === "b.txt")!, false);
        const failure = { command: "git commit --only -F - -- 1 paths", exitcode: 1, stderr: "hook says no" };
        gitCommit.mockResolvedValue({ failure });
        await commitNow(CWD);
        expect(globalStore.get(commitRunAtom)[CWD]).toEqual({ running: false, failure });
        expect(globalStore.get(commitDraftAtom)[CWD]).toBe("ship it");
        expect(globalStore.get(commitTicksAtom)[CWD]).toEqual({ off: ["b.txt"], on: [] });
        expect(globalStore.get(toastsAtom)).toEqual([]);
    });

    it("says the commit did not complete when the call itself throws", async () => {
        await ready();
        gitCommit.mockRejectedValue(new Error("timeout"));
        await commitNow(CWD);
        expect(globalStore.get(commitRunAtom)[CWD]?.failure?.stderr).toBe("the commit did not complete");
        expect(globalStore.get(commitDraftAtom)[CWD]).toBe("ship it");
    });

    it("does nothing without a message or a tick", async () => {
        gitChanges.mockResolvedValue(read());
        await loadCommitList(CWD);
        await commitNow(CWD);
        expect(gitCommit).not.toHaveBeenCalled();
    });

    it("refuses to amend a commit that is already pushed", async () => {
        gitChanges.mockResolvedValue(read({ upstream: "origin/main", upstreamahead: 0 }));
        await loadCommitList(CWD);
        setDraft(CWD, "ship it");
        globalStore.set(commitAmendAtom, { [CWD]: true });
        await commitNow(CWD);
        expect(gitCommit).not.toHaveBeenCalled();
        expect(globalStore.get(commitRunAtom)[CWD]?.failure?.stderr).toContain("force push");
    });
});

describe("workingAgents", () => {
    const agents = [{ id: "1", name: "fix labels", state: "working" }];

    it("names the agents working in the worktree", () => {
        expect(workingAgents(CWD, agents, { "1": "D:\\repo\\pkg" })).toEqual(["fix labels"]);
    });

    it("lets the DEV override replace them", () => {
        vi.stubGlobal("window", { __syncWorkingAgents: ["fixture agent"] });
        try {
            expect(workingAgents(CWD, agents, { "1": "D:\\other" })).toEqual(["fixture agent"]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
