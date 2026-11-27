// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's Later section (spec 2026-11-27-ask-later-design.md decision 5, board B-later-section): what was saved for
// later, right under the Waiting on you strip. One group per initiative, one row per item: a tick that settles it, its
// label (a click opens the chunk on its initiative), its due chip once the day has come, how long it has waited, and Ask
// agent. It is no part of Waiting on you: it never pulses and never wears the asking color, and it is not drawn with
// nothing to show. The rows and the tick are laterchunks.ts's; Ask agent is askagentlater.ts's; this draws them.

import { reopenSessionById } from "@/app/cockpit/cockpit-actions";
import { MOTION, springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatAgeShort } from "@/app/view/agents/agentsviewmodel";
import { jumpToAgent } from "@/app/view/agents/channelsprimitives";
import { quoteWhenReady } from "@/app/view/agents/chatinsert";
import { cn, fireAndForget } from "@/util/util";
import { Check } from "lucide-react";
import { AnimatePresence, motion, type TargetAndTransition, type Variants } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askAgent, type AskAgent } from "./askagentlater";
import { RevealRows } from "./briefrowviews";
import { SMALL_BTN } from "./briefstyle";
import { briefUndo } from "./briefundo";
import { setChunkStatus } from "./effortstore";
import { openInitiativeChunk } from "./initiativesheetstore";
import { localDay } from "./inlinetracker";
import { laterCount, laterDueChip, tickLater, type LaterGroup, type LaterRowModel } from "./laterchunks";

// the space the main column's gap puts above a region (briefsurface.tsx `gap-5`). The section opens and folds with a
// margin that cancels it, so the gap does not vanish in one jump when the folded section is removed.
const COLUMN_GAP = 20;

