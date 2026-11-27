// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Your prompt, pinned to the top of a transcript once it has scrolled away (pinnedprompt.ts decides which), so a long
// turn's reply still says what it answers. A click scrolls back to the prompt. Shared by the live feed
// (narrationtimeline.tsx), the compact read (compacttranscript.tsx) and chat (chatconversation.tsx); each marks its
// prompts with data-user-prompt.
// The scroll back is smooth, so the reply visibly runs back up to the prompt it answers, unless motion is reduced.
// Given every prompt's text (prompts), the bar also lists them: a counter at its right ("10/12"), or a right-click
// anywhere on it, opens the list under the bar, and picking one scrolls to it the same way. The list is portalled, so
// the scroller's overflow does not clip it and its frost blurs the reply rather than the band.
// A pair's conversation (pairpane.tsx) uses it too, for the judges' and your messages: `tags` names who wrote each one,
// and `menuTitle` / `itemWord` say "Judge & you" and "message" where Chat says "Your prompts" and "prompt".
// A sticky row sticks below the scroller's top padding, which would leave a gap above the band that content scrolling
// past shows in. So the bar covers the padding itself: it reads its scroller's padding-top, lifts the row by that much
// and adds it to the band's top padding, and a scroller that holds it may have any top padding.

import { KeyCap } from "@/app/element/keycap";
import { springPop } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    size as floatingSize,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { ArrowUp, ChevronsUpDown } from "lucide-react";
import { AnimatePresence, motion, MotionConfig, useIsPresent, useMotionValue, useReducedMotion } from "motion/react";
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
} from "react";
import {
    atScrollEnd,
    pinnedPromptIndex,
    pinnedPromptPush,
    PROMPT_JUMP_EVENT,
    PROMPT_MENU_MIN,
    promptCounter,
    promptMenuWidth,
    stepPromptMenu,
} from "./pinnedprompt";

const PROMPT_SELECTOR = "[data-user-prompt]";

// the list's height cap: about nine rows, then it scrolls inside
const PROMPT_MENU_MAX_H = 380;

// what the list and the band call their entries, unless told otherwise
const MENU_TITLE = "Your prompts";
const ITEM_WORD = "prompt";

// who wrote an entry, before its text in the band and the list (a pair's "Judge", "You")
function Tag({ tag }: { tag: string | undefined }) {
    return tag ? (
        <span
            data-prompt-tag
            className="flex-none rounded-[4px] border border-edge-mid px-[5px] text-[10.5px] leading-[16px] text-muted"
        >
            {tag}
        </span>
    ) : null;
}

/** Set on the scroller while a pinned prompt shows: how far below the sticky line (the scroller's top padding) the
 *  band's bottom edge sits, so another sticky row (a code block's head, codeblock.tsx) sticks under the band, not
 *  behind it. Two bands are drawn while one leaves and the next arrives, so each reports its own and the lowest wins. */
export const PINNED_PROMPT_HEIGHT_VAR = "--pinned-prompt-h";

const bandBottoms = new WeakMap<HTMLElement, Map<object, number>>();

// records (bottom) or drops (null) one band's bottom edge, and writes the lowest to the scroller only when it changes:
// a custom property set on the scroller restyles the whole transcript, and this runs on every scroll frame
function reportBandBottom(scroller: HTMLElement, band: object, bottom: number | null) {
    let bands = bandBottoms.get(scroller);
    if (bands == null) {
        bands = new Map();
        bandBottoms.set(scroller, bands);
    }
    if (bottom == null) {
        bands.delete(band);
    } else {
        bands.set(band, bottom);
    }
    const next = bands.size === 0 ? "" : `${Math.max(0, Math.round(Math.max(...bands.values())))}px`;
    if (scroller.style.getPropertyValue(PINNED_PROMPT_HEIGHT_VAR) !== next) {
        if (next === "") {
            scroller.style.removeProperty(PINNED_PROMPT_HEIGHT_VAR);
        } else {
            scroller.style.setProperty(PINNED_PROMPT_HEIGHT_VAR, next);
        }
    }
}

