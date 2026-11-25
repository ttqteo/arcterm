// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's pair cards (docs/superpowers/specs/2026-11-25-chat-pair-blocks-design.md): a pair's ```arc-pair list and a
// judge's ```arc-judge marks, drawn as cards instead of code. The newest list of the conversation draws in full (Waits on
// you with the answer chips, Still open, Agreed folded), each earlier one as a folded row; a judge's marks draw as a card
// of reopens and new points. Which list is the newest and what each card shows is the pure model's (pairblocks.ts); this
// file is the host Chat provides (the placed lists and the agent's pair) and the cards. Outside a host (a council's
// messages) a block stays code.

import { microFade, springReveal, turnTransition } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { Check, ChevronRight, ListChecks, Plus, RotateCcw, Scale } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { showPair } from "./agentcenter";
import { CardShell } from "./chatbrainstormparts";
import { useChatPartKey } from "./chatsteplistview";
import { CodeBlock } from "./codeblock";
import {
    JUDGE_LANG,
    PAIR_LANG,
    itemLabel,
    judgeCounts,
    judgeRowsOf,
    newlyAgreed,
    olderCounts,
    pairBlockKey,
    pairCardOf,
    pairCounts,
    parseJudgeMarks,
    parsePairItems,
    waitingCount,
    waitingLabel,
    type JudgeRow,
    type PairBlockItem,
    type PairRow,
    type PlacedPair,
} from "./pairblocks";
import { usePairOf, usePairView } from "./pairstore";
import { CHIP, useChipAnswer } from "./raildecidedpane";

interface PairHost {
    placed: ReadonlyMap<string, PlacedPair>;
    // the pair the conversation's agent is in, live; null when it is in none
    view: PairView | null;
}

const PairHostContext = createContext<PairHost | null>(null);

/** Chat's host for the pair cards: where each list draws (placePairLists) and the pair the agent (`tabId`) is in. */
export function ChatPairHost({
    placed,
    tabId,
    children,
}: {
    placed: ReadonlyMap<string, PlacedPair>;
    tabId: string | null;
    children: ReactNode;
}) {
    const pair = usePairOf(tabId);
    const view = usePairView(pair?.pair.id ?? null);
    const host = useMemo(() => ({ placed, view }), [placed, view]);
    return <PairHostContext.Provider value={host}>{children}</PairHostContext.Provider>;
}

/** A ```arc-pair block: the newest list in full, an earlier one folded, code outside a host or when nothing parses. */
export function PairBlock({ raw }: { raw: string }) {
    const host = useContext(PairHostContext);
    const part = useChatPartKey();
    const items = useMemo(() => parsePairItems(raw), [raw]);
    if (host == null || items.length === 0) {
        return <CodeBlock code={raw} lang={PAIR_LANG} />;
    }
    const placed = part != null ? host.placed.get(pairBlockKey(part, items)) : undefined;
    if (placed?.latest) {
        return <PairListCard items={items} previous={placed.previous} view={host.view} />;
    }
    return <OlderPairList items={items} />;
}

/** A ```arc-judge block: its marks as a card, one ✓ row when they raise nothing, code outside a host. */
export function JudgeBlock({ raw }: { raw: string }) {
    const host = useContext(PairHostContext);
    const marks = useMemo(() => parseJudgeMarks(raw), [raw]);
    if (host == null) {
        return <CodeBlock code={raw} lang={JUDGE_LANG} />;
    }
    const rows = judgeRowsOf(marks, host.view?.decided);
    if (rows.length === 0) {
        return (
            <div
                data-chat-judge="none"
                className="my-3 flex items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-[12.5px] text-secondary"
            >
                <Check size={14} strokeWidth={2} className="flex-none text-success" aria-hidden />
                <span>Judge marks</span>
                <span className="text-primary">No new points</span>
            </div>
        );
    }
    return (
        <div className="my-3">
            <CardShell
                kind="judge"
                state="static"
                head="Judge marks"
                icon={<Scale size={14} strokeWidth={1.8} className="flex-none" aria-hidden />}
                extra={{ "data-chat-judge": "marks" }}
                tag={<span className="tabular-nums">{judgeCounts(marks)}</span>}
            >
                <div className="flex flex-col gap-[14px]">
                    {rows.map((row) => (
                        <JudgeMarkRow key={row.key} row={row} />
                    ))}
                </div>
            </CardShell>
        </div>
    );
}

