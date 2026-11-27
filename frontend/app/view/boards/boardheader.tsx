// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The board cell's header: the board's name (a switcher while its chat has more than one board), its facts, the chat
// the board reads (a picker of the project's live Claude chats, which moves the board to another), Hide or Show turns
// (the turns column folded to a strip), Expand or Collapse (the cell over the whole grid), and Close. While a part of
// the drawing in view is read (boardparts.ts), the facts give way to the part's name, a ‹ n/N › stepper and Whole
// drawing; on the whole drawing a ‹ N parts › stepper starts the reading. The drawings themselves are the strip's row
// (boardstrip.tsx), not the header's.

import { microFade } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Maximize2,
    MessageSquare,
    Minimize2,
    Shapes,
    Trash2,
    X,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { stepPart, type BoardPart } from "./boardparts";
import { boardFacts } from "./boardtalkmodel";

export interface BoardHeaderProps {
    board: BoardInfo | undefined; // null-ish until the list has been read
    boards: readonly BoardInfo[]; // every board of its chat: what the switcher lists
    expanded: boolean;
    onSwitch: (boardId: string) => void;
    onToggleExpanded?: () => void; // left out for a board shown alone, which already fills the centre
    // the chat the board reads: its title, and whether it still runs
    chat?: { id: string; title: string; alive: boolean };
    chats?: readonly { id: string; name: string }[]; // the live Claude chats of the board's project, to move it to
    onChat?: (tabId: string) => void;
    onClose: () => void;
    parts?: readonly BoardPart[];
    part?: number | null;
    onPart?: (part: number | null) => void;
    // while a part is read in Edit: takes its shapes off the board (a part drawn by mistake); the toast holds an Undo.
    // Left out in view mode, where the header only reads.
    onDeletePart?: (part: BoardPart) => void;
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

// a menu's open state, closed by a press outside `root`
export function useMenu(): [boolean, (open: boolean) => void, RefObject<HTMLDivElement>] {
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
    return [open, setOpen, root as RefObject<HTMLDivElement>];
}

// The chat the board reads, as a menu of the project's live Claude chats: picking one moves the board to it. An ended
// chat reads as such, and the menu is how the board gets a chat again.
function ChatPicker({ chat, chats, onChat }: Required<Pick<BoardHeaderProps, "chat" | "chats" | "onChat">>) {
    const [open, setOpen, root] = useMenu();
    const label = chat.alive ? chat.title : chat.title !== "" ? `${chat.title} (ended)` : "No chat";
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
                data-board-chat={chat.id}
                data-board-chat-ended={chat.alive ? undefined : ""}
                aria-haspopup="menu"
                aria-expanded={open}
                title="The chat this board reads. Pick another to move the board to it"
                onClick={() => setOpen(!open)}
                className={cn(
                    "flex max-w-[180px] cursor-pointer items-center gap-1 rounded-[6px] px-1.5 py-0.5 hover:bg-surface-hover",
                    chat.alive ? "text-secondary" : "text-warning"
                )}
            >
                <MessageSquare size={12} strokeWidth={2} aria-hidden className="flex-none" />
                <span className="truncate">{label}</span>
                <ChevronDown size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
            </button>
            {open ? (
                <div
                    role="menu"
                    aria-label="Move the board to a chat"
                    className="absolute right-0 top-full z-30 mt-1 flex min-w-[220px] flex-col rounded-[8px] border border-edge-mid bg-surface-raised py-1 shadow-popover-sm"
                >
                    <div className="px-3 py-1 text-[11.5px] text-muted">Reads the chat</div>
                    {chats.length === 0 ? (
                        <div data-board-chat-none className="px-3 py-1.5 text-[12px] text-muted">
                            No Claude chat of this project is running
                        </div>
                    ) : (
                        chats.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                role="menuitem"
                                data-board-chat-item={c.id}
                                aria-current={c.id === chat.id ? "true" : undefined}
                                onClick={() => {
                                    setOpen(false);
                                    if (c.id !== chat.id) {
                                        onChat(c.id);
                                    }
                                }}
                                className={cn(
                                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-surface-hover",
                                    c.id === chat.id ? "text-primary" : "text-secondary"
                                )}
                            >
                                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                {c.id === chat.id ? (
                                    <Check size={12} strokeWidth={2} aria-hidden className="flex-none" />
                                ) : null}
                            </button>
                        ))
                    )}
                </div>
            ) : null}
        </div>
    );
}

