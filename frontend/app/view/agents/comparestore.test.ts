// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const divergence = vi.fn();
const compareChanges = vi.fn();
const listBranches = vi.fn();
const gitFetch = vi.fn();
const commitChanges = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitDivergenceCommand: (...a: any[]) => divergence(...a),
        GitCompareChangesCommand: (...a: any[]) => compareChanges(...a),
        ListBranchesCommand: (...a: any[]) => listBranches(...a),
        GitFetchCommand: (...a: any[]) => gitFetch(...a),
        GitCommitChangesCommand: (...a: any[]) => commitChanges(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { AGGREGATE } from "./comparerows";
import {
    compareActiveChangesAtom,
    compareActiveChangesStatusAtom,
    compareErrorAtom,
    compareOnAtom,
    compareRefsAtom,
    compareSelectionAtom,
    compareSidesAtom,
    enterCompare,
    fetchStateOf,
    fetchStatesAtom,
    leaveCompare,
    retrySelectedCompareRow,
    runFetch,
    selectCompareRow,
    setCompareForm,
    swapCompareRefs,
} from "./comparestore";
import type { DiffScope } from "./diffscope";
import { diffScopeAtom } from "./diffscopeatom";

const base: DiffScope = {
    repo: { origin: { kind: "agent", id: "a1" }, label: "jarvis-recall" },
    range: { kind: "session", agentId: "a1" },
};

afterEach(() => {
    divergence.mockReset();
    compareChanges.mockReset();
    listBranches.mockReset();
    gitFetch.mockReset();
    commitChanges.mockReset();
    globalStore.set(fetchStatesAtom, {});
    globalStore.set(diffScopeAtom, null);
});

describe("comparison as a range", () => {
    it("is off until the stored range says otherwise", () => {
        globalStore.set(diffScopeAtom, base);
        expect(globalStore.get(compareOnAtom)).toBe(false);
    });

    it("turns on by writing the range, and remembers what it interrupted", async () => {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });

        await enterCompare("/repo", "feat");

        expect(globalStore.get(compareOnAtom)).toBe(true);
        const range = globalStore.get(diffScopeAtom)!.range;
        expect(range.kind).toBe("compare");
        expect(range.kind === "compare" && range.from).toEqual({ kind: "session", agentId: "a1" });
    });

    // Escape used to call exitCompare, which cleared a boolean and left the surface to work out what
    // to show. The interrupted range is carried, so leaving is a restore rather than a guess.
    it("restores the interrupted range on the way out", async () => {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });

        await enterCompare("/repo", "feat");
        leaveCompare();

        expect(globalStore.get(compareOnAtom)).toBe(false);
        expect(globalStore.get(diffScopeAtom)!.range).toEqual({ kind: "session", agentId: "a1" });
    });

    it("does nothing when there is no scope to compare within", async () => {
        await enterCompare("/repo", "feat");
        expect(divergence).not.toHaveBeenCalled();
        expect(globalStore.get(compareOnAtom)).toBe(false);
    });

    it("carries when the refs split, 0 when the read has no time", async () => {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });

        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1", mergebasets: 42 });
        await enterCompare("/repo", "feat");
        expect(globalStore.get(compareSidesAtom)).toMatchObject({ mergeBase: "m1", mergeBaseTs: 42 });

        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "" });
        await enterCompare("/repo", "feat");
        expect(globalStore.get(compareSidesAtom)).toMatchObject({ mergeBase: "", mergeBaseTs: 0 });
    });

    it("offers the pair last used when re-entering the same repository", async () => {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });

        await enterCompare("/repo", "feat");
        leaveCompare();
        globalStore.set(diffScopeAtom, base);
        await enterCompare("/repo", "other");

        expect(globalStore.get(compareRefsAtom)).toEqual({ base: "main", head: "feat" });
    });

    // The remembered pair is a convenience for the repository it was picked in. Carried into another
    // one it names branches that do not resolve there — the summary line was seen naming a branch the
    // freshly-picked repository does not have.
    it("forgets that pair when the source moves to another repository", async () => {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });

        await enterCompare("/repo-a", "feat/a");
        leaveCompare();

        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "trunk" });
        await enterCompare("/repo-b", "feat/b");

        expect(globalStore.get(compareRefsAtom)).toEqual({ base: "trunk", head: "feat/b" });
    });
});

