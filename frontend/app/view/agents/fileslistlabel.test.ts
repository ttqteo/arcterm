// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { filesListLabel } from "./fileslistlabel";

const file = (path: string) => ({ path, status: "M", adds: 1, dels: 0 });

describe("filesListLabel", () => {
    it("says it is reading while the list loads, never 0 files", () => {
        expect(filesListLabel("loading", null)).toEqual({ text: "Reading this commit's files…", counts: false });
    });
    it("says the read failed", () => {
        expect(filesListLabel("failed", null)).toEqual({ text: "Couldn't read this commit's files", counts: false });
    });
    it("counts a loaded list", () => {
        expect(filesListLabel("ready", { files: [file("a")], adds: 1, dels: 0 })).toEqual({
            text: "1 file",
            counts: true,
        });
    });
    it("pluralises, and counts an empty ready list as 0 files", () => {
        const four = { files: ["a", "b", "c", "d"].map(file), adds: 4, dels: 0 };
        expect(filesListLabel("ready", four).text).toBe("4 files");
        expect(filesListLabel("ready", { files: [], adds: 0, dels: 0 })).toEqual({ text: "0 files", counts: true });
    });
    it("keeps old files out of the label while a new list loads", () => {
        // the store keeps the previous changes until the next read lands only by accident; the label must not trust them
        expect(filesListLabel("loading", { files: [file("a")], adds: 1, dels: 0 }).counts).toBe(false);
    });
});
