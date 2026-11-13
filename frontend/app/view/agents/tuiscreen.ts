// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads three things off the rows of Claude Code's own screen (the xterm that stays mounted under the chat view):
// the permission mode its footer names, the effort its effort line names, and the numbered options of a permission
// dialog. Pure: the rows come in as
// strings, the caller (the chat's footer and permission card) reads them with readTermLines.
//
// Every marker below is a string captured from Claude Code 2.1.319 (tuiscreen.fixtures.json), never written from
// memory. A later Claude Code that words the footer differently makes tuiMode return null, and the chat keeps the
// last mode it read.

export type ClaudeMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface TuiOption {
    n: number;
    label: string;
}

// the footer row: a mode glyph (⏵⏵ or ⏸), the mode's words, then "on" (e.g. "⏵⏵ auto mode on (shift+tab to cycle)",
// "⏸ manual mode on · ? for shortcuts", "⏵⏵ accept edits on (…)", "⏵⏵ bypass permissions on (…)"). Anchored at the
// row's start so a marker quoted in the conversation above never counts.
const modeFooter = /^\s*(?:⏵⏵|⏸)\s*(bypass permissions|accept edits|plan mode|auto mode|manual mode) on\b/i;

const modeByWords: Record<string, ClaudeMode> = {
    "bypass permissions": "bypassPermissions",
    "accept edits": "acceptEdits",
    "plan mode": "plan",
    "auto mode": "auto",
    // Claude Code 2.1.319 names the ask-for-everything mode "manual"
    "manual mode": "default",
};

// how far up from the last non-empty row the footer can sit (a notice or the effort line may share the box's foot)
const footerRows = 6;

// the mode the footer names, or null when no footer shows (a dialog or a menu covers it, or the screen is empty)
export function tuiMode(lines: string[]): ClaudeMode | null {
    let seen = 0;
    for (let i = lines.length - 1; i >= 0 && seen < footerRows; i--) {
        if (lines[i].trim() === "") {
            continue;
        }
        seen++;
        const m = modeFooter.exec(lines[i]);
        if (m) {
            return modeByWords[m[1].toLowerCase()];
        }
    }
    return null;
}

// The effort line Claude Code draws over the input box for a while after the effort changes, right-aligned: a glyph
// per level (○ low, ◐ medium, ● high, ◉ xhigh, ◈ max, from Claude Code 2.1.323's own table), the level, then
// "· /effort" (e.g. "◐ medium · /effort"). Anchored at the row's end, so a line quoted mid-row never counts.
const effortLine = /[○◐●◉◈]\s+(low|medium|high|xhigh|max)\b[^·]*·\s*\/effort\s*$/i;

// the effort the line over the box names, or null when it does not show
export function tuiEffort(lines: string[]): EffortLevel | null {
    let seen = 0;
    for (let i = lines.length - 1; i >= 0 && seen < footerRows; i--) {
        if (lines[i].trim() === "") {
            continue;
        }
        seen++;
        const m = effortLine.exec(lines[i]);
        if (m) {
            return m[1].toLowerCase() as EffortLevel;
        }
    }
    return null;
}

// "   2. Yes, and …" or " ❯ 1. Yes": the cursor mark is optional, the label starts after "N. "
const optionRow = /^(\s*(?:❯\s*)?)(\d+)\.\s+(\S.*?)\s*$/;
const cursorMark = /❯/;

// The numbered options of the dialog at the bottom of the screen, in screen order, with the cursor mark stripped and
// a label that wraps onto the next row joined to its option. [] when no dialog shows: the options are a run of rows
// numbered 1, 2, 3… that has the cursor mark on one of them, which a numbered list in Claude's reply never has.
export function tuiPermissionOptions(lines: string[]): TuiOption[] {
    for (let start = lines.length - 1; start >= 0; start--) {
        const first = optionRow.exec(lines[start]);
        if (!first || first[2] !== "1") {
            continue;
        }
        const options = readRun(lines, start);
        if (options.options.length >= 2 && options.cursor) {
            return options.options;
        }
    }
    return [];
}

function readRun(lines: string[], start: number): { options: TuiOption[]; cursor: boolean } {
    const options: TuiOption[] = [];
    let cursor = false;
    let labelCol = 0;
    for (let i = start; i < lines.length; i++) {
        const row = lines[i];
        const m = optionRow.exec(row);
        if (m) {
            if (Number(m[2]) !== options.length + 1) {
                break;
            }
            if (cursorMark.test(m[1])) {
                cursor = true;
            }
            options.push({ n: options.length + 1, label: m[3] });
            // a wrapped label continues at or past the column this one's text starts at
            labelCol = m[1].length + m[2].length + 2;
            continue;
        }
        const indent = row.length - row.trimStart().length;
        if (options.length > 0 && row.trim() !== "" && indent >= labelCol) {
            options[options.length - 1].label += " " + row.trim();
            continue;
        }
        break;
    }
    return { options, cursor };
}
