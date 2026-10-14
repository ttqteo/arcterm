// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative picker: a filter field over the initiatives of one project, "+ New initiative from this session" and the
// other projects behind a count. The agent header's "Link to initiative" opens it, and the List's "Link to…" does too
// (it leaves out the initiative being linked and everything beneath it). A pick is the initiative's oref, or "new".

import { PopoverReveal } from "@/app/element/popoverreveal";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { stateRpcTimeoutMs } from "./briefingstore";
import { buildEffortCard, type EffortCardModel } from "./effortmodel";
import { pickerRows, type PickerRow, type PickerTone } from "./initiativepickermodel";

// the initiatives that are not archived, read when the picker opens (the Brief's own list is not loaded on the Agent
// surface). Null while they load; a failed read leaves the list empty and says so.
export function useInitiativeCards(active: boolean): { cards: EffortCardModel[] | null; error: string | null } {
    const [state, setState] = useState<{ cards: EffortCardModel[] | null; error: string | null }>({
        cards: null,
        error: null,
    });
    useEffect(() => {
        if (!active) {
            return;
        }
        let live = true;
        RpcApi.EffortListCommand(TabRpcClient, {}, { timeout: stateRpcTimeoutMs })
            .then((rtn) => live && setState({ cards: (rtn.efforts ?? []).map(buildEffortCard), error: null }))
            .catch((e) => live && setState({ cards: [], error: e instanceof Error ? e.message : String(e) }));
        return () => {
            live = false;
        };
    }, [active]);
    return state;
}

const TONE_TEXT: Record<PickerTone, string> = {
    working: "text-working",
    asking: "text-asking",
    success: "text-success",
    faint: "text-ink-faint",
    muted: "text-ink-mid",
};

type Item = { kind: "row"; row: PickerRow } | { kind: "new" } | { kind: "others" };

const ROW_BASE = "flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[8px] text-left";

