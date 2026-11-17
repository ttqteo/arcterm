// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The find bar over a session opened from a search hit (Conversation History's detail, sessionsdetail.tsx), and the
// painting of its matches. The matches are counted over the entries' text (transcriptfind.ts); this paints the ones
// CompactTranscript has drawn through the CSS Custom Highlight API, as docfindbar.tsx does for a document, so the
// transcript's markup is never rewrapped, and centres the current one. Ported from the kael fork's FindBar.

import { formatChordString } from "@/util/keysym";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { joinParts, partAt } from "./docfind";
import { findRanges } from "./sessionsfind";
import { findPosLabel, type FindMatch } from "./transcriptfind";

const HIGHLIGHT_ALL = "session-find";
const HIGHLIGHT_CURRENT = "session-find-current";
// what a person never reads in a message: its "Show more" button, a code block's line numbers and head
const SKIP = "button,.select-none";
// the elements whose text is one block: a match never runs from one into the next
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,pre,td,th,blockquote,dt,dd,figcaption,summary,div";
const BTN =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";

const highlights = () => (typeof CSS !== "undefined" ? CSS.highlights : undefined);

// the DOM ranges of the matches in the text drawn under `el`: its text nodes joined block by block, searched as the
// count is (findRanges), and each match mapped back to the node and offset it starts and ends in
function elementRanges(el: HTMLElement, terms: string[]): Range[] {
    const skipped = (n: Node) => {
        const at = n.parentElement?.closest(SKIP);
        return at != null && el.contains(at);
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, (n) =>
        skipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    );
    const nodes: Text[] = [];
    const parts: { text: string; block: unknown }[] = [];
    for (let n = walker.nextNode(); n != null; n = walker.nextNode()) {
        const t = n as Text;
        nodes.push(t);
        parts.push({ text: t.data, block: t.parentElement?.closest(BLOCKS) ?? el });
    }
    const { text, starts } = joinParts(parts);
    return findRanges(text, terms).map(([start, end]) => {
        // a match never holds a block separator, so its first and last characters are in nodes
        const a = partAt(starts, start);
        const b = partAt(starts, end - 1);
        const range = document.createRange();
        range.setStart(nodes[a], start - starts[a]);
        range.setEnd(nodes[b], end - starts[b]);
        return range;
    });
}

