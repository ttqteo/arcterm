// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { assembleFileGroups, fileEcho } from "./palette-files";

const paths = [
    "frontend/app/cockpit/command-palette.tsx",
    "frontend/app/cockpit/palette-groups.ts",
    "frontend/app/cockpit/palette-scope.ts",
    "README.md",
];

describe("assembleFileGroups", () => {
    it("leads with recent files on an empty query, then the rest of the project", () => {
        const { groups } = assembleFileGroups("", paths, ["frontend/app/cockpit/palette-groups.ts"], "#waveterm", 50);
        expect(groups.map((g) => g.label)).toEqual(["Recent files", "Files in #waveterm"]);
        expect(groups[0].items.map((f) => f.base)).toEqual(["palette-groups.ts"]);
        expect(groups[1].items.map((f) => f.path)).not.toContain("frontend/app/cockpit/palette-groups.ts");
    });

    it("leads with pinned files on an empty query, ahead of recent, each listed once", () => {
        const recent = ["frontend/app/cockpit/palette-groups.ts", "README.md"];
        const { groups } = assembleFileGroups("", paths, recent, "#w", 50, ["README.md", "gone.ts"]);
        expect(groups.map((g) => g.key)).toEqual(["pinned-files", "recent-files", "files"]);
        expect(groups[0].items.map((f) => f.path)).toEqual(["README.md"]);
        expect(groups[1].items.map((f) => f.path)).toEqual(["frontend/app/cockpit/palette-groups.ts"]);
        expect(groups[2].items.map((f) => f.path)).not.toContain("README.md");
    });

    it("ranks pinned files like any other once something is typed", () => {
        const { groups } = assembleFileGroups("scope", paths, [], "#w", 50, ["README.md"]);
        expect(groups.map((g) => g.key)).toEqual(["files"]);
    });

    it("drops a recent file the index no longer lists", () => {
        const { groups } = assembleFileGroups("", paths, ["gone.ts"], "#w", 50);
        expect(groups.map((g) => g.key)).toEqual(["files"]);
    });

    it("parses path:line, ranking on the path and carrying the line", () => {
        const out = assembleFileGroups("groups:90", paths, [], "#w", 50);
        expect(out.text).toBe("groups");
        expect(out.line).toBe(90);
        expect(out.groups[0].items[0]).toEqual({
            path: "frontend/app/cockpit/palette-groups.ts",
            base: "palette-groups.ts",
            dir: "frontend/app/cockpit",
        });
    });

    it("returns no group when nothing matches", () => {
        expect(assembleFileGroups("zzzz", paths, [], "#w", 50).groups).toEqual([]);
    });

    it("splits a root-level file into an empty dir", () => {
        const { groups } = assembleFileGroups("readme", paths, [], "#w", 50);
        expect(groups[0].items[0]).toEqual({ path: "README.md", base: "README.md", dir: "" });
    });
});

describe("fileEcho", () => {
    it("names the file and the line", () => {
        const f = { path: "a/b.ts", base: "b.ts", dir: "a" };
        expect(fileEcho(f, 90)).toBe("Opens a/b.ts at line 90 in Code");
        expect(fileEcho(f, undefined)).toBe("Opens a/b.ts in Code");
    });
});
