// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The ⚖ line under a working agent's name while it works in an active pair (spec docs/superpowers/specs/
// 2026-11-26-pair-judge-round-design.md): the judges' state in words, their tokens and the pair's new-message count, small
// and always there, never folded. A click on the line is its own: it opens the worker ↔ judge conversation, or the judge's own
// view while a judge asks you; a click elsewhere on the row opens the worker. On a stopped pair of this machine it ends
// with the pause card's buttons (Resume, Judge again), faded in by the row's hover or the focus inside them; a relaying pair
// has none. The words and the tone are pairjudgeline.ts's.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Scale } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { centerModeAtom, pairSelAtom } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { TreePair } from "./agenttreemodel";
import { askingJudgeId, judgeLineDot, judgeLineTokens, judgeLineWords, judgeStateOf } from "./pairjudgeline";
import { newCount } from "./pairmodel";
import { judgeAgainOf, openPairOf, pairOnScreen } from "./pairopen";
import { pairVietnamese, pauseActions } from "./pairpause";
import { pairListAtom, pairSeenAtom, resumePair, usePairView } from "./pairstore";
import { rowFieldsAtom } from "./rowfieldsstore";

const DOT: Record<"working" | "asking", string> = { working: "bg-success", asking: "bg-warning" };

// Resume and Judge again, as the pause card draws them: small, on a raised fill
const ACT =
    "h-[18px] flex-none cursor-pointer whitespace-nowrap rounded-[5px] border border-edge-mid bg-surface-raised px-[6px] text-[11px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover hover:text-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

