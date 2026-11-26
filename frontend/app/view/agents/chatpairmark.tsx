// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The judge round's mark in the working agent's Chat (docs/superpowers/specs/2026-11-26-judge-on-reply-design.md, decision
// 3): a line under the reply the round started from, and a 2px bar on the left of the turns that belong to the round. What
// the marks are, and their words, is pairmark.ts's; this reads the agent's pairs, draws the line and gives the bar its class.
// chatconversation.tsx puts each line in a row of its own after its item's (never inside the item's cached element, as the
// choice judge's line is) and the bar class on every row the bar covers, and passes the line the owner of its item's bar
// (`bar`), since the line's row is one the bar runs beside too.
// The line is drawn like the choice judge's (chatjudgeline.tsx): a hairline rule, muted 12.5px text, no box, a spinner while
// the judge reads and the seconds ticking. Under a live round it ends in Open pair (the header's Pair button: the pair's
// conversation, through togglePairOf); an ended round's whole line is one button that opens the pair's page in Library.
// Motion: the line opens under its message on the spring and fades in (`arrive`: it lands under a message already drawn),
// and a state change cross-fades its text on the micro ease, the line riding the spring if its height changes (CardSlot).
// The leaving state is popped out of flow (AnimatePresence popLayout), which only works on a state that hands the `ref` it
// is given to its motion element (MarkRow does). The bar's colour eases from accent to grey as its round ends. Under reduced
// motion both are at their end state at once.
// Markers for the scenarios: [data-chat-pair-mark=<pair id>] with data-state (reading | live | ended), its text
// [data-chat-pair-mark-text], the action [data-chat-pair-mark-open] (data-open pair | library) and the spinner
// [data-chat-pair-mark-spinner]; a covered row carries [data-chat-pair-bar=<pair id>] with data-chat-pair-bar-state.

import { MOTION } from "@/app/element/motiontokens";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type Ref } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { CardSlot, FOCUS_RING } from "./chatbrainstormparts";
import { agentPairIds, markWords, type PairBar, type PairMarkLine } from "./pairmark";
import { togglePairOf } from "./pairopen";
import { ensurePair, loadPairHistory, pairHistoryAtom, pairViewAtom, usePairs } from "./pairstore";

/** The views of the pairs `agent` is the working agent of: the active ones (usePairs) and the project's ended ones
 *  (pairHistoryAtom, read while an agent is given), kept to this agent, each in full (pairViewAtom) and read once by id
 *  (ensurePair; `pair:update` keeps it right after that). A pair whose view is not read yet is left out until it is. With no
 *  agent (a conversation that has none: an ended session, a subagent's interior) it reads no history and returns none. */
export function useAgentPairViews(agent: Pick<AgentVM, "id"> | undefined, project: string): PairView[] {
    const agentId = agent?.id ?? "";
    const live = usePairs();
    const history = useAtomValue(pairHistoryAtom(project));
    useEffect(() => {
        if (agentId !== "") {
            void loadPairHistory(project);
        }
    }, [agentId, project]);
    // the ids as one string, so a list re-read with the same pairs in it changes nothing below
    const idsKey = useMemo(
        () => (agentId === "" ? "" : agentPairIds(agentId, live, history).join("\n")),
        [agentId, live, history]
    );
    const viewsAtom = useMemo(() => {
        const ids = idsKey === "" ? [] : idsKey.split("\n");
        return atom((get) => ids.map((id) => get(pairViewAtom(id))).filter((view): view is PairView => view != null));
    }, [idsKey]);
    useEffect(() => {
        for (const id of idsKey === "" ? [] : idsKey.split("\n")) {
            ensurePair(id);
        }
    }, [idsKey]);
    return useAtomValue(viewsAtom);
}

// ---- the bar ----

/** The class of a row the round's bar covers (undefined for a row it does not): a 2px bar hanging in the left gutter, 12px
 *  outside the column as the sketch draws it, drawn by the row's `::before`. It reaches down over the 16px gap under the
 *  row, so the covered rows read as one bar (past the last row too, which is the bar running to the bottom). Accent while
 *  the round lives, grey once it ended, the colour easing between the two; reduced motion: no transition. This makes the
 *  row positioned, and the bar is clipped by any `overflow` the row sets: a row that clips (Arriving does while it opens)
 *  shows no bar until it stops. */
export function pairBarClass(owner: PairBar | undefined): string | undefined {
    if (owner == null) {
        return undefined;
    }
    return cn(
        "relative before:pointer-events-none before:absolute before:-left-3 before:top-0 before:-bottom-4 before:w-[2px]",
        "motion-safe:before:transition-colors motion-safe:before:duration-[360ms]",
        owner.ended ? "before:bg-ink-faint" : "before:bg-accent"
    );
}

/** The markers the scenarios read on a covered row (see pairBarClass); nothing for a row the bar does not cover. */
export function pairBarAttrs(owner: PairBar | undefined): Record<string, string> | undefined {
    if (owner == null) {
        return undefined;
    }
    return { "data-chat-pair-bar": owner.pairId, "data-chat-pair-bar-state": owner.ended ? "ended" : "live" };
}

// ---- the line ----

/** how far under its message the line sits, whatever gap the column keeps between its rows */
const UNDER_MESSAGE = 8;

