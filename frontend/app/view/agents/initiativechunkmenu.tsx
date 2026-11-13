// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pieces the initiative popover (the Terminal header's) and the initiative band (Chat's) share: the popover's styling
// constants and a chunk's status menu, the `role="menu"` list of chunkMenuItems with the rename row. The rename and note
// inputs stay in each component.

import { cn } from "@/util/util";
import { Check, Pencil } from "lucide-react";
import type { MouseEvent } from "react";
import { CHUNK_RENAME, chunkMenuItems, type PopoverStatusTone } from "./initiativepopovermodel";

export const STATUS_TEXT: Record<PopoverStatusTone, string> = {
    success: "text-success",
    working: "text-working",
    asking: "text-asking",
    muted: "text-ink-mid",
    faint: "text-ink-faint",
};

export const BTN =
    "inline-flex h-[26px] cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] text-[11.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
export const ROW = "flex min-h-[26px] cursor-pointer items-center gap-[9px] rounded-[6px] px-[8px] -mx-[8px]";
export const CURSOR_RING = "ring-1 ring-inset ring-accent/60";

// a mouse press must not take focus off the root whose keys these rows answer to
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** A chunk's status menu: the statuses it can be set to (its own ticked), then Rename. `at` is the menu's own cursor,
 *  `onHover` moves it, `onChoose` gets the chosen item's id (a status, or CHUNK_RENAME). `dataAttr` is the data attribute
 *  that marks the menu for a scenario to find (`data-popover-menu`, `data-band-menu`); the items carry `data-menu-item`. */
export function ChunkStatusMenu({
    status,
    at,
    onHover,
    onChoose,
    dataAttr,
}: {
    status: string;
    at: number;
    onHover: (index: number) => void;
    onChoose: (id: string) => void;
    dataAttr: string;
}) {
    return (
        <div
            role="menu"
            {...{ [dataAttr]: "" }}
            className="mb-[2px] mt-[4px] flex flex-col rounded-[7px] border border-edge-mid bg-surface p-[3px]"
        >
            {chunkMenuItems(status).map((item, i) => (
                <div
                    key={item.id}
                    role="menuitem"
                    data-menu-item={item.id}
                    onMouseDown={keepFocus}
                    onMouseMove={() => onHover(i)}
                    onClick={(e) => {
                        e.stopPropagation();
                        onChoose(item.id);
                    }}
                    className={cn(
                        "flex h-[24px] cursor-pointer items-center gap-[8px] rounded-[5px] px-[8px] text-[11.5px]",
                        item.id === CHUNK_RENAME && "mt-[2px] border-t border-edge-mid",
                        i === at ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover"
                    )}
                >
                    {item.id === CHUNK_RENAME ? (
                        <Pencil size={11} aria-hidden className="flex-none text-ink-mid" />
                    ) : (
                        <span className="flex w-[11px] flex-none justify-center text-accent">
                            {item.current ? <Check size={11} strokeWidth={2.4} aria-hidden /> : null}
                        </span>
                    )}
                    {item.label}
                </div>
            ))}
        </div>
    );
}
