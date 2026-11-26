// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The strip above an open board's canvas, the same in the board cell and in Library → Boards: the board's drawings row on
// its left (one chip per drawing, a click moves the view there), then Tidy (the drawing in view laid out again,
// boardlayout.ts) and the Edit switch pinned at its right end. It reads and
// writes the board's atoms only (boardstore.ts): the canvas publishes the row and eases to a pick, so nothing is passed
// through it. A board opens in view mode; Edit is what brings the drawing tools, selection and a selection's ask back.

import { cardVariants, indicatorSlide } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { PenLine, Workflow } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { boardDrawingsAtom, boardEditingAtom, boardPickAtom, boardTidyAtom } from "./boardstore";

// the current chip keeps this far from the row's edge when the row scrolls to it
const CHIP_MARGIN_PX = 12;

export function BoardStrip({ boardId }: { boardId: string }) {
    const [editing, setEditing] = useAtom(boardEditingAtom(boardId));
    const inView = useAtomValue(boardDrawingsAtom(boardId))?.inView ?? null;
    const tidy = useSetAtom(boardTidyAtom(boardId));
    return (
        <div data-board-strip className="flex h-8 flex-none items-center gap-2 border-b border-edge-mid px-3">
            <div className="min-w-0 flex-1">
                <DrawingsRow boardId={boardId} />
            </div>
            <button
                type="button"
                data-board-tidy
                disabled={inView == null}
                title="Tidy the drawing in view: shapes in rows along its flow, arrows routed around them (Ctrl+Z undoes)"
                onClick={() => inView != null && tidy({ drawingId: inView, ts: Date.now() })}
                className="flex h-[22px] flex-none cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[12px] text-secondary hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-secondary"
            >
                <Workflow size={12} strokeWidth={2} aria-hidden />
                Tidy
            </button>
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
