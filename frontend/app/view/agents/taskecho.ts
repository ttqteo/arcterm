// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The commands Task (taskfile.dev) echoes before it runs them, found in a command's plain output so they can be drawn
// in the shell's colours (commandtext.tsx CommandOutput): `task: [install:windows] <command>`. Run with no terminal
// (Chat's `!`, an agent's Bash) Task prints no colour of its own. A one-line command is that line alone; a multi-line
// one (a Taskfile `cmd: |` block) runs on until the blank line Task prints after it, since the block ends in a newline.

const ECHO = /^(task: \[[^\]]+\] )(.*)$/;

/** how far a multi-line command may run before the blank line that ends it; past this the line is taken alone */
export const ECHO_BLOCK_MAX = 40;

/** One echoed command: lines [start, end) of the output, the first led by `prefix` (`task: [name] `). */
export interface TaskEcho {
    start: number;
    end: number;
    prefix: string;
}

/** Pure: the echoed commands in the output's lines, in order. A block stops at a blank line or the next echo; one that
 *  finds neither within ECHO_BLOCK_MAX lines is its first line alone, as a one-line command followed by its output. */
export function taskEchoes(lines: readonly string[]): TaskEcho[] {
    const out: TaskEcho[] = [];
    let i = 0;
    while (i < lines.length) {
        const m = ECHO.exec(lines[i]);
        if (m == null) {
            i++;
            continue;
        }
        let end = i + 1;
        let closed = false;
        for (let j = i + 1; j < lines.length && j <= i + ECHO_BLOCK_MAX; j++) {
            if (lines[j].trim() === "" || ECHO.test(lines[j])) {
                end = j;
                closed = true;
                break;
            }
        }
        if (!closed) {
            end = i + 1;
        }
        out.push({ start: i, end, prefix: m[1] });
        i = end;
    }
    return out;
}
