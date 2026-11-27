// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The strip above an open board's canvas, the same in the board cell and in Library → Boards: the board's drawings row on
// its left (one chip per drawing, a click moves the view there), then Copy view (the canvas as it shows now, at its
// zoom, on the clipboard), Export (the drawing in view to a PNG or SVG file), Delete (the drawing in view, with an Undo
// on its toast) and the Edit switch pinned at its right end. The row reads and writes the board's atoms only
// (boardstore.ts): the canvas publishes the row and eases to a pick. Copy, Export and Delete call the open canvas
// directly (boardcommands.ts), inside the press, as a clipboard write must start there. A board opens in view mode; Edit
// is what brings the drawing tools, selection and a selection's ask back.

import { pushToast } from "@/app/cockpit/notificationstore";
import { cardVariants, indicatorSlide, popoverReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Camera, Download, PenLine, Trash2 } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { boardCommands, type ExportKind } from "./boardcommands";
import { useMenu } from "./boardheader";
import { boardDrawingsAtom, boardEditingAtom, boardPickAtom } from "./boardstore";

// the current chip keeps this far from the row's edge when the row scrolls to it
const CHIP_MARGIN_PX = 12;

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

function StripIcon({
    label,
    attr,
    disabled,
    onClick,
    children,
    expanded,
}: {
    label: string;
    attr: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
    expanded?: boolean;
}) {
    return (
        <button
            type="button"
            {...{ [attr]: "" }}
            aria-label={label}
            title={label}
            disabled={disabled}
            aria-haspopup={expanded != null ? "menu" : undefined}
            aria-expanded={expanded}
            onClick={onClick}
            className={cn(
                "flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-secondary hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-secondary",
                expanded && "bg-surface-hover text-primary"
            )}
        >
            {children}
        </button>
    );
}

function copyView(boardId: string): void {
    const cmds = boardCommands(boardId);
    if (cmds == null) {
        return;
    }
    cmds.copyView().then(
        () =>
            pushToast({
                title: "View copied",
                message: "The board as it shows now, as a picture",
                level: "info",
                check: true,
            }),
        (e) => pushToast({ title: "Couldn't copy the view", message: errorText(e), level: "error" })
    );
}

function exportDrawing(boardId: string, drawingId: string, kind: ExportKind): void {
    const cmds = boardCommands(boardId);
    if (cmds == null) {
        return;
    }
    cmds.exportDrawing(drawingId, kind).then(
        (path) =>
            path != null &&
            pushToast({ title: "Drawing exported", message: fileName(path), level: "info", check: true }),
        (e) => pushToast({ title: "Couldn't export the drawing", message: errorText(e), level: "error" })
    );
}

