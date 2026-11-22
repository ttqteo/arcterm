// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A long paste in Chat's box folds into a chip over the text, as an attachment does, so the box keeps the question
// typed around it in view. The paste stays in the draft (the message is one string: the draft store, a failed send's
// put-back and a wake's all keep it whole), after the typed text and marked off by two private-use characters that
// never reach the agent: `expandPastes` turns each into the block it goes as: a <pasted_content> block in a message,
// which its bubble draws as a card; in an ask's answer, fenced when it reads as code, as a paste into the box is. Pure:
// no React, no Wave runtime imports.

import { fenceRanges } from "./chatfences";
import { looksLikeCode } from "./chatmarks";

const OPEN = "";
const CLOSE = "";
// what sets a paste apart from the text before it, in the draft and in the message
const SEP = "\n\n";
const MARKS = /[]/g;

/** a paste folds from this many lines, or this many characters on fewer lines */
export const FOLD_LINES = 10;
export const FOLD_CHARS = 1000;

function normalized(pasted: string): string {
    return pasted.replace(/\r\n?/g, "\n").replace(MARKS, "");
}

/** Whether a paste at `start` in the box's text folds into a chip: long enough, and not inside a fenced block (or right
 *  under a fence the person opened), where they are filling in code by hand. */
export function foldsPaste(box: string, start: number, pasted: string): boolean {
    const p = normalized(pasted).replace(/\s+$/, "");
    if (p.split("\n").length < FOLD_LINES && p.length < FOLD_CHARS) {
        return false;
    }
    const lines = box.split("\n");
    const line = box.slice(0, start).split("\n").length - 1;
    return !fenceRanges(lines).some((r) => line >= r.open && line <= (r.close ?? lines.length - 1));
}

/** The draft's typed text and its folded pastes. joinPastes(splitPastes(t)) is t for any draft joinPastes wrote; marks
 *  that do not pair (a draft written some other way) are dropped and the text kept. */
export function splitPastes(text: string): { body: string; pastes: string[] } {
    const at = text.indexOf(SEP + OPEN);
    if (at < 0) {
        return { body: text.includes(OPEN) || text.includes(CLOSE) ? text.replace(MARKS, "") : text, pastes: [] };
    }
    const rest = text.slice(at);
    const one = new RegExp(`${SEP}${OPEN}([^${OPEN}${CLOSE}]*)${CLOSE}`, "gy");
    const pastes: string[] = [];
    let m: RegExpExecArray | null;
    let end = 0;
    while ((m = one.exec(rest)) != null) {
        pastes.push(m[1]);
        end = one.lastIndex;
    }
    if (end !== rest.length) {
        return { body: text.replace(MARKS, ""), pastes: [] };
    }
    return { body: text.slice(0, at), pastes };
}

export function joinPastes(body: string, pastes: readonly string[]): string {
    return body + pastes.map((p) => SEP + OPEN + p + CLOSE).join("");
}

// a fence longer than any backtick run in the code, so a paste holding ``` stays one block
function fenceFor(code: string): string {
    const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
    return "`".repeat(Math.max(3, longest + 1));
}

/** A paste as it goes: blank lines and trailing space around it dropped, fenced when it reads as code or a log. */
export function pasteBlock(paste: string): string {
    const body = paste.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
    if (!looksLikeCode(body)) {
        return body;
    }
    const fence = fenceFor(body);
    return `${fence}\n${body}\n${fence}`;
}

/** The tag a sent paste goes in, which Chat's bubble draws as a folded "Pasted" card (chattagblocks.ts); `from="chat"`
 *  keeps a message that is only a paste from being read as a whole message Claude Code wrapped (unwrapWholePaste). */
export const PASTE_FROM = "chat";

/** A paste as a sent message carries it: in a <pasted_content> block, blank lines and trailing space around it dropped. */
export function taggedPasteBlock(paste: string): string {
    const body = paste.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
    return `<pasted_content from="${PASTE_FROM}">\n${body}\n</pasted_content>`;
}

/** The draft as the agent gets it: each folded paste written out after the typed text, fenced when it reads as code
 *  (`tagged`: in a <pasted_content> block instead, so the bubble of the message sent shows it as a card). */
export function expandPastes(text: string, tagged = false): string {
    const { body, pastes } = splitPastes(text);
    if (pastes.length === 0) {
        return body;
    }
    const blocks = pastes.map(tagged ? taggedPasteBlock : pasteBlock).join(SEP);
    return body.trim() === "" ? body + blocks : body.replace(/\s+$/, "") + SEP + blocks;
}

// the whole draft (typed text, pastes) with its pastes changed by `edit`, which also gets the typed text
function editPastes(
    full: string,
    edit: (body: string, pastes: string[]) => { body: string; pastes: string[] }
): string {
    const { body, pastes } = splitPastes(full);
    const next = edit(body, pastes);
    return joinPastes(next.body, next.pastes);
}

/** The whole draft with one more paste folded at its end. */
export function withPaste(full: string, pasted: string): string {
    return editPastes(full, (body, pastes) => ({ body, pastes: [...pastes, normalized(pasted)] }));
}

/** The whole draft without its `i`th paste. */
export function withoutPaste(full: string, i: number): string {
    return editPastes(full, (body, pastes) => ({ body, pastes: pastes.filter((_, k) => k !== i) }));
}

/** The whole draft with its `i`th paste put back in the text, at its end, as a paste into the box would have put it. */
export function unfoldPaste(full: string, i: number): string {
    return editPastes(full, (body, pastes) => {
        const p = pastes[i];
        if (p == null) {
            return { body, pastes };
        }
        const kept = body.replace(/\s+$/, "");
        return {
            body: (kept === "" ? "" : kept + "\n") + pasteBlock(p),
            pastes: pastes.filter((_, k) => k !== i),
        };
    });
}

/** The chip's count: lines when there are several, else characters. */
export function pasteSize(paste: string): string {
    const body = paste.replace(/\s+$/, "");
    const lines = body.split("\n").length;
    if (lines > 1) {
        return `${lines.toLocaleString("en-US")} lines`;
    }
    return `${Array.from(body).length.toLocaleString("en-US")} characters`;
}