/** The nearest ancestor of el that scrolls vertically, or null. */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let p = el?.parentElement; p != null; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") {
            return p;
        }
    }
    return null;
}

/** The index (among root's data-user-prompt elements, in order) of the prompt to pin, or -1. Follows the scroller root
 *  sits in, and root's own size, which changes as the transcript grows or a fold opens. hideAtEnd: -1 while the scroller
 *  shows the end of the transcript (atScrollEnd), so the band gives the reading room back to the newest reply; it comes
 *  back once the reader scrolls up. The scroller's own size is followed too then (a chat box that grows shrinks it). */
export function usePinnedPrompt(rootRef: RefObject<HTMLElement>, hideAtEnd = false): number {
    const [index, setIndex] = useState(-1);
    useEffect(() => {
        const root = rootRef.current;
        const scroller = scrollParent(root);
        if (root == null || scroller == null) {
            return;
        }
        let frame = 0;
        const measure = () => {
            frame = 0;
            const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
            const anchors = [...root.querySelectorAll<HTMLElement>(PROMPT_SELECTOR)].map((el) => {
                const r = el.getBoundingClientRect();
                return { top: r.top - base, bottom: r.bottom - base };
            });
            const end = hideAtEnd && atScrollEnd(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
            setIndex(end ? -1 : pinnedPromptIndex(anchors, scroller.scrollTop));
        };
        const schedule = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(measure);
            }
        };
        measure();
        scroller.addEventListener("scroll", schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(root);
        if (hideAtEnd) {
            ro.observe(scroller);
        }
        return () => {
            scroller.removeEventListener("scroll", schedule);
            ro.disconnect();
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
        };
    }, [rootRef, hideAtEnd]);
    return index;
}

/** The top padding, in px, of the scroller root sits in while `on`, kept as it changes: the padding is a style a resize or
 *  a responsive class can change, and a change resizes the scroller's content box, which is what is observed. */
function useScrollerPaddingTop(rootRef: RefObject<HTMLElement>, on: boolean): number {
    const [pad, setPad] = useState(0);
    useLayoutEffect(() => {
        const scroller = on ? scrollParent(rootRef.current) : null;
        if (scroller == null) {
            setPad(0);
            return;
        }
        const read = () => setPad(parseFloat(getComputedStyle(scroller).paddingTop) || 0);
        read();
        const ro = new ResizeObserver(read);
        ro.observe(scroller);
        return () => ro.disconnect();
    }, [rootRef, on]);
    return pad;
}

/** The pinned prompt: a zero-height sticky row, so showing it never moves the transcript under it. bg is the
 *  scroller's own background, which the row's band paints over what scrolls beneath it. className goes on the sticky
 *  row, for a parent that spaces its children (a flex gap) and so must cancel the gap the row would add. cardClassName
 *  goes on the card inside the band, for room beside it (a button in the corner): the band still spans the row, so
 *  nothing scrolling beneath shows in that room.
 *  The band pops in from the top edge as your prompt scrolls away and out as it comes back (springPop), and the next
 *  prompt shoves it up as it comes up under it, in step with the scroll (pinnedPromptPush): a band that blinked on and
 *  off over the bubble it stands for read as a jump. Each pinned prompt is its own row, keyed by its index, so one
 *  leaving and the next arriving cross over instead of the text swapping in place.
 *  prompts, when given, is every prompt's text in the order of root's data-user-prompt elements (text is prompts[index]);
 *  with PROMPT_MENU_MIN or more the bar offers the list of them. tags, when given, is who wrote each (tags[i] for
 *  prompts[i]); menuTitle and itemWord rename the list ("Your prompts") and an entry ("prompt"). */