// A long prompt is drawn six lines tall behind a "Show more" (PromptText, narrationtimeline.tsx), which clips a match
// below them: open it. True when it did, and the match is centred once the message has grown (the DOM change paints again).
function openClamped(range: Range): boolean {
    const el = range.startContainer.parentElement?.closest("[data-find-entry]");
    const more = [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Show more");
    if (more == null || range.getBoundingClientRect().bottom <= more.getBoundingClientRect().top) {
        return false;
    }
    more.click();
    return true;
}

// scrolls `range` to the middle of the scroller
function centre(scroller: HTMLElement, range: Range) {
    const box = range.getBoundingClientRect();
    if (box.height === 0) {
        return;
    }
    const view = scroller.getBoundingClientRect();
    scroller.scrollTop += box.top - view.top - (view.height - box.height) / 2;
}

/** Paints the matches of `terms` in the messages drawn under `scrollRef` (the elements with data-find-entry) while `on`:
 *  every one as `session-find`, the current one (`current`, an entry and which of its matches) as `session-find-current`.
 *  The messages drawn change (CompactTranscript draws earlier items back, a running session appends), so it paints again
 *  on each change of the DOM under the scroller. It centres the current match once per `centreKey`, as soon as its
 *  message is drawn: a re-read that redraws every range does not snap the reader back. */
export function useFindPaint(
    scrollRef: RefObject<HTMLElement | null>,
    on: boolean,
    terms: string[],
    current: FindMatch | null,
    centreKey: number
) {
    const termsKey = JSON.stringify(terms);
    // read when painting, so a step to another match repaints without running the effect (and centring) again
    const currentRef = useRef(current);
    currentRef.current = current;
    useEffect(() => {
        const root = scrollRef.current;
        const registry = highlights();
        if (!on || root == null || registry == null) {
            return;
        }
        let raf = 0;
        let centred = false;
        const paint = () => {
            raf = 0;
            const want = currentRef.current;
            const all: Range[] = [];
            let now: Range | undefined;
            for (const el of root.querySelectorAll<HTMLElement>("[data-find-entry]")) {
                const ranges = elementRanges(el, terms);
                if (want != null && Number(el.dataset.findEntry) === want.entry) {
                    // the count is over the entry's raw text and this over what it drew: they differ only where markdown
                    // syntax holds a term, so a match past the drawn ones falls back to the last drawn
                    now = ranges[Math.min(want.nth, ranges.length - 1)];
                }
                all.push(...ranges);
            }
            registry.set(HIGHLIGHT_ALL, new Highlight(...all.filter((r) => r !== now)));
            const cur = new Highlight(...(now != null ? [now] : []));
            cur.priority = 1;
            registry.set(HIGHLIGHT_CURRENT, cur);
            if (!centred && now != null && !openClamped(now)) {
                centred = true;
                centre(root, now);
            }
        };
        paint();
        const observer = new MutationObserver(() => {
            if (raf === 0) {
                raf = requestAnimationFrame(paint);
            }
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        return () => {
            observer.disconnect();
            cancelAnimationFrame(raf);
            registry.delete(HIGHLIGHT_ALL);
            registry.delete(HIGHLIGHT_CURRENT);
        };
    }, [on, termsKey, centreKey]);
}

/** The bar: the query (editable, to refine the find), "2 / 7" or "No matches", previous and next, close. Enter and
 *  Shift+Enter step, Esc closes. `total` is null while the transcript is still being read. `focusOn` changes when
 *  another result opens, which takes the focus back to the query. */
export function SessionFindBar({
    text,
    onText,
    pos,
    total,
    onStep,
    onClose,
    focusOn,
}: {
    text: string;
    onText: (v: string) => void;
    pos: number;
    total: number | null;
    onStep: (dir: 1 | -1) => void;
    onClose: () => void;
    focusOn: unknown;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [focusOn]);
    const none = !total;
    return (
        // a row of its own above the scroller (so it never covers the transcript's pinned prompt), in the transcript's
        // own column: CompactTranscript is max 760px wide, centred
        <div className="flex-none px-4 pb-2">
            <div
                data-session-find
                role="search"
                className="mx-auto flex w-full max-w-[760px] items-center gap-0.5 rounded-[8px] border border-edge-mid bg-surface-raised py-[3px] pl-2.5 pr-[3px]"
            >
                <Search size={13} className="mr-1.5 flex-none text-muted" aria-hidden />
                <input
                    ref={inputRef}
                    data-session-find-input
                    aria-label="Find in this conversation"
                    spellCheck={false}
                    value={text}
                    onChange={(e) => onText(e.target.value)}
                    onKeyDown={(e) => {
                        // an input method's Enter ends the word it is composing
                        if (e.nativeEvent.isComposing) {
                            return;
                        }
                        if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose();
                        } else if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            onStep(e.shiftKey ? -1 : 1);
                        }
                    }}
                    className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] text-primary outline-none placeholder:text-muted"
                />
                <span
                    data-find-pos
                    aria-live="polite"
                    className="whitespace-nowrap px-1.5 text-[11px] tabular-nums text-muted"
                >
                    {findPosLabel(pos, total)}
                </span>
                {/* a press keeps the caret in the input */}
                <button
                    type="button"
                    aria-label="Previous match"
                    title={`Previous match (${formatChordString("Shift:Enter")})`}
                    disabled={none}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onStep(-1)}
                    className={BTN}
                >
                    <ChevronUp size={14} aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label="Next match"
                    title="Next match (Enter)"
                    disabled={none}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onStep(1)}
                    className={BTN}
                >
                    <ChevronDown size={14} aria-hidden />
                </button>
                <button type="button" aria-label="Close find" title="Close (Esc)" onClick={onClose} className={BTN}>
                    <X size={13} aria-hidden />
                </button>
            </div>
        </div>
    );
}
