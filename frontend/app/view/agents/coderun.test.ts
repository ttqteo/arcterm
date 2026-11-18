// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isRunnableLang, runnableCommand } from "./coderun";

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