describe("the range form", () => {
    async function entered() {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });
        await enterCompare("/repo", "feat");
    }

    it("starts merge-base anchored — the file list matches the ahead count beside it", async () => {
        await entered();
        const range = globalStore.get(diffScopeAtom)!.range;
        expect(range.kind === "compare" && range.form).toBe("mergebase");
        expect(compareChanges).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tips: false }));
    });

    // The form is a different question about the same two refs, so the aggregate has to be re-read.
    // A file list built three-dot beside a pane read two-dot is the failure this exists to prevent.
    it("re-reads the aggregate tip-to-tip and records the form in the range", async () => {
        await entered();
        await setCompareForm("/repo", "tips");

        const range = globalStore.get(diffScopeAtom)!.range;
        expect(range.kind === "compare" && range.form).toBe("tips");
        expect(compareChanges).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tips: true }));
    });

    it("does not re-read when the form is already the active one", async () => {
        await entered();
        const before = compareChanges.mock.calls.length;
        await setCompareForm("/repo", "mergebase");
        expect(compareChanges.mock.calls.length).toBe(before);
    });
});

describe("remote refs, swap and fetch", () => {
    async function entered() {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });
        await enterCompare("/repo", "feat");
    }

    // origin/* is the review base most of the time, and T2 made the backend's default branch prefer it
    it("asks for remote-tracking refs, not just local branches", async () => {
        await entered();
        expect(listBranches).toHaveBeenCalledWith(expect.anything(), { projectpath: "/repo", includeremotes: true });
    });

    it("swaps by re-reading the inverted pair, not by redrawing", async () => {
        await entered();
        await swapCompareRefs("/repo");

        expect(globalStore.get(compareRefsAtom)).toEqual({ base: "feat", head: "main" });
        expect(divergence).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ base: "feat", head: "main" })
        );
    });

    it("has nothing to swap before both refs are set", async () => {
        globalStore.set(compareRefsAtom, null); // the pair survives across compares on purpose
        await swapCompareRefs("/repo");
        expect(divergence).not.toHaveBeenCalled();
    });

    // The refs moved, so what the comparison means moved with them — re-reading is the point.
    it("re-reads the comparison after a successful fetch", async () => {
        await entered();
        const before = divergence.mock.calls.length;
        gitFetch.mockResolvedValue({ isrepo: true, fetchedat: 1_700_000_000 });

        await runFetch("/repo");

        expect(fetchStateOf(globalStore.get(fetchStatesAtom), "/repo")).toEqual({
            running: false,
            at: 1_700_000_000,
            failure: null,
        });
        expect(divergence.mock.calls.length).toBeGreaterThan(before);
    });

    // git's own words, and the comparison on screen is still valid — it is merely not freshened.
    it("keeps the failure as data, the old clock, and does not re-read", async () => {
        await entered();
        globalStore.set(fetchStatesAtom, { "/repo": { running: false, at: 1_699_000_000, failure: null } });
        const before = divergence.mock.calls.length;
        const failure = { command: "git fetch --prune origin", exitcode: 128, stderr: "no such remote" };
        gitFetch.mockResolvedValue({ isrepo: true, fetchedat: 0, failure });

        await runFetch("/repo");

        expect(fetchStateOf(globalStore.get(fetchStatesAtom), "/repo")).toEqual({
            running: false,
            at: 1_699_000_000,
            failure,
        });
        expect(divergence.mock.calls.length).toBe(before);
    });

    // A rejected RPC has no stderr to show; the button must still stop spinning.
    it("stops running and keeps the previous clock when the call itself fails", async () => {
        globalStore.set(fetchStatesAtom, { "/repo": { running: false, at: 42, failure: null } });
        gitFetch.mockRejectedValue(new Error("socket closed"));

        await runFetch("/repo");

        const st = fetchStateOf(globalStore.get(fetchStatesAtom), "/repo");
        expect(st.running).toBe(false);
        expect(st.at).toBe(42);
        expect(st.failure?.exitcode).toBe(-1);
    });

    // the banner and the clock are about one remote; picking another source must not carry them over
    it("keeps a fetch's failure and clock with the repository it ran in", async () => {
        const failure = { command: "git fetch --prune origin", exitcode: 128, stderr: "no such remote" };
        gitFetch.mockResolvedValue({ isrepo: true, fetchedat: 0, failure });

        await runFetch("/repo");

        expect(fetchStateOf(globalStore.get(fetchStatesAtom), "/repo").failure).toEqual(failure);
        expect(fetchStateOf(globalStore.get(fetchStatesAtom), "/other")).toEqual({
            running: false,
            at: 0,
            failure: null,
        });
    });
});

