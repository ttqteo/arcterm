// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The folded Agent tree's peek (treepeekmodel.ts): the strip's status dots, and the small card that opens beside it after a
// pause on the strip, or while Alt is held, to pick an agent or terminal without unfolding the tree. The card floats
// over the centre, so the terminal under it never resizes.

import { digitHintAtom } from "@/app/cockpit/digithints";
import { MOTION, springPop } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { PenTool } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { openBoardsAtom } from "../boards/boardentries";
import { hiddenBoardsAtom } from "../boards/boardsplitstore";
import { useBoardList } from "../boards/boardstore";
import { activeNavRows } from "./activenav";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { selectAgentRow } from "./agenttree";
import { projectGridsAtom } from "./gridstore";
import { collapsedProjectsAtom } from "./projectfoldstore";
import { toolTerminalName } from "./toolsmodel";
import { toolsStatusAtom } from "./toolsstore";
import {
    PEEK_CLOSE_GRACE_MS,
    PEEK_OPEN_DELAY_MS,
    peekGroups,
    peekShown,
    peekStripItems,
    type PeekDot,
    type PeekGroup,
    type PeekRow,
} from "./treepeekmodel";
import { unreadLabel } from "./unreadagents";
import { unreadAgentsAtom } from "./unreadagentsstore";

const DOT_CLASS: Record<PeekDot, string> = {
    asking: "bg-asking",
    unread: "bg-unread",
    working: "bg-working",
    idle: "bg-ink-faint",
};

// on the strip an idle dot steps back (smaller) so the ones that want you stand out; the selected one keeps its state's
// dot (an idle one grows to full size in a lighter grey) on a lit tile, the fill the tree's selected row wears, which
// glides from one dot to the next as the selection moves
function stripDotClass(dot: PeekDot, selected: boolean): string {
    if (dot !== "idle") {
        return cn("h-[7px] w-[7px] rounded-full", DOT_CLASS[dot]);
    }
    return selected ? "h-[7px] w-[7px] rounded-full bg-secondary" : "h-[4px] w-[4px] rounded-full bg-ink-faint";
}

// the groups, re-read whenever the roster, the focus or the folders change
function usePeekGroups(model: AgentsViewModel): PeekGroup[] {
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    useAtomValue(model.focusIdAtom);
    useAtomValue(model.projectFilterAtom);
    useAtomValue(collapsedProjectsAtom);
    // the splits and their boards (activeNavRows reads them through globalStore); the list loads here too, since the
    // tree that loads it is not mounted while folded
    useAtomValue(projectGridsAtom);
    useAtomValue(openBoardsAtom);
    useAtomValue(hiddenBoardsAtom);
    useBoardList("");
    const tools = useAtomValue(toolsStatusAtom) ?? [];
    const unread = useAtomValue(unreadAgentsAtom);
    const byId = new Map<string, AgentVM>([...agents, ...terminals].map((v) => [v.id, v]));
    return peekGroups(
        activeNavRows(model),
        byId,
        (v) => (v.kind === "terminal" ? toolTerminalName(v, tools) : v.name),
        unread
    );
}

// The pointer's half of when the card shows: open after a pause on the strip, closed a moment after the pointer leaves
// both the strip and the card (the grace lets it cross the gap between them).
export function usePeekHover(folded: boolean) {
    const [hoverOpen, setHoverOpen] = useState(false);
    const timer = useRef<number | undefined>(undefined);
    const clear = () => {
        if (timer.current != null) {
            window.clearTimeout(timer.current);
            timer.current = undefined;
        }
    };
    useEffect(() => clear, []);
    useEffect(() => {
        if (!folded) {
            clear();
            setHoverOpen(false);
        }
    }, [folded]);
    const enter = () => {
        clear();
        if (folded && !hoverOpen) {
            timer.current = window.setTimeout(() => setHoverOpen(true), PEEK_OPEN_DELAY_MS);
        }
    };
    const leave = () => {
        clear();
        timer.current = window.setTimeout(() => setHoverOpen(false), PEEK_CLOSE_GRACE_MS);
    };
    const close = () => {
        clear();
        setHoverOpen(false);
    };
    return { hoverOpen, enter, leave, close };
}

