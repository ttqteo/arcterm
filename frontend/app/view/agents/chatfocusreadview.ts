// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Focus read in Chat, the DOM half (chatfocusread.ts is the pure geometry, chatfocusreadstore.ts the toggle and the
// registry). useFocusRead finds the conversation's blocks, marks each `data-fr-block`, the one on the reading line and
// the ones after it up to the chosen size (1 to 5) `data-fr-lit`, the one before that group and the one after it
// `data-fr-near`, and the scroller `data-focus-read` while it dims; the
// opacity is tailwindsetup.css's. Marks, not React state: the line moves on every scroll frame, and a render of the
// conversation per frame would redraw it.
//
// A block is a paragraph, a heading, a leaf list item (or a list item's own line above its nested list, the
// `data-md-li-head` markdownmessage.tsx wraps it in), a code block, a table and your bubble. Every other row or reply
// part (a step list, a card, a marker) is not text: it is marked `data-fr-skip`, dimmed, and never lit, so the line, J/K
// and the settle pass over it. Never marked, so never dimmed and never picked: a reply still being written
// (`data-chat-live`), an item that waits on you (the brainstorm row, a commit card, a handoff card), and the pending
// bubbles, the ask and the local cards, which are in `data-chat-tail`, outside the conversation. A folded reply's Show
// more goes with its last block.

import { useEffect, useRef, type RefObject } from "react";
import {
    fencedText,
    lineOffset,
    litAt,
    litGroup,
    maxScroll,
    nearOf,
    scrollTopFor,
    settleTo,
    stepFrom,
    tableText,
    type Span,
} from "./chatfocusread";
import { registerFocusReader } from "./chatfocusreadstore";
import { chatBoxText, writeChatBox } from "./chatinsert";
import { withQuote } from "./chatquote";

type BlockKind = "text" | "you" | "code" | "table" | "card";

export interface FocusBlock {
    el: HTMLElement;
    kind: BlockKind;
    /** drawn with the block, lit and dimmed with it (a folded reply's Show more) */
    extra: HTMLElement[];
}

// never a block, never walked into: the pinned prompt, Show earlier, the selection's ↩, the selection paint, a copy button
const SKIP =
    "[data-pinned-prompt],[data-chat-earlier],[data-chat-quote-button],[data-md-selection-layer],[data-chat-copy]";
// what waits on you, never dimmed
const WAITS = "[data-chat-brainstorm-row],[data-chat-ccard],[data-chat-hcard-title]";
const LIVE = "[data-chat-live]";
// markdown's own blocks, which a wrapper holding one of them is walked into for
const MD_BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,[data-md-block],[data-md-li-head]";
const TEXT_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6"]);

const BLOCK_ATTR = "data-fr-block";
const LIT_ATTR = "data-fr-lit";
const NEAR_ATTR = "data-fr-near";
const SKIP_ATTR = "data-fr-skip";
const ON_ATTR = "data-focus-read";

function shown(el: Element): el is HTMLElement {
    return el instanceof HTMLElement && el.getClientRects().length > 0;
}

function holdsAny(el: Element, sel: string): boolean {
    return el.matches(sel) || el.querySelector(sel) != null;
}

// the markdown blocks inside a reply part, in order
function proseBlocks(el: Element, out: FocusBlock[]): void {
    for (const child of Array.from(el.children)) {
        if (!shown(child) || child.matches(SKIP)) {
            continue;
        }
        if (child.matches("[data-chat-fold]")) {
            out[out.length - 1]?.extra.push(child);
            continue;
        }
        if (child.matches("[data-md-block]")) {
            const kind =
                child.querySelector("[data-code-line]") != null
                    ? "code"
                    : child.querySelector("table")
                      ? "table"
                      : "card";
            out.push({ el: child, kind, extra: [] });
        } else if (TEXT_TAGS.has(child.tagName) || child.matches("[data-md-li-head]")) {
            out.push({ el: child, kind: "text", extra: [] });
        } else if (child.tagName === "LI" && child.querySelector("li") == null) {
            out.push({ el: child, kind: "text", extra: [] });
        } else if (child.querySelector(MD_BLOCKS) != null) {
            // a list, a quote, a list item holding a list, a wrapper (the markdown root, a council's panel)
            proseBlocks(child, out);
        } else if ((child.textContent ?? "").trim() !== "") {
            out.push({ el: child, kind: "text", extra: [] });
        }
    }
}

