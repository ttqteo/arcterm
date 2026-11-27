// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's one-choice menu: a small bordered face ("project mit-thesis ▾") that opens under itself. A short list is
// the app's context menu with a radio item per option; a long one (searchable) is a picker with a filter field, the
// keys on that field. The initiatives list uses it for its project filter, the session ideas offer for the project a
// scan reads; it lives on its own so both can import it without a cycle through briefsurface.tsx.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    size,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { matchingOptions, searchable, startCursor } from "./filtermenumodel";

// A region's filter: which project the initiatives list shows. The first option is always all.
export type FilterSpec<T> = {
    label: string;
    // what the menu's face calls the choice: "project"
    noun: string;
    // the data attribute a CDP scenario finds the filter by
    tag: string;
    // search: more text the picker's filter matches (a project's full path), shown as the row's tooltip
    options: { value: T; label: string; count?: number; search?: string }[];
    value: T;
    onChange: (v: T) => void;
    // a few options (values among `options`) a long filter also offers as chips left of its menu: the recent projects
    quick?: T[];
};

export function FilterMenu<T>(spec: FilterSpec<T>) {
    const { label, noun, tag, options, value } = spec;
    // the one context menu may be a row's, so open means it holds this filter's items
    const shown = useRef<ContextMenuItem[] | null>(null);
    const menuOpen = useAtomValue(contextMenuAtom)?.items === shown.current && shown.current != null;
    const [pickerOpen, setPickerOpen] = useState(false);
    // state, not a ref: the picker positions itself against it, so it must render once the face is there
    const [face, setFace] = useState<HTMLButtonElement | null>(null);
    const long = searchable(options.length);
    const picked = options.find((o) => o.value === value) ?? options[0];
    // opened at the face rather than the pointer, so Enter on the face drops it in the same place
    const show = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (long) {
            setPickerOpen((v) => !v);
            return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        shown.current = [
            { type: "header", label },
            ...options.map(
                (o): ContextMenuItem => ({
                    type: "radio",
                    label: o.label,
                    checked: o.value === value,
                    sublabel: o.count != null ? String(o.count) : undefined,
                    click: () => spec.onChange(o.value),
                })
            ),
        ];
        globalStore.set(contextMenuAtom, { x: r.left, y: r.bottom, items: shown.current });
    };
    // a pick or Esc gives the keys back to the face; a press outside leaves focus where it landed
    const close = (refocus: boolean) => {
        setPickerOpen(false);
        if (refocus) {
            face?.focus({ preventScroll: true });
        }
    };
    return (
        <>
            <button
                ref={setFace}
                type="button"
                aria-haspopup={long ? "dialog" : "menu"}
                aria-expanded={long ? pickerOpen : menuOpen}
                aria-label={label}
                title={`${label}: ${picked.label}`}
                {...{ [tag]: "" }}
                onClick={show}
                className="flex flex-none cursor-pointer items-center gap-1.5 rounded-[5px] border border-edge-strong px-[7px] py-px text-[10.5px] text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <span className="text-muted">{noun}</span>
                {/* a long project name ends in an ellipsis instead of pushing the row's other controls out */}
                <span className="max-w-[20ch] truncate">{picked.label}</span>
                <ChevronDown size={10} aria-hidden className="text-muted" />
            </button>
            {long ? (
                <FilterPicker
                    {...spec}
                    open={pickerOpen}
                    anchor={face}
                    onPick={(v) => {
                        close(true);
                        spec.onChange(v);
                    }}
                    onClose={close}
                />
            ) : null}
        </>
    );
}

// the picker's height: at most enough for about ten rows, at least the field, five rows and the key line
const PICKER_MAX_HEIGHT = 420;
const PICKER_MIN_HEIGHT = 250;

const ROW = "flex h-[28px] cursor-pointer items-center gap-[8px] rounded-[6px] px-[8px] text-left";

