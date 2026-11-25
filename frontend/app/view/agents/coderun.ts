// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A Chat code block's Run button: which blocks get one, and the command it types into a new terminal.

const RUNNABLE_LANGS = new Set(["bash", "sh", "shell", "zsh", "console", "powershell", "pwsh", "ps1"]);

// A block fenced as a shell language is a command the reply means you to run; any other (code, output, a block with no
// language) is not.
export function isRunnableLang(lang: string | undefined): boolean {
    return lang != null && RUNNABLE_LANGS.has(lang.toLowerCase());
}

// The block's lines, each without the prompt a reply writes in front of a command: `! ` (a command for the person to
// type into Claude Code) or `$ `. A `!` or `$` with no space after it is the command's own (`!!`, `$HOME`). A block of
// only blank lines gives nothing to run.
export function runnableCommand(code: string): string | undefined {
    const lines = code
        .replace(/\n+$/, "")
        .split("\n")
        .map((ln) => ln.replace(/^\s*[!$] /, ""));
    const command = lines.join("\n").trim();
    return command || undefined;
}

// A block with no language whose every line is a prompted command (`! task install`, `$ npm test`): the reply means
// you to run it as surely as a fenced `bash` block.
export function isPromptedCommand(code: string, lang: string | undefined): boolean {
    if (lang != null && lang !== "") {
        return false;
    }
    const lines = code.replace(/\n+$/, "").split("\n");
    return lines.length > 0 && lines.every((ln) => /^\s*[!$] \S/.test(ln));
}

// A code span holding a command for the person to type at Claude Code's prompt (`! task install`): as much a must-read
// as a ==marked== sentence, so Chat draws it in the mark's tint, as the terminal's skim mod does (highlight-core.ts
// commandSpans). Only `! `: a `$ ` span is as often a shell variable or a quoted prompt as a command to type.
export function isInlineCommand(code: string): boolean {
    return /^!\s+\S/.test(code);
}

// A block drawn as one compact row, as Claude Desktop draws a command: one line, no file path, and no language or a
// shell's. A block of code in a named language keeps its head (the language tag, Wrap) and its line number.
export function isCompactBlock(code: string, lang: string | undefined, path: string | undefined): boolean {
    if (path != null && path !== "") {
        return false;
    }
    if (lang != null && lang !== "" && !isRunnableLang(lang)) {
        return false;
    }
    return !code.replace(/\n+$/, "").includes("\n");
}
