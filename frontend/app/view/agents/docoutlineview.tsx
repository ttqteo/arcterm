// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Outline button over a rendered document (docoutline.ts is the model): it reads the headings the document
// rendered, and its popover lists them with the one you are reading marked; picking one scrolls there. It shows
// only when the document has two headings or more.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    size as floatingSize,
    offset,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { TableOfContents } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { activeItem, outlineItems, type OutlineItem } from "./docoutline";

const MAX_HEIGHT = 420;
const READ_MARGIN = 24;
const SCROLL_MARGIN = 12;

// a heading's level: the data-outline-level a renderer stamps, element/markdown's is-N class, or the tag
function levelOf(el: HTMLElement): number {
    const stamped = Number(el.dataset.outlineLevel);
    if (stamped > 0) {
        return stamped;
    }
    const cls = /\bis-([1-6])\b/.exec(el.className)?.[1];
    if (cls) {
        return Number(cls);
    }
    return /^H([1-6])$/.exec(el.tagName) ? Number(el.tagName[1]) : 6;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let at = el.parentElement; at != null; at = at.parentElement) {
        const { overflowY } = getComputedStyle(at);
        if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) {
            return at;
        }
    }
    return null;
}

// where el sits in its scroller's content; the review dialog scales while it opens, and rects are measured scaled
function offsetIn(scroller: HTMLElement, el: HTMLElement): number {
    const box = scroller.getBoundingClientRect();
    const scale = box.width / scroller.offsetWidth || 1;
    return (el.getBoundingClientRect().top - box.top) / scale + scroller.scrollTop;
}

export function OutlineButton(p: {
    rootRef: RefObject<HTMLElement | null>;
    // the headings under rootRef
    selector: string;
    // what the document was rendered from: a new one means new headings to read
    textKey: string;
    className?: string;
}) {
    const [items, setItems] = useState<OutlineItem[]>([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const headings = useRef<HTMLElement[]>([]);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const els = [...(p.rootRef.current?.querySelectorAll<HTMLElement>(p.selector) ?? [])];
            headings.current = els;
            setItems(outlineItems(els.map((el) => ({ level: levelOf(el), text: el.textContent ?? "" }))));
        });
        return () => cancelAnimationFrame(frame);
    }, [p.textKey, p.selector]);

    const readActive = () => {
        const els = items.map((it) => headings.current[it.index]).filter((el) => el?.isConnected);
        const scroller = els.length > 0 ? scrollParent(els[0]) : null;
        setActive(
            scroller == null
                ? 0
                : activeItem(
                      els.map((el) => offsetIn(scroller, el)),
                      scroller.scrollTop,
                      READ_MARGIN
                  )
        );
    };

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange(next) {
            if (next) {
                readActive();
            }
            setOpen(next);
        },
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ availableHeight, elements }) {
                    elements.floating.style.setProperty(
                        "--outline-max-height",
                        `${Math.min(MAX_HEIGHT, availableHeight)}px`
                    );
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

    // focus moves into the list, so Escape closes the list and not a dialog the document sits in
    useEffect(() => {
        if (!open) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            const btn = listRef.current?.querySelector<HTMLButtonElement>(
                `[data-outline-item="${Math.max(0, active)}"]`
            );
            btn?.focus({ preventScroll: true });
            btn?.scrollIntoView({ block: "nearest" });
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    if (items.length === 0) {
        return null;
    }

    const go = (it: OutlineItem) => {
        const el = headings.current[it.index];
        const scroller = el?.isConnected ? scrollParent(el) : null;
        setOpen(false);
        if (el == null) {
            return;
        }
        if (scroller == null) {
            el.scrollIntoView({ block: "start", behavior: "smooth" });
            return;
        }
        scroller.scrollTo({ top: Math.max(0, offsetIn(scroller, el) - SCROLL_MARGIN), behavior: "smooth" });
    };

    const onListKey = (e: KeyboardEvent) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
        }
        e.preventDefault();
        const btns = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-outline-item]") ?? [])];
        const at = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = btns[Math.min(btns.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
        next?.focus();
    };

    return (
        <>
            <button
                type="button"
                ref={refs.setReference}
                {...getReferenceProps()}
                data-outline-button
                aria-expanded={open}
                aria-label="Outline"
                title="Outline"
                className={cn(
                    "inline-flex h-[25px] shrink-0 cursor-pointer items-center gap-[5px] rounded-[6px] border border-edge-mid bg-surface-raised px-2 text-[11.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover",
                    open && "border-edge-strong bg-surface-hover text-primary",
                    p.className
                )}
            >
                <TableOfContents size={13} aria-hidden />
                Outline
            </button>
            <FloatingPortal>
                {/* above ModalShell's z-[70] backdrop: the review dialog's document has one */}
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                    <PopoverReveal
                        open={open}
                        origin="top right"
                        className="flex max-h-[var(--outline-max-height)] w-[300px] flex-col overflow-hidden rounded-[11px] border border-border bg-surface shadow-popover-md"
                    >
                        <div className="flex-none px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">
                            Outline
                        </div>
                        <div
                            ref={listRef}
                            data-outline-list
                            onKeyDown={onListKey}
                            className="sc flex min-h-0 flex-col overflow-y-auto px-[5px] pb-[5px]"
                        >
                            {items.map((it, i) => (
                                <button
                                    key={it.index}
                                    type="button"
                                    data-outline-item={i}
                                    data-active={i === active || undefined}
                                    onClick={() => go(it)}
                                    title={it.text}
                                    style={{ paddingLeft: 10 + it.depth * 14 }}
                                    className={cn(
                                        "w-full cursor-pointer truncate rounded-[6px] py-[5px] pr-2.5 text-left text-[12.5px] leading-[1.4] outline-none hover:bg-surface-hover focus-visible:bg-surface-hover",
                                        it.depth === 0 ? "font-semibold text-primary" : "text-secondary",
                                        i === active &&
                                            "bg-accentbg text-primary shadow-[inset_2px_0_0_var(--color-accent)]"
                                    )}
                                >
                                    {it.text}
                                </button>
                            ))}
                        </div>
                    </PopoverReveal>
                </div>
            </FloatingPortal>
        </>
    );
}

// A document pane with the Outline button over its top right corner, for a pane with no header row to hold it.
export function WithOutline(p: { selector: string; textKey: string; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div ref={ref} className="relative h-full min-h-0">
            {p.children}
            <div className="absolute right-4 top-2.5 z-10">
                <OutlineButton rootRef={ref} selector={p.selector} textKey={p.textKey} className="shadow-popover-sm" />
            </div>
        </div>
    );
}

// what each renderer draws its headings as
export const OUTLINE_SELECTOR = {
    // element/markdown.tsx draws a heading as a div.heading.is-N
    markdown: ".heading",
    // MarkdownMessage draws plain h1..h6
    message: "h1, h2, h3, h4, h5, h6",
    tex: "h2[data-outline-level]",
} as const;