// Export's menu: the drawing in view as a PNG or an SVG
function ExportMenu({ boardId, drawingId }: { boardId: string; drawingId: string | null }) {
    const [open, setOpen, root] = useMenu();
    const pick = (kind: ExportKind) => {
        setOpen(false);
        if (drawingId != null) {
            exportDrawing(boardId, drawingId, kind);
        }
    };
    return (
        <div
            ref={root}
            className="relative flex-none"
            onKeyDown={(e) => {
                if (open && e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                }
            }}
        >
            <StripIcon
                label="Export the drawing in view"
                attr="data-board-export"
                disabled={drawingId == null}
                expanded={open}
                onClick={() => setOpen(!open)}
            >
                <Download size={13} strokeWidth={2} aria-hidden />
            </StripIcon>
            <MotionConfig reducedMotion="user">
                <AnimatePresence>
                    {open ? (
                        <motion.div
                            key="export-menu"
                            role="menu"
                            aria-label="Export the drawing in view"
                            variants={popoverReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            style={{ transformOrigin: "top right" }}
                            className="absolute right-0 top-full z-30 mt-1 flex min-w-[180px] flex-col rounded-[8px] border border-edge-mid bg-surface-raised py-1 shadow-popover-sm"
                        >
                            {(
                                [
                                    ["png", "PNG image", "twice its size"],
                                    ["svg", "SVG image", "scales to any size"],
                                ] as const
                            ).map(([kind, name, note]) => (
                                <button
                                    key={kind}
                                    type="button"
                                    role="menuitem"
                                    data-board-export-kind={kind}
                                    onClick={() => pick(kind)}
                                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] text-secondary hover:bg-surface-hover hover:text-primary"
                                >
                                    <span className="min-w-0 flex-1">{name}</span>
                                    <span className="flex-none text-[11.5px] text-muted">{note}</span>
                                </button>
                            ))}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </MotionConfig>
        </div>
    );
}

export function BoardStrip({ boardId }: { boardId: string }) {
    const [editing, setEditing] = useAtom(boardEditingAtom(boardId));
    const inView = useAtomValue(boardDrawingsAtom(boardId))?.inView ?? null;
    return (
        <div data-board-strip className="flex h-8 flex-none items-center gap-2 border-b border-edge-mid px-3">
            <div className="min-w-0 flex-1">
                <DrawingsRow boardId={boardId} />
            </div>
            <span className="flex flex-none items-center gap-0.5">
                <StripIcon
                    label="Copy the view as a picture, at its zoom"
                    attr="data-board-copy-view"
                    onClick={() => copyView(boardId)}
                >
                    <Camera size={13} strokeWidth={2} aria-hidden />
                </StripIcon>
                <ExportMenu boardId={boardId} drawingId={inView} />
                <StripIcon
                    label="Delete the drawing in view"
                    attr="data-board-delete"
                    disabled={inView == null}
                    onClick={() => inView != null && boardCommands(boardId)?.deleteDrawing(inView)}
                >
                    <Trash2 size={13} strokeWidth={2} aria-hidden />
                </StripIcon>
            </span>
            <button
                type="button"
                data-board-edit
                aria-pressed={editing}
                title={editing ? "Stop editing" : "Edit the board: draw, move and select shapes"}
                onClick={() => setEditing(!editing)}
                className={cn(
                    "flex h-[22px] flex-none cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    editing
                        ? "bg-surface-selected text-primary"
                        : "text-secondary hover:bg-surface-hover hover:text-primary"
                )}
            >
                <PenLine size={12} strokeWidth={2} aria-hidden />
                Edit
            </button>
        </div>
    );
}

// the board's drawings by number and title: the one in view is current, a new chip enters and the current marker slides
// between chips; hidden while the board has none
function DrawingsRow({ boardId }: { boardId: string }) {
    const state = useAtomValue(boardDrawingsAtom(boardId));
    const pick = useSetAtom(boardPickAtom(boardId));
    // one board can show in two strips at once, and each strip's marker slides only within itself
    const markerId = useId();
    const navRef = useRef<HTMLElement>(null);
    const inView = state?.inView ?? null;
    const count = state?.drawings.length ?? 0;

    // the current chip stays in view as the row scrolls sideways
    useEffect(() => {
        const nav = navRef.current;
        const chip = nav?.querySelector<HTMLElement>('[aria-current="true"]');
        if (nav == null || chip == null) {
            return;
        }
        if (chip.offsetLeft < nav.scrollLeft) {
            nav.scrollLeft = chip.offsetLeft - CHIP_MARGIN_PX;
        } else if (chip.offsetLeft + chip.offsetWidth > nav.scrollLeft + nav.clientWidth) {
            nav.scrollLeft = chip.offsetLeft + chip.offsetWidth - nav.clientWidth + CHIP_MARGIN_PX;
        }
    }, [inView, count]);

    if (state == null || count === 0) {
        return null;
    }
    return (
        <MotionConfig reducedMotion="user">
            <nav
                ref={navRef}
                aria-label="Drawings on this board"
                data-board-drawings
                className="relative flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <AnimatePresence initial={false}>
                    {state.drawings.map((d) => {
                        const current = d.id === inView;
                        return (
                            <motion.button
                                key={d.id}
                                type="button"
                                data-board-drawing={d.id}
                                aria-current={current ? "true" : undefined}
                                title={d.title}
                                variants={cardVariants}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                // a new ts each press, so picking the drawing already picked fits it again
                                onClick={() => pick({ drawingId: d.id, ts: Date.now() })}
                                className={cn(
                                    "relative flex h-[22px] flex-none cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    current
                                        ? "text-primary"
                                        : "text-secondary hover:bg-surface-hover hover:text-primary"
                                )}
                            >
                                {current ? (
                                    <motion.span
                                        layoutId={markerId}
                                        aria-hidden
                                        transition={indicatorSlide}
                                        className="absolute inset-0 rounded-[6px] bg-surface-selected"
                                    />
                                ) : null}
                                <span data-board-drawing-n className="relative font-mono text-[10.5px] text-muted">
                                    {d.n}
                                </span>
                                <span data-board-drawing-title className="relative max-w-[160px] truncate">
                                    {d.title}
                                </span>
                                {state.fresh.includes(d.id) ? (
                                    <span data-board-drawing-new className="relative text-[10.5px] text-muted">
                                        new
                                    </span>
                                ) : null}
                            </motion.button>
                        );
                    })}
                </AnimatePresence>
            </nav>
        </MotionConfig>
    );
}
