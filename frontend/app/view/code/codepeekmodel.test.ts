// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { NOT_TRACKED } from "./codeclassify";
import {
    binaryPeekMessage,
    canOpenPeek,
    initialPeekMode,
    PEEK_PREFERRED_PX,
    peekHeaderPath,
    peekModes,
    peekPlacement,
    peekRow,
    peekStat,
    toolargePeekMessage,
    type PeekChange,
    type PeekFile,
    type PeekGit,
    type PeekHead,
} from "./codepeekmodel";

function textFile(git: PeekGit, text = "x\n"): PeekFile {
    return { kind: "text", text, git };
}

function repo(head: PeekHead, change: PeekChange | null | "unknown"): PeekGit {
    return { kind: "repo", head, change };
}

const fifteenLines = Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n") + "\n";

describe("initialPeekMode", () => {
    it("opens markdown on preview and anything else on source", () => {
        expect(initialPeekMode("x.md")).toBe("preview");
        expect(initialPeekMode("x.ts")).toBe("source");
    });
});

describe("peekModes", () => {
    const head = { kind: "text" as const, text: "x\n" };
    it("disables preview for a non-markdown file", () => {
        const m = peekModes("C:\\repo\\a.ts", textFile(repo(head, null)));
        expect(m.preview).toEqual({ enabled: false, reason: "Preview is for markdown files" });
        expect(m.source.enabled).toBe(true);
        expect(m.diff.enabled).toBe(true);
    });
    it("enables all three for markdown in a repo", () => {
        const m = peekModes("C:\\repo\\a.md", textFile(repo(head, null)));
        expect([m.preview.enabled, m.source.enabled, m.diff.enabled]).toEqual([true, true, true]);
    });
    it("disables diff outside a repository", () => {
        const m = peekModes("C:\\plain\\a.md", textFile({ kind: "norepo" }));
        expect(m.diff).toEqual({ enabled: false, reason: NOT_TRACKED });
        expect(m.preview.enabled).toBe(true);
    });
    it("disables all three in every non-text state", () => {
        const states: PeekFile[] = [
            { kind: "loading" },
            { kind: "missing" },
            { kind: "binary", size: 10 },
            { kind: "toolarge", size: 10 },
            { kind: "error", message: "boom" },
        ];
        for (const f of states) {
            const m = peekModes("C:\\repo\\a.md", f);
            expect([m.preview.enabled, m.source.enabled, m.diff.enabled]).toEqual([false, false, false]);
        }
    });
});

describe("canOpenPeek", () => {
    it("is true for a file that is there, whether or not the card can show it", () => {
        expect(canOpenPeek(textFile({ kind: "norepo" }))).toBe(true);
        expect(canOpenPeek({ kind: "binary", size: 3 })).toBe(true);
        expect(canOpenPeek({ kind: "toolarge", size: 3 })).toBe(true);
    });
    it("is false while loading, for a missing file and for an error", () => {
        expect(canOpenPeek({ kind: "loading" })).toBe(false);
        expect(canOpenPeek({ kind: "missing" })).toBe(false);
        expect(canOpenPeek({ kind: "error", message: "boom" })).toBe(false);
    });
});

describe("peekStat", () => {
    const absent = { kind: "absent" as const };
    it("labels a staged new file with its numstat adds", () => {
        expect(peekStat(textFile(repo(absent, { adds: 15, dels: 0 }), fifteenLines))).toEqual({
            label: "new file",
            adds: 15,
        });
    });
    it("counts the lines of an untracked new file", () => {
        expect(peekStat(textFile(repo(absent, { adds: 0, dels: 0 }), fifteenLines))).toEqual({
            label: "new file",
            adds: 15,
        });
        expect(peekStat(textFile(repo(absent, null), fifteenLines))).toEqual({ label: "new file", adds: 15 });
    });
    it("counts a last line with no trailing newline", () => {
        expect(peekStat(textFile(repo(absent, null), "a\nb"))).toEqual({ label: "new file", adds: 2 });
    });
    it("reports a change's adds and dels", () => {
        expect(peekStat(textFile(repo({ kind: "text", text: "" }, { adds: 14, dels: 2 })))).toEqual({
            label: "",
            adds: 14,
            dels: 2,
        });
    });
    it("reads a change git counts no lines of as uncounted, not as no changes", () => {
        for (const note of ["bin", "repo", "dirty"] as const) {
            const change = { adds: 0, dels: 0, note };
            expect(peekStat(textFile(repo({ kind: "text", text: "" }, change)))).toEqual({
                label: "line counts unknown",
            });
        }
    });
    it("reads a failed changes read as unknown, not as no changes", () => {
        expect(peekStat(textFile(repo({ kind: "text", text: "x\n" }, "unknown")))).toEqual({
            label: "changes unknown",
        });
        // a file new since HEAD still counts its own lines
        expect(peekStat(textFile(repo(absent, "unknown"), "a\nb\n"))).toEqual({ label: "new file", adds: 2 });
    });
    it("reads no changes for a tracked file with no entry", () => {
        expect(peekStat(textFile(repo({ kind: "text", text: "x\n" }, null)))).toEqual({ label: "no changes" });
    });
    it("gives no stat outside a repository or for a non-text state", () => {
        expect(peekStat(textFile({ kind: "norepo" }))).toBeNull();
        expect(peekStat({ kind: "loading" })).toBeNull();
    });
});

