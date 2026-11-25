// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Decided tab: what the agent's pair has settled (board R1's rail, docs/superpowers/specs/
// 2026-11-25-agent-pair-judge-design.md), there while the agent is in a pair, as the working agent or as a judge. Three
// sections from the working agent's newest block (the server parsed it: PairView.decided): Waits on you, each item with its
// note and its answer chips (a chip answers both sides at once; "other…" opens the conversation to type one) and the
// answer once given; Agreed, numbered, each linking to the message where it was settled; Still open, with why a judge put
// it back. The rules are in raildecided.ts; the view comes from the pair's atom, so the tab updates as they talk, a row
// opening or folding on the spring as it arrives or leaves (DESIGN.md Motion; three or more at once land in a frame).

import { pushToast } from "@/app/cockpit/notificationstore";
import { usePartMotion, useSpringBatch } from "@/app/element/springbatch";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { showPair } from "./agentcenter";
import { batchReveal } from "./cardgridlayout";
import { clockTime } from "./councilsummarymodel";
import { pairScrollToAtom } from "./pairstore";
import { answerChip, linkedMessage, openReason } from "./raildecided";

export const CHIP =
    "h-[26px] max-w-full cursor-pointer truncate rounded-full border bg-surface px-[10px] text-[12px] outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-surface";

type Row = { key: string; node: ReactNode };

// A section's rows. Each opens and folds on the spring as it arrives or leaves; a section with none holds one quiet line,
// which trades places with the first row the same way. The padding between rows is on the inner box: a box folded to
// height 0 cannot be shorter than its own padding.
function RevealList({ tag, rows, empty }: { tag: "div" | "ol"; rows: Row[]; empty: string }) {
    const shown: Row[] =
        rows.length > 0 ? rows : [{ key: "empty", node: <div className="text-[12px] text-muted">{empty}</div> }];
    const batch = useSpringBatch(shown.map((r) => r.key));
    const part = usePartMotion(batchReveal);
    const instant = batch === "instant";
    const List = tag;
    const Item = tag === "ol" ? motion.li : motion.div;
    return (
        <List className={cn("-my-[4px] flex flex-col", tag === "ol" && "m-0 list-none p-0")}>
            <AnimatePresence initial={false} custom={instant}>
                {shown.map((r) => (
                    <Item key={r.key} {...part} initial={instant ? false : part.initial} className="overflow-hidden">
                        <div className="py-[4px]">{r.node}</div>
                    </Item>
                ))}
            </AnimatePresence>
        </List>
    );
}

function Section({ id, label, children }: { id: "asks" | "agreed" | "open"; label: string; children: ReactNode }) {
    return (
        <section data-decided-section={id} aria-label={label} className="flex flex-col gap-[7px]">
            <div className="text-[11.5px] font-medium text-muted">{label}</div>
            {children}
        </section>
    );
}

/** A chip's answer to a pair's A item, sent to both sides (raildecided.ts answerChip); `sending` is the item whose answer
 *  is on its way, so its chips wait and a second press cannot send it twice. A failure toasts `Answer not sent`. Chat's
 *  pair card (chatpairblock.tsx) answers through this too. */
export function useChipAnswer(pairId: string | null): {
    sending: number | null;
    answer: (item: PairItem, chip: string) => void;
} {
    const [sending, setSending] = useState<number | null>(null);
    const answer = (item: PairItem, chip: string) => {
        if (pairId == null) {
            return;
        }
        setSending(item.num);
        RpcApi.PairSayCommand(TabRpcClient, answerChip(pairId, item, chip))
            .catch((err) => {
                console.error(`answering item ${item.num} of pair ${pairId} failed`, err);
                pushToast({
                    title: "Answer not sent",
                    message: err instanceof Error ? err.message : String(err),
                    level: "error",
                });
            })
            .finally(() => setSending(null));
    };
    return { sending, answer };
}

