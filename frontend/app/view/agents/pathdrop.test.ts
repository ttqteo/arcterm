// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import {
    decodePathsDrag,
    draggedPathsCount,
    encodePathsDrag,
    formatDroppedPaths,
    isPathsDrag,
    pathsFromDrop,
    RAIL_PATHS_MIME,
    setDraggedPathsCount,
    splitDroppable,
} from "./pathdrop";

const agent = (cwd: string | null) => ({ agent: true, cwd });
const plain = (cwd: string | null) => ({ agent: false, cwd });

describe("isPathsDrag", () => {
    it("is true only when the paths MIME is among the types", () => {
        expect(isPathsDrag(["text/plain", RAIL_PATHS_MIME])).toBe(true);
        expect(isPathsDrag(["Files"])).toBe(false);
        expect(isPathsDrag([])).toBe(false);
    });
});

describe("encodePathsDrag / decodePathsDrag", () => {
    it("carries the paths as JSON under the custom MIME and one per line as text", () => {
        const paths = ["D:\\proj\\src\\a.ts", "D:\\proj\\docs\\"];
        const [custom, text] = encodePathsDrag(paths);
        expect(custom.mime).toBe(RAIL_PATHS_MIME);
        expect(JSON.parse(custom.data)).toEqual(paths);
        expect(text).toEqual({ mime: "text/plain", data: "D:\\proj\\src\\a.ts\nD:\\proj\\docs\\" });
    });

    it("round-trips through decode", () => {
        const paths = ["/home/u/proj/a b.ts", "/home/u/proj/src/"];
        expect(decodePathsDrag(encodePathsDrag(paths)[0].data)).toEqual(paths);
    });

    it("rejects anything that is not a JSON array of non-empty strings", () => {
        expect(decodePathsDrag("[1]")).toBeNull();
        expect(decodePathsDrag("{}")).toBeNull();
        expect(decodePathsDrag("not json")).toBeNull();
        expect(decodePathsDrag('[""]')).toBeNull();
        expect(decodePathsDrag('["a.ts", 2]')).toBeNull();
        expect(decodePathsDrag('"a.ts"')).toBeNull();
        expect(decodePathsDrag("")).toBeNull();
    });

    it("accepts a valid array", () => {
        expect(decodePathsDrag('["D:\\\\proj\\\\a.ts","/x/y/"]')).toEqual(["D:\\proj\\a.ts", "/x/y/"]);
    });
});

describe("formatDroppedPaths", () => {
    it("mentions a path under an agent's cwd as @relative", () => {
        expect(formatDroppedPaths(["/home/u/proj/src/a.ts"], agent("/home/u/proj"))).toBe("@src/a.ts ");
    });

    it("types the bare relative path on a plain terminal", () => {
        expect(formatDroppedPaths(["/home/u/proj/src/a.ts"], plain("/home/u/proj"))).toBe("src/a.ts ");
    });

    it("keeps a path outside the cwd absolute", () => {
        expect(formatDroppedPaths(["/home/u/other/x.ts"], agent("/home/u/proj"))).toBe("@/home/u/other/x.ts ");
        expect(formatDroppedPaths(["/home/u/other/x.ts"], plain("/home/u/proj"))).toBe("/home/u/other/x.ts ");
    });

    it("does not take a sibling that shares the cwd's prefix for a child", () => {
        expect(formatDroppedPaths(["/home/u/proj2/a.ts"], agent("/home/u/proj"))).toBe("@/home/u/proj2/a.ts ");
    });

    it("keeps every path absolute when the cwd is unknown", () => {
        expect(formatDroppedPaths(["/home/u/proj/a.ts"], agent(null))).toBe("@/home/u/proj/a.ts ");
        expect(formatDroppedPaths(["/home/u/proj/a.ts"], plain(null))).toBe("/home/u/proj/a.ts ");
    });

    it("turns Windows backslashes into forward slashes, relative and absolute", () => {
        expect(formatDroppedPaths(["D:\\proj\\src\\a.ts"], agent("D:\\proj"))).toBe("@src/a.ts ");
        expect(formatDroppedPaths(["D:\\other\\src\\a.ts"], agent("D:\\proj"))).toBe("@D:/other/src/a.ts ");
        expect(formatDroppedPaths(["D:\\other\\src\\a.ts"], plain(null))).toBe("D:/other/src/a.ts ");
    });

    it("compares the drive letter without case and treats \\ and / alike", () => {
        expect(formatDroppedPaths(["d:\\proj\\src\\a.ts"], agent("D:\\proj"))).toBe("@src/a.ts ");
        expect(formatDroppedPaths(["D:\\proj\\src\\a.ts"], agent("d:/proj"))).toBe("@src/a.ts ");
        expect(formatDroppedPaths(["D:/proj/src/a.ts"], plain("d:\\proj\\"))).toBe("src/a.ts ");
    });

    it("keeps the original case of the segments after the root", () => {
        expect(formatDroppedPaths(["d:\\PROJ\\Src\\README.md"], agent("D:\\proj"))).toBe("@Src/README.md ");
    });

    it("ends a directory with /", () => {
        expect(formatDroppedPaths(["/home/u/proj/src/app/"], agent("/home/u/proj"))).toBe("@src/app/ ");
        expect(formatDroppedPaths(["D:\\proj\\src\\app\\"], agent("D:\\proj"))).toBe("@src/app/ ");
        expect(formatDroppedPaths(["D:\\other\\app\\"], plain("D:\\proj"))).toBe("D:/other/app/ ");
    });

    it("quotes a path with whitespace, after the @ on an agent", () => {
        expect(formatDroppedPaths(["/home/u/proj/docs/my notes.md"], agent("/home/u/proj"))).toBe(
            '@"docs/my notes.md" '
        );
        expect(formatDroppedPaths(["/home/u/proj/docs/my notes.md"], plain("/home/u/proj"))).toBe(
            '"docs/my notes.md" '
        );
        expect(formatDroppedPaths(["D:\\other dir\\x.ts"], agent("D:\\proj"))).toBe('@"D:/other dir/x.ts" ');
    });

    it("quotes a directory with whitespace around its trailing /", () => {
        expect(formatDroppedPaths(["/home/u/proj/my docs/"], agent("/home/u/proj"))).toBe('@"my docs/" ');
    });

    it("joins several paths by single spaces and ends with one space", () => {
        const text = formatDroppedPaths(
            ["/home/u/proj/src/a.ts", "/home/u/proj/docs/", "/home/u/proj/my notes.md"],
            agent("/home/u/proj")
        );
        expect(text).toBe('@src/a.ts @docs/ @"my notes.md" ');
        expect(formatDroppedPaths(["/home/u/proj/a.ts", "/home/u/proj/b.ts"], plain("/home/u/proj"))).toBe(
            "a.ts b.ts "
        );
    });

    it("types nothing for no paths", () => {
        expect(formatDroppedPaths([], agent("/home/u/proj"))).toBe("");
    });
});

