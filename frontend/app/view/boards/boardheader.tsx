// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The split's header: the board's name (a switcher while the agent has more than one board), its facts, Expand or
// Collapse, and Close. A board in a grid of several cells has no Expand: it opens expanded and stays so.

import { cn } from "@/util/util";
import { Check, ChevronDown, Maximize2, Minimize2, Shapes, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { boardFacts } from "./boardtalkmodel";

export interface BoardHeaderProps {
    board: BoardInfo | undefined; // null-ish until the list has been read
    boards: readonly BoardInfo[]; // every board of the agent: what the switcher lists
    expanded: boolean;
    canExpand: boolean;
    onSwitch: (boardId: string) => void;
    onToggleExpanded: () => void;
    onClose: () => void;
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
}: BoardHeaderProps) {
    const expandLabel = expanded ? "Collapse" : "Expand";
    return (
        <div
            data-board-header
            className="flex h-9 flex-none items-center gap-2 border-b border-edge-mid px-3 text-[12px] text-muted"
        >
            <Shapes size={14} strokeWidth={2} aria-hidden className="flex-none" />
            <BoardSwitcher board={board} boards={boards} onSwitch={onSwitch} />
            {board != null ? (
                <>
                    <span aria-hidden className="flex-none">
                        ·
                    </span>
                    <span data-board-facts className="min-w-0 truncate">
                        {boardFacts(board, Date.now())}
                    </span>
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
