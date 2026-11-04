// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applySgr, color256, parseAnsiLine, parseAnsiLines, runCss } from "./ansitext";

const E = "\x1b";

describe("parseAnsiLine", () => {
    it("leaves plain text as one unstyled run", () => {
        expect(parseAnsiLine("hello").runs).toEqual([{ text: "hello", style: {} }]);
    });

    it("colors the text after an SGR and resets after 0", () => {
        const { runs, style } = parseAnsiLine(`a${E}[31mred${E}[0mb`);
        expect(runs).toEqual([
            { text: "a", style: {} },
            { text: "red", style: { fg: "var(--ansi-red)" } },
            { text: "b", style: {} },
        ]);
        expect(style).toEqual({});
    });

    it("reads vite's output line from the report", () => {
        const line = `${E}[2mdist/${E}[22m${E}[36massets/main-Dwz0c3aF.js${E}[39m`;
        expect(parseAnsiLine(line).runs).toEqual([
            { text: "dist/", style: { dim: true } },
            { text: "assets/main-Dwz0c3aF.js", style: { fg: "var(--ansi-cyan)" } },
        ]);
    });

    it("drops non-color escapes: erase, cursor moves, OSC titles and links", () => {
        const line = `${E}[2K${E}[1Gok${E}]0;title\x07 ${E}]8;;http://x${E}\\link${E}]8;;${E}\\`;
        expect(parseAnsiLine(line).runs).toEqual([{ text: "ok link", style: {} }]);
    });

    it("keeps only the last draw of a carriage-return line, with its style", () => {
        expect(parseAnsiLine(`${E}[32m 10%\r 50%\r100%`).runs).toEqual([
            { text: "100%", style: { fg: "var(--ansi-green)" } },
        ]);
    });

    it("ignores a trailing CR (a CRLF line)", () => {
        expect(parseAnsiLine("done\r").runs).toEqual([{ text: "done", style: {} }]);
    });

    it("merges adjacent runs whose style ends up the same", () => {
        expect(parseAnsiLine(`${E}[1ma${E}[1mb`).runs).toEqual([{ text: "ab", style: { bold: true } }]);
    });

    it("drops a lone ESC at the end of a line", () => {
        expect(parseAnsiLine(`x${E}`).runs).toEqual([{ text: "x", style: {} }]);
    });
});

describe("parseAnsiLines", () => {
    it("carries style from one line into the next", () => {
        const out = parseAnsiLines([`${E}[33mwarn`, "still", `${E}[0mplain`]);
        expect(out).toEqual([
            [{ text: "warn", style: { fg: "var(--ansi-yellow)" } }],
            [{ text: "still", style: { fg: "var(--ansi-yellow)" } }],
            [{ text: "plain", style: {} }],
        ]);
    });

    it("gives an empty line no runs", () => {
        expect(parseAnsiLines([""])).toEqual([[]]);
    });
});

describe("applySgr", () => {
    it("handles bright, background and default resets", () => {
        expect(applySgr({}, "91;104")).toEqual({ fg: "var(--ansi-brightred)", bg: "var(--ansi-brightblue)" });
        expect(applySgr({ fg: "x", bg: "y" }, "39;49")).toEqual({});
    });

    it("22 clears both bold and dim", () => {
        expect(applySgr({ bold: true, dim: true }, "22")).toEqual({});
    });

    it("reads 256-color and truecolor, with ; or :", () => {
        expect(applySgr({}, "38;5;196")).toEqual({ fg: "rgb(255, 0, 0)" });
        expect(applySgr({}, "48:2:1:2:3")).toEqual({ bg: "rgb(1, 2, 3)" });
        expect(applySgr({}, "38;5;9")).toEqual({ fg: "var(--ansi-brightred)" });
    });

    it("skips a malformed extended color without eating the codes after it", () => {
        expect(applySgr({}, "38;2;300;0;0;1")).toEqual({ bold: true });
    });

    it("treats an empty parameter list as reset", () => {
        expect(applySgr({ bold: true }, "")).toEqual({});
    });
});

describe("color256", () => {
    it("maps the cube and the grey ramp", () => {
        expect(color256(16)).toBe("rgb(0, 0, 0)");
        expect(color256(231)).toBe("rgb(255, 255, 255)");
        expect(color256(232)).toBe("rgb(8, 8, 8)");
        expect(color256(256)).toBeUndefined();
    });
});

describe("runCss", () => {
    it("swaps in the defaults for inverse", () => {
        expect(runCss({ inverse: true }, "FG", "BG")).toEqual({ color: "BG", backgroundColor: "FG" });
        expect(runCss({ inverse: true, fg: "var(--ansi-red)" }, "FG", "BG")).toEqual({
            color: "BG",
            backgroundColor: "var(--ansi-red)",
        });
    });

    it("joins underline and strike", () => {
        expect(runCss({ underline: true, strike: true, bold: true }, "", "")).toEqual({
            textDecoration: "underline line-through",
            fontWeight: 600,
        });
    });
});
