// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat reads its agent's unread turns (unreadturns.ts) as the reader scrolls: at most once a frame, on a scroll or a
// change of the conversation's size, it finds the unread turns whose reply's last line has entered the view and drops
// the agent's count by them (unreadagentsstore.ts readTurns). Only while the agent is on screen with the window
// focused, and not before the conversation went where it opens (`armed`): a view still at the end it first drew would
// read every turn at once.

import { useEffect, useMemo, type RefObject } from "react";
import { isNearBottom } from "./agentsviewmodel";
import type { ChatItem } from "./chatmodel";
import { scrollParent } from "./pinnedpromptbar";
import { readTurns } from "./unreadagentsstore";
import { chatTurns, countAfterRead, turnsRead, unreadTurns } from "./unreadturns";

/** What a conversation knows of its agent's unread turns (ChatConversation's `unread`). */
export interface ChatUnread {
    agentId: string;
    // the count when the agent came on screen, and which time that was: the conversation opens at the first of those
    // turns under the rule. Null when nothing was unread then
    open: { count: number; seq: number } | null;
    count: number; // the count now
    canRead: boolean; // on screen with the window focused
    vi: boolean; // the conversation is in Vietnamese: the rule's label is too
}

export function useUnreadReading(
    rootRef: RefObject<HTMLDivElement | null>,
    items: readonly ChatItem[],
    unread: ChatUnread | undefined,
    armed: boolean
): void {
    const turns = useMemo(() => chatTurns(items), [items]);
    const agentId = unread?.agentId;
    const count = unread?.count ?? 0;
    const canRead = unread?.canRead === true;
    useEffect(() => {
        const root = rootRef.current;
        const scroller = scrollParent(root);
        if (agentId == null || count === 0 || !canRead || !armed || root == null || scroller == null) {
            return;
        }
        let frame = 0;
        const check = () => {
            frame = 0;
            if (scroller.clientHeight === 0) {
                return;
            }
            const found = unreadTurns(turns, count);
            // the view ends where the dock's padding starts: the box floats over what is under it
            const pad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
            const viewBottom = scroller.getBoundingClientRect().bottom - pad;
            const endBottom = (key: string): number | null =>
                root
                    .querySelector<HTMLElement>(`:scope > [data-chat-item="${CSS.escape(key)}"]`)
                    ?.getBoundingClientRect().bottom ?? null;
            const read = turnsRead(found, endBottom, viewBottom, isNearBottom(scroller));
            readTurns(agentId, countAfterRead(count, found.length, read));
        };
        const schedule = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(check);
            }
        };
        schedule();
        scroller.addEventListener("scroll", schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(root);
        ro.observe(scroller);
        return () => {
            scroller.removeEventListener("scroll", schedule);
            ro.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [rootRef, agentId, count, canRead, armed, turns]);
}