// The compare commit row reads its files like the history one: null changes used to mean both
// "loading" and "failed", so a compare commit read as 0 files either way.
describe("a compare commit's file list status", () => {
    async function entered() {
        globalStore.set(diffScopeAtom, base);
        listBranches.mockResolvedValue({ branches: [], default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
        compareChanges.mockResolvedValue({ isrepo: true, statusz: "M  a.ts\0", numstat: "2\t1\ta.ts\n" });
        await enterCompare("/repo", "feat");
    }
    function deferred<T>() {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((res) => {
            resolve = res;
        });
        return { promise, resolve };
    }

    it("is loading while the read is in flight, then ready with the files", async () => {
        await entered();
        const d = deferred<any>();
        commitChanges.mockReturnValueOnce(d.promise);
        const p = selectCompareRow("/repo", "c1");
        expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("loading");
        expect(globalStore.get(compareActiveChangesAtom)).toBeNull();
        d.resolve({ isrepo: true, statusz: "M  b.ts\0", numstat: "1\t0\tb.ts\n" });
        await p;
        expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("ready");
        expect(globalStore.get(compareActiveChangesAtom)?.files.map((f) => f.path)).toEqual(["b.ts"]);
    });

    it("is failed when the read throws or says this is not a repository", async () => {
        await entered();
        commitChanges.mockRejectedValueOnce(new Error("boom"));
        await selectCompareRow("/repo", "c1");
        expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("failed");
        commitChanges.mockResolvedValueOnce({ isrepo: false, statusz: "", numstat: "" });
        await selectCompareRow("/repo", "c2");
        expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("failed");
    });

    it("ignores a late answer for a row the selection has left", async () => {
        await entered();
        const slow = deferred<any>();
        commitChanges.mockReturnValueOnce(slow.promise);
        const first = selectCompareRow("/repo", "c1");
        commitChanges.mockResolvedValueOnce({ isrepo: true, statusz: "M  b.ts\0", numstat: "1\t0\tb.ts\n" });
        await selectCompareRow("/repo", "c2");
        slow.resolve({ isrepo: false, statusz: "", numstat: "" });
        await first;
        expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("ready");
    });

    it("retry re-reads the selected row and recovers", async () => {
        await entered();
        commitChanges.mockRejectedValueOnce(new Error("boom"));
        await selectCompareRow("/repo", "c1");
        commitChanges.mockResolvedValueOnce({ isrepo: true, statusz: "M  b.ts\0", numstat: "1\t0\tb.ts\n" });
        retrySelectedCompareRow();
        expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("loading");
        await vi.waitFor(() => expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("ready"));
        expect(commitChanges).toHaveBeenLastCalledWith({}, { cwd: "/repo", hash: "c1" });
    });

    it("retry does nothing on the aggregate row, which has no commit read", async () => {
        await entered();
        expect(globalStore.get(compareSelectionAtom)).toBe(AGGREGATE);
        retrySelectedCompareRow();
        expect(commitChanges).not.toHaveBeenCalled();
    });

    describe("the aggregate row", () => {
        it("is ready once the two refs' files have loaded", async () => {
            await entered();
            expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("ready");
        });
        it("is loading until they do, and failed when the compare read fails", async () => {
            globalStore.set(diffScopeAtom, base);
            listBranches.mockResolvedValue({ branches: [], default: "main" });
            const d = deferred<any>();
            divergence.mockReturnValue(d.promise);
            compareChanges.mockResolvedValue({ isrepo: true, statusz: "", numstat: "" });
            const p = enterCompare("/repo", "feat");
            await vi.waitFor(() => expect(divergence).toHaveBeenCalled());
            expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("loading");
            d.resolve({ isrepo: true, ahead: [], behind: [], mergebase: "m1" });
            await p;
            expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("ready");

            divergence.mockRejectedValue(new Error("bad ref"));
            await enterCompare("/repo", "feat");
            expect(globalStore.get(compareErrorAtom)).not.toBeNull();
            expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("failed");
        });
    });

    describe("the DEV fault hook", () => {
        beforeEach(() => {
            (globalThis as any).window = {};
        });
        afterEach(() => {
            delete (globalThis as any).window;
        });

        it("'error' fails exactly one compare commit read, then clears itself", async () => {
            await entered();
            (globalThis as any).window.__commitChangesFault = "error";
            await selectCompareRow("/repo", "c1");
            expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("failed");
            expect((globalThis as any).window.__commitChangesFault).toBeUndefined();
            expect(commitChanges).not.toHaveBeenCalled();
        });

        it("'hang' holds the compare commit read in loading", async () => {
            await entered();
            (globalThis as any).window.__commitChangesFault = "hang";
            void selectCompareRow("/repo", "c1");
            await new Promise((r) => setTimeout(r, 0));
            expect(globalStore.get(compareActiveChangesStatusAtom)).toBe("loading");
            expect(commitChanges).not.toHaveBeenCalled();
        });
    });
});
