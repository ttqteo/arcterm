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
