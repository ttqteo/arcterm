// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Selection settling for the Diff surface's history pane. The case that matters here is precedence:
// the pane deliberately remembers where you were (so a nav switch does not throw you back to row
// zero), but a deep link from a sealed run's evidence card names one specific file and has to win.

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gitHistory = vi.fn();
const gitCommitChanges = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitHistoryCommand: (...a: any[]) => gitHistory(...a),
        GitCommitChangesCommand: (...a: any[]) => gitCommitChanges(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { scopeKey } from "./diffscope";
import { filesStateAtom, requestFileLink } from "./filesstore";
import {
    activeChangesAtom,
    activeChangesStatusAtom,
    commitChangesStatusAtom,
    historyCommitsAtom,
    historyFailureAtom,
    historyFiltersAtom,
    historyHasMoreAtom,
    historyLoadStartedAtom,
    historyRowsAtom,
    historyScrollAtom,
    loadHistory,
    loadMoreHistory,
    refreshHistory,
    refreshHistoryIfMoved,
    resetHistory,
    restoreNoticeAtom,
    retryHistory,
    retrySelectedCommit,
    selectCommit,
    selectedCommitAtom,
    selectedFileAtom,
    setHistoryOpts,
    startFromTop,
} from "./githistorystore";
import { NO_FILTERS } from "./historyquery";
import { WORKING_TREE } from "./historyrows";

const CWD = "C:/repo";
const RUN = scopeKey({
    repo: { origin: { kind: "run", runId: "run-1", cwd: CWD, baseCommit: "base000" }, label: "run base000" },
    range: { kind: "run", runId: "run-1", baseCommit: "base000" },
});
// The run's own change set, as filesstore leaves it after a run-range load: everything since the run's
// base commit, which is what the "Run changes" row lists.
const RUN_CHANGES = {
    files: [
        { path: "docs/open-issues.md", status: "M", adds: 48, dels: 14 },
        { path: "pkg/jarvis/evidence.go", status: "M", adds: 25, dels: 6 },
        { path: "removed/old.ts", status: "D", adds: 0, dels: 30 },
    ],
};

const commit = (hash: string, subject: string) => ({
    hash,
    parents: [],
    subject,
    author: "t",
    email: "t@t",
    ts: 1_700_000_000,
    refs: [],
});

beforeEach(() => {
    gitHistory.mockResolvedValue({
        isrepo: true,
        head: "aaa1111",
        commits: [commit("aaa1111", "tip commit"), commit("bbb2222", "older commit")],
    });
    gitCommitChanges.mockResolvedValue({ isrepo: true, statusz: "M  x.ts\0", numstat: "1\t0\tx.ts\n" });
    globalStore.set(filesStateAtom, {
        cwd: CWD,
        branch: "main",
        isRepo: true,
        changes: RUN_CHANGES as any,
        ref: "base000",
        head: "aaa1111",
        upstream: "",
        upstreamAhead: 0,
        upstreamBehind: 0,
    });
});

afterEach(() => {
    resetHistory();
    gitHistory.mockReset();
    gitCommitChanges.mockReset();
    globalStore.set(filesStateAtom, null);
    globalStore.set(selectedCommitAtom, null);
    globalStore.set(selectedFileAtom, null);
});

const settle = () => new Promise((r) => setTimeout(r, 0));

const RUN_OPTS = { anchor: "base000", rowLabel: "Run changes" };

describe("loadHistory selection settling", () => {
    it("opens the deep-linked file on the run's own change set, not the first file", async () => {
        requestFileLink(RUN, "pkg/jarvis/evidence.go");
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        // a fixture that fails to build rows would make every assertion below vacuous
        expect(globalStore.get(historyFailureAtom)).toBeNull();
        expect(globalStore.get(selectedCommitAtom)).toBe(WORKING_TREE);
        expect(globalStore.get(selectedFileAtom)).toBe("pkg/jarvis/evidence.go");
    });

    it("opens a deleted file the same way — the deletion diff is the point", async () => {
        requestFileLink(RUN, "removed/old.ts");
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        expect(globalStore.get(selectedCommitAtom)).toBe(WORKING_TREE);
        expect(globalStore.get(selectedFileAtom)).toBe("removed/old.ts");
    });

    it("beats a remembered commit selection — a deep link names one change", async () => {
        // the pane is already parked on the tip commit, as it would be after an earlier visit
        globalStore.set(selectedCommitAtom, "aaa1111");
        globalStore.set(selectedFileAtom, "x.ts");
        requestFileLink(RUN, "pkg/jarvis/evidence.go");
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        expect(globalStore.get(selectedCommitAtom)).toBe(WORKING_TREE);
        expect(globalStore.get(selectedFileAtom)).toBe("pkg/jarvis/evidence.go");
    });

    it("beats a remembered working-tree row that is already showing a different file", async () => {
        // the case that failed live: the pane was parked on the run-changes row with its first file open
        globalStore.set(selectedCommitAtom, WORKING_TREE);
        globalStore.set(selectedFileAtom, "docs/open-issues.md");
        requestFileLink(RUN, "pkg/jarvis/evidence.go");
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        expect(globalStore.get(selectedFileAtom)).toBe("pkg/jarvis/evidence.go");
    });

    it("survives the remount load that has no change set yet", async () => {
        // the surface fires one history read per mount against the previous render's state; that read
        // must not eat the link, or the load that can honour it finds nothing pending
        requestFileLink(RUN, "pkg/jarvis/evidence.go");
        globalStore.set(filesStateAtom, null);
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        globalStore.set(filesStateAtom, {
            cwd: CWD,
            branch: "main",
            isRepo: true,
            changes: RUN_CHANGES as any,
            ref: "base000",
            head: "aaa1111",
            upstream: "",
            upstreamAhead: 0,
            upstreamBehind: 0,
        });
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        expect(globalStore.get(selectedCommitAtom)).toBe(WORKING_TREE);
        expect(globalStore.get(selectedFileAtom)).toBe("pkg/jarvis/evidence.go");
    });

    it("keeps a remembered commit selection when no deep link was followed", async () => {
        globalStore.set(selectedCommitAtom, "aaa1111");
        globalStore.set(selectedFileAtom, "x.ts");
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        expect(globalStore.get(selectedCommitAtom)).toBe("aaa1111");
    });

    it("ignores a deep-linked path the scope's change set does not contain", async () => {
        requestFileLink(RUN, "not/in/the/list.ts");
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        // falls back to the default pick (row zero = the run-changes row), never a blank pane
        expect(globalStore.get(selectedFileAtom)).toBe("docs/open-issues.md");
    });
});

// The agent details rail's changed-file rows are the same gesture as a sealed run's evidence rows, but
// they used to go through a separate request that only reached an atom no pane renders — so clicking
// the third file opened the Diff surface on the scope's *first* file. Same settling path now.
describe("agent-scoped file deep link", () => {
    const AGENT = scopeKey({
        repo: { origin: { kind: "agent", id: "agent-9" }, label: "agent-9" },
        range: { kind: "session", agentId: "agent-9" },
    });
    const AGENT_OPTS = { anchor: "base000", rowLabel: "Since session start" };

    it("opens the file clicked in the agent rail, not the scope's first file", async () => {
        requestFileLink(AGENT, "pkg/jarvis/evidence.go");
        await loadHistory(CWD, AGENT_OPTS, AGENT);
        await settle();
        expect(globalStore.get(historyFailureAtom)).toBeNull();
        expect(globalStore.get(selectedCommitAtom)).toBe(WORKING_TREE);
        expect(globalStore.get(selectedFileAtom)).toBe("pkg/jarvis/evidence.go");
    });

    it("beats a remembered row, then stops, so a later return keeps the user's own selection", async () => {
        requestFileLink(AGENT, "pkg/jarvis/evidence.go");
        await loadHistory(CWD, AGENT_OPTS, AGENT);
        await settle();
        // the user moves on to a commit, leaves the surface, and comes back
        globalStore.set(selectedCommitAtom, "aaa1111");
        globalStore.set(selectedFileAtom, "x.ts");
        await loadHistory(CWD, AGENT_OPTS, AGENT);
        await settle();
        expect(globalStore.get(selectedCommitAtom)).toBe("aaa1111");
    });

    it("a run's link is not claimable by the agent load and vice versa", async () => {
        requestFileLink(RUN, "pkg/jarvis/evidence.go");
        await loadHistory(CWD, AGENT_OPTS, AGENT);
        await settle();
        // the agent load must fall back to the default pick and leave the run's link pending
        expect(globalStore.get(selectedFileAtom)).toBe("docs/open-issues.md");
        globalStore.set(selectedCommitAtom, null);
        globalStore.set(selectedFileAtom, null);
        await loadHistory(CWD, RUN_OPTS, RUN);
        await settle();
        expect(globalStore.get(selectedFileAtom)).toBe("pkg/jarvis/evidence.go");
    });
});

describe("range changes do not re-read git", () => {
    // Decision 5 of the design. The anchor never reaches git — it labels a divider and names what the
    // synthetic top row counts — so folding it into the load identity is what made switching range
    // blank the list and throw the reader back to the top.
    it("keeps the reader's scroll offset and the loaded commits when only the anchor changes", async () => {
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "aaa1111",
            commits: [commit("aaa1111", "tip commit"), commit("bbb2222", "older commit")],
        });

        await loadHistory("/repo", { anchor: "bbb2222", anchorLabel: "session start", rowLabel: "Since session start" });
        globalStore.set(historyScrollAtom, 420);
        const before = globalStore.get(historyCommitsAtom);

        await loadHistory("/repo", {});

        expect(gitHistory).toHaveBeenCalledTimes(2);
        expect(globalStore.get(historyScrollAtom)).toBe(420);
        expect(globalStore.get(historyCommitsAtom)).toEqual(before);
    });

    it("relabels the divider with no git call at all", async () => {
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "aaa1111",
            commits: [commit("aaa1111", "tip commit"), commit("bbb2222", "older commit")],
        });

        await loadHistory("/repo", {});
        gitHistory.mockClear();

        setHistoryOpts({ anchor: "bbb2222", anchorLabel: "run base", rowLabel: "Run changes" });

        expect(gitHistory).not.toHaveBeenCalled();
        // the divider label and the synthetic top row's name are what the anchor is for; asserting the
        // row merely exists would pass without the setter, because that commit is in the list anyway
        const rows = globalStore.get(historyRowsAtom) ?? [];
        expect(rows.find((r) => r.hash === "bbb2222")?.divider).toBe("run base");
        expect(rows[0]?.subject).toBe("Run changes");
    });

    // A different repository IS a different subject: filters and scroll from the old one are
    // meaningless, and a stale path filter would produce an empty history that looks broken.
    it("still starts a different repository at the top", async () => {
        gitHistory.mockResolvedValue({ isrepo: true, head: "aaa1111", commits: [commit("aaa1111", "tip commit")] });

        await loadHistory("/repo", {});
        globalStore.set(historyScrollAtom, 420);
        await loadHistory("/other", {});

        expect(globalStore.get(historyScrollAtom)).toBe(0);
    });
});