/** The conversation's blocks, in document order. */
export function collectBlocks(root: Element): FocusBlock[] {
    const out: FocusBlock[] = [];
    for (const row of Array.from(root.children)) {
        if (!shown(row) || row.matches(SKIP)) {
            continue;
        }
        const reply = row.querySelector(":scope > [data-chat-agent]");
        if (reply != null) {
            for (const part of Array.from(reply.children)) {
                if (!shown(part) || holdsAny(part, LIVE) || holdsAny(part, WAITS)) {
                    continue;
                }
                const prose = part.querySelector("[data-chat-prose]");
                if (prose != null) {
                    proseBlocks(prose, out);
                } else {
                    out.push({ el: part, kind: "card", extra: [] });
                }
            }
            continue;
        }
        if (holdsAny(row, LIVE) || holdsAny(row, WAITS)) {
            continue;
        }
        const you = row.querySelector("[data-chat-you][data-user-prompt]");
        out.push({ el: row, kind: you != null ? "you" : "card", extra: [] });
    }
    return out;
}

/** What Q puts in the box for a block, before it is made a quote: its text as rendered, a code block fenced, a table
 *  rebuilt; null for a card or a step list, where Q does nothing. */
export function quoteTextOf(block: FocusBlock): string | null {
    switch (block.kind) {
        case "text":
            return block.el.innerText;
        case "you": {
            // the bubble's words, not the file cards under it
            const bubble = block.el.querySelector("[data-chat-you][data-user-prompt]")?.firstElementChild;
            return bubble instanceof HTMLElement ? bubble.innerText : null;
        }
        case "code": {
            const lines = Array.from(block.el.querySelectorAll("[data-code-line]")).map((l) => l.textContent ?? "");
            return fencedText(block.el.getAttribute("data-md-lang") ?? "", lines);
        }
        case "table": {
            const rows = Array.from(block.el.querySelectorAll("tr")).map((tr) =>
                Array.from(tr.querySelectorAll("th,td")).map((c) => (c as HTMLElement).innerText)
            );
            return tableText(rows);
        }
        case "card":
            return null;
    }
}

function spanOf(el: HTMLElement, scroller: HTMLElement, top: number): Span {
    const r = el.getBoundingClientRect();
    return { top: r.top - top + scroller.scrollTop, bottom: r.bottom - top + scroller.scrollTop };
}

function reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// at most one collect per this many ms: a reply streaming in mutates the conversation every frame
const COLLECT_MS = 120;
// when there is no scrollend, a scroll counts as stopped after this much quiet
const IDLE_MS = 140;
// a programmatic scroll that never reports its end lets go after this
const PROGRAMMATIC_MS = 1200;

/** Focus read over one Chat scroller: `on` is the toggle, `paused` holds the dimming off (while you follow a live reply
 *  at the bottom) with the keys still working, `size` how many blocks the line lights at a time (the one on it and the
 *  ones after it; J/K slide it one block). `tickRef` is the accent tick in the gutter that marks the line. */