// the name; with other boards of the same chat it opens a list to switch to one
function BoardSwitcher({ board, boards, onSwitch }: Pick<BoardHeaderProps, "board" | "boards" | "onSwitch">) {
    const [open, setOpen, root] = useMenu();
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
                    aria-label="Boards of this chat"
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
    onSwitch,
    onToggleExpanded,
    onClose,
    chat,
    chats,
    onChat,
    parts = [],
    part = null,
    onPart,
    onDeletePart,
}: BoardHeaderProps) {
    const expandLabel = expanded ? "Collapse" : "Expand";
    const reading = part != null && onPart != null ? parts[part] : undefined;
    const stepping = onPart != null && (reading != null || parts.length >= 2);
    // the middle of the stepper is as wide in both states and for every part ("12 parts", "3/12"), so its arrows hold
    // their place while you step and as reading starts or ends
    const middleCh = `${String(parts.length).length + 6}ch`;
    return (
        <div
            data-board-header
            className="flex h-9 flex-none items-center gap-2 border-b border-edge-mid px-3 text-[12px] text-muted"
        >
            <Shapes size={14} strokeWidth={2} aria-hidden className="flex-none" />
            <BoardSwitcher board={board} boards={boards} onSwitch={onSwitch} />
            {reading != null ? (
                <>
                    <span aria-hidden className="flex-none">
                        ›
                    </span>
                    <span data-board-part-name title={reading.label} className="min-w-0 truncate text-primary">
                        {reading.label}
                    </span>
                </>
            ) : board != null ? (
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
            {stepping ? (
                // pinned beside the right-hand buttons, which hold still, so the part's name never moves it
                <span
                    data-board-parts-stepper={reading == null ? "" : undefined}
                    className="flex flex-none items-center"
                >
                    <MotionConfig reducedMotion="user">
                        <AnimatePresence initial={false}>
                            {reading != null && onDeletePart != null ? (
                                <motion.span
                                    key="delete-part"
                                    variants={microFade}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    className="flex"
                                >
                                    <HeaderButton
                                        label="Delete this part (Undo on its toast)"
                                        attr="data-board-part-delete"
                                        onClick={() => onDeletePart(reading)}
                                    >
                                        <Trash2 size={13} strokeWidth={2} />
                                    </HeaderButton>
                                </motion.span>
                            ) : null}
                        </AnimatePresence>
                    </MotionConfig>
                    {reading != null ? (
                        <button
                            type="button"
                            data-board-part-whole
                            title="Whole drawing (Esc)"
                            onClick={() => onPart!(null)}
                            className="mr-1 flex-none cursor-pointer rounded-[6px] px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-primary"
                        >
                            Whole drawing
                        </button>
                    ) : null}
                    <HeaderButton
                        label={reading != null ? "Previous part (←)" : "Last part (←)"}
                        attr={reading != null ? "data-board-part-prev" : "data-board-parts-prev"}
                        onClick={() => onPart!(stepPart(parts.length, part, -1))}
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </HeaderButton>
                    {reading != null ? (
                        <span
                            data-board-part-index
                            style={{ minWidth: middleCh }}
                            className="flex-none text-center tabular-nums"
                        >
                            {part! + 1}/{parts.length}
                        </span>
                    ) : (
                        <button
                            type="button"
                            data-board-parts-count
                            title="Read the drawing part by part (→)"
                            onClick={() => onPart!(0)}
                            style={{ minWidth: middleCh }}
                            className="flex-none cursor-pointer rounded-[6px] py-0.5 text-center tabular-nums hover:bg-surface-hover hover:text-primary"
                        >
                            {parts.length} parts
                        </button>
                    )}
                    <HeaderButton
                        label={reading != null ? "Next part (→)" : "First part (→)"}
                        attr={reading != null ? "data-board-part-next" : "data-board-parts-next"}
                        onClick={() => onPart!(stepPart(parts.length, part, 1))}
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </HeaderButton>
                </span>
            ) : null}
            {chat != null && chats != null && onChat != null ? (
                <ChatPicker chat={chat} chats={chats} onChat={onChat} />
            ) : null}
            {onToggleExpanded != null ? (
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