// The Diff surface polls the change list every 10s while it is on screen, but nothing re-read the
// commit column: loadHistory fires from an effect keyed on cwd/isRepo/ref/scope, and the poll writes
// a filesStateAtom whose primitives never change. An agent committing in the watched worktree left
// the column silently stale, and no key on the surface could force it.
describe("refreshing the commit column", () => {
    const loadedHeadIs = async (head: string) => {
        gitHistory.mockResolvedValue({ isrepo: true, head, commits: [commit(head, "tip commit")] });
        await loadHistory(CWD, {});
        await settle();
        gitHistory.mockClear();
    };

    it("does nothing when HEAD has not moved — a quiet tick must cost no git call", async () => {
        await loadedHeadIs("aaa1111");
        refreshHistoryIfMoved("aaa1111");
        await settle();
        expect(gitHistory).not.toHaveBeenCalled();
    });

    it("re-reads the log when HEAD moved", async () => {
        await loadedHeadIs("aaa1111");
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "ccc3333",
            commits: [commit("ccc3333", "just landed"), commit("aaa1111", "tip commit")],
        });

        refreshHistoryIfMoved("ccc3333");
        await settle();

        expect(gitHistory).toHaveBeenCalledTimes(1);
        expect((globalStore.get(historyRowsAtom) ?? []).some((r) => r.hash === "ccc3333")).toBe(true);
    });

    it("keeps the reader's place — scroll offset and selected commit survive the refresh", async () => {
        await loadedHeadIs("aaa1111");
        globalStore.set(historyScrollAtom, 420);
        globalStore.set(selectedCommitAtom, "aaa1111");
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "ccc3333",
            commits: [commit("ccc3333", "just landed"), commit("aaa1111", "tip commit")],
        });

        refreshHistoryIfMoved("ccc3333");
        await settle();

        expect(globalStore.get(historyScrollAtom)).toBe(420);
        expect(globalStore.get(selectedCommitAtom)).toBe("aaa1111");
    });

    // The reader may have paged several times. Re-reading only the first page would delete rows from
    // under a scrolled-down list, so the refresh asks for what is loaded, not for one page.
    it("re-reads every page already loaded, not just the first", async () => {
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "aaa1111",
            commits: Array.from({ length: 50 }, (_, i) => commit(`c${i}`, `commit ${i}`)),
        });
        await loadHistory(CWD, {});
        await settle();
        await loadMoreHistory();
        await settle();
        expect(globalStore.get(historyCommitsAtom)).toHaveLength(100);
        gitHistory.mockClear();
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "ddd4444",
            commits: Array.from({ length: 100 }, (_, i) => commit(`d${i}`, `commit ${i}`)),
        });

        refreshHistoryIfMoved("ddd4444");
        await settle();

        expect(gitHistory.mock.calls[0][1].limit).toBe(100);
        expect(globalStore.get(historyCommitsAtom)).toHaveLength(100);
        // 100 returned for a 100 limit is a full page, so there may well be more behind it
        expect(globalStore.get(historyHasMoreAtom)).toBe(true);
    });

    // hasMorePages compared against the page constant, so a refresh that asked for 100 and got 73
    // would have claimed another page existed and left a footer that loads nothing forever.
    it("does not claim another page when a larger read comes back short", async () => {
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "aaa1111",
            commits: Array.from({ length: 50 }, (_, i) => commit(`c${i}`, `commit ${i}`)),
        });
        await loadHistory(CWD, {});
        await settle();
        await loadMoreHistory();
        await settle();
        gitHistory.mockResolvedValue({
            isrepo: true,
            head: "ddd4444",
            commits: Array.from({ length: 73 }, (_, i) => commit(`d${i}`, `commit ${i}`)),
        });

        refreshHistoryIfMoved("ddd4444");
        await settle();

        expect(globalStore.get(historyHasMoreAtom)).toBe(false);
    });

    it("stays quiet before anything is loaded — the surface's own load owns the first read", async () => {
        resetHistory();
        gitHistory.mockClear();
        refreshHistoryIfMoved("aaa1111");
        await settle();
        expect(gitHistory).not.toHaveBeenCalled();
    });

    // `r` is a decision, not a tick: it re-reads whether or not HEAD moved, because the reason to
    // press it is that you do not trust what is on screen.
    it("refreshHistory re-reads even when HEAD is unchanged", async () => {
        await loadedHeadIs("aaa1111");
        refreshHistory();
        await settle();
        expect(gitHistory).toHaveBeenCalledTimes(1);
    });
});