export function PinnedPromptBar({
    rootRef,
    index,
    text,
    prompts,
    tags,
    menuTitle = MENU_TITLE,
    itemWord = ITEM_WORD,
    bg,
    className,
    cardClassName,
}: {
    rootRef: RefObject<HTMLElement>;
    index: number;
    text: string | undefined;
    prompts?: readonly string[];
    tags?: readonly string[];
    menuTitle?: string;
    itemWord?: string;
    bg: string;
    className?: string;
    cardClassName?: string;
}) {
    const shown = index >= 0 && text != null;
    const pad = useScrollerPaddingTop(rootRef, shown);
    // The row sticks below the scroller's top padding: `top` lifts it by the padding and the band's own top padding grows
    // by the same, so the band paints the gap above the card and the card stays where it was
    return (
        <AnimatePresence initial={false}>
            {shown ? (
                <div
                    key={index}
                    data-pinned-prompt
                    className={cn("sticky top-0 z-10 h-0", className)}
                    style={pad > 0 ? { top: -pad } : undefined}
                >
                    <PinnedBand
                        rootRef={rootRef}
                        index={index}
                        text={text}
                        prompts={prompts}
                        tags={tags}
                        menuTitle={menuTitle}
                        itemWord={itemWord}
                        bg={bg}
                        pad={pad}
                        cardClassName={cardClassName}
                    />
                </div>
            ) : null}
        </AnimatePresence>
    );
}

// root's index-th prompt, scrolled to the top of its scroller; a feed that sticks to its tail lets go first
function scrollToPrompt(root: HTMLElement | null, index: number, smooth: boolean) {
    const target = root?.querySelectorAll<HTMLElement>(PROMPT_SELECTOR)[index];
    if (root == null || target == null) {
        return;
    }
    root.dispatchEvent(new Event(PROMPT_JUMP_EVENT, { bubbles: true }));
    target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
}