function PickerBody({
    cards,
    error,
    project,
    excluding,
    newLabel,
    pickVerb,
    onPick,
    onClose,
}: {
    cards: EffortCardModel[] | null;
    error: string | null;
    project: string;
    excluding?: readonly string[];
    newLabel: string | null;
    pickVerb: string;
    onPick: (pick: string) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState("");
    const [showOthers, setShowOthers] = useState(false);
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const rows = useMemo(() => pickerRows(cards ?? [], project, query, excluding), [cards, project, query, excluding]);
    const filtering = query.trim() !== "";
    // the cursor's order is the screen's: the rows, then the two actions, then the other projects once opened
    const items: Item[] = [
        ...rows.rows.map((row): Item => ({ kind: "row", row })),
        ...(newLabel != null ? [{ kind: "new" } as Item] : []),
        ...(rows.otherCount > 0 ? [{ kind: "others" } as Item] : []),
        ...(showOthers ? rows.others.map((row): Item => ({ kind: "row", row })) : []),
    ];
    const cur = Math.min(cursor, Math.max(0, items.length - 1));
    const cursorEl = useRef<HTMLElement | null>(null);

    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        cursorEl.current?.scrollIntoView?.({ block: "nearest" });
    }, [cur, items.length]);

    const activate = (item: Item | undefined) => {
        if (item == null) {
            return;
        }
        if (item.kind === "others") {
            setShowOthers((v) => !v);
        } else if (item.kind === "new") {
            onPick("new");
        } else {
            onPick(item.row.oref);
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setCursor(Math.min(items.length - 1, Math.max(0, cur + (e.key === "ArrowDown" ? 1 : -1))));
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            activate(items[cur]);
        }
    };

    const rowEl = (item: Item, index: number) => {
        const active = index === cur;
        const common = {
            // a mouse press must not take focus off the filter field: the keys live there
            onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
            onMouseMove: () => setCursor(index),
            onClick: () => activate(item),
            ref: (el: HTMLDivElement | null) => {
                if (active) {
                    cursorEl.current = el;
                }
            },
        };
        if (item.kind === "row") {
            return (
                <div
                    key={item.row.oref}
                    role="option"
                    aria-selected={active}
                    data-picker-row={item.row.oref}
                    {...common}
                    className={cn(ROW_BASE, "h-[34px]", active ? "bg-surface-selected" : "hover:bg-surface-hover")}
                >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-hi">{item.row.title}</span>
                    {filtering && item.row.project !== project ? (
                        <span className="max-w-[80px] flex-none truncate text-[10.5px] text-ink-faint">
                            {item.row.project || "no project"}
                        </span>
                    ) : null}
                    <span className="flex-none text-[11px] tabular-nums text-secondary">{item.row.progress}</span>
                    <span className={cn("w-[60px] flex-none text-right text-[10.5px]", TONE_TEXT[item.row.tone])}>
                        {item.row.status}
                    </span>
                </div>
            );
        }
        if (item.kind === "new") {
            return (
                <div
                    key="new"
                    role="option"
                    aria-selected={active}
                    data-picker-new
                    {...common}
                    className={cn(
                        ROW_BASE,
                        "h-[32px] text-[12px] text-accent-soft",
                        active ? "bg-surface-selected" : "hover:bg-surface-hover"
                    )}
                >
                    {newLabel}
                </div>
            );
        }
        return (
            <div
                key="others"
                role="option"
                aria-selected={active}
                aria-expanded={showOthers}
                data-picker-others
                {...common}
                className={cn(
                    ROW_BASE,
                    "h-[28px] text-[11.5px] text-ink-mid",
                    active ? "bg-surface-selected" : "hover:bg-surface-hover"
                )}
            >
                Other projects · {rows.otherCount}
                <span aria-hidden className="text-ink-faint">
                    {showOthers ? "▴" : "▾"}
                </span>
            </div>
        );
    };

    const own = rows.rows.length;
    return (
        <div
            role="dialog"
            aria-label="Link to an initiative"
            data-initiative-picker
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex w-[330px] flex-col rounded-[10px] border border-edge-mid bg-surface-raised shadow-popover-xl outline-none"
        >
            <div className="border-b border-edge-mid p-[10px]">
                <label className="flex h-[28px] items-center gap-[8px] rounded-[7px] border border-accent-soft/60 bg-surface px-[9px]">
                    <Search size={13} aria-hidden className="flex-none text-muted" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setCursor(0);
                        }}
                        aria-label="Find an initiative"
                        placeholder="Find an initiative"
                        className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink-hi outline-none placeholder:text-ink-faint"
                    />
                </label>
            </div>
            <div role="listbox" className="flex max-h-[300px] flex-col gap-px overflow-y-auto p-[6px]">
                {cards == null ? (
                    <div className="px-[8px] py-[6px] text-[11.5px] text-muted">Loading initiatives…</div>
                ) : null}
                {error != null ? (
                    <div role="alert" className="px-[8px] py-[6px] text-[11.5px] text-error">
                        {error}
                    </div>
                ) : null}
                {cards != null && !filtering ? (
                    <div className="px-[8px] py-[4px] text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-mid">
                        {project || "No project"}
                    </div>
                ) : null}
                {cards != null && own === 0 ? (
                    <div className="px-[8px] py-[6px] text-[11.5px] text-muted">
                        {filtering ? "No initiative matches." : `No initiatives in ${project || "this project"} yet.`}
                    </div>
                ) : null}
                {items.slice(0, own).map((it, i) => rowEl(it, i))}
                {items.length > own ? <div aria-hidden className="mx-[6px] my-[5px] h-px bg-edge-mid" /> : null}
                {items.slice(own).map((it, i) => rowEl(it, own + i))}
            </div>
            <div className="flex gap-[12px] border-t border-edge-mid px-[12px] py-[8px] text-[10.5px] text-ink-mid">
                <span className="flex items-center gap-[5px]">
                    <kbd className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] leading-[16px]">
                        ↑ ↓
                    </kbd>
                    pick
                </span>
                <span className="flex items-center gap-[5px]">
                    <kbd className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] leading-[16px]">
                        ⏎
                    </kbd>
                    {pickVerb}
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

export function InitiativePicker({
    open,
    anchor,
    project,
    excluding,
    newLabel = "+ New initiative from this session",
    pickVerb = "link",
    onPick,
    onClose,
}: {
    open: boolean;
    anchor: HTMLElement | null;
    // the agent's project, whose initiatives come first
    project: string;
    // initiatives left out (the one being linked and its descendants, for the List's Link to…)
    excluding?: readonly string[];
    // the row that makes a new initiative; null leaves it out
    newLabel?: string | null;
    pickVerb?: string;
    onPick: (pick: string) => void;
    onClose: () => void;
}) {
    const { cards, error } = useInitiativeCards(open);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) {
                onClose();
            }
        },
        placement: "bottom-start",
        strategy: "fixed",
        elements: { reference: anchor },
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: open ? autoUpdate : undefined,
    });
    // Escape is the body's own (it stops the key there); this is the press outside, which the trigger is not
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);
    // React events bubble through a portal to what opened it: a click in the picker is not that element's
    const contained = {
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps(contained)} className="z-[80]">
                <PopoverReveal open={open} origin="top left">
                    <PickerBody
                        cards={cards}
                        error={error}
                        project={project}
                        excluding={excluding}
                        newLabel={newLabel}
                        pickVerb={pickVerb}
                        onPick={onPick}
                        onClose={onClose}
                    />
                </PopoverReveal>
            </div>
        </FloatingPortal>
    );
}