const SECTION_REVEAL: Variants = (() => {
    const clipped = (target: TargetAndTransition, marginTop: number): TargetAndTransition => ({
        ...target,
        marginTop,
        transition: { ...target.transition, marginTop: MOTION.spring },
        overflow: "hidden",
    });
    return {
        initial: clipped(springReveal.initial as TargetAndTransition, -COLUMN_GAP),
        animate: { ...clipped(springReveal.animate as TargetAndTransition, 0), transitionEnd: { overflow: "visible" } },
        exit: clipped(springReveal.exit as TargetAndTransition, -COLUMN_GAP),
    };
})();

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function LaterChunksRegion({
    model,
    groups,
    filter,
    agents,
}: {
    model: AgentsViewModel;
    // every group the section holds, before the ticks still leaving: the Brief's filter already applied (laterGroups)
    groups: LaterGroup[];
    // the Brief's search: a new one shows its rows at once instead of one by one
    filter: string;
    // the roster Ask agent looks the agent up in
    agents: readonly AskAgent[];
}) {
    const reveal = usePartMotion(SECTION_REVEAL);
    // the items ticked and not yet gone from the list: the server's list follows the write by a briefing round trip, and
    // the row should leave as it is pressed. Read through the ref too, since a row that is leaving keeps the callbacks it
    // was last drawn with, and a second press on it must still see the first.
    const leavingRef = useRef<ReadonlySet<string>>(new Set());
    const [leaving, setLeavingState] = useState<ReadonlySet<string>>(leavingRef.current);
    const setLeaving = useCallback((next: ReadonlySet<string>) => {
        leavingRef.current = next;
        setLeavingState(next);
    }, []);
    const present = useMemo(() => new Set(groups.flatMap((g) => g.items.map((i) => i.key))), [groups]);
    useEffect(() => {
        const kept = [...leavingRef.current].filter((k) => present.has(k));
        if (kept.length !== leavingRef.current.size) {
            setLeaving(new Set(kept));
        }
    }, [present, setLeaving]);
    const shown = useMemo(
        () =>
            groups
                .map((g) => ({ ...g, items: g.items.filter((i) => !leaving.has(i.key)) }))
                .filter((g) => g.items.length > 0),
        [groups, leaving]
    );
    // the items whose Ask agent is still working (a resume loads the archive and opens a tab): the button says so, and a
    // second press does nothing
    const askingRef = useRef<ReadonlySet<string>>(new Set());
    const [asking, setAskingState] = useState<ReadonlySet<string>>(askingRef.current);
    const setAsking = useCallback((next: ReadonlySet<string>) => {
        askingRef.current = next;
        setAskingState(next);
    }, []);

    const tick = useCallback(
        (item: LaterRowModel) => {
            if (leavingRef.current.has(item.key)) {
                return;
            }
            setLeaving(new Set(leavingRef.current).add(item.key));
            const back = () => {
                const next = new Set(leavingRef.current);
                next.delete(item.key);
                setLeaving(next);
            };
            fireAndForget(async () => {
                const done = await tickLater(
                    {
                        setChunkStatus,
                        undo: {
                            error: briefUndo.error,
                            // the toast's Undo brings the row back at once, then puts the status back
                            notify: (text, undo) =>
                                briefUndo.notify(
                                    text,
                                    undo == null
                                        ? undefined
                                        : () => {
                                              back();
                                              undo();
                                          }
                                ),
                        },
                    },
                    item
                );
                if (!done) {
                    back();
                }
            });
        },
        [setLeaving]
    );

    const ask = useCallback(
        (item: LaterRowModel) => {
            if (askingRef.current.has(item.key)) {
                return;
            }
            setAsking(new Set(askingRef.current).add(item.key));
            fireAndForget(async () => {
                try {
                    await askAgent(item, agents, {
                        jump: (id) => jumpToAgent(model, id),
                        reopen: (conversation) => reopenSessionById(model, conversation),
                        quote: (id, make) => void quoteWhenReady(id, make),
                        error: briefUndo.error,
                    });
                } finally {
                    const next = new Set(askingRef.current);
                    next.delete(item.key);
                    setAsking(next);
                }
            });
        },
        [agents, model, setAsking]
    );

    const now = Date.now();
    const today = localDay(new Date(now));
    const total = laterCount(shown);

    return (
        <AnimatePresence initial={false}>
            {total > 0 ? (
                // the reveal is its own box, with no border or padding: those would hold it open at height 0
                <motion.div key="later" {...reveal} data-jarvis-brief-region-reveal="later-chunks">
                    <section data-jarvis-brief-region="later-chunks" className="flex min-w-0 flex-col">
                        <div className="flex items-center gap-2 px-1 pb-1.5 text-[12px] font-semibold text-ink-mid">
                            Later
                            <span data-later-count className="font-normal tabular-nums text-muted">
                                {total}
                            </span>
                        </div>
                        <RevealRows
                            rows={shown}
                            rowKey={(g) => g.oref}
                            filter={filter}
                            render={(g) => (
                                <div data-later-group={g.oref} className="flex min-w-0 flex-col">
                                    <span
                                        title={g.title}
                                        className="truncate px-2.5 pb-0.5 pt-2 text-[11px] text-muted"
                                    >
                                        {g.title}
                                    </span>
                                    <RevealRows
                                        rows={g.items}
                                        rowKey={(i) => i.key}
                                        filter={filter}
                                        render={(i) => (
                                            <LaterRow
                                                item={i}
                                                due={laterDueChip(i.due, i.status, today)}
                                                age={formatAgeShort(Math.max(0, now - i.since))}
                                                asking={asking.has(i.key)}
                                                onTick={tick}
                                                onAsk={ask}
                                            />
                                        )}
                                    />
                                </div>
                            )}
                        />
                    </section>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function LaterRow({
    item,
    due,
    age,
    asking,
    onTick,
    onAsk,
}: {
    item: LaterRowModel;
    due: string | null;
    age: string;
    // Ask agent is still working (a resume opening its tab)
    asking: boolean;
    onTick: (item: LaterRowModel) => void;
    onAsk: (item: LaterRowModel) => void;
}) {
    return (
        <div
            data-later-row=""
            data-later-oref={item.oref}
            data-later-label={item.label}
            className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-[3px] hover:bg-surface-hover"
        >
            <button
                type="button"
                data-later-tick=""
                aria-label={`Mark done: ${item.label}`}
                title="Mark done"
                onClick={() => onTick(item)}
                className={cn(
                    "group/tick -ml-1 flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px]",
                    FOCUS
                )}
            >
                <span
                    aria-hidden
                    className="flex h-3 w-3 items-center justify-center rounded-[3px] border-[1.5px] border-edge-strong text-transparent group-hover/tick:border-secondary group-hover/tick:text-secondary"
                >
                    <Check size={9} strokeWidth={3} />
                </span>
            </button>
            <button
                type="button"
                data-later-open=""
                title={item.label}
                onClick={() => openInitiativeChunk(item.oref, item.label)}
                className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate rounded-[4px] text-left text-[13px] text-ink-hi hover:underline",
                    FOCUS
                )}
            >
                {item.label}
            </button>
            {due != null ? (
                <span
                    data-later-due=""
                    title="Its due day has come. Later items never wait in Needs you."
                    className="flex-none rounded-[4px] bg-pill px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-ink-mid"
                >
                    {due}
                </span>
            ) : null}
            <span
                data-later-age=""
                title="How long it has waited"
                className="w-8 flex-none text-right text-[11px] tabular-nums text-ink-mid"
            >
                {age}
            </span>
            <button
                type="button"
                data-later-ask=""
                title="Go to the agent it came from and quote it there"
                disabled={asking}
                aria-busy={asking}
                onClick={() => onAsk(item)}
                className={cn(SMALL_BTN, "flex-none disabled:cursor-default disabled:opacity-60")}
            >
                Ask agent
            </button>
        </div>
    );
}