// the band of one pinned prompt: it follows the prompt after it (pinnedPromptPush) for as long as it is drawn, its
// exit included, so a band on its way out still moves with the scroll
function PinnedBand({
    rootRef,
    index,
    text,
    prompts,
    tags,
    menuTitle,
    itemWord,
    bg,
    pad,
    cardClassName,
}: {
    rootRef: RefObject<HTMLElement>;
    index: number;
    text: string;
    prompts?: readonly string[];
    tags?: readonly string[];
    menuTitle: string;
    itemWord: string;
    bg: string;
    pad: number; // the scroller's top padding the band covers (useScrollerPaddingTop)
    cardClassName?: string;
}) {
    const reduce = useReducedMotion();
    // false once the band starts leaving: it fades out over what it stood above, so it no longer holds room for a sticky
    // row under it (a code block's head would stay a band's height down, over the lines it should show, until unmount)
    const present = useIsPresent();
    const bandRef = useRef<HTMLDivElement>(null);
    const push = useMotionValue(0);
    const menu = prompts != null && prompts.length >= PROMPT_MENU_MIN ? prompts : null;
    const [open, setOpen] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const counterRef = useRef<HTMLButtonElement>(null);
    // the list hangs under the whole card, its right edge on the card's, as wide as the card up to PROMPT_MENU_MAX_W
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ availableHeight, rects, elements }) {
                    elements.floating.style.setProperty(
                        "--prompt-menu-max-h",
                        `${Math.min(PROMPT_MENU_MAX_H, availableHeight)}px`
                    );
                    elements.floating.style.setProperty(
                        "--prompt-menu-w",
                        `${promptMenuWidth(rects.reference.width)}px`
                    );
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    const { getFloatingProps } = useInteractions([useDismiss(context)]);
    // focus moves to the prompt you are reading, centred in the list, so the keys start from it and Escape closes the
    // list before anything under it
    useEffect(() => {
        if (!open) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            const list = listRef.current;
            const row = list?.querySelector<HTMLButtonElement>(`[data-prompt-item="${index}"]`);
            if (list == null || row == null) {
                return;
            }
            list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
            row.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);
    useEffect(() => {
        const root = rootRef.current;
        const scroller = scrollParent(root);
        const band = bandRef.current;
        if (root == null || scroller == null || band == null) {
            return;
        }
        if (!present) {
            reportBandBottom(scroller, band, null);
            return;
        }
        let frame = 0;
        const measure = () => {
            frame = 0;
            const next = root.querySelectorAll<HTMLElement>(PROMPT_SELECTOR)[index + 1];
            const nextTop =
                next == null ? null : next.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            const shove = pinnedPromptPush(nextTop, band.offsetHeight);
            push.set(shove);
            reportBandBottom(scroller, band, band.offsetHeight - pad + shove);
        };
        const schedule = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(measure);
            }
        };
        measure();
        scroller.addEventListener("scroll", schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(root);
        ro.observe(band);
        return () => {
            scroller.removeEventListener("scroll", schedule);
            ro.disconnect();
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
            reportBandBottom(scroller, band, null);
        };
    }, [rootRef, index, push, pad, present]);
    const jump = () => scrollToPrompt(rootRef.current, index, !reduce);
    const pick = (i: number) => {
        setOpen(false);
        scrollToPrompt(rootRef.current, i, !reduce);
    };
    // a right-click anywhere on the card opens the list, not the webview's own menu; nothing behind the bar takes it
    const onCardMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
    };
    const onListKey = (e: KeyboardEvent) => {
        // the list is portalled, but React still bubbles its keys to the pane, whose own Escape would act too
        if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            counterRef.current?.focus({ preventScroll: true });
            return;
        }
        const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-prompt-item]") ?? [])];
        const next = stepPromptMenu(rows.indexOf(document.activeElement as HTMLButtonElement), e.key, rows.length);
        if (next == null) {
            return;
        }
        e.preventDefault();
        rows[next].focus();
    };
    // with an earlier prompt above it, the bar reads as the top of a stack: one card's edge shows under it, never more.
    // y is the scroll's, not an entrance: the band arrives on opacity + scale like any card
    return (
        <motion.div
            ref={bandRef}
            variants={springPop}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{
                y: push,
                transformOrigin: "top center",
                ...(pad > 0 ? { paddingTop: `calc(0.25rem + ${pad}px)` } : {}),
            }}
            className={cn("pb-2 pt-1", bg)}
        >
            <div className={cn("relative", cardClassName)}>
                {index > 0 ? (
                    <div
                        aria-hidden
                        className="absolute inset-x-2.5 -bottom-1 h-4 rounded-[8px] border border-edge-mid bg-surface"
                    />
                ) : null}
                {/* the scroller's ground under the card, so the card behind does not show through it. The card is
                    neutral, your message bubble's surface: an accent tint goes muddy over a coloured theme. It floats
                    over the reply scrolling beneath, so it takes the strong edge and the 1px micro-shadow of floating
                    chrome (DESIGN.md "Elevation & Depth"): with the mid edge it sank into the page in a small window */}
                <div className={cn("relative rounded-[8px]", bg)}>
                    <div
                        ref={refs.setReference}
                        onContextMenu={menu != null ? onCardMenu : undefined}
                        className="flex items-stretch rounded-[8px] border border-edge-strong bg-surface-raised shadow-popover-line"
                    >
                        <button
                            type="button"
                            onClick={jump}
                            title={`Back to this ${itemWord}`}
                            className={cn(
                                "flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-[5px] text-left hover:bg-surface-hover",
                                menu != null ? "rounded-l-[7px]" : "rounded-[7px]"
                            )}
                        >
                            <Tag tag={tags?.[index]} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{text}</span>
                            <ArrowUp size={12} strokeWidth={2.2} aria-hidden className="flex-none text-muted" />
                        </button>
                        {menu != null ? (
                            <>
                                <span aria-hidden className="my-[5px] w-px flex-none bg-edge-mid" />
                                <button
                                    ref={counterRef}
                                    type="button"
                                    data-prompt-counter
                                    onClick={() => setOpen((o) => !o)}
                                    aria-haspopup="menu"
                                    aria-expanded={open}
                                    aria-label={`${menuTitle} (${index + 1} of ${menu.length})`}
                                    title={menuTitle}
                                    className={cn(
                                        "flex flex-none cursor-pointer items-center gap-1 rounded-r-[7px] pl-[9px] pr-2 text-[11.5px] tabular-nums text-muted hover:bg-surface-hover",
                                        open && "bg-surface-hover"
                                    )}
                                >
                                    {promptCounter(index, menu.length)}
                                    <ChevronsUpDown size={12} strokeWidth={2} aria-hidden />
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
            {menu != null ? (
                <FloatingPortal>
                    <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                        <MotionConfig reducedMotion="user">
                            <AnimatePresence>
                                {open ? (
                                    <motion.div
                                        role="menu"
                                        aria-label={menuTitle}
                                        variants={springPop}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                        style={{ transformOrigin: "top right" }}
                                        className="flex max-h-[var(--prompt-menu-max-h)] w-[var(--prompt-menu-w)] flex-col overflow-hidden rounded-[12px] border border-edge-mid frost shadow-popover-md"
                                    >
                                        <PromptMenuBody
                                            listRef={listRef}
                                            prompts={menu}
                                            tags={tags}
                                            title={menuTitle}
                                            itemWord={itemWord}
                                            index={index}
                                            onPick={pick}
                                            onKey={onListKey}
                                        />
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>
                        </MotionConfig>
                    </div>
                </FloatingPortal>
            ) : null}
        </motion.div>
    );
}

// the list of your prompts in conversation order, the one you are reading marked; focus is the cursor, so the pointer
// moves it too and only one row is ever lifted
function PromptMenuBody({
    listRef,
    prompts,
    tags,
    title,
    itemWord,
    index,
    onPick,
    onKey,
}: {
    listRef: RefObject<HTMLDivElement>;
    prompts: readonly string[];
    tags?: readonly string[];
    title: string;
    itemWord: string;
    index: number;
    onPick: (i: number) => void;
    onKey: (e: KeyboardEvent) => void;
}) {
    return (
        <>
            <div className="flex flex-none items-baseline justify-between px-3 pb-[5px] pt-[9px]">
                <span className="text-[11.5px] font-medium text-muted">{title}</span>
                <span className="text-[11px] tabular-nums text-muted">{prompts.length}</span>
            </div>
            {/* data-owns-keys: the list is portalled out of the pane's own key region, so without it the dispatcher
                read focus here as nowhere in particular and a surface binding could take Escape or an arrow first */}
            <div
                ref={listRef}
                data-prompt-list
                data-owns-keys
                onKeyDown={onKey}
                className="sc relative flex min-h-0 flex-col gap-px overflow-y-auto px-1 pb-1"
            >
                {prompts.map((text, i) => (
                    <button
                        key={i}
                        type="button"
                        role="menuitem"
                        data-prompt-item={i}
                        aria-current={i === index || undefined}
                        onClick={() => onPick(i)}
                        onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
                        className={cn(
                            "flex h-[30px] w-full flex-none cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-left outline-none focus:bg-surface-hover",
                            i === index && "bg-surface-selected focus:bg-surface-selected"
                        )}
                    >
                        <span className="w-[18px] flex-none text-right text-[11px] tabular-nums text-muted">
                            {i + 1}
                        </span>
                        <Tag tag={tags?.[i]} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{text}</span>
                        {i === index ? <span className="flex-none text-[11px] text-muted">reading</span> : null}
                    </button>
                ))}
            </div>
            <div className="flex flex-none items-center gap-3 border-t border-edge-mid px-3 py-1.5 text-[11px] text-muted">
                <span className="flex items-center gap-1">
                    <KeyCap chord="ArrowUp" variant="inline" />
                    <KeyCap chord="ArrowDown" variant="inline" />
                    move
                </span>
                <span className="flex items-center gap-1">
                    <KeyCap chord="Enter" variant="inline" />
                    go to {itemWord}
                </span>
                <span className="flex items-center gap-1">
                    <KeyCap chord="Esc" variant="inline" />
                    close
                </span>
            </div>
        </>
    );
}