function PickerBody<T>({
    label,
    noun,
    options,
    value,
    onPick,
    onClose,
}: FilterSpec<T> & { onPick: (v: T) => void; onClose: (refocus: boolean) => void }) {
    const [query, setQuery] = useState("");
    const rows = useMemo(() => matchingOptions(options, query), [options, query]);
    const [cursor, setCursor] = useState(() => startCursor(rows, value));
    const cur = Math.min(cursor, Math.max(0, rows.length - 1));
    const inputRef = useRef<HTMLInputElement>(null);
    const cursorEl = useRef<HTMLElement | null>(null);

    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        cursorEl.current?.scrollIntoView?.({ block: "nearest" });
    }, [cur, rows.length]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose(true);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setCursor(Math.min(rows.length - 1, Math.max(0, cur + (e.key === "ArrowDown" ? 1 : -1))));
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (rows[cur] != null) {
                onPick(rows[cur].value);
            }
        }
    };

    return (
        <div
            role="dialog"
            aria-label={label}
            data-filter-picker
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="frost flex max-h-[inherit] w-[280px] flex-col rounded-[10px] border border-edge-mid shadow-popover-xl outline-none"
        >
            <div className="flex-none border-b border-edge-mid p-[8px]">
                <label className="flex h-[28px] items-center gap-[8px] rounded-[7px] border border-accent-soft/60 bg-surface px-[9px]">
                    <Search size={13} aria-hidden className="flex-none text-muted" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setCursor(0);
                        }}
                        aria-label={`Find a ${noun}`}
                        placeholder={`Find a ${noun}`}
                        data-filter-picker-input
                        className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink-hi outline-none placeholder:text-ink-faint"
                    />
                </label>
            </div>
            <div role="listbox" aria-label={label} className="flex min-h-0 flex-col gap-px overflow-y-auto p-[6px]">
                {rows.length === 0 ? (
                    <div className="px-[8px] py-[6px] text-[11.5px] text-muted">No {noun} matches.</div>
                ) : null}
                {rows.map((o, i) => {
                    const active = i === cur;
                    const checked = o.value === value;
                    return (
                        <div
                            key={o.label}
                            role="option"
                            aria-selected={active}
                            aria-checked={checked}
                            data-filter-picker-item={o.label}
                            data-cursor={active ? "" : undefined}
                            ref={(el) => {
                                if (active) {
                                    cursorEl.current = el;
                                }
                            }}
                            // a mouse press must not take focus off the filter field: the keys live there
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseMove={() => setCursor(i)}
                            onClick={() => onPick(o.value)}
                            className={cn(ROW, active ? "bg-surface-selected" : "hover:bg-surface-hover")}
                        >
                            <Check
                                size={12}
                                aria-hidden
                                className={cn("flex-none text-accent", checked ? "opacity-100" : "opacity-0")}
                            />
                            <span
                                className="min-w-0 flex-1 truncate text-[12px] text-ink-hi"
                                title={o.search || o.label}
                            >
                                {o.label}
                            </span>
                            {o.count != null ? (
                                <span className="flex-none text-[11px] tabular-nums text-secondary">{o.count}</span>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-none gap-[12px] border-t border-edge-mid px-[12px] py-[7px] text-[10.5px] text-ink-mid">
                <span className="flex items-center gap-[5px]">
                    <kbd className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] leading-[16px]">
                        ↑ ↓
                    </kbd>
                    move
                </span>
                <span className="flex items-center gap-[5px]">
                    <kbd className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] leading-[16px]">
                        {formatChordString("Enter")}
                    </kbd>
                    pick
                </span>
                <span className="flex items-center gap-[5px]">
                    <kbd className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] leading-[16px]">
                        Esc
                    </kbd>
                    close
                </span>
            </div>
        </div>
    );
}

function FilterPicker<T>({
    open,
    anchor,
    onPick,
    onClose,
    ...spec
}: FilterSpec<T> & {
    open: boolean;
    anchor: HTMLElement | null;
    onPick: (v: T) => void;
    onClose: (refocus: boolean) => void;
}) {
    const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
    const { refs, floatingStyles, context, placement } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) {
                onClose(false);
            }
        },
        placement: "bottom-start",
        strategy: "fixed",
        elements: { reference: anchor },
        middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            // the panel never runs past the window: its list scrolls instead. It never shrinks below PICKER_MIN_HEIGHT
            // either: under the face near the window's bottom it would show two rows, and flip only turns it upward
            // when it overflows at that height
            size({
                padding: 8,
                apply: ({ availableHeight }) =>
                    setMaxHeight(Math.max(PICKER_MIN_HEIGHT, Math.min(PICKER_MAX_HEIGHT, availableHeight))),
            }),
        ],
        whileElementsMounted: open ? autoUpdate : undefined,
    });
    // Escape is the body's own (it stops the key there); this is the press outside, which the face is not: a press on
    // the face toggles it shut itself
    const { getFloatingProps } = useInteractions([
        useDismiss(context, {
            escapeKey: false,
            outsidePress: (e) => !(anchor != null && e.target instanceof Node && anchor.contains(e.target)),
        }),
    ]);
    // React events bubble through a portal to what opened it: a click in the picker is not that element's
    const contained = {
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={{ ...floatingStyles, maxHeight }}
                {...getFloatingProps(contained)}
                className="z-[80] flex"
            >
                {/* it grows from the edge at the face: the bottom when flip turned it upward */}
                <PopoverReveal
                    open={open}
                    origin={placement.startsWith("top") ? "bottom left" : "top left"}
                    className="flex max-h-[inherit]"
                >
                    <PickerBody {...spec} onPick={onPick} onClose={onClose} />
                </PopoverReveal>
            </div>
        </FloatingPortal>
    );
}
