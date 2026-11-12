// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";

const fileAtRef = vi.fn();
const fileRead = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitFileAtRefCommand: (...a: any[]) => fileAtRef(...a),
        FileReadCommand: (...a: any[]) => fileRead(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { pairRefsFor } from "./diffcontent";
import {
    clearDiffPair,
    diffPairAtom,
    diffPairFailureAtom,
    loadDiffPair,
    MAX_DIFF_BYTES,
    retryDiffPair,
    worktreeSide,
} from "./diffcontentstore";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

afterEach(() => {
    fileAtRef.mockReset();
    fileRead.mockReset();
    clearDiffPair();
});

describe("loading both sides of a diff", () => {
    it("reads a commit against its first parent", async () => {
        fileAtRef.mockImplementation((_c: any, d: any) => Promise.resolve({ content: `at ${d.ref}` }));
        await loadDiffPair("/repo", "src/x.ts", { kind: "commit", hash: "deadbee" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({
            path: "src/x.ts",
            original: "at deadbee^",
            modified: "at deadbee",
        });
    });

    it("carries the refs it was read from", async () => {
        fileAtRef.mockResolvedValue({ content: "x\n" });
        fileRead.mockResolvedValue({ data64: b64("y\n") });
        const worktree = { kind: "worktree", anchorRef: "main" } as const;
        await loadDiffPair("/repo", "a.ts", worktree);
        expect(globalStore.get(diffPairAtom)?.refs).toEqual(pairRefsFor(worktree));
        const compare = { kind: "compare", base: "main", head: "feature", mergeBase: "m1", form: "mergebase" } as const;
        await loadDiffPair("/repo", "a.ts", compare);
        expect(globalStore.get(diffPairAtom)?.refs).toEqual(pairRefsFor(compare));
    });

    // The working-tree side is the file on disk, not a ref — a git read of it would show the last
    // committed content and silently hide every uncommitted edit, which is the whole point of the row.
    it("reads the working-tree side from disk, not from git", async () => {
        fileAtRef.mockResolvedValue({ content: "committed\n" });
        fileRead.mockResolvedValue({ data64: b64("edited\n") });
        await loadDiffPair("/repo", "src/x.ts", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({ original: "committed\n", modified: "edited\n" });
        expect(fileRead).toHaveBeenCalledTimes(1);
    });

    it("reads a deleted working-tree file as an empty right side rather than failing", async () => {
        fileAtRef.mockResolvedValue({ content: "was here\n" });
        fileRead.mockRejectedValue(new Error("ENOENT"));
        await loadDiffPair("/repo", "gone.ts", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({ original: "was here\n", modified: "" });
    });

    it("caps both sides and reports the larger one", async () => {
        fileAtRef.mockImplementation((_c: any, d: any) =>
            Promise.resolve(d.ref === "main" ? { content: "", toolarge: true, size: 9_000_000 } : { content: "ok\n" })
        );
        await loadDiffPair("/repo", "lock.json", {
            kind: "compare",
            base: "main",
            head: "feature",
            mergeBase: "",
            form: "tips",
        });
        expect(globalStore.get(diffPairAtom)).toMatchObject({ tooLarge: true, size: 9_000_000 });
        expect(fileAtRef).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ maxbytes: MAX_DIFF_BYTES })
        );
    });

    // Clicking a second file while the first is still in flight: the slow answer must not overwrite
    // the fast one, or the pane ends up showing a file the list no longer has selected.
    it("drops a read the selection has moved past", async () => {
        let releaseFirst: (v: any) => void = () => {};
        fileAtRef.mockImplementationOnce(() => new Promise((res) => (releaseFirst = res)));
        fileAtRef.mockImplementation(() => Promise.resolve({ content: "second\n" }));

        const slow = loadDiffPair("/repo", "first.ts", { kind: "commit", hash: "aaa" });
        await loadDiffPair("/repo", "second.ts", { kind: "commit", hash: "bbb" });
        releaseFirst({ content: "first\n" });
        await slow;

        expect(globalStore.get(diffPairAtom)?.path).toBe("second.ts");
    });

    it("clears the pane while a new pair is loading, so a stale diff is never on screen", async () => {
        fileAtRef.mockResolvedValue({ content: "x\n" });
        await loadDiffPair("/repo", "a.ts", { kind: "commit", hash: "aaa" });
        expect(globalStore.get(diffPairAtom)).not.toBeNull();
        const pending = loadDiffPair("/repo", "b.ts", { kind: "commit", hash: "bbb" });
        expect(globalStore.get(diffPairAtom)).toBeNull();
        await pending;
    });
});

describe("refreshing the pair already on screen", () => {
    // The change poll replaces the working-tree state every few seconds, and the surface re-reads the
    // open file with it. Blanking the atom first would flash the skeleton on every tick.
    it("keeps the current content on screen while re-reading the same file", async () => {
        fileAtRef.mockResolvedValue({ content: "v1\n" });
        fileRead.mockResolvedValue({ data64: b64("v1 edited\n") });
        await loadDiffPair("/repo", "a.ts", { kind: "worktree", anchorRef: "HEAD" });

        fileRead.mockResolvedValue({ data64: b64("v2 edited\n") });
        const pending = loadDiffPair("/repo", "a.ts", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)?.modified).toBe("v1 edited\n");
        await pending;
        expect(globalStore.get(diffPairAtom)?.modified).toBe("v2 edited\n");
    });
});

describe("the working-tree side's caps", () => {
    // the disk read gets the same caps as a ref read, so an untracked lockfile or binary cannot freeze the pane
    it("reads no further than one byte past the cap", async () => {
        fileAtRef.mockResolvedValue({ content: "", missing: true });
        fileRead.mockResolvedValue({ data64: b64("new\n") });
        await loadDiffPair("/repo", "src/x.ts", { kind: "worktree", anchorRef: "HEAD" });
        expect(fileRead).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ at: { offset: 0, size: MAX_DIFF_BYTES + 1 } })
        );
    });

    it("reports an untracked file past the cap as too large, by its size on disk", async () => {
        fileAtRef.mockResolvedValue({ content: "", missing: true });
        fileRead.mockResolvedValue({ info: { path: "/repo/big.log", size: 3_000_000 }, data64: b64("x") });
        await loadDiffPair("/repo", "big.log", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({
            binary: false,
            tooLarge: true,
            size: 3_000_000,
            modified: "",
        });
    });

    it("reports bytes that are not UTF-8 as binary", async () => {
        fileAtRef.mockResolvedValue({ content: "", missing: true });
        fileRead.mockResolvedValue({ data64: Buffer.from([0xff, 0xfe, 0x00, 0x81]).toString("base64") });
        await loadDiffPair("/repo", "blob.bin", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({ binary: true, tooLarge: false, modified: "" });
    });

    it("is a pure read of one answer", () => {
        expect(worktreeSide({ info: { path: "/r/a", notfound: true } })).toEqual({
            text: "",
            binary: false,
            tooLarge: false,
            missing: true,
            size: 0,
        });
        expect(worktreeSide({ data64: b64("héllo\n") })).toMatchObject({ text: "héllo\n", missing: false });
        expect(worktreeSide(null)).toMatchObject({ text: "", missing: false, binary: false, tooLarge: false });
    });
});