function JudgeMarkRow({ row }: { row: JudgeRow }) {
    const Icon = row.kind === "reopen" ? RotateCcw : Plus;
    return (
        <div data-chat-judge-mark={row.kind} className="grid grid-cols-[108px_minmax(0,1fr)] items-start gap-[10px]">
            <span className="inline-flex items-center gap-[5px] justify-self-start whitespace-nowrap rounded-[6px] bg-surface-selected px-[8px] py-[2px] text-[11.5px] text-primary">
                <Icon size={11} strokeWidth={2} aria-hidden />
                {row.tag}
            </span>
            <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-[13.5px] leading-[1.45] text-ink-hi [overflow-wrap:anywhere]">{row.text}</span>
                {row.sub !== "" ? (
                    <span className="text-[12px] leading-[1.4] text-muted [overflow-wrap:anywhere]">{row.sub}</span>
                ) : null}
            </div>
        </div>
    );
}

// ---- the newest list ----

const LIST_ICON = <ListChecks size={14} strokeWidth={1.8} className="flex-none" aria-hidden />;

function Chevron({ open, size }: { open: boolean; size: number }) {
    return (
        <ChevronRight
            size={size}
            strokeWidth={2}
            aria-hidden
            style={turnTransition}
            className={cn("flex-none transition-transform", open && "rotate-90")}
        />
    );
}

// a row's number column and its text, with the note under the text
function NumberedRow({ row, textClass }: { row: PairRow; textClass: string }) {
    return (
        <div data-chat-pair-item={row.label || "new"} className="grid grid-cols-[34px_minmax(0,1fr)] gap-x-[4px]">
            <span className="pt-px text-[12px] tabular-nums text-muted">{row.label}</span>
            <div className="flex min-w-0 flex-col gap-[2px]">
                <span className={cn("text-[13.5px] leading-[1.45] [overflow-wrap:anywhere]", textClass)}>
                    {row.text}
                </span>
                {row.note !== "" ? (
                    <span className="text-[12px] leading-[1.4] text-muted [overflow-wrap:anywhere]">{row.note}</span>
                ) : null}
            </div>
        </div>
    );
}

function Section({ id, label, children }: { id: "asks" | "open"; label: string; children: ReactNode }) {
    return (
        <section data-chat-pair-section={id} aria-label={label} className="flex flex-col gap-[8px]">
            <div className="text-[11.5px] font-medium text-muted">{label}</div>
            {children}
        </section>
    );
}

function PairListCard({
    items,
    previous,
    view,
}: {
    items: PairBlockItem[];
    previous: PairBlockItem[] | null;
    view: PairView | null;
}) {
    const card = useMemo(() => pairCardOf(items, view), [items, view]);
    const { sending, answer } = useChipAnswer(card.current ? (view?.id ?? null) : null);
    const waiting = waitingCount(card);
    const shownAgreed = new Set(card.agreed.map((r) => r.label));
    const newly = newlyAgreed(previous, items).filter((l) => shownAgreed.has(l));
    return (
        <div className="my-3">
            <CardShell
                kind="pair"
                state="static"
                head="Pair list"
                icon={LIST_ICON}
                extra={{ "data-chat-pair": "latest", "data-chat-pair-current": card.current }}
                chip={
                    <span className="flex-none tabular-nums">{pairCounts(card.agreed.length, card.open.length)}</span>
                }
                tag={
                    waiting > 0 ? (
                        <span data-chat-pair-waiting className="flex items-center gap-[6px] text-asking">
                            <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-asking" />
                            {waitingLabel(waiting)}
                        </span>
                    ) : (
                        <span>Nothing waits on you</span>
                    )
                }
            >
                <div className="flex flex-col gap-[16px]">
                    {card.asks.length > 0 ? (
                        <Section id="asks" label="Waits on you">
                            {card.asks.map((row) => (
                                <AskBox
                                    key={row.key}
                                    row={row}
                                    pairId={card.current ? (view?.id ?? null) : null}
                                    sending={sending === row.num}
                                    onChip={(chip) => row.item != null && answer(row.item, chip)}
                                />
                            ))}
                        </Section>
                    ) : null}
                    {card.open.length > 0 ? (
                        <Section id="open" label="Still open">
                            {card.open.map((row) => (
                                <div key={row.key} className="px-[12px]">
                                    <NumberedRow row={row} textClass="text-secondary" />
                                </div>
                            ))}
                        </Section>
                    ) : null}
                    {card.agreed.length > 0 ? <AgreedFold rows={card.agreed} newly={newly} /> : null}
                </div>
            </CardShell>
        </div>
    );
}

