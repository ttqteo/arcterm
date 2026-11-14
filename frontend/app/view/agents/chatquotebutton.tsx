// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Reply button that floats under text selected in Chat's conversation (chatquote.ts): a click puts the passage in
// the agent's chat box as a quote, the caret under it. It shows for any text in the conversation, Claude's reply, your
// message or a tool's output alike, and only while the agent has a chat box to take it. It is drawn fixed in a portal,
// so no row's layout or transform moves it, and follows the selection as the conversation scrolls. QuoteButton is the
// same button over any box (a council's chat, councilchat.tsx): the box is named by `target`, given the selection.

import { cn } from "@/util/util";
import { Reply } from "lucide-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { chatBoxText, hasChatBox, replaceChatBox } from "./chatinsert";
import { withQuote } from "./chatquote";

const BTN_W = 84;

// the nearest ancestor that scrolls: the selection's rect is checked against it, so the button hides with a passage
// scrolled out of the pane instead of pinning to its edge
function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p != null; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") {
            return p;
        }
    }
    return null;
}

function editable(node: Node | null): boolean {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("input,textarea,[contenteditable='true'],[contenteditable='']") != null;
}

export function ChatQuoteButton({ agentId, rootRef }: { agentId: string; rootRef: RefObject<HTMLElement> }) {
    const target = useMemo<QuoteTarget>(
        () => ({
            ready: () => hasChatBox(agentId),
            read: () => chatBoxText(agentId),
            write: (text) => replaceChatBox(agentId, text),
        }),
        [agentId]
    );
    return <QuoteButton rootRef={rootRef} target={target} />;
}

/** The box a quote goes into, given the selected range (a council has two boxes: the thread's and the channel's).
 *  `ready` false hides the button; `write` false keeps the selection, as nothing took the quote. */
export interface QuoteTarget {
    ready: (range: Range) => boolean;
    read: (range: Range) => string;
    write: (text: string, range: Range) => boolean;
}

export function QuoteButton({ rootRef, target }: { rootRef: RefObject<HTMLElement>; target: QuoteTarget }) {
    const [at, setAt] = useState<{ top: number; left: number } | null>(null);
    useEffect(() => {
        const update = () => {
            const root = rootRef.current;
            const s = window.getSelection();
            if (root == null || s == null || s.isCollapsed || s.rangeCount === 0) {
                setAt(null);
                return;
            }
            const range = s.getRangeAt(0);
            if (
                !root.contains(range.commonAncestorContainer) ||
                editable(range.commonAncestorContainer) ||
                !target.ready(range)
            ) {
                setAt(null);
                return;
            }
            if (s.toString().trim() === "") {
                setAt(null);
                return;
            }
            const r = range.getBoundingClientRect();
            // the pane the passage scrolls in (a council's channel or thread, inside the root), else the root's
            const from =
                range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
            const view = (from != null && root.contains(from)
                ? scrollParent(from)
                : scrollParent(root)
            )?.getBoundingClientRect() ?? {
                top: 0,
                bottom: window.innerHeight,
                left: 0,
                right: window.innerWidth,
            };
            if (r.bottom < view.top || r.bottom + 6 > view.bottom - 28) {
                setAt(null);
                return;
            }
            setAt({
                top: r.bottom + 6,
                left: Math.min(Math.max(r.right - BTN_W, view.left + 8), view.right - BTN_W - 8),
            });
        };
        document.addEventListener("selectionchange", update);
        // the conversation scrolls under a kept selection: the button follows it (capture: the scroll is the pane's)
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            document.removeEventListener("selectionchange", update);
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [rootRef, target]);

    if (at == null) {
        return null;
    }
    const reply = () => {
        const s = window.getSelection();
        const range = s != null && s.rangeCount > 0 ? s.getRangeAt(0) : null;
        const next = range != null ? withQuote(target.read(range), s!.toString()) : null;
        if (range != null && next != null && target.write(next, range)) {
            s?.removeAllRanges();
        }
        setAt(null);
    };
    return createPortal(
        <button
            type="button"
            data-chat-quote
            title="Reply to the selection: it goes into the box as a quote"
            // keep the selection: a press would otherwise collapse it before the click
            onMouseDown={(e) => e.preventDefault()}
            onClick={reply}
            style={{ top: at.top, left: at.left, width: BTN_W }}
            className={cn(
                "fixed z-50 flex cursor-pointer items-center justify-center gap-[6px] whitespace-nowrap rounded-[7px] border-0",
                "bg-accent px-[10px] py-[5px] text-[12.5px] font-semibold leading-[1.2] text-background shadow-popover-sm hover:bg-accenthover"
            )}
        >
            <Reply size={13} strokeWidth={2.2} aria-hidden />
            Reply
        </button>,
        document.body
    );
}
