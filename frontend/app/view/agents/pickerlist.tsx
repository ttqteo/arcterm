// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The dropdown at a text box that the chat box's pickers share: the `@` file picker (filemention.tsx) and the `/`
// command menu (slashmenu.tsx). It is portaled out of the box, as the launcher's route picker is: the launcher's fields
// area scrolls, and a chat cell clips, so a dropdown inside either would be cut off at its edge.
//
// A list with `groups` (a header before the row at each group's `start`) or a `footer` is the board's menu instead of a
// plain dropdown: a box up to 420 px tall as wide as the text box, the rows scrolling in it and the footer fixed under
// them. The box carries `listAttr`; the scroller inside is the listbox (and `data-picker-scroll`), each header is tagged
// `<listAttr>-group` (its value the group's title). The keys belong to the caller and see rows only: a header is no option.
//
// `look: "frosted"` is Chat's suggestion panel instead (the chat box passes it; the launcher keeps the plain list): the
// same list and rows inside `[data-chat-suggest-panel]`, a 16 px panel on `--color-panel` with a static blur that stands
// just above `frame` (the message box) as wide as it is, under a key line (↑↓ to navigate, ⏎ to select, esc to close),
// and enters and leaves on `springPop` from its bottom edge. The blur is never animated, only the scale and opacity.

import { springPop } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, size as floatingSize, offset, shift, useFloating } from "@floating-ui/react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { Fragment, useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { EditorLike } from "./chateditor";

const LIST_MIN_WIDTH = 360;
const LIST_MAX_WIDTH = 560;
const LIST_MAX_HEIGHT = 320;
// the scroller's padding, kept in view above a header scrolled to and below a row
const SCROLL_PAD = 5;
// the room between a list and what it opens over: the plain dropdown's and the frosted panel's
const PLAIN_GAP = 4;
const FROSTED_GAP = 8;

/** Where a picker's list opens: "below" the box, turning above it when there is no room, or "above" it always (the
 *  `@` picker: its box sits at the foot of the chat, and a list that flips with the room left jumps as you type). */
export type PickerSide = "below" | "above";

/** The look of a picker's list: the plain dropdown (nothing passed) or Chat's frosted suggestion panel. */
export type PickerLook = "frosted";

/** The floating setup of a picker's list: anchored to the box itself, so the list starts at the text and follows the
 *  box as it grows. `shown` mounts it. `wide` lets it take the whole width of the box (no 560 px cap) and publishes the
 *  room the side has as `--mention-avail`, which a grouped list's 420 px cap is `min`'d with. The anchor is a text box
 *  (a textarea) or the chat editor's handle, which floating-ui takes as a virtual element: its `contextElement` is the
 *  editable root, so the list still follows the box when it grows or scrolls. `frame` (the frosted look) is an element
 *  the list stands over and matches in width instead of the anchor: the message box. */
export function usePickerFloating(
    shown: boolean,
    anchor: RefObject<EditorLike | null>,
    side: PickerSide = "below",
    wide = false,
    frame?: RefObject<HTMLElement | null>,
    gap = PLAIN_GAP
) {
    const { refs, floatingStyles } = useFloating({
        open: shown,
        placement: side === "above" ? "top-start" : "bottom-start",
        strategy: "fixed",
        middleware: [
            offset(gap),
            ...(side === "above" ? [] : [flip({ padding: 8 })]),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ rects, availableHeight, elements }) {
                    const width = Math.min(
                        Math.max(rects.reference.width, LIST_MIN_WIDTH),
                        wide ? Infinity : LIST_MAX_WIDTH
                    );
                    elements.floating.style.width = `${width}px`;
                    elements.floating.style.setProperty(
                        "--mention-max-height",
                        `${Math.min(LIST_MAX_HEIGHT, availableHeight)}px`
                    );
                    elements.floating.style.setProperty("--mention-avail", `${availableHeight}px`);
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    useEffect(() => {
        refs.setReference(shown ? (frame?.current ?? anchor.current) : null);
    }, [shown, refs, anchor, frame]);
    return { setFloating: refs.setFloating, floatingStyles };
}

// One key of the panel's key line
function KeyCap({ children }: { children: ReactNode }) {
    return (
        <kbd className="rounded-[4px] border border-edge-strong px-[5px] py-px font-mono text-[11px] leading-[1.3] text-muted">
            {children}
        </kbd>
    );
}

// The panel's header: what the keys do, as the board draws it (esc at the far end)
function KeyLine() {
    return (
        <div
            data-chat-suggest-keys=""
            className="flex shrink-0 items-center gap-3.5 whitespace-nowrap px-4 pb-1 pt-2.5 text-[11.5px] text-muted"
        >
            <span>
                <KeyCap>↑↓</KeyCap> to navigate
            </span>
            <span>
                <KeyCap>⏎</KeyCap> to select
            </span>
            <span className="ml-auto">
                <KeyCap>esc</KeyCap> to close
            </span>
        </div>
    );
}

// The frosted panel: scales in from its bottom edge on the spring and out again (the exit plays because the caller keeps
// it under an AnimatePresence). The blur is plain CSS and never animates. While it leaves, what it shows is the last
// frame of a list that is already closed: it is inert (no clicks, no focus) and hidden from assistive tech, it drops its
// own tag, and `children(false)` is asked to drop the list's, so the page names an open panel only while one is open.
function FrostedPanel({ children }: { children: (present: boolean) => ReactNode }) {
    const present = useIsPresent();
    return (
        <motion.div
            data-chat-suggest-panel={present ? "" : undefined}
            aria-hidden={present ? undefined : true}
            inert={!present}
            variants={springPop}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ originX: 0.5, originY: 1 }}
            className="flex max-h-[min(420px,var(--mention-avail))] flex-col overflow-hidden rounded-[16px] border border-edge-mid bg-panel shadow-popover-soft backdrop-blur-[18px]"
        >
            {children(present)}
        </motion.div>
    );
}

