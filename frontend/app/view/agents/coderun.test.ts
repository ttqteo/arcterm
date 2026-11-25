// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isCompactBlock, isInlineCommand, isPromptedCommand, isRunnableLang, runnableCommand } from "./coderun";

describe("isRunnableLang", () => {
    it("takes the shell languages, in any case", () => {
        for (const lang of ["bash", "sh", "shell", "zsh", "console", "powershell", "pwsh", "ps1", "BASH"]) {
            expect(isRunnableLang(lang)).toBe(true);
        }
    });

    it("refuses code that is not a shell command, and a block with no language", () => {
        for (const lang of ["ts", "json", "go", "text", "diff", "", undefined]) {
            expect(isRunnableLang(lang)).toBe(false);
        }
    });
});

describe("runnableCommand", () => {
    it("drops the `! ` a reply puts before a command the person types", () => {
        expect(runnableCommand("! task install\n")).toBe("task install");
    });

    it("drops a `$ ` prompt", () => {
        expect(runnableCommand("$ git status")).toBe("git status");
    });

    it("keeps every line, each without its prompt", () => {
        expect(runnableCommand("$ cd web\n$ npm test\n")).toBe("cd web\nnpm test");
    });

    it("keeps a `!` or `$` that is part of the command", () => {
        expect(runnableCommand("!!")).toBe("!!");
        expect(runnableCommand("$HOME/bin/x")).toBe("$HOME/bin/x");
    });

    it("gives nothing for a block of only blank lines", () => {
        expect(runnableCommand("\n  \n")).toBeUndefined();
    });
});

describe("isPromptedCommand", () => {
    it("takes a block with no language whose lines are all prompted", () => {
        expect(isPromptedCommand("! task install", undefined)).toBe(true);
        expect(isPromptedCommand("$ cd web\n$ npm test\n", "")).toBe(true);
    });

    it("refuses a language, an unprompted line, and a bare prompt", () => {
        expect(isPromptedCommand("! task install", "text")).toBe(false);
        expect(isPromptedCommand("$ cd web\nnpm test", undefined)).toBe(false);
        expect(isPromptedCommand("$HOME/bin/x", undefined)).toBe(false);
        expect(isPromptedCommand("! ", undefined)).toBe(false);
    });
});

describe("isInlineCommand", () => {
    it("takes a span that is a `! ` command", () => {
        expect(isInlineCommand("! task install")).toBe(true);
        expect(isInlineCommand("! wsh runs land a8e7ce25 --force")).toBe(true);
    });

    it("refuses `!=`, `!important`, a bare `!` and a `$ ` span", () => {
        expect(isInlineCommand("!= null")).toBe(false);
        expect(isInlineCommand("!important")).toBe(false);
        expect(isInlineCommand("! ")).toBe(false);
        expect(isInlineCommand("$ npm test")).toBe(false);
        expect(isInlineCommand("a ! b")).toBe(false);
    });
});

describe("isCompactBlock", () => {
    it("is one line with no language or a shell's, and no path", () => {
        expect(isCompactBlock("! task install\n", undefined, undefined)).toBe(true);
        expect(isCompactBlock("npm test", "bash", undefined)).toBe(true);
    });

    it("keeps the head for several lines, a named language, or a path", () => {
        expect(isCompactBlock("a\nb", undefined, undefined)).toBe(false);
        expect(isCompactBlock('{"a": 1}', "json", undefined)).toBe(false);
        expect(isCompactBlock("x", undefined, "src/a.ts")).toBe(false);
    });
});
