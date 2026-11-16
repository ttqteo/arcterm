// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the quick pick card Chat draws when the agent asks you to choose between option boards it drew in its Canvas
// (docs/superpowers/specs/2026-11-16-canvas-quick-pick-design.md). Which boards are options, when the card shows, its
// head and the line a row sends. The card itself is chatcanvaspickcard.tsx.

import type { CanvasBoard } from "./canvasmodel";
import { endsWithQuestion } from "./chatsuggest";

/** One row of the card: the board's letter, its title as the agent wrote it, and the board it opens. */
export type PickRow = { letter: string; title: string; board: string };

/** What the card draws: the agent's question and one row per option board. */
export type CanvasPick = { question: string; rows: PickRow[] };

// an option board as the design skill names it (skills/design/SKILL.md): A-<slug>.dc.html, B-<slug>.dc.html…
const OPTION_BOARD = /^([A-Z])-(.+)\.dc\.html$/;
// the title's own "Option A: " prefix, which the row's letter already says
const OPTION_PREFIX = /^option\s+[A-Z]\s*[:—–-]\s*/i;
const SEPARATOR = "[—–:.)\\-]";
// a line that opens an option: an optional bullet, the letter (bold or not), then a separator or the bold's end
const OPTION_LINE = new RegExp(
    `^(?:[-*+•]\\s+|\\d+[.)]\\s+)?(\\*\\*|__)?([A-Z])\\s*(${SEPARATOR})?\\s*(\\*\\*|__)?\\s*(${SEPARATOR})?(?=\\s|$)`
);
const FENCE = /```[\s\S]*?(```|$)/g;

function prose(reply: string): string {
    return reply.replace(FENCE, "");
}

/** Pure: the letters the reply lists as options, a line each: `A — …`, `**A** …`, `- B: …`, `1. C) …`. A letter that only
 *  opens a sentence ("I think…") is no option. */
export function namedLetters(reply: string): Set<string> {
    const out = new Set<string>();
    for (const raw of prose(reply).split("\n")) {
        const m = OPTION_LINE.exec(raw.trim());
        if (m == null) {
            continue;
        }
        const [, open, letter, sep1, close, sep2] = m;
        const bold = open != null && close === open;
        if ((open != null || close != null) && !bold) {
            continue;
        }
        if (bold || sep1 != null || sep2 != null) {
            out.add(letter);
        }
    }
    return out;
}

/** Pure: the title a row shows and sends: the board's title less its `Option X: ` prefix, else the slug of its name. */
export function boardTitle(b: CanvasBoard): string {
    const title = b.title?.replace(OPTION_PREFIX, "").trim();
    if (title) {
        return title;
    }
    return OPTION_BOARD.exec(b.name)?.[2] ?? b.name;
}

/** Pure: the option boards the reply names, in canvas.json's order, at most one per letter (the one modified last, or the
 *  later in the order when the poller read no time for them). Fewer than two is no choice, so none. */
export function optionRows(boards: readonly CanvasBoard[], reply: string): PickRow[] {
    const named = namedLetters(reply);
    const chosen = new Map<string, { b: CanvasBoard; at: number }>();
    boards.forEach((b, at) => {
        const letter = OPTION_BOARD.exec(b.name)?.[1];
        if (letter == null || !named.has(letter)) {
            return;
        }
        const prev = chosen.get(letter);
        if (prev == null || (b.modifiedMs ?? -Infinity) >= (prev.b.modifiedMs ?? -Infinity)) {
            chosen.set(letter, { b, at });
        }
    });
    if (chosen.size < 2) {
        return [];
    }
    return [...chosen.entries()]
        .sort(([, x], [, y]) => x.at - y.at)
        .map(([letter, { b }]) => ({ letter, title: boardTitle(b), board: b.name }));
}

/** Pure: the reply's last sentence that ends with a question mark, with its markdown marks taken off, for the card's head. */
export function lastQuestion(reply: string): string {
    const lines = prose(reply)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "");
    const last = lines[lines.length - 1] ?? "";
    const bare = last
        .replace(/^(?:#{1,6}\s+|>\s*|[-*+•]\s+)+/, "")
        .replace(/==|\*\*|__|`/g, "")
        .trim();
    const sentences = bare.split(/(?<=[.!?？。])\s+/);
    for (let i = sentences.length - 1; i >= 0; i--) {
        const s = sentences[i].replace(/["'”’)\]\s]+$/u, "");
        if (s.endsWith("?") || s.endsWith("？")) {
            return sentences[i].trim();
        }
    }
    return bare;
}

/** Pure: the line a row sends, its letter and the board's title: `A — Gộp các lần liên tiếp cùng file`. */
export function pickLine(row: PickRow): string {
    return `${row.letter} — ${row.title}`;
}

/** Pure: the card, or null when it does not show. It shows only while the agent's turn is over and waits on you (`idle`),
 *  the agent is the one in focus, it has no brainstorm (whose card does this) but a canvas this app opened, its last
 *  reply ends with a question and names two or more option boards of that canvas, and that reply was not answered from
 *  the card already (`sent`, the reply a row was sent for). */
export function canvasPick(i: {
    reply: string | null;
    idle: boolean;
    focused: boolean;
    brainstorm: boolean;
    boards: readonly CanvasBoard[] | null;
    sent: string | null;
}): CanvasPick | null {
    if (i.reply == null || !i.idle || !i.focused || i.brainstorm || i.boards == null || i.sent === i.reply) {
        return null;
    }
    if (!endsWithQuestion(i.reply)) {
        return null;
    }
    const rows = optionRows(i.boards, i.reply);
    return rows.length === 0 ? null : { question: lastQuestion(i.reply), rows };
}
