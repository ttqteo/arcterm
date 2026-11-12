// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    FRAME_EXPANDED_MAX,
    FRAME_MAX,
    FRAME_MIN,
    PROMPT_GAP_MS,
    PROMPT_MAX,
    THEME_VARS,
    VISUAL_LANG,
    frameHeight,
    promptAction,
    themeVars,
    themeVarsChanged,
    visualPathOf,
    visualsDirOf,
} from "./chatvisual";

const WIN_DIR = "C:/Users/me/.arc/visuals";
const POSIX_DIR = "/home/me/.arc/visuals";

describe("constants", () => {
    it("names the fence language and the limits", () => {
        expect(VISUAL_LANG).toBe("arc-visual");
        expect(PROMPT_MAX).toBe(4000);
        expect(PROMPT_GAP_MS).toBe(1500);
        expect(FRAME_MIN).toBe(120);
        expect(FRAME_MAX).toBe(640);
        expect(FRAME_EXPANDED_MAX).toBe(4000);
    });
});

describe("visualsDirOf", () => {
    it("joins home and .arc/visuals with forward slashes", () => {
        expect(visualsDirOf("C:\\Users\\me")).toBe("C:/Users/me/.arc/visuals");
        expect(visualsDirOf("/home/me")).toBe("/home/me/.arc/visuals");
    });
    it("leaves no trailing slash and no doubled one", () => {
        expect(visualsDirOf("/home/me/")).toBe("/home/me/.arc/visuals");
        expect(visualsDirOf("C:\\Users\\me\\")).toBe("C:/Users/me/.arc/visuals");
    });
});

describe("visualPathOf: what draws", () => {
    it("accepts a Windows path with forward slashes", () => {
        expect(visualPathOf("C:/Users/me/.arc/visuals/a.html", WIN_DIR)).toEqual({
            path: "C:/Users/me/.arc/visuals/a.html",
        });
    });
    it("accepts a Windows path with backslashes and .htm, and returns it with forward slashes", () => {
        expect(visualPathOf("C:\\Users\\me\\.arc\\visuals\\b.htm", WIN_DIR)).toEqual({
            path: "C:/Users/me/.arc/visuals/b.htm",
        });
    });
    it("matches the drive letter in either case", () => {
        expect(visualPathOf("c:/Users/me/.arc/visuals/a.html", WIN_DIR)).toEqual({
            path: "c:/Users/me/.arc/visuals/a.html",
        });
        expect(visualPathOf("C:/Users/me/.arc/visuals/a.html", "c:/Users/me/.arc/visuals")).toEqual({
            path: "C:/Users/me/.arc/visuals/a.html",
        });
    });
    it("accepts a POSIX path", () => {
        expect(visualPathOf("/home/me/.arc/visuals/c.html", POSIX_DIR)).toEqual({
            path: "/home/me/.arc/visuals/c.html",
        });
    });
    it("takes the extension in any case", () => {
        expect(visualPathOf("/home/me/.arc/visuals/c.HTML", POSIX_DIR)).toEqual({
            path: "/home/me/.arc/visuals/c.HTML",
        });
    });
    it("trims the block's whitespace and a trailing newline", () => {
        expect(visualPathOf("  /home/me/.arc/visuals/c.html \n", POSIX_DIR)).toEqual({
            path: "/home/me/.arc/visuals/c.html",
        });
        expect(visualPathOf("\n/home/me/.arc/visuals/c.html\r\n\r\n", POSIX_DIR)).toEqual({
            path: "/home/me/.arc/visuals/c.html",
        });
    });
    it("accepts a subfolder inside the dir", () => {
        expect(visualPathOf("/home/me/.arc/visuals/quiz/index.html", POSIX_DIR)).toEqual({
            path: "/home/me/.arc/visuals/quiz/index.html",
        });
        expect(visualPathOf("C:\\Users\\me\\.arc\\visuals\\2026\\q.html", WIN_DIR)).toEqual({
            path: "C:/Users/me/.arc/visuals/2026/q.html",
        });
    });
});