export function useFocusRead(
    agentId: string,
    scrollRef: RefObject<HTMLDivElement | null>,
    tickRef: RefObject<HTMLDivElement | null>,
    on: boolean,
    paused: boolean,
    size: number = 1
): void {
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const sizeRef = useRef(size);
    // the running machinery's way to show or hide the dimming when `paused` flips
    const applyPaused = useRef<() => void>(() => {});
    // and to light a group of the new size when `size` changes
    const applySize = useRef<(next: number) => void>(() => {});

    useEffect(() => {
        const scroller = scrollRef.current;
        if (!on || scroller == null) {
            return;
        }
        // the text blocks the line lights and J/K step through, and the rows that are not text, dimmed and passed over
        let blocks: FocusBlock[] = [];
        let skipped: FocusBlock[] = [];
        let spans: Span[] = [];
        let lit = -1;
        let programmatic = false;
        let programmaticTimer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let frame = 0;
        let collectTimer: ReturnType<typeof setTimeout> | undefined;
        let lastCollect = 0;
        // the conversation root the size observer watches: it is a new element when the transcript reloads
        let watched: Element | null = null;
        let watchConv: (conv: Element | null) => void = () => {};

        const marked = (b: FocusBlock) => [b.el, ...b.extra];
        // the lit group's marks (`lit` is its first block) and its neighbours', put on or taken off
        const paint = (put: boolean) => {
            const size = sizeRef.current;
            const marks: [number, string][] = [
                ...litGroup(lit, blocks.length, size).map((i): [number, string] => [i, LIT_ATTR]),
                ...nearOf(lit, blocks.length, size).map((i): [number, string] => [i, NEAR_ATTR]),
            ];
            for (const [i, attr] of marks) {
                const b = blocks[i];
                if (b == null) {
                    continue;
                }
                for (const el of marked(b)) {
                    if (put) {
                        el.setAttribute(attr, "");
                    } else {
                        el.removeAttribute(attr);
                    }
                }
            }
        };
        const setLit = (next: number) => {
            paint(false);
            lit = next;
            paint(true);
        };
        const line = () => lineOffset(scroller.clientHeight);
        const pickFromLine = () => setLit(litAt(spans, scroller.scrollTop + line()));

        const placeTick = () => {
            const tick = tickRef.current;
            if (tick == null) {
                return;
            }
            const conv = scroller.querySelector("[data-chat-conversation]");
            if (conv == null || pausedRef.current || blocks.length === 0) {
                tick.style.display = "none";
                return;
            }
            const base = scroller.getBoundingClientRect();
            tick.style.display = "block";
            tick.style.top = `${line()}px`;
            tick.style.left = `${Math.max(4, conv.getBoundingClientRect().left - base.left - 12)}px`;
        };
        applyPaused.current = () => {
            if (pausedRef.current) {
                scroller.removeAttribute(ON_ATTR);
            } else {
                scroller.setAttribute(ON_ATTR, "");
            }
            placeTick();
        };

        // the blocks and where they are; the lit one stays lit while it is still drawn, else the line picks again
        const collect = () => {
            lastCollect = Date.now();
            const conv = scroller.querySelector("[data-chat-conversation]");
            watchConv(conv);
            const all = conv != null ? collectBlocks(conv) : [];
            const next = all.filter((b) => b.kind !== "card");
            const nextSkipped = all.filter((b) => b.kind === "card");
            const keep = new Set(next.flatMap(marked));
            const keepSkipped = new Set(nextSkipped.flatMap(marked));
            const litEl = lit >= 0 ? blocks[lit]?.el : undefined;
            paint(false);
            for (const el of blocks.flatMap(marked)) {
                if (!keep.has(el)) {
                    el.removeAttribute(BLOCK_ATTR);
                }
            }
            for (const el of skipped.flatMap(marked)) {
                if (!keepSkipped.has(el)) {
                    el.removeAttribute(SKIP_ATTR);
                }
            }
            blocks = next;
            skipped = nextSkipped;
            for (const el of keep) {
                el.setAttribute(BLOCK_ATTR, "");
            }
            for (const el of keepSkipped) {
                el.setAttribute(SKIP_ATTR, "");
            }
            const top = scroller.getBoundingClientRect().top;
            spans = blocks.map((b) => spanOf(b.el, scroller, top));
            const again = litEl != null ? blocks.findIndex((b) => b.el === litEl) : -1;
            lit = -1;
            if (again >= 0) {
                setLit(again);
            } else {
                pickFromLine();
            }
            placeTick();
        };
        const scheduleCollect = () => {
            if (collectTimer != null) {
                return;
            }
            const wait = Math.max(0, COLLECT_MS - (Date.now() - lastCollect));
            collectTimer = setTimeout(() => {
                collectTimer = undefined;
                collect();
            }, wait);
        };

        const scrollTo = (top: number) => {
            if (Math.abs(top - scroller.scrollTop) <= 1) {
                return;
            }
            programmatic = true;
            clearTimeout(programmaticTimer);
            programmaticTimer = setTimeout(() => (programmatic = false), PROGRAMMATIC_MS);
            scroller.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
        };
        // a scroll stopped: one of ours ends there; one of the reader's settles the nearest block onto the line
        const stopped = () => {
            if (programmatic) {
                programmatic = false;
                clearTimeout(programmaticTimer);
                return;
            }
            pickFromLine();
            const settle = settleTo(spans, scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight);
            if (settle != null) {
                setLit(settle.index);
                scrollTo(settle.top);
            }
        };
        const hasScrollEnd = "onscrollend" in scroller;
        const onScroll = () => {
            if (!hasScrollEnd) {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(stopped, IDLE_MS);
            }
            if (programmatic) {
                return;
            }
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(pickFromLine);
        };
        // the reader taking the wheel or the bar mid-way through one of ours: theirs from here
        const onIntent = () => {
            programmatic = false;
        };

        scroller.addEventListener("scroll", onScroll, { passive: true });
        if (hasScrollEnd) {
            scroller.addEventListener("scrollend", stopped);
        }
        scroller.addEventListener("wheel", onIntent, { passive: true });
        scroller.addEventListener("touchstart", onIntent, { passive: true });
        scroller.addEventListener("pointerdown", onIntent);
        // a change inside the tail or a reply still being written moves no block: only what changes elsewhere collects
        const mo = new MutationObserver((records) => {
            if (records.some((r) => (r.target as Element).closest?.(`[data-chat-tail],${LIVE}`) == null)) {
                scheduleCollect();
            }
        });
        mo.observe(scroller, { childList: true, subtree: true });
        // the scroller's size moves the line; the conversation's size (a picture loading, a fold) moves the blocks
        const ro = new ResizeObserver(scheduleCollect);
        watchConv = (conv) => {
            if (conv === watched) {
                return;
            }
            watched = conv;
            ro.disconnect();
            ro.observe(scroller);
            if (conv != null) {
                ro.observe(conv);
            }
        };
        collect();
        applyPaused.current();

        applySize.current = (next) => {
            paint(false);
            sizeRef.current = next;
            paint(true);
        };

        const unregister = registerFocusReader(agentId, {
            step: (dir) => {
                const from = lit >= 0 ? lit : litAt(spans, scroller.scrollTop + line());
                const n = stepFrom(from, dir, blocks.length, sizeRef.current);
                if (n == null) {
                    return;
                }
                setLit(n);
                scrollTo(scrollTopFor(spans[n], line(), maxScroll(scroller.scrollHeight, scroller.clientHeight)));
            },
            // the lit group as one quote, its blocks a blank quoted line apart; a step list or a card in it adds nothing
            quote: () => {
                const texts = litGroup(lit, blocks.length, sizeRef.current)
                    .map((i) => quoteTextOf(blocks[i]))
                    .filter((t): t is string => t != null && t.trim() !== "");
                const next = texts.length > 0 ? withQuote(chatBoxText(agentId), texts.join("\n\n")) : null;
                if (next != null) {
                    writeChatBox(agentId, next);
                }
            },
        });

        return () => {
            unregister();
            applyPaused.current = () => {};
            applySize.current = () => {};
            scroller.removeEventListener("scroll", onScroll);
            scroller.removeEventListener("scrollend", stopped);
            scroller.removeEventListener("wheel", onIntent);
            scroller.removeEventListener("touchstart", onIntent);
            scroller.removeEventListener("pointerdown", onIntent);
            mo.disconnect();
            ro.disconnect();
            cancelAnimationFrame(frame);
            clearTimeout(collectTimer);
            clearTimeout(idleTimer);
            clearTimeout(programmaticTimer);
            for (const el of blocks.flatMap(marked)) {
                el.removeAttribute(BLOCK_ATTR);
                el.removeAttribute(LIT_ATTR);
                el.removeAttribute(NEAR_ATTR);
            }
            for (const el of skipped.flatMap(marked)) {
                el.removeAttribute(SKIP_ATTR);
            }
            scroller.removeAttribute(ON_ATTR);
            if (tickRef.current != null) {
                tickRef.current.style.display = "none";
            }
        };
    }, [on, agentId]);

    useEffect(() => {
        applyPaused.current();
    }, [paused]);

    useEffect(() => {
        if (size !== sizeRef.current) {
            applySize.current(size);
            sizeRef.current = size;
        }
    }, [size]);
}
