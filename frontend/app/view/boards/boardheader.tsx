// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The split's header: the board's name (a switcher while the agent has more than one board), its facts, Expand or
// Collapse, and Close. A board in a grid of several cells has no Expand: it opens expanded and stays so. While a part of
// the board is read (boardparts.ts), the facts give way to the part's name, a ‹ n/N › stepper and Whole board; on the
// whole board a ‹ N parts › stepper starts the reading.

import { cn } from "@/util/util";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Maximize2, Minimize2, Shapes, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { stepPart, type BoardPart } from "./boardparts";
import { boardFacts } from "./boardtalkmodel";

export interface BoardHeaderProps {
    board: BoardInfo | undefined; // null-ish until the list has been read
    boards: readonly BoardInfo[]; // every board of the agent: what the switcher lists
    expanded: boolean;
    canExpand: boolean;
    onSwitch: (boardId: string) => void;
    onToggleExpanded: () => void;
    onClose: () => void;
    parts?: readonly BoardPart[];
    part?: number | null;
    onPart?: (part: number | null) => void;
}

function HeaderButton({
    label,
    onClick,
    children,
    attr,
}: {
    label: string;
    onClick: () => void;
    children: ReactNode;
    attr: string;
}) {
    return (
        <button
            type="button"
            {...{ [attr]: "" }}
            aria-label={label}
            title={label}
            onClick={onClick}
            className="flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary"
        >
            {children}
        </button>
    );
}

// the name; with other boards of the same agent it opens a list to switch to one
function BoardSwitcher({ board, boards, onSwitch }: Pick<BoardHeaderProps, "board" | "boards" | "onSwitch">) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open]);
    const name = board?.name ?? "Board";
    if (boards.length < 2) {
        return (
            <span data-board-name className="min-w-0 flex-none truncate text-primary">
                {name}
            </span>
        );
    }
    const now = Date.now();
    return (
        <div
            ref={root}
            className="relative min-w-0 flex-none"
            onKeyDown={(e) => {
                if (open && e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                }
            }}
        >
            <button
                type="button"
                data-board-switcher
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex min-w-0 cursor-pointer items-center gap-1 rounded-[6px] px-1 py-0.5 text-primary hover:bg-surface-hover"
            >
                <span data-board-name className="truncate">
                    {name}
                </span>
                <ChevronDown size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
            </button>
            {open ? (
                <div
                    role="menu"
                    aria-label="Boards of this agent"
                    className="absolute left-0 top-full z-30 mt-1 flex min-w-[220px] flex-col rounded-[8px] border border-edge-mid bg-surface-raised py-1 shadow-popover-sm"
                >
                    {boards.map((b) => (
                        <button
                            key={b.id}
                            type="button"
                            role="menuitem"
                            data-board-switch-item={b.id}
                            aria-current={b.id === board?.id ? "true" : undefined}
                            onClick={() => {
                                setOpen(false);
                                if (b.id !== board?.id) {
                                    onSwitch(b.id);
                                }
                            }}
                            className={cn(
                                "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-surface-hover",
                                b.id === board?.id ? "text-primary" : "text-secondary"
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate">{b.name}</span>
                            <span className="flex-none text-[11.5px] text-muted">{boardFacts(b, now)}</span>
                            {b.id === board?.id ? (
                                <Check size={12} strokeWidth={2} aria-hidden className="flex-none" />
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function BoardHeader({
    board,
    boards,
    expanded,
    canExpand,
    onSwitch,
    onToggleExpanded,
    onClose,
    parts = [],
    part = null,
    onPart,
}: BoardHeaderProps) {
    const expandLabel = expanded ? "Collapse" : "Expand";
    const reading = part != null ? parts[part] : undefined;
    return (
        <div
            data-board-header
            className="flex h-9 flex-none items-center gap-2 border-b border-edge-mid px-3 text-[12px] text-muted"
        >
            <Shapes size={14} strokeWidth={2} aria-hidden className="flex-none" />
            <BoardSwitcher board={board} boards={boards} onSwitch={onSwitch} />
            {reading != null && onPart != null ? (
                <>
                    <span aria-hidden className="flex-none">
                        ›
                    </span>
                    <span data-board-part-name className="min-w-0 truncate text-primary">
                        {reading.label}
                    </span>
                    <HeaderButton
                        label="Previous part (←)"
                        attr="data-board-part-prev"
                        onClick={() => onPart(stepPart(parts.length, part, -1))}
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </HeaderButton>
                    <span data-board-part-index className="flex-none tabular-nums">
                        {part! + 1}/{parts.length}
                    </span>
                    <HeaderButton
                        label="Next part (→)"
                        attr="data-board-part-next"
                        onClick={() => onPart(stepPart(parts.length, part, 1))}
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </HeaderButton>
                    <button
                        type="button"
                        data-board-part-whole
                        title="Whole board (Esc)"
                        onClick={() => onPart(null)}
                        className="flex-none cursor-pointer rounded-[6px] px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-primary"
                    >
                        Whole board
                    </button>
                </>
            ) : board != null ? (
                <>
                    <span aria-hidden className="flex-none">
                        ·
                    </span>
                    <span data-board-facts className="min-w-0 truncate">
                        {boardFacts(board, Date.now())}
                    </span>
                    {parts.length >= 2 && onPart != null ? (
                        <span data-board-parts-stepper className="flex flex-none items-center">
                            <HeaderButton
                                label="Last part (←)"
                                attr="data-board-parts-prev"
                                onClick={() => onPart(stepPart(parts.length, null, -1))}
                            >
                                <ChevronLeft size={14} strokeWidth={2} />
                            </HeaderButton>
                            <button
                                type="button"
                                data-board-parts-count
                                title="Read the board part by part (→)"
                                onClick={() => onPart(0)}
                                className="flex-none cursor-pointer rounded-[6px] px-1 py-0.5 tabular-nums hover:bg-surface-hover hover:text-primary"
                            >
                                {parts.length} parts
                            </button>
                            <HeaderButton
                                label="First part (→)"
                                attr="data-board-parts-next"
                                onClick={() => onPart(stepPart(parts.length, null, 1))}
                            >
                                <ChevronRight size={14} strokeWidth={2} />
                            </HeaderButton>
                        </span>
                    ) : null}
                </>
            ) : null}
            <div className="flex-1" />
            {canExpand ? (
                <HeaderButton label={expandLabel} attr="data-board-expand" onClick={onToggleExpanded}>
                    {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
                </HeaderButton>
            ) : null}
            <HeaderButton label="Close" attr="data-board-close" onClick={onClose}>
                <X size={14} strokeWidth={2} />
            </HeaderButton>
        </div>
    );
}
