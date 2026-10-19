// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    WORKING_TREE,
    authorInitials,
    buildRows,
    classifyRef,
    defaultSelection,
    keepSelection,
    refChipClass,
    rowTitle,
    toRow,
    worktreeCaption,
    type RefKind,
} from "./historyrows";

const NOW = 1_800_000_000_000;

function commit(hash: string, over: Partial<HistoryCommit> = {}): HistoryCommit {
    return {
        hash,
        parents: [],
        author: "dana k",
        email: "dana@example.com",
        ts: NOW,
        subject: `subject ${hash}`,
        ...over,
    };
}

describe("classifyRef", () => {
    // HistoryLog emits --decorate=full, so every entry carries its refs/ namespace.
    it("reads HEAD, remotes, tags and plain branches apart, labelling by the short name", () => {
        expect(classifyRef("HEAD -> refs/heads/main")).toEqual({ label: "main", kind: "head" });
        expect(classifyRef("HEAD")).toEqual({ label: "HEAD", kind: "head" });
        expect(classifyRef("tag: refs/tags/v0.9.4")).toEqual({ label: "v0.9.4", kind: "tag" });
        expect(classifyRef("refs/tags/v0.9.4")).toEqual({ label: "v0.9.4", kind: "tag" });
        expect(classifyRef("refs/remotes/origin/main")).toEqual({ label: "origin/main", kind: "remote" });
        expect(classifyRef("refs/heads/feature/idempotent-retries")).toEqual({
            label: "feature/idempotent-retries",
            kind: "branch",
        });
    });

    // The whole reason HistoryLog asks for full decoration: under short decoration these two are the
    // same string, so a slashed local branch would be indistinguishable from a remote branch.
    it("separates a slashed local branch from a remote branch, which short decoration cannot", () => {
        const local = classifyRef("refs/heads/feature/idempotent-retries")!;
        const remote = classifyRef("refs/remotes/origin/feature/idempotent-retries")!;
        expect(local.kind).toBe("branch");
        expect(remote.kind).toBe("remote");
        expect(remote.label).toBe("origin/feature/idempotent-retries");
    });

    // Short-form tolerance: a bare name is ambiguous by construction and reads as the local branch.
    it("still classifies a bare short-form name rather than dropping it", () => {
        expect(classifyRef("main")).toEqual({ label: "main", kind: "branch" });
        expect(classifyRef("tag: v0.9.4")).toEqual({ label: "v0.9.4", kind: "tag" });
    });

    it("drops empty decorations", () => {
        expect(classifyRef("")).toBeNull();
        expect(classifyRef("   ")).toBeNull();
    });
});

