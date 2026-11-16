// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reply to text selected in Chat's conversation (chatquote.ts): the passage goes into the agent's chat box as a quote,
// the caret under it. Two ways in: a small ↩ button diagonally off the selection's top-right corner (its bottom-right
// when the pane has no room above), so it never covers the words it would quote or the ones after them, and a right-click on the selection, which opens a menu of Reply and Copy. It takes any text
// in the conversation, Claude's reply, your message or a tool's output alike, and only while the agent has a chat box to
// take it. A right-click off the selection, or with nothing selected, leaves the row's own menu (Copy text, Fork from
// here…) as it was. The button is drawn fixed in a portal, so no row's layout or transform moves it, and follows the
// selection as the conversation scrolls. QuoteMenu is the same over any box (a council's chat, councilchat.tsx): the
// box is named by `target`, given the selection.

import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { Copy, Reply } from "lucide-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { chatBoxText, hasChatBox, replaceChatBox } from "./chatinsert";
import { withQuote } from "./chatquote";

const BTN = 22;
// how far the button sits off the selection's corner, across and up
const CORNER_GAP = 2;

function editable(node: Node | null): boolean {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("input,textarea,[contenteditable='true'],[contenteditable='']") != null;
}

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
 *  `ready` false hides the button and leaves the row's own menu; `write` false keeps the selection, as nothing took
 *  the quote. */
export interface QuoteTarget {
    ready: (range: Range) => boolean;
    read: (range: Range) => string;
    write: (text: string, range: Range) => boolean;
}

type Picked = { range: Range; text: string };

// the current selection, when it is text of the conversation a box can take; null otherwise
function picked(root: HTMLElement, target: QuoteTarget): Picked | null {
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
    return text.trim() === "" ? null : { range: range.cloneRange(), text };
}

// the selection, when a press at (x, y) lands on it
function pickedAt(root: HTMLElement, target: QuoteTarget, x: number, y: number): Picked | null {
    const p = picked(root, target);
    const pad = 4;
    const on =
        p != null &&
        Array.from(p.range.getClientRects()).some(
            (r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
        );
    return on ? p : null;
}

function reply(target: QuoteTarget, p: Picked) {
    const next = withQuote(target.read(p.range), p.text);
    if (target.write(next, p.range)) {
        window.getSelection()?.removeAllRanges();
    }
}

export function QuoteMenu({ rootRef, target }: { rootRef: RefObject<HTMLElement>; target: QuoteTarget }) {
    const [at, setAt] = useState<{ top: number; left: number } | null>(null);

    // the button: diagonally off the selection's top-right corner (its widest line's end), the bottom-right corner when
    // the pane has no room above; held inside the pane
    useEffect(() => {
        const update = () => {
            const root = rootRef.current;
            const p = root != null ? picked(root, target) : null;
            const rects = p != null ? Array.from(p.range.getClientRects()).filter((r) => r.width > 0) : [];
            const first = rects[0];
            const last = rects[rects.length - 1];
            if (root == null || p == null || first == null || last == null) {
                setAt(null);
                return;
            }
            // the pane the passage scrolls in (a council's channel or thread, inside the root), else the root's
            const start = p.range.startContainer;
            const from = start instanceof HTMLElement ? start : start.parentElement;
            const view = (from != null && root.contains(from)
                ? scrollParent(from)
                : scrollParent(root)
            )?.getBoundingClientRect() ?? {
                top: 0,
                bottom: window.innerHeight,
                left: 0,
                right: window.innerWidth,
            };
            if (last.bottom < view.top || first.top > view.bottom - 28) {
                setAt(null);
                return;
            }
            // diagonal off the selection's corner: its widest line's right end, a hair out
            const right = Math.max(...rects.map((r) => r.right));
            const above = first.top - BTN - CORNER_GAP;
            const top = above >= view.top + 4 ? above : last.bottom + CORNER_GAP;
            if (top + BTN > view.bottom - 4) {
                setAt(null);
                return;
            }
            setAt({
                top,
                left: Math.min(Math.max(right + CORNER_GAP, view.left + 8), view.right - BTN - 8),
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

    // the right-click menu
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
            const p = held !== undefined ? held : root != null ? pickedAt(root, target, e.clientX, e.clientY) : null;
            held = undefined;
            if (root == null || p == null) {
                return;
            }
            // before the row's own menu (React's handler on the root) sees it
            e.preventDefault();
            e.stopPropagation();
            globalStore.set(contextMenuAtom, {
                items: [
                    {
                        label: "Reply",
                        sublabel: "quote it in the box",
                        icon: <Reply size={15} />,
                        click: () => reply(target, p),
                        attrs: { "data-chat-quote": "" },
                    },
                    {
                        label: "Copy",
                        icon: <Copy size={15} />,
                        click: () => void navigator.clipboard.writeText(p.text),
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

    if (at == null) {
        return null;
    }
    const press = () => {
        const root = rootRef.current;
        const p = root != null ? picked(root, target) : null;
        if (p != null) {
            reply(target, p);
        }
        setAt(null);
    };
    return createPortal(
        <button
            type="button"
            data-chat-quote-button
            title="Reply: quote the selection in the box"
            aria-label="Reply"
            // keep the selection: a press would otherwise collapse it before the click
            onMouseDown={(e) => e.preventDefault()}
            onClick={press}
            style={{ top: at.top, left: at.left, width: BTN, height: BTN }}
            className={cn(
                "fixed z-50 flex cursor-pointer items-center justify-center rounded-[6px] border border-border p-0",
                "bg-surface-raised text-secondary shadow-popover-sm hover:bg-surface-hover hover:text-accent"
            )}
        >
            <Reply size={13} strokeWidth={2.2} aria-hidden />
        </button>,
        document.body
    );
}
