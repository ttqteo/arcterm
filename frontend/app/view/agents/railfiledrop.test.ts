// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    afterDropState,
    chunkRanges,
    copyingLabel,
    dropBytes,
    dropDirFor,
    dropFailedToast,
    dropHintLabel,
    isSafeEntryName,
    readDrop,
    type DropEntryLike,
} from "./railfiledrop";
import { EMPTY_RAIL_TREE } from "./railtree";

function file(name: string, body = "x", type = "text/plain"): File {
    return new File([body], name, { type });
}

function fileEntry(name: string, body = "x"): DropEntryLike {
    return { name, isFile: true, isDirectory: false, file: (ok) => ok(file(name, body)) };
}

// a folder whose reader answers in batches of two, as a real one answers in batches of 100
function dirEntry(name: string, children: DropEntryLike[]): DropEntryLike {
    return {
        name,
        isFile: false,
        isDirectory: true,
        createReader: () => {
            let at = 0;
            return {
                readEntries: (ok) => {
                    const batch = children.slice(at, at + 2);
                    at += batch.length;
                    ok(batch);
                },
            };
        },
    };
}

describe("dropDirFor", () => {
    it("lands in a folder row, a file row's parent, or the root", () => {
        expect(dropDirFor({ path: "src/app", kind: "dir" })).toBe("src/app");
        expect(dropDirFor({ path: "src/app/main.ts", kind: "file" })).toBe("src/app");
        expect(dropDirFor({ path: "README.md", kind: "file" })).toBe("");
        expect(dropDirFor(null)).toBe("");
    });
});

describe("isSafeEntryName", () => {
    it("refuses separators and the dot names", () => {
        expect(isSafeEntryName("a.txt")).toBe(true);
        expect(isSafeEntryName(".env")).toBe(true);
        for (const bad of ["", ".", "..", "a/b", "a\\b"]) {
            expect(isSafeEntryName(bad)).toBe(false);
        }
    });
});

describe("chunkRanges", () => {
    it("cuts a file into chunks, and an empty file into one empty chunk", () => {
        expect(chunkRanges(0, 4)).toEqual([{ start: 0, end: 0 }]);
        expect(chunkRanges(4, 4)).toEqual([{ start: 0, end: 4 }]);
        expect(chunkRanges(10, 4)).toEqual([
            { start: 0, end: 4 },
            { start: 4, end: 8 },
            { start: 8, end: 10 },
        ]);
    });
});

describe("readDrop", () => {
    it("walks a folder to its files and its empty folders, reading every batch", async () => {
        const tree = dirEntry("site", [
            fileEntry("index.html", "<p>"),
            dirEntry("css", [fileEntry("a.css"), fileEntry("b.css"), fileEntry("c.css")]),
            dirEntry("empty", []),
            dirEntry("nested", [dirEntry("deeper", [])]),
        ]);
        const read = await readDrop([tree, fileEntry("notes.md", "hello")], []);
        expect(read.failed).toEqual([]);
        expect(read.items).toHaveLength(2);
        const [dir, single] = read.items;
        expect(dir.kind).toBe("dir");
        if (dir.kind === "dir") {
            expect(dir.name).toBe("site");
            expect(dir.files.map((f) => f.rel)).toEqual(["index.html", "css/a.css", "css/b.css", "css/c.css"]);
            expect(dir.emptyDirs).toEqual(["empty", "nested/deeper"]);
        }
        expect(single).toMatchObject({ kind: "file", name: "notes.md" });
        expect(dropBytes(read.items)).toBe(3 + 1 + 1 + 1 + 5);
    });

    it("names what it could not read and keeps the rest", async () => {
        const broken: DropEntryLike = {
            name: "locked.txt",
            isFile: true,
            isDirectory: false,
            file: (_ok, fail) => fail?.(new Error("permission denied")),
        };
        const read = await readDrop([dirEntry("d", [broken, fileEntry("ok.txt"), fileEntry("..")])], []);
        expect(read.failed).toEqual([
            { name: "d/locked.txt", reason: "permission denied" },
            { name: "d/..", reason: "its name cannot be a file name here" },
        ]);
        expect(read.items[0].kind === "dir" && read.items[0].files.map((f) => f.rel)).toEqual(["ok.txt"]);
    });

    it("falls back to the plain file list when the webview gives no entries", async () => {
        const read = await readDrop([null], [file("a.txt"), file("folder", "", "")]);
        expect(read.items).toMatchObject([{ kind: "file", name: "a.txt" }]);
        expect(read.failed.map((f) => f.name)).toEqual(["folder"]);
    });
});

describe("afterDropState", () => {
    it("opens the folder and the folders above it, and selects what was copied", () => {
        const s = { ...EMPTY_RAIL_TREE, expanded: ["src"] };
        expect(afterDropState(s, "src/app/ui", ["src/app/ui/a (1).txt", "src/app/ui/b"])).toEqual({
            expanded: ["src", "src/app", "src/app/ui"],
            selected: ["src/app/ui/a (1).txt", "src/app/ui/b"],
            anchor: "src/app/ui/a (1).txt",
            cursor: "src/app/ui/a (1).txt",
        });
    });

    it("opens nothing for the root, and changes nothing when nothing was copied", () => {
        expect(afterDropState(EMPTY_RAIL_TREE, "", ["a.txt"]).expanded).toEqual([]);
        expect(afterDropState(EMPTY_RAIL_TREE, "src", [])).toBe(EMPTY_RAIL_TREE);
    });
});

describe("labels", () => {
    it("names the folder, and the share copied", () => {
        expect(dropHintLabel("src")).toBe("Drop to copy into src/");
        expect(dropHintLabel("")).toBe("Drop to copy into the project root");
        expect(copyingLabel(1, "src", 0, 0)).toBe("Copying 1 item into src/");
        expect(copyingLabel(3, "", 45, 100)).toBe("Copying 3 items into the project root · 45%");
    });

    it("words one failure, and a few of many", () => {
        expect(dropFailedToast([])).toBeNull();
        expect(dropFailedToast([{ name: "a", reason: "r" }])).toEqual({ title: "Couldn't copy “a”", message: "r" });
        const many = ["a", "b", "c", "d", "e"].map((name) => ({ name, reason: "r" }));
        expect(dropFailedToast(many)).toEqual({
            title: "5 items weren't copied",
            message: "“a”: r; “b”: r; “c”: r; and 2 more",
        });
    });
});