// The slow-read notice counts from when a read started with nothing on screen, so the clock has to
// stop whichever way that read settles, and restart when Retry supersedes it.
describe("the slow-read clock", () => {
    it("starts when a fresh read has nothing on screen and stops when rows arrive", async () => {
        resetHistory();
        let resolve!: (v: any) => void;
        gitHistory.mockReturnValueOnce(new Promise((r) => (resolve = r)));
        const p = loadHistory("C:/other", {});
        expect(globalStore.get(historyLoadStartedAtom)).not.toBeNull();
        resolve({ isrepo: true, head: "aaa", commits: [commit("aaa", "one")] });
        await p;
        expect(globalStore.get(historyLoadStartedAtom)).toBeNull();
    });

    it("stops on a failed read too", async () => {
        resetHistory();
        gitHistory.mockRejectedValueOnce(new Error("socket closed"));
        await loadHistory("C:/other2", {});
        expect(globalStore.get(historyLoadStartedAtom)).toBeNull();
    });

    it("restarts on retry", async () => {
        resetHistory();
        gitHistory.mockReturnValue(new Promise(() => {}));
        void loadHistory("C:/slow", {});
        const first = globalStore.get(historyLoadStartedAtom)!;
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(first + 20_000);
        retryHistory();
        expect(globalStore.get(historyLoadStartedAtom)).toBe(first + 20_000);
        vi.useRealTimers();
        gitHistory.mockReset();
    });
});