// an A item in its box: the chips that answer it while the card is the pair's current list (or the answer once given), the
// item alone on a read-only card
function AskBox({
    row,
    pairId,
    sending,
    onChip,
}: {
    row: PairRow;
    pairId: string | null;
    sending: boolean;
    onChip: (chip: string) => void;
}) {
    const fade = usePartMotion(microFade);
    const answered = row.answer !== "";
    return (
        <div
            data-chat-pair-item={row.label}
            data-chat-pair-answered={answered ? "" : undefined}
            className="flex flex-col gap-[8px] rounded-[10px] border border-edge-mid bg-surface px-[12px] py-[10px]"
        >
            <NumberedRow row={row} textClass="text-ink-hi" />
            {pairId != null ? (
                // the chips row and the answer share one cell and crossfade, as tall as each other, so the box never resizes
                <div className="grid pl-[38px]">
                    <AnimatePresence initial={false}>
                        {answered ? (
                            <motion.div
                                key="answer"
                                {...fade}
                                data-chat-pair-answer
                                className="flex min-h-[26px] items-center text-[12px] text-secondary [grid-area:1/1]"
                            >
                                <span className="[overflow-wrap:anywhere]">
                                    <span className="text-muted">You answered </span>
                                    {row.answer}
                                </span>
                            </motion.div>
                        ) : (
                            <motion.div key="chips" {...fade} className="flex flex-wrap gap-[6px] [grid-area:1/1]">
                                {row.chips.map((chip) => (
                                    <button
                                        key={chip}
                                        type="button"
                                        title={`Answer both sides: ${chip}`}
                                        data-chat-pair-chip={chip}
                                        disabled={sending}
                                        onClick={() => onChip(chip)}
                                        className={cn(CHIP, "border-edge-strong text-primary")}
                                    >
                                        {chip}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    data-chat-pair-other
                                    title="Open the pair conversation to type an answer"
                                    onClick={() => showPair(pairId)}
                                    className={cn(CHIP, "border-edge-mid text-secondary")}
                                >
                                    other…
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            ) : null}
        </div>
    );
}

// Agreed, folded to one row by default; the open state is the card's own (a glance, not kept)
function AgreedFold({ rows, newly }: { rows: PairRow[]; newly: string[] }) {
    const [open, setOpen] = useState(false);
    const reveal = usePartMotion(springReveal);
    return (
        <section
            data-chat-pair-section="agreed"
            data-chat-pair-open={open ? "" : undefined}
            aria-label="Agreed"
            className="flex flex-col border-t border-edge-mid pt-[10px]"
        >
            <button
                type="button"
                aria-expanded={open}
                data-chat-pair-agreed-toggle
                onClick={() => setOpen((o) => !o)}
                className="flex cursor-pointer items-center gap-[6px] self-start rounded-[4px] border-0 bg-transparent px-0 py-[4px] text-[11.5px] font-medium text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <Chevron open={open} size={13} />
                <span>Agreed</span>
                <span className="tabular-nums">{rows.length}</span>
                {newly.length > 0 ? (
                    <span className="font-normal text-ink-faint">· {newly.join(", ")} agreed in this reply</span>
                ) : null}
            </button>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div key="agreed" {...reveal} className="overflow-hidden">
                        <div className="flex flex-col gap-[10px] px-[12px] pb-[2px] pt-[8px]">
                            {rows.map((row) => (
                                <NumberedRow key={row.key} row={row} textClass="text-ink-hi" />
                            ))}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </section>
    );
}

// ---- an earlier list ----

// a list a newer one replaced: one row with its own counts, opening into its lines as written
function OlderPairList({ items }: { items: PairBlockItem[] }) {
    const [open, setOpen] = useState(false);
    const reveal = usePartMotion(springReveal);
    return (
        <div data-chat-pair="older" data-chat-pair-open={open ? "" : undefined} className="my-3 flex flex-col">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-left text-[12.5px] text-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
                {LIST_ICON}
                <span className="flex-none text-secondary">Pair list</span>
                <span className="min-w-0 truncate tabular-nums">{olderCounts(items)}</span>
                <span className="ml-auto flex-none text-ink-faint">a newer list replaced it</span>
                <Chevron open={open} size={14} />
            </button>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div key="lines" {...reveal} className="overflow-hidden">
                        <div className="flex flex-col gap-[5px] px-[14px] pb-[2px] pt-[10px] text-[12.5px] leading-[1.45] text-muted">
                            {items.map((item, i) => (
                                <div key={i} className="grid grid-cols-[34px_minmax(0,1fr)] gap-x-[4px]">
                                    <span className="tabular-nums text-ink-faint">
                                        {itemLabel(item.kind, item.num)}
                                    </span>
                                    <span className="[overflow-wrap:anywhere]">{item.text}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
