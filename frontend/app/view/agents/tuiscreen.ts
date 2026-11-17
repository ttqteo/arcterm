// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads four things off the rows of Claude Code's own screen (the xterm that stays mounted under the chat view):
// the permission mode its footer names, the effort its effort line names, the numbered options of a permission
// dialog, and any other dialog whole (its title, text and options). Pure: the rows come in as
// strings, the caller (the chat's footer, permission card and screen dialog card) reads them with readTermLines.
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

// a rule at the front of a row, solid (─) or dashed (╌), and what follows it
const ruleHead = /^(\s*(?:─{8,}|╌{8,}))(.*)$/;

/** Claude Code draws its rules, solid and dashed, the screen's full width, so xterm marks the row after one as a wrap of
 *  it and readTermLines joins the two: "────…────❯ text", "────…──── ⏵⏵ auto mode on", "╌╌╌…╌╌╌  echo hi". This
 *  splits each rule back off onto a row of its own, so the screen reads as Claude Code drew it. */
export function splitRules(lines: string[]): string[] {
    return lines.flatMap((line) => {
        const m = ruleHead.exec(line);
        return m == null || m[2].trim() === "" ? [line] : [m[1], m[2]];
    });
}

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
export function tuiMode(screen: string[]): ClaudeMode | null {
    const lines = splitRules(screen);
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

// a footer row by its glyph alone, whatever words follow it
const footerGlyph = /^\s*(?:⏵⏵|⏸)\s*\S/;

/** Whether the footer under Claude Code's input box shows, so the prompt is up, read by its glyph (⏵⏵ or ⏸) and not by
 *  the mode's words: a Claude Code that words a mode in a way tuiMode does not know (2.1.319 brought "manual mode") still
 *  shows its prompt. */
export function tuiPromptUp(screen: string[]): boolean {
    const lines = splitRules(screen);
    let seen = 0;
    for (let i = lines.length - 1; i >= 0 && seen < footerRows; i--) {
        if (lines[i].trim() === "") {
            continue;
        }
        seen++;
        if (footerGlyph.test(lines[i])) {
            return true;
        }
    }
    return false;
}

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
    return dialogRun(lines)?.options ?? [];
}

// the bottom-most run of numbered options with the cursor on one of them, and the row it starts at
function dialogRun(lines: string[]): { start: number; options: TuiOption[]; cursor: number } | null {
    for (let start = lines.length - 1; start >= 0; start--) {
        const first = optionRow.exec(lines[start]);
        if (!first || first[2] !== "1") {
            continue;
        }
        const run = readRun(lines, start);
        if (run.options.length >= 2 && run.cursor > 0) {
            return { start, options: run.options, cursor: run.cursor };
        }
    }
    return null;
}

export interface TuiDialog {
    /** the dialog's first row ("Session paused", "Bash command") */
    title: string;
    /** the rows between the title and the options, as paragraphs: a row wrapped at the screen's edge joined to the next */
    body: string[];
    options: TuiOption[];
    /** the option the cursor is on */
    cursor: number;
}

// the solid rule Claude Code draws across the screen over a dialog (a dashed ╌ rule inside one frames a command). The
// rule is the screen's full width, so xterm marks the row after it as a wrap and readTermLines joins the two
// ("────…──── Session paused"): what follows the rule is that next row.
const dialogRule = /^(\s*─{8,})(.*)$/;
const dashedRule = /^\s*╌{8,}\s*$/;

// the last solid rule at or above row `from`: its row, its width, and the row it swallowed ("" for none)
function ruleAbove(lines: string[], from: number): { at: number; width: number; rest: string } | null {
    for (let i = from; i >= 0; i--) {
        const m = dialogRule.exec(lines[i]);
        if (m) {
            return { at: i, width: m[1].length, rest: m[2] };
        }
    }
    return null;
}

/** The dialog at the bottom of Claude Code's screen, whatever it asks: the rows from the solid rule over it down to its
 *  numbered options. null with no options on screen, or no rule over them (a numbered list in a reply has neither the
 *  cursor nor the rule). A row as long as the rule, give or take a word, was wrapped there, so it runs on into the next
 *  row's paragraph; a blank row ends a paragraph. */