describe("startFromTop", () => {
    it("clears filters, scroll and selection, and dismisses the notice", async () => {
        // a clean tree has no uncommitted row, so the tip is what the default selection lands on
        globalStore.set(filesStateAtom, {
            cwd: CWD,
            branch: "main",
            isRepo: true,
            changes: { files: [] } as any,
            ref: "",
            head: "aaa",
            upstream: "",
            upstreamAhead: 0,
            upstreamBehind: 0,
        });
        globalStore.set(historyFiltersAtom, { author: "dana", path: "", text: "" });
        globalStore.set(historyScrollAtom, 300);
        globalStore.set(selectedCommitAtom, "bbb");
        globalStore.set(restoreNoticeAtom, "Back where you left off: commit bbb.");
        gitHistory.mockResolvedValueOnce({
            isrepo: true,
            head: "aaa",
            commits: [commit("aaa", "one"), commit("bbb", "two")],
        });
        startFromTop();
        await vi.waitFor(() => expect(globalStore.get(selectedCommitAtom)).toBe("aaa"));
        expect(globalStore.get(historyFiltersAtom)).toEqual(NO_FILTERS);
        expect(globalStore.get(historyScrollAtom)).toBe(0);
        expect(globalStore.get(restoreNoticeAtom)).toBeNull();
    });
});