/** One round's line under the reply it started from. `vi` is the person writing Vietnamese; `agentId` is the working agent,
 *  whose view Open pair opens the conversation in; `gap` is the gap of the column the line sits in, which it takes back to
 *  sit close under its message; `arrive` is a line that comes in now, under a message already drawn, and opens on the
 *  spring. `bar` is the owner of the bar of the item the line sits under (pairMarks' `bars` for that item, whichever round
 *  the line is of): the line's row carries the bar too, so it runs unbroken beside the line. The row is clipped only while
 *  it opens (the bar hangs outside it, and reaches over the gap below it), so the bar shows once it has opened. */
export function ChatPairMarkLine({
    line,
    vi,
    model,
    agentId,
    gap,
    arrive,
    bar,
}: {
    line: PairMarkLine;
    vi: boolean;
    model: AgentsViewModel;
    agentId: string;
    gap: number;
    arrive: boolean;
    bar?: PairBar;
}) {
    const reduce = useReducedMotion();
    const opens = arrive && !reduce;
    const [settled, setSettled] = useState(!opens);
    // the seconds a reading round has run tick once a second, and only then
    const reading = line.state === "reading";
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!reading) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [reading]);
    const words = markWords(line, vi, now);
    const closed = { opacity: 0, height: 0, marginTop: -gap };
    const spring = reduce
        ? { duration: 0 }
        : {
              height: MOTION.spring,
              marginTop: MOTION.spring,
              opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid },
          };
    return (
        <motion.div
            initial={opens ? closed : false}
            animate={{ opacity: 1, height: "auto", marginTop: UNDER_MESSAGE - gap, transition: spring }}
            onAnimationComplete={() => setSettled(true)}
            // the line is one row under its message, and its focus ring is drawn inside the button, so a row at rest needs
            // no clip
            className={cn("min-w-0", settled ? undefined : "overflow-hidden", pairBarClass(bar))}
            {...pairBarAttrs(bar)}
        >
            <div
                data-chat-pair-mark={line.pairId}
                data-state={line.state}
                className="text-[12.5px] leading-[1.5] text-muted"
            >
                <CardSlot swap={line.state}>
                    {/* the rule: its colour does not move, its size is the slot's spring */}
                    <div className="border-t border-edge-mid pt-[6px]">
                        <div className="relative">
                            <AnimatePresence mode="popLayout" initial={false}>
                                <MarkRow
                                    key={line.state}
                                    line={line}
                                    words={words}
                                    model={model}
                                    agentId={agentId}
                                    reduce={!!reduce}
                                />
                            </AnimatePresence>
                        </div>
                    </div>
                </CardSlot>
            </div>
        </motion.div>
    );
}

/** One state of the line's text, which cross-fades with the next on the micro ease (at once under reduced motion). While
 *  it fades out it takes no presses and is hidden from assistive tech: the line's one live row is the new one. `ref` is the
 *  element AnimatePresence pops out of flow while the state leaves, so it goes on the motion element. */
function MarkRow({
    line,
    words,
    model,
    agentId,
    reduce,
    ref,
}: {
    line: PairMarkLine;
    words: { text: string; action: string };
    model: AgentsViewModel;
    agentId: string;
    reduce: boolean;
    ref?: Ref<HTMLDivElement>;
}) {
    const present = useIsPresent();
    const ended = line.state === "ended";
    const text = (
        <span data-chat-pair-mark-text="" className="min-w-0 tabular-nums [overflow-wrap:anywhere]">
            {words.text}
        </span>
    );
    return (
        <motion.div
            ref={ref}
            {...rowFade(reduce)}
            aria-hidden={present ? undefined : true}
            className={cn("flex items-start gap-2", !present && "pointer-events-none")}
        >
            {line.state === "reading" ? (
                <Loader2
                    data-chat-pair-mark-spinner=""
                    size={13}
                    strokeWidth={1.8}
                    aria-hidden
                    className="mt-[3px] flex-none animate-spin motion-reduce:animate-none"
                />
            ) : null}
            {ended ? (
                // an ended round's whole line opens its page in Library
                <button
                    type="button"
                    data-chat-pair-mark-open="library"
                    title="Open this judge round in Library"
                    onClick={() => fireAndForget(() => openTarget(model, { kind: "pair", pairId: line.pairId }))}
                    className={cn(
                        "group flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-[3px] border-0 bg-transparent p-0 text-left text-inherit hover:text-secondary",
                        FOCUS_RING,
                        "focus-visible:ring-inset"
                    )}
                >
                    {text}
                    <span className="min-w-0 flex-1" />
                    <ArrowUpRight
                        size={12}
                        strokeWidth={2}
                        aria-hidden
                        className="mt-[3px] flex-none text-ink-faint group-hover:text-primary"
                    />
                </button>
            ) : (
                <>
                    {text}
                    <span className="min-w-0 flex-1" />
                    {words.action !== "" ? (
                        <button
                            type="button"
                            data-chat-pair-mark-open="pair"
                            title="Open the conversation with the judge"
                            onClick={() => togglePairOf(model, agentId, line.pairId)}
                            className={cn(
                                "flex-none cursor-pointer whitespace-nowrap rounded-[3px] border-0 bg-transparent p-0 text-accent hover:text-accenthover",
                                FOCUS_RING,
                                "focus-visible:ring-inset"
                            )}
                        >
                            {words.action}
                        </button>
                    ) : null}
                </>
            )}
        </motion.div>
    );
}

/** one state's fade in and out, on the micro ease (at once under reduced motion) */
function rowFade(reduce: boolean) {
    const fade = reduce ? { duration: 0 } : { duration: MOTION.durMicro, ease: MOTION.easeFluid };
    return {
        initial: reduce ? false : { opacity: 0 },
        animate: { opacity: 1, transition: fade },
        exit: { opacity: 0, transition: fade },
    } as const;
}