export function tuiDialog(screen: string[]): TuiDialog | null {
    const lines = splitRules(screen);
    const run = dialogRun(lines);
    if (run == null) {
        return null;
    }
    const rule = ruleAbove(lines, run.start - 1);
    if (rule == null) {
        return null;
    }
    const width = rule.width;
    const rows = [rule.rest, ...lines.slice(rule.at + 1, run.start)].filter((row) => !dashedRule.test(row));
    const first = rows.findIndex((row) => row.trim() !== "");
    if (first < 0) {
        return null;
    }
    const body: string[] = [];
    let open = false;
    for (const row of rows.slice(first + 1)) {
        const text = row.trim();
        if (text === "") {
            open = false;
            continue;
        }
        if (open) {
            body[body.length - 1] += " " + text;
        } else {
            body.push(text);
        }
        open = row.trimEnd().length >= width - WRAP_SLACK;
    }
    return { title: rows[first].trim(), body, options: run.options, cursor: run.cursor };
}

// how far short of the screen's edge a wrapped row can end: the longest word that did not fit
const WRAP_SLACK = 16;

// the most rows tuiScreenTail gives
const TAIL_ROWS = 14;

/** The foot of Claude Code's screen as the person would read it there: the non-blank rows under its last solid rule (the
 *  rule's own row counts for what it swallowed), or with no rule the last rows on screen; at most TAIL_ROWS, the
 *  bottom ones. For a screen this module has no reader for (a form, a "Press Enter to continue"). */
export function tuiScreenTail(screen: string[]): string[] {
    const lines = splitRules(screen);
    const rule = ruleAbove(lines, lines.length - 1);
    const rows = rule == null ? lines : [rule.rest, ...lines.slice(rule.at + 1)];
    return rows
        .filter((row) => row.trim() !== "" && !dashedRule.test(row))
        .map((row) => row.trimEnd())
        .slice(-TAIL_ROWS);
}

// a select list's cursor row: " ❯ No" or " ❯ 2. Yes"; the label starts at the column after the mark
const cursorRow = /^(\s*❯\s+)(\S.*?)\s*$/;
const numberedLabel = /^(\d+)\.\s+(\S.*)$/;
const yesLabel = /^yes\b/i;

/** Where the dialog's Yes sits from its cursor, read off the bottom of the screen: `moves` rows down (up when negative)
 *  and its label; null with no list there, or no option starting with "Yes". A numbered dialog (" ❯ 1. Yes") counts by
 *  its numbers; a plain one (the Artifact tool's " ❯ No / Yes") by the rows around the cursor at the label's column,
 *  up to a blank row or a row at another indent. The input box's own "❯" is no list: it has no rows beside it. */
export function tuiSelectYes(lines: string[]): { moves: number; label: string } | null {
    let at = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (cursorRow.test(lines[i])) {
            at = i;
            break;
        }
    }
    if (at < 0) {
        return null;
    }
    const [, lead, label] = cursorRow.exec(lines[at]);
    const numbered = numberedLabel.exec(label);
    if (numbered) {
        const cursor = Number(numbered[1]);
        const yes = tuiPermissionOptions(lines).find((o) => yesLabel.test(o.label));
        return yes == null ? null : { moves: yes.n - cursor, label: yes.label };
    }
    const col = lead.length;
    const atCol = (row: string | undefined) =>
        row != null && row.trim() !== "" && !row.includes("❯") && row.length - row.trimStart().length === col;
    let first = at;
    while (atCol(lines[first - 1])) {
        first--;
    }
    let last = at;
    while (atCol(lines[last + 1])) {
        last++;
    }
    if (last === first) {
        return null;
    }
    const labels = lines.slice(first, last + 1).map((row, i) => (first + i === at ? label : row.trim()));
    const yes = labels.findIndex((l) => yesLabel.test(l));
    return yes < 0 ? null : { moves: first + yes - at, label: labels[yes] };
}

// the run of options from row `start`, and the number of the one the cursor is on (0 for none)
function readRun(lines: string[], start: number): { options: TuiOption[]; cursor: number } {
    const options: TuiOption[] = [];
    let cursor = 0;
    let labelCol = 0;
    for (let i = start; i < lines.length; i++) {
        const row = lines[i];
        const m = optionRow.exec(row);
        if (m) {
            if (Number(m[2]) !== options.length + 1) {
                break;
            }
            if (cursorMark.test(m[1])) {
                cursor = options.length + 1;
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