export interface PickerGroup {
    title: string;
    /** the rows it holds, shown after the title */
    count: number;
    /** the index in `items` of its first row: its header is drawn before that row */
    start: number;
}

/** A picker's dropdown: `note` (a line of muted text, while listing or on an error) or the `items`, each drawn by
 *  `renderItem` into the row's content; `at` is the highlighted one, `onPick` a click (the box keeps focus), `onHover`
 *  moves the highlight. `groups` and `footer` make it the grouped, scrolling menu (the file header above). A key-driven
 *  move of `at` scrolls its row into view (with its group's header when it is the group's first row); a hover does not. */
export function PickerList<T>({
    anchor,
    shown,
    note,
    items,
    at,
    onPick,
    onHover,
    label,
    itemKey,
    itemTitle,
    renderItem,
    listAttr,
    itemAttr,
    groups,
    footer,
    listAttrs,
    side = "below",
    look,
    frame,
}: {
    anchor: RefObject<EditorLike | null>;
    shown: boolean;
    note: string | null;
    items: T[];
    at: number;
    onPick: (item: T) => void;
    onHover: (i: number) => void;
    label: string;
    itemKey: (item: T) => string;
    itemTitle?: (item: T) => string;
    renderItem: (item: T) => ReactNode;
    /** the data attribute that tags the list for scenarios (`data-chat-mentions`) */
    listAttr: string;
    /** the data attribute on each row, its value `itemKey(item)` (`data-chat-mention`) */
    itemAttr: string;
    /** a header before the row at each group's `start`; not options */
    groups?: PickerGroup[];
    /** drawn under the scroller, outside it */
    footer?: ReactNode;
    /** more data attributes on the list (`data-chat-slash-live`) */
    listAttrs?: Record<`data-${string}`, string>;
    side?: PickerSide;
    /** "frosted": Chat's suggestion panel (see the file header); it always opens above, as wide as `frame` */
    look?: PickerLook;
    /** the frosted panel stands over this element (the message box) and takes its width; without it, over `anchor` */
    frame?: RefObject<HTMLElement | null>;
}) {
    const frosted = look === "frosted";
    const boxed = groups != null || footer != null;
    const { setFloating, floatingStyles } = usePickerFloating(
        shown,
        anchor,
        frosted ? "above" : side,
        boxed || frosted,
        frosted ? frame : undefined,
        frosted ? FROSTED_GAP : PLAIN_GAP
    );
    const scroller = useRef<HTMLUListElement>(null);
    // the row the pointer last moved onto: its highlight is already under the pointer, so it is not scrolled to
    const hovered = useRef(-1);
    // the effect follows the highlight and the list, not every render: a re-render of the box must not snap a list the
    // reader has wheel-scrolled back to its highlighted row
    const listSig = `${items.length}:${items.length > 0 ? itemKey(items[0]) : ""}`;
    useEffect(() => {
        const via = hovered.current;
        hovered.current = -1;
        const ul = scroller.current;
        const row = ul?.querySelector<HTMLElement>(`[data-picker-row="${at}"]`);
        if (!shown || via === at || ul == null || row == null) {
            return;
        }
        const head = row.previousElementSibling?.hasAttribute("data-picker-head") ? row.previousElementSibling : null;
        const top = (head as HTMLElement | null)?.offsetTop ?? row.offsetTop;
        const bottom = row.offsetTop + row.offsetHeight;
        if (top - SCROLL_PAD < ul.scrollTop) {
            ul.scrollTop = Math.max(0, top - SCROLL_PAD);
        } else if (bottom + SCROLL_PAD > ul.scrollTop + ul.clientHeight) {
            ul.scrollTop = bottom + SCROLL_PAD - ul.clientHeight;
        }
    }, [at, shown, listSig]);
    // a plain list just goes; the frosted panel is handed to its AnimatePresence below even when nothing shows, which
    // plays its exit
    if (!shown && !frosted) {
        return null;
    }
    const rows =
        note != null ? (
            <li data-picker-note="" className="px-2 py-[5px] text-[12px] text-muted">
                {note}
            </li>
        ) : (
            items.map((item, i) => {
                const group = groups?.find((g) => g.start === i);
                return (
                    <Fragment key={itemKey(item)}>
                        {group != null ? (
                            <li
                                role="presentation"
                                data-picker-head=""
                                {...{ [`${listAttr}-group`]: group.title }}
                                className="flex gap-1.5 px-2 pb-1 pt-2 text-[11.5px] text-muted"
                            >
                                <span>{group.title}</span>
                                <span className="tabular-nums text-ink-faint">{group.count}</span>
                            </li>
                        ) : null}
                        <li
                            role="option"
                            aria-selected={i === at}
                            data-picker-row={i}
                            {...{ [itemAttr]: itemKey(item) }}
                            title={itemTitle?.(item)}
                            onMouseDown={(e) => {
                                // keep focus in the box
                                e.preventDefault();
                                onPick(item);
                            }}
                            onMouseMove={() => {
                                hovered.current = i;
                                onHover(i);
                            }}
                            className={cn(
                                "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[5px]",
                                i === at && (frosted ? "bg-hover" : "bg-surface-hover")
                            )}
                        >
                            {renderItem(item)}
                        </li>
                    </Fragment>
                );
            })
        );
    // the plain look is today's dropdown, class for class; the frosted one drops the list's own border, fill and shadow
    // (the panel has them) and lets the panel's max height bound it. `present` is false only for a frosted panel on its
    // way out: its list no longer carries the tag that says a list is open.
    const list = (present: boolean) => {
        const tag = present ? { [listAttr]: "", ...listAttrs } : {};
        return boxed ? (
            <div
                {...tag}
                className={
                    frosted
                        ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                        : "flex max-h-[min(420px,var(--mention-avail))] flex-col overflow-hidden rounded-[11px] border border-border bg-surface shadow-popover-md"
                }
            >
                <ul
                    ref={scroller}
                    role="listbox"
                    data-picker-scroll=""
                    aria-label={label}
                    className={
                        frosted
                            ? "relative m-0 min-h-0 flex-1 list-none overflow-y-auto p-[6px] pt-0"
                            : "relative m-0 min-h-0 flex-1 list-none overflow-y-auto p-[5px]"
                    }
                >
                    {rows}
                </ul>
                {footer}
            </div>
        ) : (
            <ul
                ref={scroller}
                role="listbox"
                {...tag}
                data-picker-scroll=""
                aria-label={label}
                className={
                    frosted
                        ? "relative m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-[6px] pt-0"
                        : "relative m-0 flex max-h-[var(--mention-max-height)] list-none flex-col overflow-y-auto rounded-[11px] border border-border bg-surface p-[5px] shadow-popover-md"
                }
            >
                {rows}
            </ul>
        );
    };
    if (frosted) {
        return (
            <AnimatePresence>
                {shown ? (
                    <FloatingPortal key="suggest-panel">
                        <div ref={setFloating} style={floatingStyles} className="z-[80]">
                            <FrostedPanel>
                                {(present) => (
                                    <>
                                        <KeyLine />
                                        {list(present)}
                                    </>
                                )}
                            </FrostedPanel>
                        </div>
                    </FloatingPortal>
                ) : null}
            </AnimatePresence>
        );
    }
    return (
        <FloatingPortal>
            {/* above ModalShell's z-[70] backdrop (the launcher), as the route picker sits */}
            <div ref={setFloating} style={floatingStyles} className="z-[80]">
                {list(true)}
            </div>
        </FloatingPortal>
    );
}
