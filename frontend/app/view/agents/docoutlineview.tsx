// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Outline over a rendered document (docoutline.ts is the model): it reads the headings the document rendered,
// and lists them with the one you are reading marked; picking one scrolls there. Either a button whose popover holds
// the list, or a rail of dashes on the document's right edge that opens it on hover (the File tab's). It shows only
// when the document has two headings or more.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    size as floatingSize,
    offset,
    safePolygon,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useHover,
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

// The headings under rootRef, the one you are reading, and a jump to one; shared by the button and the rail.
function useOutline(rootRef: RefObject<HTMLElement | null>, selector: string, textKey: string) {
    const [items, setItems] = useState<OutlineItem[]>([]);
    const [active, setActive] = useState(-1);
    const headings = useRef<HTMLElement[]>([]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const els = [...(rootRef.current?.querySelectorAll<HTMLElement>(selector) ?? [])];
            headings.current = els;
            setItems(outlineItems(els.map((el) => ({ level: levelOf(el), text: el.textContent ?? "" }))));
        });
        return () => cancelAnimationFrame(frame);
    }, [textKey, selector]);

    const readActive = () => {
        const els = items.map((it) => headings.current[it.index]).filter((el) => el?.isConnected);
        const at = els.length > 0 ? scrollParent(els[0]) : null;
        setActive(
            at == null
                ? 0
                : activeItem(
                      els.map((el) => offsetIn(at, el)),
                      at.scrollTop,
                      READ_MARGIN
                  )
        );
    };

    const go = (it: OutlineItem) => {
        const el = headings.current[it.index];
        const at = el?.isConnected ? scrollParent(el) : null;
        if (el == null) {
            return;
        }
        if (at == null) {
            el.scrollIntoView({ block: "start", behavior: "smooth" });
            return;
        }
        at.scrollTo({ top: Math.max(0, offsetIn(at, el) - SCROLL_MARGIN), behavior: "smooth" });
    };

    return { items, active, readActive, go };
}

// The Outline heading and its list of headings, the one you are reading marked; inside a PopoverReveal.
function OutlineList(p: {
    listRef: RefObject<HTMLDivElement | null>;
    items: OutlineItem[];
    active: number;
    onGo: (it: OutlineItem) => void;
    onClose: () => void;
}) {
    const onListKey = (e: KeyboardEvent) => {
        // the list is portalled, but React still bubbles its keys to the pane, whose own Escape closes the file
        if (e.key === "Escape") {
            e.stopPropagation();
            p.onClose();
            return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
        }
        e.preventDefault();
        const btns = [...(p.listRef.current?.querySelectorAll<HTMLButtonElement>("[data-outline-item]") ?? [])];
        const at = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = btns[Math.min(btns.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
        next?.focus();
    };
    return (
        <>
            <div className="flex-none px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">
                Outline
            </div>
            <div
                ref={p.listRef}
                data-outline-list
                onKeyDown={onListKey}
                className="sc flex min-h-0 flex-col overflow-y-auto px-[5px] pb-[5px]"
            >
                {p.items.map((it, i) => (
                    <button
                        key={it.index}
                        type="button"
                        data-outline-item={i}
                        data-active={i === p.active || undefined}
                        onClick={() => p.onGo(it)}
                        title={it.text}
                        style={{ paddingLeft: 10 + it.depth * 14 }}
                        className={cn(
                            "w-full shrink-0 cursor-pointer truncate rounded-[6px] py-[5px] pr-2.5 text-left text-[12.5px] leading-[1.4] outline-none hover:bg-surface-hover focus-visible:bg-surface-hover",
                            it.depth === 0 ? "font-semibold text-primary" : "text-secondary",
                            i === p.active && "bg-accentbg text-primary shadow-[inset_2px_0_0_var(--color-accent)]"
                        )}
                    >
                        {it.text}
                    </button>
                ))}
            </div>
        </>
    );
}

export function OutlineButton(p: {
    rootRef: RefObject<HTMLElement | null>;
    // the headings under rootRef
    selector: string;
    // what the document was rendered from: a new one means new headings to read
    textKey: string;
    className?: string;
    // just the icon, for a header already full of controls (the File tab's)
    iconOnly?: boolean;
}) {
    const { items, active, readActive, go: jump } = useOutline(p.rootRef, p.selector, p.textKey);
    const [open, setOpen] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

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
        setOpen(false);
        jump(it);
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
                    p.iconOnly
                        ? "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                        : "inline-flex h-[25px] shrink-0 cursor-pointer items-center gap-[5px] rounded-[6px] border border-edge-mid bg-surface-raised px-2 text-[11.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover",
                    open &&
                        (p.iconOnly
                            ? "bg-surface-hover text-primary"
                            : "border-edge-strong bg-surface-hover text-primary"),
                    p.className
                )}
            >
                <TableOfContents size={13} aria-hidden />
                {p.iconOnly ? null : "Outline"}
            </button>
            <FloatingPortal>
                {/* above ModalShell's z-[70] backdrop: the review dialog's document has one */}
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                    <PopoverReveal
                        open={open}
                        origin="top right"
                        className="flex max-h-[var(--outline-max-height)] w-[300px] flex-col overflow-hidden rounded-[11px] border border-border bg-surface shadow-popover-md"
                    >
                        <OutlineList
                            listRef={listRef}
                            items={items}
                            active={active}
                            onGo={go}
                            onClose={() => setOpen(false)}
                        />
                    </PopoverReveal>
                </div>
            </FloatingPortal>
        </>
    );
}

