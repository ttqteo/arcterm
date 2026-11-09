// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The dropdown under a text box that the chat box's pickers share: the `@` file picker (filemention.tsx) and the `/`
// command menu (slashmenu.tsx). It is portaled out of the box, as the launcher's route picker is: the launcher's fields
// area scrolls, and a chat cell clips, so a dropdown inside either would be cut off at its edge.

import { cn } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, size as floatingSize, offset, shift, useFloating } from "@floating-ui/react";
import { useEffect, type ReactNode, type RefObject } from "react";

const LIST_MIN_WIDTH = 360;
const LIST_MAX_WIDTH = 560;
const LIST_MAX_HEIGHT = 320;

/** The floating setup of a picker's list: anchored to the box itself, so the list starts under the text and follows the
 *  box as it grows. `shown` mounts it. */
export function usePickerFloating(shown: boolean, anchor: RefObject<HTMLTextAreaElement | null>) {
    const { refs, floatingStyles } = useFloating({
        open: shown,
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [
            offset(4),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ rects, availableHeight, elements }) {
                    const width = Math.min(Math.max(rects.reference.width, LIST_MIN_WIDTH), LIST_MAX_WIDTH);
                    elements.floating.style.width = `${width}px`;
                    elements.floating.style.setProperty(
                        "--mention-max-height",
                        `${Math.min(LIST_MAX_HEIGHT, availableHeight)}px`
                    );
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    useEffect(() => {
        refs.setReference(shown ? anchor.current : null);
    }, [shown, refs, anchor]);
    return { setFloating: refs.setFloating, floatingStyles };
}

/** A picker's dropdown: `note` (a line of muted text, while listing or on an error) or the `items`, each drawn by
 *  `renderItem` into the row's content; `at` is the highlighted one, `onPick` a click (the box keeps focus), `onHover`
 *  moves the highlight. */
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
}: {
    anchor: RefObject<HTMLTextAreaElement | null>;
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
}) {
    const { setFloating, floatingStyles } = usePickerFloating(shown, anchor);
    if (!shown) {
        return null;
    }
    return (
        <FloatingPortal>
            {/* above ModalShell's z-[70] backdrop (the launcher), as the route picker sits */}
            <div ref={setFloating} style={floatingStyles} className="z-[80]">
                <ul
                    role="listbox"
                    {...{ [listAttr]: "" }}
                    aria-label={label}
                    className="m-0 flex max-h-[var(--mention-max-height)] list-none flex-col overflow-y-auto rounded-[11px] border border-border bg-surface p-[5px] shadow-popover-md"
                >
                    {note != null ? (
                        <li className="px-2 py-[5px] text-[12px] text-muted">{note}</li>
                    ) : (
                        items.map((item, i) => (
                            <li
                                key={itemKey(item)}
                                role="option"
                                aria-selected={i === at}
                                {...{ [itemAttr]: itemKey(item) }}
                                title={itemTitle?.(item)}
                                onMouseDown={(e) => {
                                    // keep focus in the box
                                    e.preventDefault();
                                    onPick(item);
                                }}
                                onMouseMove={() => onHover(i)}
                                className={cn(
                                    "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[5px]",
                                    i === at && "bg-surface-hover"
                                )}
                            >
                                {renderItem(item)}
                            </li>
                        ))
                    )}
                </ul>
            </div>
        </FloatingPortal>
    );
}
