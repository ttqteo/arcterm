// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the folded Agent tree's peek: the 14px strip it folds to shows a dot per agent and terminal, and a
// small card opens beside it (a pause on the strip, or Alt held) listing them by project, name and state only, to pick
// one without unfolding the tree. Rows and digits follow the tree's own order (activeNavRows), so the card's numbers are
// the Alt+1..9 the tree shows. No React, no Wave runtime imports.

import { AGENT_DIGITS, projectLabel, treeNavIds, type ProjectTreeRow } from "./agentsidebarmodel";
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
    if (vm.state === "asking" && !vm.sleeping) {
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
    for (const r of rows) {
        if (r.kind === "group") {
            current = { project: r.project, label: projectLabel(r.project), rows: [] };
            groups.push(current);
            continue;
        }
        for (const id of treeNavIds([r])) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            index += 1;
            const vm = byId.get(id);
            if (vm == null || current == null) {
                continue;
            }
            const unreadCount = unread.get(id) ?? 0;
            current.rows.push({
                id,
                name: nameOf(vm),
                dot: dotOf(vm, unreadCount),
                terminal: vm.kind === "terminal",
                ...(unreadCount > 0 ? { unread: unreadCount } : {}),
                digit: index <= AGENT_DIGITS ? index : undefined,
            });
        }
    }
    return groups.filter((g) => g.rows.length > 0);
}

/** Pure: the strip's dots, one per row in order, with a gap where a new project starts. */
export function peekDots(groups: readonly PeekGroup[]): { id: string; dot: PeekDot; gapBefore: boolean }[] {
    return groups.flatMap((g, gi) => g.rows.map((r, ri) => ({ id: r.id, dot: r.dot, gapBefore: gi > 0 && ri === 0 })));
}

/** Pure: whether the card shows. Only on a folded tree; Alt held shows it at once (the digits are what it is for),
 *  a pointer only after its pause (hoverOpen, set by the timer). */
export function peekShown(input: { folded: boolean; hoverOpen: boolean; altHeld: boolean }): boolean {
    return input.folded && (input.hoverOpen || input.altHeld);
}
