// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reply to text selected in Chat's conversation (chatquote.ts), from the right-click menu: a right-click on the
// selection opens a menu of Reply (the passage goes into the agent's chat box as a quote, the caret under it) and Copy.
// It takes any text in the conversation, Claude's reply, your message or a tool's output alike, and only while the agent
// has a chat box to take it. A right-click off the selection, or with nothing selected, leaves the row's own menu (Copy
// text, Fork from here…) as it was. QuoteMenu is the same over any box (a council's chat, councilchat.tsx): the box is
// named by `target`, given the selection.

import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { Copy, Reply } from "lucide-react";
import { useEffect, useMemo, type RefObject } from "react";
import { chatBoxText, hasChatBox, replaceChatBox } from "./chatinsert";
import { withQuote } from "./chatquote";

function editable(node: Node | null): boolean {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("input,textarea,[contenteditable='true'],[contenteditable='']") != null;
}

export function ChatQuoteMenu({ agentId, rootRef }: { agentId: string; rootRef: RefObject<HTMLElement> }) {
    const target = useMemo<QuoteTarget>(
        () => ({
            ready: () => hasChatBox(agentId),
            read: () => chatBoxText(agentId),
            write: (text) => replaceChatBox(agentId, text),
        }),
        [agentId]
    );
    return <QuoteMenu rootRef={rootRef} target={target} />;
}

/** The box a quote goes into, given the selected range (a council has two boxes: the thread's and the channel's).
 *  `ready` false leaves the row's own menu; `write` false keeps the selection, as nothing took the quote. */
export interface QuoteTarget {
    ready: (range: Range) => boolean;
    read: (range: Range) => string;
    write: (text: string, range: Range) => boolean;
}

type Picked = { range: Range; text: string };

// the selection a press at (x, y) lands on, when it is text of the conversation a box can take; null otherwise
function pickedAt(root: HTMLElement, target: QuoteTarget, x: number, y: number): Picked | null {
    const s = window.getSelection();
    if (s == null || s.isCollapsed || s.rangeCount === 0) {
        return null;
    }
    const range = s.getRangeAt(0);
    if (
        !root.contains(range.commonAncestorContainer) ||
        editable(range.commonAncestorContainer) ||
        !target.ready(range)
    ) {
        return null;
    }
    const text = s.toString();
    if (text.trim() === "") {
        return null;
    }
    const pad = 4;
    const on = Array.from(range.getClientRects()).some(
        (r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
    );
    return on ? { range: range.cloneRange(), text } : null;
}

export function QuoteMenu({ rootRef, target }: { rootRef: RefObject<HTMLElement>; target: QuoteTarget }) {
    useEffect(() => {
        // the selection as it was at the press that opens the menu: WebKit selects the word under a right-click before
        // the contextmenu event, so a right-click on a row with nothing selected would otherwise read as one on a
        // selection. undefined: no press seen (the menu key), so the selection as it is now counts
        let held: Picked | null | undefined;
        const inRoot = (e: MouseEvent) => {
            const root = rootRef.current;
            return root != null && e.target instanceof Node && root.contains(e.target) ? root : null;
        };
        const onDown = (e: MouseEvent) => {
            const root = inRoot(e);
            const opens = e.button === 2 || (e.button === 0 && e.ctrlKey);
            held = root != null && opens ? pickedAt(root, target, e.clientX, e.clientY) : undefined;
        };
        const onMenu = (e: MouseEvent) => {
            const root = inRoot(e);
            const picked =
                held !== undefined ? held : root != null ? pickedAt(root, target, e.clientX, e.clientY) : null;
            held = undefined;
            if (root == null || picked == null) {
                return;
            }
            // before the row's own menu (React's handler on the root) sees it
            e.preventDefault();
            e.stopPropagation();
            const reply = () => {
                const next = withQuote(target.read(picked.range), picked.text);
                if (target.write(next, picked.range)) {
                    window.getSelection()?.removeAllRanges();
                }
            };
            globalStore.set(contextMenuAtom, {
                items: [
                    {
                        label: "Reply",
                        sublabel: "quote it in the box",
                        icon: <Reply size={15} />,
                        click: reply,
                        attrs: { "data-chat-quote": "" },
                    },
                    {
                        label: "Copy",
                        icon: <Copy size={15} />,
                        click: () => void navigator.clipboard.writeText(picked.text),
                    },
                ],
                x: e.clientX,
                y: e.clientY,
            });
        };
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("contextmenu", onMenu, true);
        return () => {
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("contextmenu", onMenu, true);
        };
    }, [rootRef, target]);
    return null;
}