// The folded strip's dots, a gap between projects; the strip clips them when they outrun its height.
export function PeekStripDots({ model }: { model: AgentsViewModel }) {
    const groups = usePeekGroups(model);
    const focusId = useAtomValue(model.focusIdAtom);
    return (
        <span
            data-tree-peek-dots
            className="flex min-h-0 w-full flex-col items-center gap-[6px] overflow-hidden pb-[8px] pt-[6px]"
        >
            {peekStripItems(groups).map((item) => {
                const dots = item.dots.map((d) => (
                    <span key={d.id} className="relative flex w-full shrink-0 justify-center">
                        {d.id === focusId ? (
                            <motion.span
                                layoutId="tree-strip-selected"
                                data-tree-peek-selected
                                transition={{ duration: MOTION.durMacro, ease: MOTION.easeFluid }}
                                // centred by top and left, not a translate: motion owns transform while it glides
                                className="absolute left-[calc(50%-8px)] top-[calc(50%-7px)] h-[14px] w-[16px] rounded-[5px] bg-surface-selected"
                            />
                        ) : null}
                        <span
                            data-tree-peek-dot={d.board ? "board" : d.dot}
                            className={cn(
                                "relative shrink-0 transition-[height,width,background-color] duration-150",
                                // a board's cell: a small square, outlined, beside its split's agents
                                d.board
                                    ? "h-[6px] w-[6px] rounded-[1.5px] border border-secondary"
                                    : stripDotClass(d.dot, d.id === focusId)
                            )}
                        />
                    </span>
                ));
                if (item.split == null) {
                    return (
                        <span key={item.key} className={cn("flex w-full shrink-0", item.gapBefore && "mt-[8px]")}>
                            {dots}
                        </span>
                    );
                }
                // a split's dots on one pill, the accent the tree's split row wears (fainter when it is off screen)
                return (
                    <span
                        key={item.key}
                        data-tree-peek-split={item.split.key}
                        className={cn(
                            "flex w-[16px] shrink-0 flex-col items-center gap-[6px] rounded-[7px] border py-[4px]",
                            item.split.shown ? "border-accent/60 bg-accent/20" : "border-border bg-surface-raised",
                            item.gapBefore && "mt-[8px]"
                        )}
                    >
                        {dots}
                    </span>
                );
            })}
        </span>
    );
}

export function TreePeekCard({
    model,
    folded,
    hoverOpen,
    onPicked,
}: {
    model: AgentsViewModel;
    folded: boolean;
    hoverOpen: boolean;
    onPicked: () => void;
}) {
    const altHeld = useAtomValue(digitHintAtom) === "alt";
    const shown = peekShown({ folded, hoverOpen, altHeld });
    return (
        <AnimatePresence>
            {shown ? <PeekCard key="peek" model={model} altHeld={altHeld} onPicked={onPicked} /> : null}
        </AnimatePresence>
    );
}

function PeekCard({ model, altHeld, onPicked }: { model: AgentsViewModel; altHeld: boolean; onPicked: () => void }) {
    const pop = usePartMotion(springPop);
    const groups = usePeekGroups(model);
    const focusId = useAtomValue(model.focusIdAtom);
    return (
        <motion.nav
            {...pop}
            data-tree-peek
            aria-label="Agents"
            className="absolute left-full top-[8px] z-50 ml-[4px] flex max-h-[calc(100%-16px)] w-[264px] origin-top-left flex-col gap-px overflow-y-auto rounded-[12px] border border-edge-mid p-[6px] frost shadow-popover-soft"
        >
            {groups.length === 0 ? (
                <div className="px-2 py-1.5 text-[12px] text-muted">No agents open</div>
            ) : (
                groups.map((g) => (
                    <div key={g.project} className="flex flex-col gap-px">
                        <div className="truncate px-2 pb-0.5 pt-1.5 text-[11px] text-muted">{g.label}</div>
                        {splitRuns(g.rows).map((run) =>
                            run.split == null ? (
                                <Fragment key={run.rows[0].id}>
                                    {run.rows.map((r) => (
                                        <PeekRowButton
                                            key={r.id}
                                            model={model}
                                            row={r}
                                            focusId={focusId}
                                            altHeld={altHeld}
                                            onPicked={onPicked}
                                        />
                                    ))}
                                </Fragment>
                            ) : (
                                // a split's rows in one frame, the accent the tree's split row wears (fainter off screen)
                                <SplitFrame
                                    key={`split:${run.split.key}`}
                                    splitKey={run.split.key}
                                    shown={run.split.shown}
                                >
                                    {run.rows.map((r) => (
                                        <PeekRowButton
                                            key={r.id}
                                            model={model}
                                            row={r}
                                            focusId={focusId}
                                            altHeld={altHeld}
                                            onPicked={onPicked}
                                        />
                                    ))}
                                </SplitFrame>
                            )
                        )}
                    </div>
                ))
            )}
        </motion.nav>
    );
}

