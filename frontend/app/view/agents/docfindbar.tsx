// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The find bar over the File tab's Preview of a markdown file (docfind.ts is the model): it reads the rendered
// document's text from its text nodes, paints every match through the CSS Custom Highlight API, so the markdown is
// never rewrapped, and scrolls the current match into view.

import { cn } from "@/util/util";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { findMatches, firstInView, joinParts, matchCount, partAt, stepMatch, type TextMatch } from "./docfind";

const HIGHLIGHT_ALL = "doc-find";
const HIGHLIGHT_CURRENT = "doc-find-current";
// MdDoc's own cards, buttons and marks: not the document, and their changes do not change it
const OURS = "[data-md-slot],[data-md-overlay]";
// nor a code block's line numbers and header
const SKIP = `${OURS},.select-none`;
// the elements whose text is one block: a match never runs from one into the next
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,pre,td,th,blockquote,dt,dd,figcaption,summary,div";
// the bar sits over the top of the view: a match under it is not in view
const BAR_CLEAR = 48;
const BTN =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";

interface DocText {
    nodes: Text[];
    text: string;
    starts: number[];
}

const highlights = () => (typeof CSS !== "undefined" ? CSS.highlights : undefined);

function readDoc(root: HTMLElement): DocText {
    const skipped = (n: Node) => {
        const at = n.parentElement?.closest(SKIP);
        return at != null && root.contains(at);
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, (n) =>
        skipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    );
    const nodes: Text[] = [];
    const parts: { text: string; block: unknown }[] = [];
    for (let n = walker.nextNode(); n != null; n = walker.nextNode()) {
        const t = n as Text;
        nodes.push(t);
        parts.push({ text: t.data, block: t.parentElement?.closest(BLOCKS) ?? root });
    }
    return { nodes, ...joinParts(parts) };
}

function rangeOf(doc: DocText, m: TextMatch): Range {
    // a match never holds a separator, so its last character is in a node
    const a = partAt(doc.starts, m.start);
    const b = partAt(doc.starts, m.end - 1);
    const range = document.createRange();
    range.setStart(doc.nodes[a], m.start - doc.starts[a]);
    range.setEnd(doc.nodes[b], m.end - doc.starts[b]);
    return range;
}

// a change only to MdDoc's own cards and buttons (a hover's +) leaves the document's text as it was
function ours(r: MutationRecord): boolean {
    const isOurs = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest(OURS) != null;
    const touched = [...r.addedNodes, ...r.removedNodes];
    return isOurs(r.target) || (touched.length > 0 && touched.every(isOurs));
}

// centred, unless it is in view already
function reveal(scroller: HTMLElement, range: Range) {
    const box = range.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.top >= view.top + BAR_CLEAR && box.bottom <= view.bottom - 16) {
        return;
    }
    scroller.scrollTop += box.top - view.top - (view.height - box.height) / 2;
}

// `docRef` holds the File tab's body; the document is its [data-md-doc], the Preview's scroller. `textKey` is the
// text the document was rendered from; `focusKey` changes each time Mod+F asks for the bar again.
export function DocFindBar({
    docRef,
    query,
    onQuery,
    textKey,
    focusKey,
    onClose,
}: {
    docRef: RefObject<HTMLElement | null>;
    query: string;
    onQuery: (q: string) => void;
    textKey: string;
    focusKey: number;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [ranges, setRanges] = useState<Range[]>([]);
    const [current, setCurrent] = useState(-1);
    // the query the matches were found for: a new one starts from the view, the same one read again (the file
    // changed, an image or diagram rendered late) keeps its place
    const foundFor = useRef<string | null>(null);
    const revealNext = useRef(false);
    const scroller = () => docRef.current?.querySelector<HTMLElement>("[data-md-doc]") ?? null;

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [focusKey]);

    useEffect(() => {
        const root = scroller();
        if (root == null) {
            return;
        }
        let raf = 0;
        const find = () => {
            raf = 0;
            const doc = readDoc(root);
            const next = findMatches(doc.text, query).map((m) => rangeOf(doc, m));
            setRanges(next);
            if (foundFor.current !== query) {
                foundFor.current = query;
                const top = root.getBoundingClientRect().top + BAR_CLEAR;
                setCurrent(
                    firstInView(
                        next.map((r) => r.getBoundingClientRect().top),
                        top
                    )
                );
                revealNext.current = true;
            } else {
                setCurrent((c) => (next.length === 0 ? -1 : Math.min(Math.max(c, 0), next.length - 1)));
            }
        };
        find();
        const mo = new MutationObserver((records) => {
            if (records.every(ours)) {
                return;
            }
            if (raf === 0) {
                raf = requestAnimationFrame(find);
            }
        });
        mo.observe(root, { childList: true, subtree: true, characterData: true });
        return () => {
            mo.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [query, textKey]);

    useEffect(() => {
        const registry = highlights();
        if (registry == null) {
            return;
        }
        registry.set(HIGHLIGHT_ALL, new Highlight(...ranges.filter((_, i) => i !== current)));
        const now = new Highlight(...(ranges[current] != null ? [ranges[current]] : []));
        now.priority = 1;
        registry.set(HIGHLIGHT_CURRENT, now);
        return () => {
            registry.delete(HIGHLIGHT_ALL);
            registry.delete(HIGHLIGHT_CURRENT);
        };
    }, [ranges, current]);

    useLayoutEffect(() => {
        if (!revealNext.current) {
            return;
        }
        revealNext.current = false;
        const root = scroller();
        const range = ranges[current];
        if (root != null && range != null) {
            reveal(root, range);
        }
    }, [ranges, current]);

    const step = (delta: 1 | -1) => {
        revealNext.current = true;
        setCurrent((c) => stepMatch(c, ranges.length, delta));
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // an input method's Enter ends the word it is composing
        if (e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "Enter") {
            // not the tab's Mod+Enter, which would send the comments
            e.preventDefault();
            e.stopPropagation();
            step(e.shiftKey ? -1 : 1);
        }
    };
    const none = ranges.length === 0;

    return (
        <div
            data-doc-find
            role="search"
            className="absolute right-3 top-2 z-20 flex items-center gap-0.5 rounded-[7px] border border-edge-mid bg-surface-raised py-[3px] pl-2.5 pr-[3px] shadow-popover-sm"
        >
            <input
                ref={inputRef}
                data-doc-find-input
                aria-label="Find in this file"
                placeholder="Find"
                spellCheck={false}
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="h-6 w-[150px] min-w-0 border-0 bg-transparent p-0 text-[12px] text-primary outline-none placeholder:text-muted"
            />
            <span
                data-doc-find-count
                aria-live="polite"
                className={cn(
                    "whitespace-nowrap px-1.5 text-[11px] tabular-nums text-muted",
                    query.trim() === "" && "invisible"
                )}
            >
                {matchCount(current, ranges.length)}
            </span>
            {/* a press keeps the caret in the input */}
            <button
                type="button"
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
                disabled={none}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => step(-1)}
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
                onClick={() => step(1)}
                className={BTN}
            >
                <ChevronDown size={14} aria-hidden />
            </button>
            <button type="button" aria-label="Close find" title="Close (Esc)" onClick={onClose} className={BTN}>
                <X size={13} aria-hidden />
            </button>
        </div>
    );
}
