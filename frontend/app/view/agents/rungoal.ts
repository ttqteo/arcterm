// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A run's goal as its heading (rungoalview.tsx): the first paragraph is the heading, and the rest, which the
// heading never shows, is what opening the goal reveals. The rest is sliced, not re-joined, so a code block's
// own blank lines survive.
export function splitGoal(goal: string): { lead: string; rest: string } {
    const text = goal.trim();
    const brk = /\n\s*\n/.exec(text);
    if (brk == null) {
        return { lead: text, rest: "" };
    }
    return { lead: text.slice(0, brk.index), rest: text.slice(brk.index + brk[0].length) };
}