describe("splitDroppable", () => {
    it("keeps ordinary paths, spaces and $ included", () => {
        const paths = ["/home/u/proj/a.ts", "/home/u/proj/my notes.md", "/home/u/proj/$x/"];
        expect(splitDroppable(paths)).toEqual({ ok: paths, refused: [] });
    });

    // a newline typed into a shell without bracketed paste is an Enter: the line would run before the person sees it
    it("refuses a path holding a control character", () => {
        expect(splitDroppable(["/home/u/proj/a.ts", "/home/u/proj/x\nrm -rf ~", "/tmp/b\r.md"])).toEqual({
            ok: ["/home/u/proj/a.ts"],
            refused: ["/home/u/proj/x\nrm -rf ~", "/tmp/b\r.md"],
        });
    });

    // inside @"..." or "..." a double quote ends the quoting early, so the terminal is given another path
    it("refuses a path holding a double quote", () => {
        expect(splitDroppable(['/home/u/proj/say "hi".md', "/home/u/proj/a.ts"])).toEqual({
            ok: ["/home/u/proj/a.ts"],
            refused: ['/home/u/proj/say "hi".md'],
        });
    });
});

describe("dragged paths count", () => {
    afterEach(() => setDraggedPathsCount(0));

    it("is 0 with no drag, holds what the tree set, and resets", () => {
        expect(draggedPathsCount()).toBe(0);
        setDraggedPathsCount(3);
        expect(draggedPathsCount()).toBe(3);
        setDraggedPathsCount(0);
        expect(draggedPathsCount()).toBe(0);
    });
});

describe("pathsFromDrop", () => {
    const drop = (data: Record<string, string>) => (type: string) => data[type] ?? "";
    it("takes the tree's own paths first", () => {
        const get = drop({ [RAIL_PATHS_MIME]: JSON.stringify(["D:/a/b.ts", "D:/a/c.ts"]), "text/plain": "ignored" });
        expect(pathsFromDrop([RAIL_PATHS_MIME, "text/plain"], get)).toEqual(["D:/a/b.ts", "D:/a/c.ts"]);
    });
    it("reads file URIs from a uri-list, skipping comments and other schemes", () => {
        const list = [
            "# a comment",
            "file:///D:/work/notes/a%20b.pdf",
            "https://example.com/x",
            "file:///home/me/n.md",
        ];
        const get = drop({ "text/uri-list": list.join("\r\n") });
        expect(pathsFromDrop(["text/uri-list"], get)).toEqual(["D:/work/notes/a b.pdf", "/home/me/n.md"]);
    });
    it("takes plain text when every line is an absolute path, quotes stripped", () => {
        const lines = [String.raw`"D:\work\notes\paper.pdf"`, String.raw`\\server\share\x.txt`, "/home/me/n.md", ""];
        expect(pathsFromDrop(["text/plain"], drop({ "text/plain": lines.join("\n") }))).toEqual([
            String.raw`D:\work\notes\paper.pdf`,
            String.raw`\\server\share\x.txt`,
            "/home/me/n.md",
        ]);
    });
    it("leaves text that is not only paths to the text box", () => {
        const plain = (text: string) => pathsFromDrop(["text/plain"], drop({ "text/plain": text }));
        expect(plain(String.raw`see D:\a.pdf`)).toBeNull();
        expect(plain(String.raw`D:\a.pdf` + "\nand more")).toBeNull();
        expect(plain("relative/path.ts")).toBeNull();
        expect(plain("  ")).toBeNull();
    });
    it("is null for a drag of real files, which the box copies instead", () => {
        expect(pathsFromDrop(["Files", "text/plain"], drop({ "text/plain": String.raw`D:\a.pdf` }))).toBeNull();
    });
});