describe("which side a file is missing from", () => {
    it("records the side a new file is missing from", async () => {
        fileAtRef.mockResolvedValue({ content: "", missing: true });
        fileRead.mockResolvedValue({ info: { path: "/repo/empty.txt", size: 0 } });
        await loadDiffPair("/repo", "empty.txt", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({
            original: "",
            modified: "",
            originalMissing: true,
            modifiedMissing: false,
        });
    });

    it("records a working-tree file the read finds gone as missing", async () => {
        fileAtRef.mockResolvedValue({ content: "" });
        fileRead.mockResolvedValue({ info: { path: "/repo/gone.txt", notfound: true } });
        await loadDiffPair("/repo", "gone.txt", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({ originalMissing: false, modifiedMissing: true });
    });

    it("records a read refused as not found as missing, not as a failure", async () => {
        fileAtRef.mockResolvedValue({ content: "was here\n" });
        fileRead.mockRejectedValue(new Error("open gone.ts: no such file or directory"));
        await loadDiffPair("/repo", "gone.ts", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toMatchObject({ modified: "", modifiedMissing: true });
        expect(globalStore.get(diffPairFailureAtom)).toBeNull();
    });
});

describe("a read that fails", () => {
    it("says why instead of leaving the skeleton up, and keeps the pair empty", async () => {
        fileAtRef.mockResolvedValue({ content: "x\n" });
        fileRead.mockRejectedValue(new Error('cannot stream directory "src/x"'));
        await loadDiffPair("/repo", "src/x", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairAtom)).toBeNull();
        expect(globalStore.get(diffPairFailureAtom)).toBe('cannot stream directory "src/x"');
    });

    it("says why a ref read failed", async () => {
        fileAtRef.mockRejectedValue(new Error("git cat-file: exit status 128"));
        await loadDiffPair("/repo", "a.ts", { kind: "commit", hash: "aaa" });
        expect(globalStore.get(diffPairFailureAtom)).toBe("git cat-file: exit status 128");
    });

    it("re-reads the same file on retry and clears the failure once it reads", async () => {
        fileAtRef.mockResolvedValue({ content: "a\n" });
        fileRead.mockRejectedValue(new Error("Access is denied."));
        await loadDiffPair("/repo", "src/x.ts", { kind: "worktree", anchorRef: "HEAD" });
        expect(globalStore.get(diffPairFailureAtom)).toBe("Access is denied.");

        fileRead.mockReset();
        fileRead.mockResolvedValue({ data64: b64("b\n") });
        await retryDiffPair();
        expect(globalStore.get(diffPairFailureAtom)).toBeNull();
        expect(globalStore.get(diffPairAtom)).toMatchObject({ path: "src/x.ts", original: "a\n", modified: "b\n" });
        expect(fileRead).toHaveBeenCalledTimes(1);
    });

    it("keeps the failure up while the poll re-reads the same file and it still fails", async () => {
        fileAtRef.mockRejectedValue(new Error("boom"));
        await loadDiffPair("/repo", "a.ts", { kind: "commit", hash: "aaa" });
        const pending = loadDiffPair("/repo", "a.ts", { kind: "commit", hash: "aaa" });
        expect(globalStore.get(diffPairFailureAtom)).toBe("boom");
        await pending;
        expect(globalStore.get(diffPairFailureAtom)).toBe("boom");
    });

    it("forgets the failure when the selection moves to another file", async () => {
        fileAtRef.mockRejectedValue(new Error("boom"));
        await loadDiffPair("/repo", "a.ts", { kind: "commit", hash: "aaa" });
        fileAtRef.mockReset();
        const releases: ((v: any) => void)[] = [];
        fileAtRef.mockImplementation(() => new Promise((res) => releases.push(res)));
        const pending = loadDiffPair("/repo", "b.ts", { kind: "commit", hash: "aaa" });
        expect(globalStore.get(diffPairFailureAtom)).toBeNull();
        releases.forEach((r) => r({ content: "x\n" }));
        await pending;
    });

    it("is cleared with the pair", async () => {
        fileAtRef.mockRejectedValue(new Error("boom"));
        await loadDiffPair("/repo", "a.ts", { kind: "commit", hash: "aaa" });
        clearDiffPair();
        expect(globalStore.get(diffPairFailureAtom)).toBeNull();
    });

    it("does nothing on retry when nothing was loaded", async () => {
        await retryDiffPair();
        expect(fileAtRef).not.toHaveBeenCalled();
        expect(fileRead).not.toHaveBeenCalled();
    });
});
