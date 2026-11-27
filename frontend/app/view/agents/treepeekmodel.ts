// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the folded Agent tree's peek: the 20px strip it folds to shows a dot per agent and terminal, and a
// small card opens beside it (a pause on the strip, or Alt held) listing them by project, name and state only, to pick
// one without unfolding the tree. Rows and digits follow the tree's own order (activeNavRows), so the card's numbers are
// the Alt+1..9 the tree shows. No React, no Wave runtime imports.

import { AGENT_DIGITS, isBoardSplitCell, projectLabel, treeNavIds, type ProjectTreeRow } from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";

// a pause on the strip before the card opens, so a pointer crossing from the rail to the terminal never opens it
export const PEEK_OPEN_DELAY_MS = 180;
// the time the pointer has to cross from the strip to the card (or back) before it closes
export const PEEK_CLOSE_GRACE_MS = 150;

// unread: it finished turns you have not read (unreadAgentsAtom), drawn in the accent the tree's unread count wears
export type PeekDot = "asking" | "unread" | "working" | "idle";

export interface PeekRow {
    id: string;
    name: string;
    dot: PeekDot;
    terminal: boolean;
    unread?: number; // its finished turns not read yet, when there are any
    digit?: number; // its Alt digit, for the first AGENT_DIGITS of the tree's order
    // the split it is a cell of (the split's project), with whether that split is the one on screen: the card frames a
    // split's rows together and the strip joins its dots, as the tree draws a split as one row
    split?: { key: string; shown: boolean };
    // a board's cell of a split: no agent, so no digit; a click picks the split's first agent (`pick`), which brings the
    // split up, as the tree's board cell does for a split off screen
    board?: { pick: string };
}

export interface PeekGroup {
    project: string;
    label: string;
    rows: PeekRow[];
}

function dotOf(vm: AgentVM, unread: number): PeekDot {
    if (vm.kind === "terminal") {
        return vm.running ? "working" : "idle";
    }
    // a sleeping agent that kept its question (sleeping.asking) still waits on you; one asleep without the mark has no
    // process to ask with, so it reads like any sleeper
    if (vm.state === "asking" && (!vm.sleeping || vm.sleeping.asking)) {
        return "asking";
    }
    if (unread > 0) {
        return "unread";
    }
    if (vm.sleeping) {
        return "idle";
    }
    return vm.state;
}

/** Pure: the card's groups, a group per project folder in the tree's order holding the rows it lists there. An id the
 *  roster no longer knows (a service's tab) is left out but keeps its place in the digit count, so a row's digit is
 *  always the Alt+N that reaches it. A folded project folder lists no rows (the tree's order skips it too), so it is
 *  left out. `unread` is each agent's count of finished turns not read (unreadAgentsAtom). */
export function peekGroups(
    rows: readonly ProjectTreeRow[],
    byId: ReadonlyMap<string, AgentVM>,
    nameOf: (vm: AgentVM) => string,
    unread: ReadonlyMap<string, number> = new Map()
): PeekGroup[] {
    const groups: PeekGroup[] = [];
    const seen = new Set<string>();
    let current: PeekGroup | undefined;
    let index = 0;
    const tabRow = (id: string, split?: PeekRow["split"]) => {
        if (seen.has(id)) {
            return;
        }
        seen.add(id);
        index += 1;
        const vm = byId.get(id);
        if (vm == null || current == null) {
            return;
        }
        const unreadCount = unread.get(id) ?? 0;
        current.rows.push({
            id,
            name: nameOf(vm),
            dot: dotOf(vm, unreadCount),
            terminal: vm.kind === "terminal",
            ...(unreadCount > 0 ? { unread: unreadCount } : {}),
            digit: index <= AGENT_DIGITS ? index : undefined,
            ...(split != null ? { split } : {}),
        });
    };
    for (const r of rows) {
        if (r.kind === "group") {
            current = { project: r.project, label: projectLabel(r.project), rows: [] };
            groups.push(current);
            continue;
        }
        if (r.kind !== "split") {
            treeNavIds([r]).forEach((id) => tabRow(id));
            continue;
        }
        // a split's cells in its grid's order, a board's among them; the board takes no place in the digit count
        const split = { key: r.project, shown: r.shown };
        const pick = r.cells.find((c) => !isBoardSplitCell(c))?.id;
        for (const c of r.cells) {
            if (!isBoardSplitCell(c)) {
                tabRow(c.id, split);
            } else if (current != null && pick != null) {
                current.rows.push({
                    id: c.id,
                    name: c.board.name,
                    dot: "idle",
                    terminal: false,
                    split,
                    board: { pick },
                });
            }
        }
    }
    // a split left with one row (its other cells unknown to the roster) is no split to frame
    for (const g of groups) {
        const count = new Map<string, number>();
        g.rows.forEach((row) => row.split != null && count.set(row.split.key, (count.get(row.split.key) ?? 0) + 1));
        g.rows = g.rows.flatMap((row) => {
            if (row.split == null || (count.get(row.split.key) ?? 0) > 1) {
                return [row];
            }
            if (row.board != null) {
                return [];
            }
            const { split: _split, ...alone } = row;
            return [alone];
        });
    }
    return groups.filter((g) => g.rows.length > 0);
}

export interface PeekStripDot {
    id: string;
    dot: PeekDot;
    gapBefore: boolean;
    board: boolean; // a board's cell: a small square, not a status dot
}

// the strip's dots, grouped: one dot alone, or a split's dots together, which the strip draws joined
export interface PeekStripItem {
    key: string;
    split?: { key: string; shown: boolean };
    gapBefore: boolean;
    dots: PeekStripDot[];
}

/** Pure: the strip's dots, one per row in order, a gap where a new project starts, each alone except a split's, which
 *  run together into one item (a split's rows are consecutive in its group, peekGroups). */
export function peekStripItems(groups: readonly PeekGroup[]): PeekStripItem[] {
    const out: PeekStripItem[] = [];
    groups.forEach((g, gi) =>
        g.rows.forEach((r, ri) => {
            const dot = { id: r.id, dot: r.dot, gapBefore: gi > 0 && ri === 0, board: r.board != null };
            const last = out[out.length - 1];
            if (r.split != null && ri > 0 && last?.split?.key === r.split.key) {
                last.dots.push(dot);
                return;
            }
            out.push({
                key: r.split != null ? `split:${g.project}:${r.split.key}` : r.id,
                ...(r.split != null ? { split: r.split } : {}),
                gapBefore: dot.gapBefore,
                dots: [dot],
            });
        })
    );
    return out;
}

/** Pure: whether the card shows. Only on a folded tree; Alt held shows it at once (the digits are what it is for),
 *  a pointer only after its pause (hoverOpen, set by the timer). */
export function peekShown(input: { folded: boolean; hoverOpen: boolean; altHeld: boolean }): boolean {
    return input.folded && (input.hoverOpen || input.altHeld);
}
