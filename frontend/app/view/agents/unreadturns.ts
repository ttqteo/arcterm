// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: Chat's side of the unread count (unreadagents.ts). An agent showing Chat is not read at sight: its N unread
// turns are the last N turns its Chat finds, Chat opens at the first of them under an "N new turns" rule, and each one
// counts as read once the last line of its reply has entered the view. The count then drops by the turns read. Wakes
// that leave no item (a scheduled wakeup, a hook continue) can make N larger than the turns found: N is clamped to
// them, and the leftover goes with the last one found. No React, no DOM.

import type { ChatItem } from "./chatmodel";

/** One turn of a conversation, by item key: the item that set the agent working, and the last item of its reply. */
export interface ChatTurn {
    start: string;
    end: string;
}

// what sets the agent working: a message you typed, one arcterm typed, or a finished background task that woke it. A
// command that starts no turn (`!` bash, /btw's side answer, a panel only Claude Code's screen drew) is no boundary;
// one that prints and starts nothing (/model) bounds a stretch with no reply, which is no turn
function startsTurn(item: ChatItem): boolean {
    switch (item.kind) {
        case "you":
            return !("command" in item) || !(item.command.startsWith("!") || item.terminal || item.btw != null);
        case "sent":
            return true;
        case "marker":
            return item.item.kind === "notification";
        default:
            return false;
    }
}

/** Pure: the turns of a conversation, oldest first. Each runs from an item that set the agent working up to the next
 *  one, and ends at the last of the agent's items in it; a stretch with no reply of the agent's is no turn. */
export function chatTurns(items: readonly ChatItem[]): ChatTurn[] {
    const out: ChatTurn[] = [];
    let start: string | null = null;
    let end: string | null = null;
    const close = () => {
        if (start != null && end != null) {
            out.push({ start, end });
        }
    };
    for (const item of items) {
        if (startsTurn(item)) {
            close();
            start = item.key;
            end = null;
        } else if (item.kind === "agent" && start != null) {
            end = item.key;
        }
    }
    close();
    return out;
}

/** Pure: the unread turns, the last `count` of `turns` (all of them when `count` is larger). */
export function unreadTurns(turns: readonly ChatTurn[], count: number): ChatTurn[] {
    return count > 0 ? turns.slice(Math.max(0, turns.length - count)) : [];
}

// how far up from an item's bottom edge its last line starts (px): the line has entered the view once this much of the
// item's bottom is above the view's
export const LAST_LINE_PX = 20;

/** Pure: how many of the `unread` turns are read: each whose reply's last line is in the view or above it (`endBottom`
 *  is the bottom edge of its last item, null when that is not drawn), or every one once the view is at the end. */
export function turnsRead(
    unread: readonly ChatTurn[],
    endBottom: (key: string) => number | null,
    viewBottom: number,
    atEnd: boolean
): number {
    if (atEnd) {
        return unread.length;
    }
    let n = 0;
    for (const turn of unread) {
        const bottom = endBottom(turn.end);
        if (bottom != null && bottom - LAST_LINE_PX <= viewBottom) {
            n++;
        }
    }
    return n;
}

/** Pure: the count once `read` of the `found` unread turns Chat found are read: 0 once all of them are (any leftover
 *  never found goes with them), else `count` less `read`. */
export function countAfterRead(count: number, found: number, read: number): number {
    return read >= found ? 0 : Math.max(0, count - read);
}

/** Pure: the rule's label over the first unread turn, in the conversation's language (chatsuggest.ts writesVietnamese). */
export function unreadRuleLabel(n: number, vi: boolean): string {
    if (vi) {
        return `${n} lượt mới`;
    }
    return n === 1 ? "1 new turn" : `${n} new turns`;
}
