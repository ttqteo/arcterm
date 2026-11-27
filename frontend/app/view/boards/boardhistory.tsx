// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// History in a board's header (the board cell's and Library → Boards'): a clock with the turn count that opens the
// board's talk as a list, newest first, what each turn drew or asked, when, and how it went (historyRows). A press on a
// drawn turn eases the canvas to its drawing, as its chip in the drawings row does, and closes the list; a row's tooltip
// holds the whole request. It only reads: Stop and Retry are the status line's (boardstatus.tsx).

import { microFade, popoverReveal } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronLeft, History } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useMenu } from "./boardheader";
import { boardBackAtom, boardDrawingsAtom, boardPickAtom, goBack } from "./boardstore";
import { historyRows, type TurnShown } from "./boardtalkmodel";

// Back in a board's header: there while a followed link left a drawing to return to (boardBackAtom); a press, or
// Backspace on the canvas, eases back to it
export function BoardBack({ boardId }: { boardId: string }) {
    const stack = useAtomValue(boardBackAtom(boardId));
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false}>
                {stack.length > 0 ? (
                    <motion.button
                        key="back"
                        type="button"
                        data-board-back
                        variants={microFade}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        title="Back to the drawing the link left (Backspace)"
                        onClick={() => goBack(boardId)}
                        className="flex h-[22px] flex-none cursor-pointer items-center gap-0.5 rounded-[6px] px-1.5 text-muted hover:bg-surface-hover hover:text-primary"
                    >
                        <ChevronLeft size={13} strokeWidth={2} aria-hidden />
                        Back
                    </motion.button>
                ) : null}
            </AnimatePresence>
        </MotionConfig>
    );
}

const TONE: Partial<Record<TurnShown, string>> = {
    drawn: "text-success",
    answering: "text-success",
    slow: "text-warning",
    failed: "text-error",
};

export function BoardHistory({ boardId, talk }: { boardId: string; talk: BoardTalk | null }) {
    const [open, setOpen, root] = useMenu();
    const row = useAtomValue(boardDrawingsAtom(boardId));
    const count = talk?.turns.length ?? 0;
    if (count === 0) {
        return null;
    }
    const rows = open ? historyRows(talk, row?.drawings ?? [], Date.now()) : [];
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
            <button
                type="button"
                data-board-history
                aria-haspopup="menu"
                aria-expanded={open}
                title="History: every turn of this board"
                onClick={() => setOpen(!open)}
                className={cn(
                    "flex h-[22px] flex-none cursor-pointer items-center gap-1 rounded-[6px] px-1.5 tabular-nums hover:bg-surface-hover hover:text-primary",
                    open ? "bg-surface-selected text-primary" : "text-muted"
                )}
            >
                <History size={13} strokeWidth={2} aria-hidden />
                <span data-board-history-count>{count}</span>
            </button>
            <MotionConfig reducedMotion="user">
                <AnimatePresence>
                    {open ? (
                        <motion.div
                            key="history"
                            role="menu"
                            aria-label="History of this board"
                            data-board-history-menu
                            variants={popoverReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            style={{ transformOrigin: "top right" }}
                            className="absolute right-0 top-full z-30 mt-1 flex max-h-[min(420px,70vh)] w-[340px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-[8px] border border-edge-mid bg-surface-raised py-1 shadow-popover-sm"
                        >
                            <div className="flex flex-none px-3 py-1 text-[11.5px] text-muted">
                                <span className="flex-1">History · {count}</span>
                                <span>newest first</span>
                            </div>
                            {rows.map((r) => {
                                const inView = r.drawingId != null && r.drawingId === row?.inView;
                                return (
                                    <button
                                        key={r.id}
                                        type="button"
                                        role="menuitem"
                                        data-board-history-row={r.id}
                                        data-board-history-state={r.state}
                                        aria-current={inView ? "true" : undefined}
                                        disabled={r.drawingId == null}
                                        title={r.brief || r.title}
                                        onClick={() => {
                                            if (r.drawingId == null) {
                                                return;
                                            }
                                            setOpen(false);
                                            globalStore.set(boardPickAtom(boardId), {
                                                drawingId: r.drawingId,
                                                ts: Date.now(),
                                            });
                                        }}
                                        className={cn(
                                            "flex gap-2 px-3 py-1.5 text-left text-[12px] enabled:cursor-pointer enabled:hover:bg-surface-hover",
                                            inView && "bg-surface-selected"
                                        )}
                                    >
                                        <span className="w-[42px] flex-none tabular-nums text-muted">{r.time}</span>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span
                                                className={cn(
                                                    "truncate",
                                                    r.drawingId != null ? "text-primary" : "text-secondary"
                                                )}
                                            >
                                                {r.by === "you" ? `“${r.title}”` : r.title}
                                            </span>
                                            <span className="truncate text-[11px] text-muted">
                                                <span className={TONE[r.state]}>{r.stateText}</span>
                                                {r.by === "you" ? " · you" : " · agent"}
                                                {r.detail ? ` · ${r.detail}` : ""}
                                                {inView ? " · in view" : ""}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </MotionConfig>
        </div>
    );
}
