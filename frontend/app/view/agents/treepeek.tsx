// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The folded Agent tree's peek (treepeekmodel.ts): the strip's status dots, and the small card that opens beside it after a
// pause on the strip, or while Alt is held, to pick an agent or terminal without unfolding the tree. The card floats
// over the centre, so the terminal under it never resizes.

import { digitHintAtom } from "@/app/cockpit/digithints";
import { springPop } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { activeNavRows } from "./activenav";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { selectAgentRow } from "./agenttree";
import { collapsedProjectsAtom } from "./projectfoldstore";
import { toolTerminalName } from "./toolsmodel";
import { toolsStatusAtom } from "./toolsstore";
import {
    PEEK_CLOSE_GRACE_MS,
    PEEK_OPEN_DELAY_MS,
    peekDots,
    peekGroups,
    peekShown,
    type PeekDot,
    type PeekGroup,
} from "./treepeekmodel";
import { unreadLabel } from "./unreadagents";
import { unreadAgentsAtom } from "./unreadagentsstore";

const DOT_CLASS: Record<PeekDot, string> = {
    asking: "bg-asking",
    unread: "bg-accent",
    working: "bg-working",
    idle: "bg-ink-faint",
};

// on the strip an idle dot steps back (smaller) so the ones that want you stand out; the selected one is a bar, in a
// lighter grey when it is idle, so it reads at a glance whatever its state
function stripDotClass(dot: PeekDot, selected: boolean): string {
    if (selected) {
        return cn("h-[14px] w-[6px] rounded-full", dot === "idle" ? "bg-secondary" : DOT_CLASS[dot]);
    }
    return dot === "idle"
        ? "h-[4px] w-[4px] rounded-full bg-ink-faint"
        : cn("h-[7px] w-[7px] rounded-full", DOT_CLASS[dot]);
}

// the groups, re-read whenever the roster, the focus or the folders change
function usePeekGroups(model: AgentsViewModel): PeekGroup[] {
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    useAtomValue(model.focusIdAtom);
    useAtomValue(model.projectFilterAtom);
    useAtomValue(collapsedProjectsAtom);
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
        <span data-tree-peek-dots className="flex min-h-0 flex-col items-center gap-[6px] overflow-hidden pt-[6px]">
            {peekDots(groups).map((d) => (
                <span
                    key={d.id}
                    data-tree-peek-dot={d.dot}
                    className={cn(
                        "shrink-0 transition-[height,width,background-color] duration-150",
                        stripDotClass(d.dot, d.id === focusId),
                        d.gapBefore && "mt-[8px]"
                    )}
                />
            ))}
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
                        {g.rows.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                data-tree-peek-row={r.id}
                                aria-current={r.id === focusId ? "true" : undefined}
                                onClick={() => {
                                    selectAgentRow(model, r.id);
                                    onPicked();
                                }}
                                className={cn(
                                    "flex h-[28px] min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px]",
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
                                        className="flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold tabular-nums text-background"
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
                        ))}
                    </div>
                ))
            )}
        </motion.nav>
    );
}