describe("peekRow", () => {
    it("gives the viewport row while the line is on screen", () => {
        expect(peekRow(50, 40, 30)).toBe(10);
        expect(peekRow(40, 40, 30)).toBe(0);
        expect(peekRow(69, 40, 30)).toBe(29);
    });
    it("gives null off screen", () => {
        expect(peekRow(39, 40, 30)).toBeNull();
        expect(peekRow(70, 40, 30)).toBeNull();
    });
});

describe("peekPlacement", () => {
    it("opens below at the preferred height when the room under the line fits it", () => {
        expect(peekPlacement({ lineTop: 0, lineHeight: 18, viewportHeight: 900 })).toEqual({
            side: "below",
            height: PEEK_PREFERRED_PX,
        });
    });
    it("opens above near the bottom, clamped to the room above", () => {
        const lineTop = 900 - 40;
        expect(peekPlacement({ lineTop, lineHeight: 18, viewportHeight: 900 })).toEqual({
            side: "above",
            height: Math.min(PEEK_PREFERRED_PX, lineTop),
        });
        expect(peekPlacement({ lineTop: 300, lineHeight: 18, viewportHeight: 340 })).toEqual({
            side: "above",
            height: 300,
        });
    });
    it("takes the larger side in a short viewport, clamped to its room", () => {
        // room below 300 - 160 - 18 = 122, room above 160
        expect(peekPlacement({ lineTop: 160, lineHeight: 18, viewportHeight: 300 })).toEqual({
            side: "above",
            height: 160,
        });
        // room below 300 - 100 - 18 = 182, room above 100
        expect(peekPlacement({ lineTop: 100, lineHeight: 18, viewportHeight: 300 })).toEqual({
            side: "below",
            height: 182,
        });
    });
});

describe("binaryPeekMessage", () => {
    it("names an image and a plain binary", () => {
        expect(binaryPeekMessage("assets/logo.PNG")).toBe("Image — open it in Code");
        expect(binaryPeekMessage("bin/blob.bin")).toBe("Binary file");
    });
});

describe("toolargePeekMessage", () => {
    it("names the limit that file would have met: 2 MB of text, 32 MB of image", () => {
        expect(toolargePeekMessage("logs/big.log")).toBe("Larger than the 2 MB view limit");
        expect(toolargePeekMessage("assets/huge.PNG")).toBe("Larger than the 32 MB image limit");
    });
});

describe("peekHeaderPath", () => {
    it("is relative to the terminal's folder for a file under it, with forward slashes", () => {
        expect(peekHeaderPath("C:/repo/docs/a.md", "C:\\repo")).toBe("docs/a.md");
        expect(peekHeaderPath("/home/me/repo/src/a.ts", "/home/me/repo")).toBe("src/a.ts");
    });
    it("is the full path for a file elsewhere, or with no folder to be relative to", () => {
        expect(peekHeaderPath("D:/other/a.md", "C:\\repo")).toBe("D:/other/a.md");
        expect(peekHeaderPath("C:/repo/a.md", null)).toBe("C:/repo/a.md");
        expect(peekHeaderPath("C:/repository/a.md", "C:/repo")).toBe("C:/repository/a.md");
    });
});