// 2026-10-09: a failed or non-repo read left the commit's change list at null, which also means
// "loading", so the pane showed skeleton rows and `0 FILES +0 −0` for good. The status says which.
describe("a commit's file list status", () => {
    function deferred<T>() {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((res) => {
            resolve = res;
        });
        return { promise, resolve };
    }

    it("is loading while the read is in flight, then ready with the files", async () => {
        const d = deferred<any>();
        gitCommitChanges.mockReturnValueOnce(d.promise);
        const p = selectCommit(CWD, "ccc3333");
        expect(globalStore.get(commitChangesStatusAtom)).toBe("loading");
        expect(globalStore.get(activeChangesStatusAtom)).toBe("loading");
        expect(globalStore.get(activeChangesAtom)).toBeNull();
        d.resolve({ isrepo: true, statusz: "M  x.ts\0", numstat: "1\t0\tx.ts\n" });
        await p;
        expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
        expect(globalStore.get(activeChangesAtom)?.files.map((f) => f.path)).toEqual(["x.ts"]);
        expect(globalStore.get(selectedFileAtom)).toBe("x.ts");
    });

    it("is failed when the read throws, with no files and no selected file", async () => {
        gitCommitChanges.mockRejectedValueOnce(new Error("boom"));
        await selectCommit(CWD, "ccc3333");
        expect(globalStore.get(activeChangesStatusAtom)).toBe("failed");
        expect(globalStore.get(activeChangesAtom)).toBeNull();
        expect(globalStore.get(selectedFileAtom)).toBeNull();
    });

    it("is failed when git says this is not a repository", async () => {
        gitCommitChanges.mockResolvedValueOnce({ isrepo: false, statusz: "", numstat: "" });
        await selectCommit(CWD, "ccc3333");
        expect(globalStore.get(activeChangesStatusAtom)).toBe("failed");
    });

    it("is ready with an empty list for a commit that changes no files", async () => {
        gitCommitChanges.mockResolvedValueOnce({ isrepo: true, statusz: "", numstat: "" });
        await selectCommit(CWD, "ccc3333");
        expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
        expect(globalStore.get(activeChangesAtom)?.files).toEqual([]);
    });

    it("ignores a late answer for a commit the selection has left", async () => {
        const slow = deferred<any>();
        gitCommitChanges.mockReturnValueOnce(slow.promise);
        const first = selectCommit(CWD, "ccc3333");
        await selectCommit(CWD, "ddd4444");
        expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
        slow.resolve({ isrepo: false, statusz: "", numstat: "" });
        await first;
        expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
        expect(globalStore.get(activeChangesAtom)?.files.length).toBe(1);
    });

    it("retry re-reads the selected commit and recovers", async () => {
        gitCommitChanges.mockRejectedValueOnce(new Error("boom"));
        await selectCommit(CWD, "ccc3333");
        expect(globalStore.get(activeChangesStatusAtom)).toBe("failed");
        retrySelectedCommit();
        expect(globalStore.get(activeChangesStatusAtom)).toBe("loading");
        await vi.waitFor(() => expect(globalStore.get(activeChangesStatusAtom)).toBe("ready"));
        expect(gitCommitChanges).toHaveBeenLastCalledWith({}, { cwd: CWD, hash: "ccc3333" });
    });

    it("retry does nothing for the working tree, which has no commit read", async () => {
        globalStore.set(selectedCommitAtom, WORKING_TREE);
        retrySelectedCommit();
        expect(gitCommitChanges).not.toHaveBeenCalled();
    });

    it("the working-tree row is loading until the change list exists", () => {
        globalStore.set(selectedCommitAtom, WORKING_TREE);
        expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
        globalStore.set(filesStateAtom, null);
        expect(globalStore.get(activeChangesStatusAtom)).toBe("loading");
    });

    it("a stale failure does not follow the selection back to the working tree", async () => {
        gitCommitChanges.mockRejectedValueOnce(new Error("boom"));
        await selectCommit(CWD, "ccc3333");
        await selectCommit(CWD, WORKING_TREE);
        expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
    });

    describe("the DEV fault hook", () => {
        beforeEach(() => {
            (globalThis as any).window = {};
        });
        afterEach(() => {
            delete (globalThis as any).window;
        });

        it("'error' fails exactly one commit read, then clears itself", async () => {
            (globalThis as any).window.__commitChangesFault = "error";
            await selectCommit(CWD, "ccc3333");
            expect(globalStore.get(activeChangesStatusAtom)).toBe("failed");
            expect((globalThis as any).window.__commitChangesFault).toBeUndefined();
            expect(gitCommitChanges).not.toHaveBeenCalled();
            retrySelectedCommit();
            await vi.waitFor(() => expect(globalStore.get(activeChangesStatusAtom)).toBe("ready"));
        });

        it("'hang' holds the read in loading until the selection moves on", async () => {
            (globalThis as any).window.__commitChangesFault = "hang";
            void selectCommit(CWD, "ccc3333");
            await settle();
            expect(globalStore.get(activeChangesStatusAtom)).toBe("loading");
            expect((globalThis as any).window.__commitChangesFault).toBeUndefined();
            expect(gitCommitChanges).not.toHaveBeenCalled();
            await selectCommit(CWD, "ddd4444");
            expect(globalStore.get(activeChangesStatusAtom)).toBe("ready");
        });

        it("is not read for the working-tree row, which has no commit read", async () => {
            (globalThis as any).window.__commitChangesFault = "error";
            await selectCommit(CWD, WORKING_TREE);
            expect((globalThis as any).window.__commitChangesFault).toBe("error");
        });
    });
});