// a rail dash's width by depth: a section's dash is longer than its subsections'
const DASH_WIDTH = [12, 8, 5];

// The Outline as a rail of dashes on the right edge of a document, centred top to bottom (Notion's): one dash per
// heading, the one you are reading lit and following the scroll. Hovering the rail opens the list beside it, and a
// click or Enter opens it with focus in it. The parent places it (positioned, over the document's right gutter)
// and keeps the text clear of it; onShown says when the document has headings enough to show it.
export function OutlineRail(p: {
    rootRef: RefObject<HTMLElement | null>;
    selector: string;
    textKey: string;
    className?: string;
    onShown?: (shown: boolean) => void;
}) {
    const { items, active, readActive, go: jump } = useOutline(p.rootRef, p.selector, p.textKey);
    const [open, setOpen] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    // a hover opens the list without taking focus from the document; a click or a key moves focus into it
    const focusList = useRef(false);
    const shown = items.length > 0;

    useEffect(() => {
        p.onShown?.(shown);
    }, [shown]);

    // scroll events don't bubble, but a capturing listener on the root hears its scroller's
    useEffect(() => {
        const root = p.rootRef.current;
        if (!shown || root == null) {
            return;
        }
        readActive();
        let frame = 0;
        const onScroll = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(readActive);
        };
        root.addEventListener("scroll", onScroll, { capture: true, passive: true });
        return () => {
            root.removeEventListener("scroll", onScroll, { capture: true });
            cancelAnimationFrame(frame);
        };
    }, [items]);

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange(next, _event, reason) {
            if (next) {
                readActive();
                focusList.current = reason !== "hover";
            }
            setOpen(next);
        },
        placement: "left",
        strategy: "fixed",
        middleware: [
            offset(6),
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
    const { getReferenceProps, getFloatingProps } = useInteractions([
        useHover(context, { delay: { open: 60, close: 160 }, handleClose: safePolygon() }),
        useClick(context, { toggle: false }),
        useDismiss(context),
    ]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            const btn = listRef.current?.querySelector<HTMLButtonElement>(
                `[data-outline-item="${Math.max(0, active)}"]`
            );
            btn?.scrollIntoView({ block: "nearest" });
            if (focusList.current) {
                btn?.focus({ preventScroll: true });
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    if (!shown) {
        return null;
    }

    const go = (it: OutlineItem) => {
        setOpen(false);
        jump(it);
    };

    return (
        <>
            <button
                type="button"
                ref={refs.setReference}
                {...getReferenceProps()}
                data-outline-rail
                aria-expanded={open}
                aria-label="Outline"
                className={cn(
                    "group flex max-h-full cursor-pointer flex-col items-end overflow-hidden rounded-[6px] border-0 bg-transparent px-[3px] py-2",
                    items.length > 24 ? "gap-[3px]" : "gap-[7px]",
                    p.className
                )}
            >
                {items.map((it, i) => (
                    <span
                        key={it.index}
                        aria-hidden
                        data-outline-dash={i}
                        style={{ width: DASH_WIDTH[it.depth] ?? DASH_WIDTH[DASH_WIDTH.length - 1] }}
                        className={cn(
                            "h-[2px] flex-none rounded-full transition-colors",
                            i === active ? "bg-accent" : open ? "bg-muted" : "bg-edge-strong group-hover:bg-muted"
                        )}
                    />
                ))}
            </button>
            <FloatingPortal>
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                    <PopoverReveal
                        open={open}
                        origin="center right"
                        className="flex max-h-[var(--outline-max-height)] w-[280px] flex-col overflow-hidden rounded-[11px] border border-border bg-surface shadow-popover-md"
                    >
                        <OutlineList
                            listRef={listRef}
                            items={items}
                            active={active}
                            onGo={go}
                            onClose={() => setOpen(false)}
                        />
                    </PopoverReveal>
                </div>
            </FloatingPortal>
        </>
    );
}

// A document pane with the Outline rail centred on its right edge, for the Code surface's previews: their text
// keeps px-8 (32px) on the right, which clears the rail.
export function WithOutline(p: { selector: string; textKey: string; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div ref={ref} className="relative h-full min-h-0">
            {p.children}
            <OutlineRail
                rootRef={ref}
                selector={p.selector}
                textKey={p.textKey}
                className="absolute right-2 top-1/2 z-10 max-h-[calc(100%-24px)] -translate-y-1/2"
            />
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