describe("visualPathOf: what is shown as code", () => {
    const ONE_PATH = "a visual must be one absolute path";
    const HTML = "a visual must be an .html file";
    const IN_DIR = "a visual must sit in ~/.arc/visuals";

    it("refuses an empty block", () => {
        expect(visualPathOf("", POSIX_DIR)).toEqual({ refused: ONE_PATH });
        expect(visualPathOf("  \n \n", POSIX_DIR)).toEqual({ refused: ONE_PATH });
    });
    it("refuses a block of two lines", () => {
        expect(visualPathOf("/home/me/.arc/visuals/a.html\n/home/me/.arc/visuals/b.html", POSIX_DIR)).toEqual({
            refused: ONE_PATH,
        });
        expect(visualPathOf("/home/me/.arc/visuals/a.html\r\nnotes", POSIX_DIR)).toEqual({ refused: ONE_PATH });
    });
    it("refuses a relative path", () => {
        expect(visualPathOf("a.html", POSIX_DIR)).toEqual({ refused: ONE_PATH });
        expect(visualPathOf("visuals/a.html", POSIX_DIR)).toEqual({ refused: ONE_PATH });
        expect(visualPathOf("./a.html", POSIX_DIR)).toEqual({ refused: ONE_PATH });
        expect(visualPathOf("~/.arc/visuals/a.html", POSIX_DIR)).toEqual({ refused: ONE_PATH });
        expect(visualPathOf("C:a.html", WIN_DIR)).toEqual({ refused: ONE_PATH });
    });
    it("refuses a file that is not .html or .htm", () => {
        expect(visualPathOf("/home/me/.arc/visuals/a.svg", POSIX_DIR)).toEqual({ refused: HTML });
        expect(visualPathOf("/home/me/.arc/visuals/a.html.txt", POSIX_DIR)).toEqual({ refused: HTML });
        expect(visualPathOf("/home/me/.arc/visuals/html", POSIX_DIR)).toEqual({ refused: HTML });
        expect(visualPathOf("C:/Users/me/.arc/visuals/a.js", WIN_DIR)).toEqual({ refused: HTML });
    });
    it("refuses a path in another folder", () => {
        expect(visualPathOf("/home/me/other/a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("C:/Users/me/Desktop/a.html", WIN_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("D:/Users/me/.arc/visuals/a.html", WIN_DIR)).toEqual({ refused: IN_DIR });
    });
    it("refuses a sibling whose name only starts with the dir's", () => {
        expect(visualPathOf("/home/me/.arc/visuals-evil/a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("/home/me/.arc/visualsa.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
    });
    it("refuses a path that is the dir's parent", () => {
        expect(visualPathOf("/home/me/.arc/a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
    });
    it("refuses a .. segment, and so a subfolder path that escapes the dir", () => {
        expect(visualPathOf("/home/me/.arc/visuals/../a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("/home/me/.arc/visuals/sub/../../a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("C:\\Users\\me\\.arc\\visuals\\..\\secret\\a.html", WIN_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("/home/me/.arc/visuals/sub/../a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
    });
    it("refuses a segment Windows would read as .. (trailing dots or spaces)", () => {
        expect(visualPathOf("C:/Users/me/.arc/visuals/.../a.html", WIN_DIR)).toEqual({ refused: IN_DIR });
        expect(visualPathOf("C:/Users/me/.arc/visuals/.. /a.html", WIN_DIR)).toEqual({ refused: IN_DIR });
    });
    it("refuses a path that reaches the dir through a .. segment before it", () => {
        expect(visualPathOf("/home/me/x/../.arc/visuals/a.html", POSIX_DIR)).toEqual({ refused: IN_DIR });
    });
    it("reads the .html check before the folder check", () => {
        expect(visualPathOf("/etc/passwd", POSIX_DIR)).toEqual({ refused: HTML });
    });
});

describe("promptAction", () => {
    const base = { fromFrame: true, frameFocused: true, text: "Explain step 2", draft: "", sinceLastMs: Infinity };

    it("sends a prompt from the focused frame when the box is empty and none was sent lately", () => {
        expect(promptAction(base)).toBe("send");
    });
    it("drops what does not come from the frame", () => {
        expect(promptAction({ ...base, fromFrame: false })).toBe("drop");
    });
    it("drops what arrives while the frame is not focused", () => {
        expect(promptAction({ ...base, frameFocused: false })).toBe("drop");
    });
    it("drops a message whose text is not a string", () => {
        for (const text of [undefined, null, 42, {}, ["a"], true]) {
            expect(promptAction({ ...base, text })).toBe("drop");
        }
    });
    it("drops an empty or blank text", () => {
        expect(promptAction({ ...base, text: "" })).toBe("drop");
        expect(promptAction({ ...base, text: " \n\t " })).toBe("drop");
    });
    it("drops a text over PROMPT_MAX and takes one of exactly PROMPT_MAX", () => {
        expect(promptAction({ ...base, text: "a".repeat(PROMPT_MAX + 1) })).toBe("drop");
        expect(promptAction({ ...base, text: "a".repeat(PROMPT_MAX) })).toBe("send");
    });
    it("fills the box instead of sending while it holds a draft", () => {
        expect(promptAction({ ...base, draft: "half a thought" })).toBe("fill");
    });
    it("sends when the draft is only whitespace", () => {
        expect(promptAction({ ...base, draft: "  \n " })).toBe("send");
    });
    it("fills when the frame sent a prompt less than PROMPT_GAP_MS ago", () => {
        expect(promptAction({ ...base, sinceLastMs: 0 })).toBe("fill");
        expect(promptAction({ ...base, sinceLastMs: PROMPT_GAP_MS - 1 })).toBe("fill");
    });
    it("sends once PROMPT_GAP_MS has passed", () => {
        expect(promptAction({ ...base, sinceLastMs: PROMPT_GAP_MS })).toBe("send");
        expect(promptAction({ ...base, sinceLastMs: 60_000 })).toBe("send");
    });
    it("drops before it fills: a bad message is dropped whatever the draft or the gap", () => {
        expect(promptAction({ ...base, fromFrame: false, draft: "x", sinceLastMs: 0 })).toBe("drop");
        expect(promptAction({ ...base, frameFocused: false, draft: "x", sinceLastMs: 0 })).toBe("drop");
        expect(promptAction({ ...base, text: "", draft: "x", sinceLastMs: 0 })).toBe("drop");
    });
});

describe("frameHeight", () => {
    it("is 160 until the page reports a height", () => {
        expect(frameHeight(undefined, false)).toBe(160);
        expect(frameHeight(undefined, true)).toBe(160);
    });
    it("is 160 for a height that is not a finite number", () => {
        expect(frameHeight(Number.NaN, false)).toBe(160);
        expect(frameHeight(Number.POSITIVE_INFINITY, false)).toBe(160);
    });
    it("passes a height inside the range", () => {
        expect(frameHeight(300, false)).toBe(300);
        expect(frameHeight(FRAME_MIN, false)).toBe(FRAME_MIN);
        expect(frameHeight(FRAME_MAX, false)).toBe(FRAME_MAX);
    });
    it("raises a short page to FRAME_MIN", () => {
        expect(frameHeight(0, false)).toBe(FRAME_MIN);
        expect(frameHeight(-50, false)).toBe(FRAME_MIN);
        expect(frameHeight(FRAME_MIN - 1, true)).toBe(FRAME_MIN);
    });
    it("caps a tall page at FRAME_MAX, or FRAME_EXPANDED_MAX once expanded", () => {
        expect(frameHeight(2000, false)).toBe(FRAME_MAX);
        expect(frameHeight(2000, true)).toBe(2000);
        expect(frameHeight(9000, true)).toBe(FRAME_EXPANDED_MAX);
    });
});

describe("themeVars", () => {
    it("maps each name to the app's custom property", () => {
        expect(THEME_VARS).toEqual({
            background: "--color-background",
            surface: "--color-surface",
            "surface-raised": "--color-surface-raised",
            edge: "--color-edge-mid",
            ink: "--color-ink-hi",
            "ink-mid": "--color-ink-mid",
            muted: "--color-muted",
            accent: "--color-accent",
            success: "--color-success",
            warning: "--color-warning",
            error: "--color-error",
            "font-sans": "--font-sans",
            "font-mono": "--font-mono",
        });
    });
    it("reads every custom property by name and keys the result by the short name", () => {
        const asked: string[] = [];
        const out = themeVars((cssVar) => {
            asked.push(cssVar);
            return `v(${cssVar})`;
        });
        expect(asked).toEqual(Object.values(THEME_VARS));
        expect(out.background).toBe("v(--color-background)");
        expect(out.edge).toBe("v(--color-edge-mid)");
        expect(out.ink).toBe("v(--color-ink-hi)");
        expect(out["font-mono"]).toBe("v(--font-mono)");
        expect(Object.keys(out)).toEqual(Object.keys(THEME_VARS));
    });
    it("trims values and drops the empty ones", () => {
        const values: Record<string, string> = {
            "--color-background": "  #101010 ",
            "--color-accent": "",
            "--color-ink-hi": "   ",
            "--font-sans": "\n Inter, sans-serif\n",
        };
        expect(themeVars((cssVar) => values[cssVar] ?? "")).toEqual({
            background: "#101010",
            "font-sans": "Inter, sans-serif",
        });
    });
});

describe("themeVarsChanged", () => {
    const last = { background: "#101010", accent: "#d97757", "font-sans": "Inter, sans-serif" };

    it("is no change for the same vars, a fresh object with the same entries included", () => {
        expect(themeVarsChanged(last, last)).toBe(false);
        expect(themeVarsChanged(last, { ...last })).toBe(false);
        expect(themeVarsChanged({}, {})).toBe(false);
    });
    it("is no change when only the order of the keys differs", () => {
        expect(
            themeVarsChanged(last, { "font-sans": "Inter, sans-serif", accent: "#d97757", background: "#101010" })
        ).toBe(false);
    });
    it("is a change when one var's value is different", () => {
        expect(themeVarsChanged(last, { ...last, background: "#ffffff" })).toBe(true);
        expect(themeVarsChanged(last, { ...last, "font-sans": "Inter" })).toBe(true);
    });
    it("is a change when a var appears or goes", () => {
        expect(themeVarsChanged(last, { ...last, error: "#ff0000" })).toBe(true);
        expect(themeVarsChanged(last, { background: "#101010", accent: "#d97757" })).toBe(true);
        expect(themeVarsChanged(last, {})).toBe(true);
    });
    it("is a change when a var swaps for another of the same count", () => {
        expect(themeVarsChanged({ background: "#101010" }, { surface: "#101010" })).toBe(true);
    });
    it("is a change when nothing was posted yet", () => {
        expect(themeVarsChanged(null, last)).toBe(true);
        expect(themeVarsChanged(null, {})).toBe(true);
    });
});
