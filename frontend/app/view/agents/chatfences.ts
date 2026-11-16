// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Fenced code in a message you write: where its ``` blocks are (the message box draws each as a code box while you
// type, chateditor.tsx), and a fence with code on its own line (```curl https://…) read as code, not as a language.
// Markdown takes everything after an opening ``` as the block's language, so the bubble would drop that first line.

/** A fenced block, as line indices: the opening fence line and the closing one, null while it is still open (it then
 *  runs to the last line, as markdown reads an unclosed fence) */
export interface FenceRange {
    open: number;
    close: number | null;
}

// up to three spaces, then three or more backticks or tildes, then the info string
const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

interface Opener {
    fence: string;
    info: string;
}

function openerOf(line: string): Opener | null {
    const m = OPEN.exec(line);
    if (m == null) {
        return null;
    }
    const [, fence, info] = m;
    // a backtick fence's info holds no backtick (```a``` is inline code, not a fence)
    if (fence[0] === "`" && info.includes("`")) {
        return null;
    }
    return { fence, info };
}

function closes(line: string, fence: string): boolean {
    const m = CLOSE.exec(line);
    return m != null && m[1][0] === fence[0] && m[1].length >= fence.length;
}

/** Pure: the fenced blocks in a message's lines, in order. */
export function fenceRanges(lines: string[]): FenceRange[] {
    const out: FenceRange[] = [];
    let at = -1;
    let fence = "";
    for (let i = 0; i < lines.length; i++) {
        if (at < 0) {
            const opener = openerOf(lines[i]);
            if (opener != null) {
                at = i;
                fence = opener.fence;
            }
        } else if (closes(lines[i], fence)) {
            out.push({ open: at, close: i });
            at = -1;
        }
    }
    if (at >= 0) {
        out.push({ open: at, close: null });
    }
    return out;
}

/** Pure: a message whose opening fence carries code on its line (```curl https://x \) with that code moved to the
 *  next line, so markdown keeps it in the block. An info string of one word (```bash, ```c++) is a language and stays;
 *  one with a space in it is code. Lines inside a block are left alone. */
export function splitFenceInfo(text: string): string {
    if (!text.includes("```") && !text.includes("~~~")) {
        return text;
    }
    const lines = text.split("\n");
    const out: string[] = [];
    let fence: string | null = null;
    for (const line of lines) {
        if (fence != null) {
            out.push(line);
            if (closes(line, fence)) {
                fence = null;
            }
            continue;
        }
        const opener = openerOf(line);
        if (opener == null) {
            out.push(line);
            continue;
        }
        fence = opener.fence;
        const code = opener.info.trim();
        if (/\s/.test(code)) {
            out.push(line.slice(0, line.length - opener.info.length), code);
        } else {
            out.push(line);
        }
    }
    return out.join("\n");
}
