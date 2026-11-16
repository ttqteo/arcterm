// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative form's Parent initiative field: a box naming the parent that opens a searchable list of initiatives.
// The list is portaled out of the form, whose body scrolls and would clip it; being outside the dialog's panel, an
// Escape in it closes only the list (ModalShell's shellOwnsEscape). The model is effortparent.ts.

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
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { briefingStateAtom, loadBriefingAsync } from "./briefingstore";
import { bareEffortOid, parentLabel, parentOptions } from "./effortparent";

export function EffortParentPicker({
    value,
    onChange,
    self,
    project,
    className,
}: {
    value: string;
    onChange: (oid: string) => void;
    // the initiative being edited (an oref), null for a new one
    self: string | null;
    project: string;
    className?: string;
}) {
    const load = useAtomValue(briefingStateAtom);
    const efforts = load.snapshot?.state.efforts ?? [];
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // the list comes from the Brief's snapshot; a form opened before the Brief ever loaded reads it once now
    const askedLoad = useRef(false);
    const needsLoad = load.snapshot == null && !load.loading;
    useEffect(() => {
        if (needsLoad && !askedLoad.current) {
            askedLoad.current = true;
            void loadBriefingAsync();
        }
    }, [needsLoad]);

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-start",
        middleware: [
            offset(4),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ rects, availableHeight, elements }) {
                    elements.floating.style.width = `${Math.max(rects.reference.width, 300)}px`;
                    elements.floating.style.maxHeight = `${Math.min(availableHeight, 320)}px`;
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([useDismiss(context)]);

    const picked = bareEffortOid(value);
    const label = parentLabel(efforts, picked);
    const options = parentOptions(efforts, self, project, query);
    // row 0 is "No parent" while one is picked
    const rows: ({ oid: string; title: string; project?: string } | null)[] = [
        ...(picked !== "" ? [null] : []),
        ...options.map((o) => ({ oid: bareEffortOid(o.oref), title: o.title, project: o.project })),
    ];

    useEffect(() => {
        setActive(0);
    }, [query, open]);
    useEffect(() => {
        listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
    }, [active]);

    const choose = (oid: string) => {
        onChange(oid);
        setOpen(false);
        setQuery("");
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, rows.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const row = rows[active];
            if (row !== undefined) {
                choose(row?.oid ?? "");
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            (refs.reference.current as HTMLElement | null)?.focus();
        }
    };

    return (
        <>
            <button
                type="button"
                ref={refs.setReference}
                aria-haspopup="listbox"
                aria-expanded={open}
                {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
                className={cn(
                    "flex w-full cursor-pointer items-center gap-2 text-left",
                    className,
                    open && "border-accent/60"
                )}
            >
                <span className={cn("min-w-0 flex-1 truncate", label == null && "text-muted")}>{label ?? "None"}</span>
                <span className="flex-none text-[10px] text-muted">▾</span>
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        {...getFloatingProps()}
                        data-effort-parent-picker=""
                        className="frost z-[80] flex flex-col overflow-hidden rounded-[8px] border border-edge-mid shadow-popover"
                    >
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="Search initiatives…"
                            spellCheck={false}
                            className="w-full flex-none border-b border-edge-faint bg-transparent px-2.5 py-2 text-[12px] text-primary placeholder:text-muted outline-none"
                        />
                        <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
                            {rows.length === 0 ? (
                                <div className="px-2 py-2 text-[11.5px] text-muted">
                                    {load.snapshot == null ? "Loading initiatives…" : "No initiative matches"}
                                </div>
                            ) : (
                                rows.map((row, i) => (
                                    <button
                                        key={row?.oid ?? "none"}
                                        type="button"
                                        role="option"
                                        aria-selected={i === active}
                                        data-row={i}
                                        onMouseEnter={() => setActive(i)}
                                        onClick={() => choose(row?.oid ?? "")}
                                        className={cn(
                                            "flex w-full cursor-pointer items-baseline gap-2 rounded-[5px] px-2 py-[5px] text-left",
                                            i === active && "bg-surface-hover"
                                        )}
                                    >
                                        {row == null ? (
                                            <span className="text-[12px] text-secondary">No parent</span>
                                        ) : (
                                            <>
                                                <span
                                                    className={cn(
                                                        "min-w-0 flex-1 truncate text-[12px]",
                                                        row.oid === picked ? "text-accent" : "text-primary"
                                                    )}
                                                >
                                                    {row.title}
                                                </span>
                                                {row.project ? (
                                                    <span className="flex-none text-[10.5px] text-muted">
                                                        {row.project}
                                                    </span>
                                                ) : null}
                                            </>
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </FloatingPortal>
            ) : null}
        </>
    );
}
