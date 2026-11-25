// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DRAFT_MAX_AGE_MS, parseDrafts, restoreDrafts, snapshotDrafts } from "./chatdrafts";
import type { Attachment } from "./composerattachments";

const ready = (id: string, path: string, kind: "image" | "file" = "file"): Attachment => ({
    id,
    name: path.split("/").pop()!,
    kind,
    status: "ready",
    path,
});

describe("snapshotDrafts", () => {
    it("keeps text and ready files per agent, and leaves out empty, skipped and unfinished ones", () => {
        const texts = new Map([
            ["a", "hello"],
            ["launcher", "task"],
        ]);
        const atts = new Map<string, Attachment[]>([
            [
                "a",
                [ready("1", "/x/shot.png", "image"), { id: "2", name: "big.zip", kind: "file", status: "uploading" }],
            ],
            ["b", [{ id: "3", name: "bad", kind: "file", status: "error", error: "no" }]],
            ["c", [ready("4", "/y/notes.md")]],
        ]);
        const out = snapshotDrafts(texts, atts, {}, 100, new Set(["launcher"]));
        expect(out).toEqual({
            a: { text: "hello", files: [{ name: "shot.png", kind: "image", path: "/x/shot.png" }], at: 100 },
            c: { files: [{ name: "notes.md", kind: "file", path: "/y/notes.md" }], at: 100 },
        });
    });

    it("keeps an unchanged draft's time and moves a changed one's", () => {
        const prev = { a: { text: "same", at: 5 }, b: { text: "old", at: 5 } };
        const out = snapshotDrafts(
            new Map([
                ["a", "same"],
                ["b", "new"],
            ]),
            new Map(),
            prev,
            50
        );
        expect(out.a.at).toBe(5);
        expect(out.b.at).toBe(50);
    });
});

describe("parseDrafts", () => {
    it("drops stale, malformed and empty entries", () => {
        const now = DRAFT_MAX_AGE_MS + 1000;
        const raw = {
            fresh: {
                text: "hi",
                files: [
                    { name: "a", kind: "file", path: "/a" },
                    { name: "b", kind: "x", path: "/b" },
                ],
                at: now - 10,
            },
            stale: { text: "old", at: 0 },
            noat: { text: "hi" },
            empty: { text: "", files: [], at: now },
            junk: 3,
        };
        expect(parseDrafts(raw, now)).toEqual({
            fresh: { text: "hi", files: [{ name: "a", kind: "file", path: "/a" }], at: now - 10 },
        });
    });

    it("reads nothing from what is not an object", () => {
        expect(parseDrafts(null, 0)).toEqual({});
        expect(parseDrafts([1, 2], 0)).toEqual({});
        expect(parseDrafts("x", 0)).toEqual({});
    });
});

describe("restoreDrafts", () => {
    it("brings the text back and the files back as ready chips", () => {
        let n = 0;
        const { texts, atts } = restoreDrafts(
            {
                a: { text: "hi", files: [{ name: "s.png", kind: "image", path: "/s.png" }], at: 1 },
                b: { text: "yo", at: 1 },
            },
            () => `id${++n}`
        );
        expect([...texts]).toEqual([
            ["a", "hi"],
            ["b", "yo"],
        ]);
        expect(atts.get("a")).toEqual([{ id: "id1", name: "s.png", kind: "image", status: "ready", path: "/s.png" }]);
        expect(atts.has("b")).toBe(false);
    });

    it("round-trips through a snapshot", () => {
        const texts = new Map([["a", "draft"]]);
        const atts = new Map([["a", [ready("1", "/f.txt")]]]);
        const saved = snapshotDrafts(texts, atts, {}, 7);
        const back = restoreDrafts(parseDrafts(JSON.parse(JSON.stringify(saved)), 8), () => "1");
        expect(back.texts).toEqual(texts);
        expect(back.atts).toEqual(atts);
    });
});
