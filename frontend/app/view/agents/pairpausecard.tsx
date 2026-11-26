// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The card a pair's pause puts in the conversation (spec docs/superpowers/specs/2026-11-26-pair-judge-ux-design.md, "A
// summary at each pause"): why the pair paused, the judge's few sentences when it wrote them, then what waits on the person
// (with its answer chips), what is still open and what was agreed, and, on the newest card of a stopped pair, the way on:
// Resume when something would be delivered, Judge again after no new points or both agree, else a hint that a message goes
// on. The words and the lists are pairpause.ts's (the same card the Library page draws); this file only lays them out. An
// older card, or any card on the Library page, has no controls: its chips are plain text and it has no buttons.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { Pause } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { CouncilText } from "./councilchat";
import type { PairRow } from "./pairmodel";
import { messageClock } from "./pairpanemodel";
import { pauseCardOf, type PauseActions, type PauseSection } from "./pairpause";
import { CHIP } from "./raildecidedpane";

// pairpane.tsx's GHOST_BUTTON and PROSE, not imported from there: it imports this file
const ACTION =
    "h-[26px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[12.5px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const PROSE = "text-[13.5px] leading-[1.55] text-ink-hi";

/** What the newest card of a stopped pair can do. The conversation holds the state (a press in flight, the chip being sent). */
export type PauseLive = {
    actions: PauseActions;
    /** the item whose answer is on its way: its chips wait */
    sending: number | null;
    /** a Resume press is in flight: the button waits, so a second press cannot send it twice */
    resuming: boolean;
    onChip: (item: PairItem, chip: string) => void;
    onResume: () => void;
    onJudgeAgain: () => void;
};

export function PairPauseCard({
    row,
    view,
    enters,
    live,
}: {
    row: PairRow;
    view: PairView;
    // it arrived after the conversation opened: it grows in on springReveal like any message, else it is drawn in place
    enters: boolean;
    // null on an older card and on the Library page
    live: PauseLive | null;
}) {
    const part = usePartMotion(springReveal);
    const arrive = { ...part, initial: enters ? part.initial : (false as const) };
    const card = useMemo(() => pauseCardOf(view, row), [view, row]);
    if (card == null) {
        return null;
    }
    const actions = live?.actions;
    const hasButtons = actions != null && (actions.resume != null || actions.judgeAgain != null);
    const hint = actions?.hint ?? null;
    return (
        <motion.div
            data-pair-msg={row.id}
            data-side="system"
            data-pair-pause={row.id}
            data-pair-pause-reason={row.pause?.reason ?? ""}
            {...arrive}
            className="flex overflow-hidden"
        >
            <section
                aria-label={card.head}
                className="flex w-full min-w-0 flex-col gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[13px] py-[11px]"
            >
                <div className="flex items-center gap-2 text-[12px] text-muted">
                    <Pause size={12} strokeWidth={2} aria-hidden className="flex-none" />
                    <span
                        data-pair-pause-head
                        className="min-w-0 truncate font-semibold text-primary"
                        title={card.head}
                    >
                        {card.head}
                    </span>
                    <span className="flex-none tabular-nums">{messageClock(row.ts)}</span>
                </div>
                {card.summary !== "" ? (
                    <div data-pair-pause-summary>
                        <CouncilText text={card.summary} className={PROSE} refs />
                    </div>
                ) : null}
                {card.sections.map((section) => (
                    <Section key={section.kind} section={section} live={live} />
                ))}
                {card.note !== "" ? (
                    <div data-pair-pause-note className="text-[12.5px] leading-[1.45] text-secondary">
                        {card.note}
                    </div>
                ) : null}
                {hint != null || hasButtons ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {hint != null ? (
                            <span data-pair-pause-hint className="min-w-0 flex-1 text-[12.5px] text-muted">
                                {hint}
                            </span>
                        ) : (
                            <span className="flex-1" />
                        )}
                        {actions?.resume != null ? (
                            <button
                                type="button"
                                data-pair-resume
                                disabled={live?.resuming}
                                onClick={live?.onResume}
                                className={ACTION}
                            >
                                {actions.resume}
                            </button>
                        ) : null}
                        {actions?.judgeAgain != null ? (
                            <button type="button" data-pair-judge-again onClick={live?.onJudgeAgain} className={ACTION}>
                                {actions.judgeAgain}
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </section>
        </motion.div>
    );
}

function Section({ section, live }: { section: PauseSection; live: PauseLive | null }) {
    return (
        <section data-pair-pause-section={section.kind} aria-label={section.label} className="flex flex-col gap-[7px]">
            <div className="text-[11.5px] font-medium text-muted">{section.label}</div>
            {section.items.map((item, i) =>
                section.kind === "asks" ? (
                    <AskItem key={`a${item.num}`} item={item} live={live} />
                ) : (
                    // a judge's new point has no number of its own (0), so its position keys it
                    <NumberedItem
                        key={item.num > 0 ? `n${item.num}` : `new${i}`}
                        item={item}
                        textClass={section.kind === "open" ? "text-secondary" : "text-ink-hi"}
                    />
                )
            )}
        </section>
    );
}

// an item's number column, its text and the note under it
function NumberedItem({ item, textClass }: { item: PairItem; textClass: string }) {
    return (
        <div
            data-pair-pause-item={item.num > 0 ? item.num : "new"}
            className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-[4px]"
        >
            <span className="pt-px text-[11.5px] tabular-nums text-muted">{item.num > 0 ? item.num : ""}</span>
            <div className="flex min-w-0 flex-col gap-[2px]">
                <div className={cn("break-words text-[13px] leading-[1.45]", textClass)}>{item.text}</div>
                {item.note !== "" ? (
                    <div className="break-words text-[11.5px] leading-[1.4] text-muted">{item.note}</div>
                ) : null}
            </div>
        </div>
    );
}

// An A item that waits on the person: its chips answer both sides while this is the newest card of a stopped pair (and a
// pressed one reads as the answer), else the answer once given, else the chips as one line of text.
function AskItem({ item, live }: { item: PairItem; live: PauseLive | null }) {
    const chips = item.chips ?? [];
    return (
        <div
            data-pair-pause-item={item.num}
            data-pair-pause-answered={item.answer !== "" ? "" : undefined}
            className="flex flex-col gap-[7px] rounded-[10px] border border-edge-strong bg-surface-raised p-[10px]"
        >
            <div className="break-words text-[13px] leading-[1.45] text-ink-hi">{item.text}</div>
            {item.note !== "" ? (
                <div className="break-words text-[11.5px] leading-[1.4] text-muted">{item.note}</div>
            ) : null}
            {item.answer !== "" ? (
                // as tall as the chips row it replaces, so answering never resizes the card
                <div
                    data-pair-pause-answer
                    className="flex min-h-[26px] items-center break-words text-[12px] text-secondary"
                >
                    <span>
                        <span className="text-muted">You answered </span>
                        {item.answer}
                    </span>
                </div>
            ) : chips.length === 0 ? null : live != null ? (
                <div className="flex flex-wrap gap-[6px]">
                    {chips.map((chip) => (
                        <button
                            key={chip}
                            type="button"
                            title={`Answer both sides: ${chip}`}
                            data-pair-pause-chip={chip}
                            disabled={live.sending === item.num}
                            onClick={() => live.onChip(item, chip)}
                            className={cn(CHIP, "border-edge-strong text-primary")}
                        >
                            {chip}
                        </button>
                    ))}
                </div>
            ) : (
                <div data-pair-pause-options className="break-words text-[12px] text-muted">
                    {chips.join(" · ")}
                </div>
            )}
        </div>
    );
}