export function RailDecidedPane({ view }: { view: PairView | null }) {
    const { sending, answer } = useChipAnswer(view?.id ?? null);
    if (view == null) {
        return (
            <div data-rail-decided-state="reading" className="px-[12px] pt-[12px] text-[12px] text-muted">
                Reading the pair…
            </div>
        );
    }
    // a nil list comes over the wire as null
    const asks = view.decided?.asks ?? [];
    const agreed = view.decided?.agreed ?? [];
    const open = view.decided?.open ?? [];
    const judges = (view.judges ?? []).length;

    // the agreed item's link: the conversation, scrolled to the message where it was settled (the pane scrolls and clears)
    const goTo = (msgid: string) => {
        showPair(view.id);
        globalStore.set(pairScrollToAtom, msgid);
    };

    return (
        <div
            data-rail-decided={view.id}
            className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[12px] pb-[40px] pt-[12px] [scrollbar-gutter:stable]"
        >
            <Section id="asks" label="Waits on you">
                <RevealList
                    tag="div"
                    empty="Nothing waits on you"
                    rows={asks.map((item) => ({
                        key: `a${item.num}`,
                        node: (
                            <div
                                data-decided-item={item.num}
                                data-decided-answered={item.answer !== "" ? "" : undefined}
                                className="flex flex-col gap-[7px] rounded-[10px] border border-edge-strong bg-surface-raised p-[10px]"
                            >
                                <div className="break-words text-[13px] leading-[1.45] text-ink-hi">{item.text}</div>
                                {item.note !== "" ? (
                                    <div className="break-words text-[11.5px] leading-[1.4] text-muted">
                                        {item.note}
                                    </div>
                                ) : null}
                                {item.answer !== "" ? (
                                    // as tall as the chips row it replaces, so answering never resizes the card
                                    <div
                                        data-decided-answer
                                        className="flex min-h-[26px] items-center break-words text-[12px] text-secondary"
                                    >
                                        <span>
                                            <span className="text-muted">You answered </span>
                                            {item.answer}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-[6px]">
                                        {(item.chips ?? []).map((chip) => (
                                            <button
                                                key={chip}
                                                type="button"
                                                title={chip}
                                                data-decided-chip={chip}
                                                disabled={sending === item.num}
                                                onClick={() => answer(item, chip)}
                                                className={cn(CHIP, "border-edge-strong text-primary")}
                                            >
                                                {chip}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            data-decided-other
                                            title="Open the conversation to type an answer"
                                            onClick={() => showPair(view.id)}
                                            className={cn(CHIP, "border-edge-mid text-secondary")}
                                        >
                                            other…
                                        </button>
                                    </div>
                                )}
                            </div>
                        ),
                    }))}
                />
            </Section>
            <Section id="agreed" label="Agreed">
                <RevealList
                    tag="ol"
                    empty="Nothing agreed yet"
                    rows={agreed.map((item) => {
                        const at = linkedMessage(view.messages, item);
                        return {
                            key: `d${item.num}`,
                            node: (
                                <div
                                    data-decided-item={item.num}
                                    className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-[4px]"
                                >
                                    <span className="pt-px text-[11.5px] tabular-nums text-muted">{item.num}</span>
                                    <div className="flex min-w-0 flex-col gap-[2px]">
                                        <div className="break-words text-[13px] leading-[1.45] text-ink-hi">
                                            {item.text}
                                            {at != null ? (
                                                <>
                                                    {" "}
                                                    <button
                                                        type="button"
                                                        data-decided-link={at.id}
                                                        title="Show the message where this was settled"
                                                        aria-label={`Show the message at ${clockTime(at.ts)} where this was settled`}
                                                        onClick={() => goTo(at.id)}
                                                        className="cursor-pointer rounded-[3px] border-0 bg-transparent p-0 text-[11.5px] tabular-nums text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                                                    >
                                                        {clockTime(at.ts)}
                                                    </button>
                                                </>
                                            ) : null}
                                        </div>
                                        {item.note !== "" ? (
                                            <div className="break-words text-[11.5px] leading-[1.4] text-muted">
                                                {item.note}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ),
                        };
                    })}
                />
            </Section>
            <Section id="open" label="Still open">
                <RevealList
                    tag="div"
                    empty="Nothing still open"
                    rows={open.map((item, i) => {
                        const why = openReason(item, judges);
                        return {
                            // a judge's new point has no number of its own (0), so its position keys it
                            key: item.num > 0 ? `o${item.num}` : `new${i}`,
                            node: (
                                <div
                                    data-decided-item={item.num > 0 ? item.num : "new"}
                                    className="flex flex-col gap-[2px]"
                                >
                                    <div className="break-words text-[13px] leading-[1.45] text-secondary">
                                        {item.text}
                                    </div>
                                    {why !== "" ? (
                                        <div data-decided-reason className="text-[11.5px] leading-[1.4] text-muted">
                                            {why}
                                        </div>
                                    ) : null}
                                </div>
                            ),
                        };
                    })}
                />
            </Section>
        </div>
    );
}