describe("refChipClass", () => {
    it("gives each kind a distinct class string built only from existing tokens", () => {
        const kinds: RefKind[] = ["head", "remote", "branch", "tag"];
        const classes = kinds.map(refChipClass);
        expect(new Set(classes).size).toBe(4);
        // a raw hex here would silently opt the chip out of runtime theming
        expect(classes.join(" ")).not.toMatch(/#[0-9a-f]{3}/i);
    });
});

describe("buildRows", () => {
    it("puts uncommitted work above the tip, parented to HEAD", () => {
        const rows = buildRows([commit("aaa"), commit("bbb")], {
            head: "aaa",
            dirtyFileCount: 3,
            now: NOW,
        });
        expect(rows).toHaveLength(3);
        expect(rows[0].hash).toBe(WORKING_TREE);
        expect(rows[0].workingTree).toBe(true);
        expect(rows[0].parents).toEqual(["aaa"]);
        expect(rows[0].subject).toBe("Uncommitted changes");
        expect(rows[0].fileCount).toBe(3);
        expect(rows[0].when).toBe("now");
        expect(rows[1].hash).toBe("aaa");
    });

    it("uses the singular when exactly one file is dirty", () => {
        const rows = buildRows([commit("aaa")], { head: "aaa", dirtyFileCount: 1, now: NOW });
        expect(rows[0].subject).toBe("Uncommitted changes");
        expect(rows[0].fileCount).toBe(1);
    });

    // The change set behind dirtyFileCount is only working-tree-vs-HEAD in repo scope. Agent scope
    // anchors it at the session-start commit and run scope at the run's base commit, so both include
    // already-committed work and must not claim otherwise.
    it("names the row after the scope it is counting, not always the working tree", () => {
        const agent = buildRows([commit("aaa")], {
            head: "aaa",
            dirtyFileCount: 5,
            rowLabel: "Since session start",
            now: NOW,
        });
        expect(agent[0].subject).toBe("Since session start");
        expect(agent[0].fileCount).toBe(5);
        const run = buildRows([commit("aaa")], { head: "aaa", dirtyFileCount: 1, rowLabel: "Run changes", now: NOW });
        expect(run[0].subject).toBe("Run changes");
        expect(run[0].fileCount).toBe(1);
    });

    it("omits the uncommitted row on a clean tree", () => {
        const rows = buildRows([commit("aaa")], { head: "aaa", dirtyFileCount: 0, now: NOW });
        expect(rows).toHaveLength(1);
        expect(rows[0].hash).toBe("aaa");
    });

    it("marks the anchor with a divider and dims everything older", () => {
        const rows = buildRows([commit("aaa"), commit("bbb"), commit("ccc")], {
            head: "aaa",
            dirtyFileCount: 0,
            anchor: "bbb",
            anchorLabel: "session start",
            now: NOW,
        });
        expect(rows[0].before).toBe(false);
        expect(rows[1].hash).toBe("bbb");
        expect(rows[1].divider).toBe("session start");
        expect(rows[1].before).toBe(false);
        expect(rows[2].before).toBe(true);
    });

    it("puts the divider only on the anchor row, and dims only the rows below it", () => {
        const rows = buildRows([commit("aaa"), commit("bbb"), commit("ccc")], {
            head: "aaa",
            dirtyFileCount: 0,
            anchor: "bbb",
            anchorLabel: "session start",
            now: NOW,
        });
        expect(rows.map((r) => r.divider)).toStrictEqual([undefined, "session start", undefined]);
        expect(rows.map((r) => r.before)).toEqual([false, false, true]);
    });

    it("anchors at the tip: the divider sits on the first row and everything below is dimmed", () => {
        const rows = buildRows([commit("aaa"), commit("bbb"), commit("ccc")], {
            head: "aaa",
            dirtyFileCount: 0,
            anchor: "aaa",
            anchorLabel: "run base",
            now: NOW,
        });
        expect(rows.map((r) => r.divider)).toStrictEqual(["run base", undefined, undefined]);
        expect(rows.map((r) => r.before)).toEqual([false, true, true]);
    });

    it("draws no divider and dims nothing when the scope has no anchor", () => {
        const rows = buildRows([commit("aaa"), commit("bbb"), commit("ccc")], {
            head: "aaa",
            dirtyFileCount: 0,
            anchorLabel: "session start",
            now: NOW,
        });
        expect(rows.map((r) => r.divider)).toStrictEqual([undefined, undefined, undefined]);
        expect(rows.map((r) => r.before)).toEqual([false, false, false]);
    });

    it("gives the uncommitted row no ref chips and never dims it, even above an anchor", () => {
        const rows = buildRows([commit("aaa"), commit("bbb")], {
            head: "aaa",
            dirtyFileCount: 2,
            anchor: "aaa",
            anchorLabel: "run base",
            now: NOW,
        });
        expect(rows[0].refs).toStrictEqual([]);
        expect(rows[0].before).toBe(false);
    });

    it("leaves every row undimmed when the anchor is not in the page", () => {
        const rows = buildRows([commit("aaa"), commit("bbb")], {
            head: "aaa",
            dirtyFileCount: 0,
            anchor: "zzz",
            anchorLabel: "session start",
            now: NOW,
        });
        expect(rows.every((r) => !r.before)).toBe(true);
        expect(rows.every((r) => r.divider == null)).toBe(true);
    });

    it("formats age compactly and collapses sub-minute to now", () => {
        const rows = buildRows(
            [
                commit("aaa", { ts: NOW - 30_000 }),
                commit("bbb", { ts: NOW - 7_200_000 }),
                commit("ccc", { ts: NOW - 172_800_000 }),
            ],
            { head: "aaa", dirtyFileCount: 0, now: NOW }
        );
        expect(rows.map((r) => r.when)).toEqual(["now", "2h", "2d"]);
    });

    it("carries parents and classified refs through", () => {
        const rows = buildRows(
            [commit("aaa", { parents: ["bbb", "ccc"], refs: ["HEAD -> refs/heads/main", "tag: refs/tags/v1.0"] })],
            { head: "aaa", dirtyFileCount: 0, now: NOW }
        );
        expect(rows[0].parents).toEqual(["bbb", "ccc"]);
        expect(rows[0].refs).toEqual([
            { label: "main", kind: "head" },
            { label: "v1.0", kind: "tag" },
        ]);
    });
});

describe("defaultSelection", () => {
    it("prefers the uncommitted row", () => {
        const rows = buildRows([commit("aaa")], { head: "aaa", dirtyFileCount: 2, now: NOW });
        expect(defaultSelection(rows)).toBe(WORKING_TREE);
    });

    it("falls back to the tip commit on a clean tree", () => {
        const rows = buildRows([commit("aaa"), commit("bbb")], { head: "aaa", dirtyFileCount: 0, now: NOW });
        expect(defaultSelection(rows)).toBe("aaa");
    });

    it("returns null for an empty history", () => {
        expect(defaultSelection([])).toBeNull();
    });
});

describe("keepSelection", () => {
    it("keeps a selection that is still on screen", () => {
        const rows = buildRows([commit("aaa"), commit("bbb")], { head: "aaa", dirtyFileCount: 0, now: NOW });
        expect(keepSelection(rows, "bbb")).toBe("bbb");
    });

    it("keeps the uncommitted row, whose hash is the empty string", () => {
        const rows = buildRows([commit("aaa")], { head: "aaa", dirtyFileCount: 2, now: NOW });
        expect(keepSelection(rows, WORKING_TREE)).toBe(WORKING_TREE);
    });

    it("falls back to the default when the selection was filtered away", () => {
        const rows = buildRows([commit("aaa"), commit("bbb")], { head: "aaa", dirtyFileCount: 0, now: NOW });
        expect(keepSelection(rows, "zzz")).toBe("aaa");
    });

    it("returns null for an empty result, so nothing is selected", () => {
        expect(keepSelection([], "aaa")).toBeNull();
    });
});

describe("worktreeCaption", () => {
    it("names the branch and the commit the working tree is measured from", () => {
        expect(worktreeCaption({ kind: "working" }, "main", "3eaffac1234", "")).toBe("On main, measured from 3eaffac");
    });
    it("does not call a detached HEAD a branch", () => {
        expect(worktreeCaption({ kind: "working" }, "", "3eaffac1234", "")).toBe(
            "Detached HEAD, measured from 3eaffac"
        );
        expect(worktreeCaption({ kind: "working" }, "HEAD", "3eaffac1234", "")).toBe(
            "Detached HEAD, measured from 3eaffac"
        );
    });
    it("measures a session from its start commit", () => {
        expect(worktreeCaption({ kind: "session", agentId: "a" }, "main", "3eaffac1234", "9f2c1de0000")).toBe(
            "On main, measured from session start 9f2c1de"
        );
    });
    it("measures a run from its base", () => {
        expect(worktreeCaption({ kind: "run", runId: "r", baseCommit: "b41d000aaaa" }, "wave/r", "x", "")).toBe(
            "On wave/r, measured from run base b41d000"
        );
    });
});

describe("authorInitials", () => {
    it("takes the first and last word's initial of a full name", () => {
        expect(authorInitials("dana k")).toBe("DK");
        expect(authorInitials("Trần Tú Quang")).toBe("TQ");
    });
    it("takes a lone word's first two letters", () => {
        expect(authorInitials("ttqteo")).toBe("TT");
        expect(authorInitials("x")).toBe("X");
    });
    it("reads only letters, so a bot or a dotted handle still gets a mark", () => {
        expect(authorInitials("dependabot[bot]")).toBe("DB");
        expect(authorInitials("jane.doe")).toBe("JD");
        expect(authorInitials("  ")).toBe("?");
        expect(authorInitials("123")).toBe("?");
    });
});

describe("rowTitle", () => {
    it("names the author, their email and the commit's date", () => {
        const t = rowTitle(toRow(commit("aaa"), NOW))!;
        expect(t.startsWith("dana k <dana@example.com> · ")).toBe(true);
        expect(t).toContain("2027");
    });
    it("leaves the email out when the commit has none", () => {
        expect(rowTitle(toRow(commit("aaa", { email: "" }), NOW))!.startsWith("dana k · ")).toBe(true);
    });
    it("gives the uncommitted row no title: it has no author", () => {
        const rows = buildRows([commit("aaa")], { head: "aaa", dirtyFileCount: 2, now: NOW });
        expect(rowTitle(rows[0])).toBeUndefined();
    });
});
