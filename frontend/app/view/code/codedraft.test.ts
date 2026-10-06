// frontend/app/view/code/codedraft.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { beforeEach, describe, expect, it } from "vitest";
import {
    conflictOf,
    nextDrafts,
    parseStoredDrafts,
    renameDraftKeys,
    storedDraftsJson,
    withoutDraft,
    type Draft,
    type FileBase,
} from "./codedraft";

const base: FileBase = { text: "hello", size: 5, modtime: 1000 };

describe("conflictOf", () => {
    it("is none when size and mtime both still match the pinned base", () => {
        expect(conflictOf(base, { size: 5, modtime: 1000 })).toBe("none");
    });

    it("is missing when the file was deleted under us", () => {
        expect(conflictOf(base, { notfound: true })).toBe("missing");
    });

    it("is missing when the stat itself came back empty", () => {
        expect(conflictOf(base, null)).toBe("missing");
    });

    it("is changed when the mtime moved but the length happens to match", () => {
        // the same-length rewrite: an agent swapping one word for another of equal length
        expect(conflictOf(base, { size: 5, modtime: 2000 })).toBe("changed");
    });

    it("is changed when the length moved but the mtime happens to match", () => {
        // the same-second rewrite: a fast agent writing within the mtime's resolution
        expect(conflictOf(base, { size: 9, modtime: 1000 })).toBe("changed");
    });

    it("treats absent size/mtime fields as zero rather than as a match", () => {
        expect(conflictOf(base, {})).toBe("changed");
    });
});

describe("nextDrafts", () => {
    it("stores an edit that differs from disk", () => {
        const out = nextDrafts(new Map(), "/repo/a.go", base, "hello world");
        expect(out.get("/repo/a.go")).toEqual({ text: "hello world", base });
    });

    it("drops the draft when the text is edited back to what is on disk", () => {
        const start = new Map<string, Draft>([["/repo/a.go", { text: "typo", base }]]);
        const out = nextDrafts(start, "/repo/a.go", base, "hello");
        expect(out.has("/repo/a.go")).toBe(false);
    });

    it("does not mutate the map it was given", () => {
        const start = new Map<string, Draft>();
        nextDrafts(start, "/repo/a.go", base, "changed");
        expect(start.size).toBe(0);
    });

    it("keeps drafts for other files untouched", () => {
        const start = new Map<string, Draft>([["/repo/other.go", { text: "x", base }]]);
        const out = nextDrafts(start, "/repo/a.go", base, "changed");
        expect(out.size).toBe(2);
        expect(out.get("/repo/other.go")).toEqual({ text: "x", base });
    });

    it("pins the base it was given, so a later stat is compared against the read-time state", () => {
        const out = nextDrafts(new Map(), "/repo/a.go", base, "edited");
        expect(out.get("/repo/a.go")!.base).toEqual({ text: "hello", size: 5, modtime: 1000 });
    });
});

describe("withoutDraft", () => {
    it("removes just the one key and does not mutate the original", () => {
        const start = new Map<string, Draft>([
            ["/repo/a.go", { text: "x", base }],
            ["/repo/b.go", { text: "y", base }],
        ]);
        const out = withoutDraft(start, "/repo/a.go");
        expect(out.has("/repo/a.go")).toBe(false);
        expect(out.has("/repo/b.go")).toBe(true);
        expect(start.size).toBe(2);
    });
});

describe("renameDraftKeys", () => {
    const d: Draft = { text: "x", base };
    beforeEach(() => setPlatform("win32"));

    it("moves the draft of a renamed file", () => {
        const out = renameDraftKeys(new Map([["C:\\repo\\a.go", d]]), "C:\\repo\\a.go", "C:\\repo\\b.go");
        expect([...out.keys()]).toEqual(["C:\\repo\\b.go"]);
    });

    it("moves every draft under a renamed directory", () => {
        const start = new Map([
            ["C:\\repo\\pkg\\a.go", d],
            ["C:\\repo\\pkg\\sub\\b.go", d],
        ]);
        const out = renameDraftKeys(start, "C:\\repo\\pkg", "C:\\repo\\lib");
        expect([...out.keys()]).toEqual(["C:\\repo\\lib\\a.go", "C:\\repo\\lib\\sub\\b.go"]);
    });

    it("leaves a sibling that only shares the renamed name as a prefix", () => {
        const start = new Map([
            ["C:\\repo\\pkg2\\a.go", d],
            ["C:\\repo\\pkg.go", d],
        ]);
        const out = renameDraftKeys(start, "C:\\repo\\pkg", "C:\\repo\\lib");
        expect([...out.keys()]).toEqual(["C:\\repo\\pkg2\\a.go", "C:\\repo\\pkg.go"]);
    });

    it("does not mutate the map it was given", () => {
        const start = new Map([["C:\\repo\\a.go", d]]);
        renameDraftKeys(start, "C:\\repo\\a.go", "C:\\repo\\b.go");
        expect([...start.keys()]).toEqual(["C:\\repo\\a.go"]);
    });

    it("moves the drafts under a renamed directory on macOS, and not a prefix sibling's", () => {
        setPlatform("darwin");
        const start = new Map([
            ["/repo/pkg/a.go", d],
            ["/repo/pkg2/a.go", d],
        ]);
        const out = renameDraftKeys(start, "/repo/pkg", "/repo/lib");
        expect([...out.keys()]).toEqual(["/repo/lib/a.go", "/repo/pkg2/a.go"]);
    });
});

describe("stored drafts", () => {
    const d: Draft = { text: "edited", base };

    it("round-trips drafts through their stored form", () => {
        const drafts = new Map([["C:\\repo\\a.go", d]]);
        expect(parseStoredDrafts(storedDraftsJson(drafts, 10_000))).toEqual(drafts);
    });

    it("reads no drafts from an absent or corrupt value", () => {
        expect(parseStoredDrafts(null).size).toBe(0);
        expect(parseStoredDrafts("not json").size).toBe(0);
        expect(parseStoredDrafts(JSON.stringify({ a: 1 })).size).toBe(0);
    });

    it("drops malformed entries and keeps the valid ones", () => {
        const raw = JSON.stringify([
            ["C:\\repo\\a.go", d],
            ["C:\\repo\\b.go", { text: "x" }],
            ["C:\\repo\\c.go", { text: "x", base: { text: "y", size: "5", modtime: 1 } }],
            [42, d],
        ]);
        expect([...parseStoredDrafts(raw).keys()]).toEqual(["C:\\repo\\a.go"]);
    });

    it("leaves out a draft that would overflow the budget but keeps the ones that fit", () => {
        const big: Draft = { text: "x".repeat(500), base };
        const drafts = new Map([
            ["C:\\repo\\big.go", big],
            ["C:\\repo\\a.go", d],
        ]);
        expect([...parseStoredDrafts(storedDraftsJson(drafts, 200)).keys()]).toEqual(["C:\\repo\\a.go"]);
    });
});