function PairJudgeLine({
    model,
    workerId,
    workerName,
    pair,
    rowSelected,
    onOpenJudge,
}: {
    model: AgentsViewModel;
    workerId: string;
    workerName: string;
    pair: TreePair;
    rowSelected: boolean;
    onOpenJudge: (judgeId: string) => void;
}) {
    const fields = useAtomValue(rowFieldsAtom);
    const view = usePairView(pair.pairId);
    // the list knows the pair's state before its view is read
    const listed = useAtomValue(pairListAtom).find((p) => p.id === pair.pairId);
    const info = view ?? listed;
    // the conversation on screen: the line is the selected thing then, the worker's row is not
    const onScreen = pairOnScreen(useAtomValue(centerModeAtom), useAtomValue(pairSelAtom), pair.pairId);
    const seen = useAtomValue(pairSeenAtom(pair.pairId));
    const fresh = view != null && !onScreen ? newCount(view, seen) : 0;
    // Resume and Judge again of a stopped pair (pairpause.ts says which; the rows here are all this machine's)
    const actions = view != null ? pauseActions(view, { local: true }) : null;
    // a Resume in flight, or one that worked and waits for the flipped view to draw its button away, and why one failed
    const [resuming, setResuming] = useState(false);
    const [resumeError, setResumeError] = useState<string | null>(null);
    const errorPart = usePartMotion(springReveal);
    // the pair going on (or stopping again) is a new situation: the wait and the old error are over
    const stateKey = info != null ? `${info.state}/${info.stopreason ?? ""}` : "";
    useEffect(() => {
        setResuming(false);
        setResumeError(null);
    }, [stateKey]);
    if (info == null) {
        return null;
    }
    const states = pair.judges.map(judgeStateOf);
    const words = judgeLineWords(info, states, view != null && pairVietnamese(view));
    const dot = judgeLineDot(info, states);
    const tokens = fields.tokens ? judgeLineTokens(view?.tokens) : null;
    const asker = askingJudgeId(pair.judges);
    const warning = words.tone === "warning";
    const resume = async () => {
        if (resuming) {
            return;
        }
        setResuming(true);
        setResumeError(null);
        try {
            await resumePair(pair.pairId);
        } catch (err) {
            // resumePair logged it; the line says it where the button was pressed
            setResumeError(err instanceof Error ? err.message : String(err));
            setResuming(false);
        }
    };
    const hasActions = actions != null && (actions.resume != null || actions.judgeAgain != null);
    return (
        <div
            data-pair-judge-line={pair.pairId}
            data-pair-judge-tone={words.tone}
            className="mt-[3px] ml-[19px] min-w-0"
        >
            <div className="relative flex min-w-0">
                {/* the line's click is its own: it must not select the worker's row it sits in */}
                <button
                    type="button"
                    data-pair-judge-open
                    title={
                        asker != null ? "The judge is asking you: open its own view" : "Open the pair's conversation"
                    }
                    onClick={(e) => {
                        e.stopPropagation();
                        if (asker != null) {
                            onOpenJudge(asker);
                        } else {
                            openPairOf(model, workerId, pair.pairId);
                        }
                    }}
                    className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center gap-[6px] rounded-[5px] px-[6px] py-[2px] text-left text-[11px] outline-none transition-colors duration-[140ms] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
                        onScreen ? "bg-surface-selected" : warning ? "bg-askingbg" : "bg-pill hover:bg-hover",
                        warning ? "font-semibold text-warning" : onScreen ? "text-primary" : "text-muted"
                    )}
                >
                    <Scale size={11} strokeWidth={1.9} aria-hidden className="flex-none text-accent-soft" />
                    {dot != null ? (
                        <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", DOT[dot])} />
                    ) : null}
                    <span data-pair-judge-words className="min-w-0 flex-1 truncate">
                        {words.text}
                    </span>
                    {tokens != null ? (
                        <span data-pair-judge-tokens className="flex-none tabular-nums">
                            {tokens}
                        </span>
                    ) : null}
                    {fresh > 0 ? (
                        <span
                            data-pair-judge-new={fresh}
                            aria-label={`${fresh} new ${fresh === 1 ? "message" : "messages"} in the pair`}
                            className="flex h-[15px] min-w-[15px] flex-none items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold tabular-nums text-background"
                        >
                            {fresh}
                        </span>
                    ) : null}
                </button>
                {/* Resume and Judge again float over the line's right end on the row's own fill, faded in from the left, so
                    the words read in full until the pointer is on the row or the focus is in them; a click on one is its own */}
                {hasActions ? (
                    <span
                        className={cn(
                            "pointer-events-none absolute inset-y-0 right-0 flex items-center gap-[4px] rounded-r-[5px] pl-[2px] pr-[3px] opacity-0 transition-opacity duration-100 before:absolute before:inset-y-0 before:right-full before:w-[18px] before:bg-linear-to-r before:from-transparent focus-within:pointer-events-auto focus-within:opacity-100 group-hover/agentrow:pointer-events-auto group-hover/agentrow:opacity-100",
                            onScreen || rowSelected
                                ? "bg-surface-selected before:to-surface-selected"
                                : "bg-surface-hover before:to-surface-hover"
                        )}
                    >
                        {actions.resume != null ? (
                            <button
                                type="button"
                                data-pair-judge-resume={pair.pairId}
                                disabled={resuming}
                                title={
                                    resumeError != null
                                        ? `Resume failed: ${resumeError}`
                                        : "Put the pair back to relaying and hand over what is still queued"
                                }
                                aria-label={`${actions.resume}, ${workerName}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void resume();
                                }}
                                className={ACT}
                            >
                                {actions.resume}
                            </button>
                        ) : null}
                        {actions.judgeAgain != null ? (
                            <button
                                type="button"
                                data-pair-judge-rerun={pair.pairId}
                                title="Open the conversation with @judge in the composer"
                                aria-label={`${actions.judgeAgain}, ${workerName}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    judgeAgainOf(model, workerId, pair.pairId);
                                }}
                                className={ACT}
                            >
                                {actions.judgeAgain}
                            </button>
                        ) : null}
                    </span>
                ) : null}
            </div>
            {/* the live region is always there, so a failure that appears in it is read out */}
            <div aria-live="polite" className="min-w-0">
                <AnimatePresence initial={false}>
                    {resumeError != null ? (
                        <motion.div key="resume-error" {...errorPart} className="overflow-hidden">
                            <div
                                data-pair-judge-error
                                className="mt-[3px] break-words text-[11px] leading-[1.35] text-error-soft"
                            >
                                Resume failed: {resumeError}
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </div>
    );
}

/** The slot under a working agent's name: the line while the agent works in an active pair, which grows in as the pair
 *  starts and folds away as its round ends (springReveal, a change of shape), and nothing otherwise. */
export function PairJudgeLineSlot(props: {
    model: AgentsViewModel;
    workerId: string;
    workerName: string;
    pair: TreePair | undefined;
    rowSelected: boolean;
    onOpenJudge: (judgeId: string) => void;
}) {
    const part = usePartMotion(springReveal);
    const { pair, ...rest } = props;
    return (
        <AnimatePresence initial={false}>
            {pair != null ? (
                <motion.div key="pair-line" {...part} className="overflow-hidden">
                    <PairJudgeLine {...rest} pair={pair} />
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
