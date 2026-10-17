// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's notice board, as the dialog box shows it (spec docs/superpowers/specs/2026-10-16-office-needs-you-board-
// design.md; canvas .superpowers/design/office-needs-you-board: Dialog). One page per Needs you row, and with none a
// page that says so: this turns a StripRow into the ▶ menu's items, the box's words and the page tabs, and says which of
// the strip's handlers each item runs. Pure: no React, no Wave runtime imports. cockpitsurface.tsx only switches on
// boardCall.

import type { AttentionAct } from "@/app/view/jarvis/attentionact";
import type { StripRow } from "./needsyoustripmodel";
import type { DialogItem, DialogItemId, QuestionTabs } from "./officedialogmodel";

export type BoardAct = "act" | "act2" | "open" | "accept" | "dismiss" | "why" | "ok";

/** Pure: the ▶ menu of one page: the strip's buttons for its row, in their order. A learned rule is Accept, Dismiss
 *  and Why (its words) behind a rule; Edit needs typing, which the box has no place for, so it stays in Cards. */
export function boardItems(row: StripRow, whyOpen: boolean, busy = false): DialogItem[] {
    const items: DialogItem[] = [];
    if (row.learnId != null) {
        items.push({ id: "board:accept", label: "Accept" }, { id: "board:dismiss", label: "Dismiss" });
        if (row.why !== "") {
            items.push({ id: "board:why", label: "Why", rule: true, checked: whyOpen });
        }
    } else {
        const opens = row.open != null;
        if (row.act.kind !== "open" || opens) {
            items.push({ id: "board:act", label: row.act.label });
        }
        if (row.secondAct != null) {
            items.push({ id: "board:act2", label: row.secondAct.label });
        }
        if (row.act.kind !== "open" && opens) {
            items.push({ id: "board:open", label: "Open" });
        }
    }
    return busy ? items.map((it) => ({ ...it, dim: true })) : items;
}

/** Pure: the ▶ menu of the board with no row on it: OK, which goes back to walking. */
export function boardEmptyItems(): DialogItem[] {
    return [{ id: "board:ok", label: "OK" }];
}

/** Pure: the page in range, -1 with no rows. */
export function boardPage(page: number, rows: number): number {
    return Math.min(Math.max(page, 0), rows - 1);
}

/** Pure: ◀ the page's kind ▶ and which of how many, over the ▶ menu; none for a single row. */
export function boardTabs(rows: readonly StripRow[], page: number): QuestionTabs | undefined {
    if (rows.length < 2) {
        return undefined;
    }
    const at = boardPage(page, rows.length);
    return { head: rows[at].kindLabel, at, of: rows.length };
}

export interface BoardWords {
    title: string;
    text: string;
    why: string;
    quote?: string;
}

/** Pure: the box's words. A learned rule's `why` is the person's own words: shown only once Why is picked. */
export function boardWords(row: StripRow, whyOpen: boolean): BoardWords {
    const title = row.source !== "" ? `${row.kindLabel} · ${row.source}` : row.kindLabel;
    if (row.learnId != null) {
        return { title, text: row.text, why: "", quote: whyOpen ? row.why : undefined };
    }
    return { title, text: row.text, why: row.why, quote: undefined };
}

export type BoardCall =
    | { kind: "act"; act: AttentionAct }
    | { kind: "open" }
    | { kind: "learn"; accept: boolean }
    | { kind: "why" }
    | { kind: "close" };

/** Pure: which strip handler a ▶ item runs; null for an item that is not the board's, or a second act the row lacks.
 *  The empty board has no row: only its OK runs then. The Cockpit surface only switches on it, so what each item does is
 *  pinned here. */
export function boardCall(row: StripRow | undefined, id: DialogItemId): BoardCall | null {
    if (id === "board:ok") {
        return { kind: "close" };
    }
    if (row == null) {
        return null;
    }
    switch (id) {
        case "board:act":
            return { kind: "act", act: row.act };
        case "board:act2":
            return row.secondAct != null ? { kind: "act", act: row.secondAct } : null;
        case "board:open":
            return { kind: "open" };
        case "board:accept":
            return { kind: "learn", accept: true };
        case "board:dismiss":
            return { kind: "learn", accept: false };
        case "board:why":
            return { kind: "why" };
        default:
            return null;
    }
}