// a group's rows cut into runs: a split's rows (consecutive, peekGroups) as one run, every other row a run of its own
function splitRuns(rows: readonly PeekRow[]): { split?: PeekRow["split"]; rows: PeekRow[] }[] {
    const out: { split?: PeekRow["split"]; rows: PeekRow[] }[] = [];
    for (const r of rows) {
        const last = out[out.length - 1];
        if (r.split != null && last?.split?.key === r.split.key) {
            last.rows.push(r);
        } else {
            out.push({ ...(r.split != null ? { split: r.split } : {}), rows: [r] });
        }
    }
    return out;
}

function SplitFrame({ splitKey, shown, children }: { splitKey: string; shown: boolean; children: ReactNode }) {
    return (
        <div
            data-tree-peek-split={splitKey}
            data-tree-peek-split-shown={shown ? "true" : undefined}
            className={cn(
                "my-px flex flex-col gap-px rounded-[8px] border p-px",
                shown ? "border-accent/60 bg-accent/10" : "border-border"
            )}
        >
            {children}
        </div>
    );
}

function PeekRowButton({
    model,
    row: r,
    focusId,
    altHeld,
    onPicked,
}: {
    model: AgentsViewModel;
    row: PeekRow;
    focusId: string | undefined;
    altHeld: boolean;
    onPicked: () => void;
}) {
    if (r.board != null) {
        const pick = r.board.pick;
        return (
            <button
                type="button"
                data-tree-peek-board={r.id}
                title={r.name}
                onClick={() => {
                    // the split's first agent, which brings the split up with the board in it
                    selectAgentRow(model, pick);
                    onPicked();
                }}
                className="flex h-[26px] min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-secondary hover:bg-surface-hover"
            >
                <PenTool size={11} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
            </button>
        );
    }
    return (
        <button
            type="button"
            data-tree-peek-row={r.id}
            aria-current={r.id === focusId ? "true" : undefined}
            onClick={() => {
                selectAgentRow(model, r.id);
                onPicked();
            }}
            className={cn(
                "flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px]",
                r.split != null ? "h-[26px]" : "h-[28px]",
                r.id === focusId ? "bg-surface-selected text-primary" : "hover:bg-surface-hover",
                r.id !== focusId && (r.dot === "idle" ? "text-secondary" : "text-primary"),
                r.dot === "unread" && "font-semibold"
            )}
        >
            <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", DOT_CLASS[r.dot])} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.dot === "asking" ? (
                <span className="shrink-0 text-[11px] text-asking">asking</span>
            ) : r.unread != null ? (
                <span
                    data-tree-peek-unread={r.unread}
                    className="flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-full bg-unread px-1 text-[9.5px] font-bold tabular-nums text-background"
                >
                    {unreadLabel(r.unread)}
                </span>
            ) : null}
            {altHeld && r.digit != null ? (
                <kbd className="min-w-[16px] shrink-0 rounded-[4px] border border-edge-strong bg-surface-selected px-[3px] text-center font-mono text-[10px] leading-[14px] text-primary">
                    {r.digit}
                </kbd>
            ) : null}
        </button>
    );
}
