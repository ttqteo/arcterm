// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Memory tab's card view (boards A and A2 of .superpowers/design/memory-review-ux): the queue strip of the
// selected project's changes, and one card for the shown change, with its text or diffs, the buttons right under
// it, the hint and the reason section. All derivation is memorymodel.ts (memoryQueue, memoryCard, doneCard);
// the actions are memorystore.ts.

import { KeyCap } from "@/app/element/keycap";
import { viewFade } from "@/app/element/motiontokens";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useEffect } from "react";
import { MarkdownMessage } from "./markdownmessage";
import { doneCard, memoryCard, memoryQueue, type CardButton, type CardModel, type QueueTone } from "./memorymodel";
import {
    BTN_PRIMARY,
    BTN_SECONDARY,
    ConflictAlert,
    DiffBlock,
    Dot,
    KindChip,
    SECTION_HEAD,
    TONE_TEXT,
    toTone,
    useFade,
} from "./memoryparts";
import {
    askMemoryAgent,
    decideMemory,
    memoryBusyAtom,
    selectMemoryChange,
    setMemoryView,
    talkItOver,
} from "./memorystore";

const QUEUE_TONE: Record<QueueTone, string> = {
    ok: "text-ink-mid",
    warn: "text-warning-soft",
    accent: "text-accent-soft",
    none: "text-muted",
};

// ---- the queue strip ----

export function MemoryQueue({ p, shown }: { p: MemHygieneProject; shown: string | null }) {
    const rows = memoryQueue(p, Date.now());
    const open = rows.filter((r) => !r.decided).length;
    // j and k, and the move to the next card after a verdict, can land on a row scrolled out of view
    useEffect(() => {
        if (shown != null) {
            document
                .querySelector(`[data-memory-queue-row="${CSS.escape(shown)}"]`)
                ?.scrollIntoView({ block: "nearest" });
        }
    }, [shown]);
    return (
        <aside
            aria-label="To review"
            data-memory-queue
            className="flex w-[280px] flex-none flex-col border-r border-border bg-surface"
        >
            <div className="flex flex-none items-baseline gap-2 px-4 pb-2.5 pt-3.5">
                <span className="text-[13px] font-semibold text-primary">To review</span>
                <span className="text-[12px] text-muted">
                    {open} in {p.project}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {rows.map((r) => {
                    const on = r.id === shown;
                    return (
                        <button
                            key={r.id}
                            type="button"
                            data-memory-queue-row={r.id}
                            data-selected={on || undefined}
                            data-decided={r.decided || undefined}
                            aria-current={on || undefined}
                            onClick={() => selectMemoryChange(r.id)}
                            className={cn(
                                "flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-edge-faint px-4 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset",
                                on
                                    ? "bg-surface-selected shadow-[inset_2px_0_0_var(--color-accent)]"
                                    : "bg-transparent hover:bg-surface-hover"
                            )}
                        >
                            <span
                                className={cn(
                                    "line-clamp-2 text-[12.5px] leading-[1.4]",
                                    r.decided ? "text-muted" : on ? "text-ink-hi" : "text-secondary"
                                )}
                            >
                                {r.title}
                            </span>
                            <span className={cn("text-[11px]", r.decided ? "text-ink-faint" : QUEUE_TONE[r.tone])}>
                                {r.status}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="flex-none border-t border-border px-4 py-3">
                <button
                    type="button"
                    data-memory-view-toggle="table"
                    onClick={() => setMemoryView(p.project, "table")}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-accent hover:text-accenthover"
                >
                    All changes as a table
                </button>
            </div>
        </aside>
    );
}

// ---- the card ----

// the word beside a button's key in the key hints: "a still true", "x back"
function keyWord(card: CardModel, b: CardButton): string {
    if (b.action === "keep") {
        return card.kind === "proposal" ? "back" : "keep";
    }
    return b.label.replace(/…$/, "").toLowerCase();
}

function CardButtons({
    model,
    p,
    change,
    card,
}: {
    model: AgentsViewModel;
    p: MemHygieneProject;
    change: MemChange;
    card: CardModel;
}) {
    const busy = useAtomValue(memoryBusyAtom);
    const press = (b: CardButton) => {
        const action = b.action;
        if (action === "ask") {
            fireAndForget(() => askMemoryAgent(p.project, change.id));
        } else if (action === "talk") {
            fireAndForget(() => talkItOver(model, p, change));
        } else {
            fireAndForget(() => decideMemory(p.project, change.id, action));
        }
    };
    const keyed = card.buttons.filter((b) => b.key !== "");
    return (
        <div className="flex flex-wrap items-center gap-2">
            {card.buttons.map((b) => (
                <button
                    key={b.action}
                    type="button"
                    data-memory-card-action={b.action}
                    disabled={busy || b.disabled}
                    onClick={() => press(b)}
                    className={cn(
                        b.primary ? BTN_PRIMARY : BTN_SECONDARY,
                        b.danger && "text-error-soft hover:text-error"
                    )}
                >
                    {b.label}
                </button>
            ))}
            <span className="flex-1" />
            <span aria-hidden data-memory-keys className="flex items-center gap-1.5 text-[11px] text-muted">
                {keyed.map((b) => (
                    <span key={b.action} className="flex items-center gap-1.5">
                        <KeyCap chord={b.key} variant="inline" />
                        {keyWord(card, b)}
                    </span>
                ))}
                <KeyCap chord="j" variant="inline" />
                <KeyCap chord="k" variant="inline" />
                move
            </span>
        </div>
    );
}

function CardBody({ card }: { card: CardModel }) {
    const body = card.body;
    if (body.kind === "text") {
        return (
            <div
                data-memory-body
                className="rounded-lg bg-background px-4 py-3.5 text-[13.5px] leading-[1.6] text-secondary"
            >
                {body.text.trim() ? (
                    <MarkdownMessage text={body.text} />
                ) : (
                    <span className="text-muted">The memory has no text.</span>
                )}
            </div>
        );
    }
    return (
        <div data-memory-body className="flex flex-col gap-2.5">
            {body.kind === "proposal" && body.reason ? (
                <p className="m-0 text-[13.5px] leading-[1.6] text-secondary">{body.reason}</p>
            ) : null}
            {body.diffs.map((d, i) => (
                <DiffBlock key={i} diff={d} />
            ))}
        </div>
    );
}

function ReasonSection({ card }: { card: CardModel }) {
    const r = card.reason;
    if (!r.verdict && !r.askLine && r.doclines.length === 0 && r.evidence.length === 0) {
        return null;
    }
    return (
        <section
            aria-label="Why"
            data-memory-reason
            className="flex flex-col gap-2 border-t border-border pt-3 text-[12.5px] leading-[1.5] text-secondary"
        >
            {r.askLine ? (
                <span data-memory-ask-line className="text-ink-hi">
                    {r.askLine}
                </span>
            ) : null}
            {r.verdict ? <span className="text-ink-hi">{r.verdict}</span> : null}
            {r.doclines.length > 0 ? (
                <div data-memory-doclines className="flex flex-col gap-1 font-mono text-[11.5px] text-muted">
                    {r.doclines.map((d, i) => (
                        <span key={i} className="break-words">
                            <span className="text-code-inline">
                                {d.doc}:{d.line}
                            </span>{" "}
                            {d.text}
                        </span>
                    ))}
                </div>
            ) : null}
            {r.evidence.length > 0 ? (
                <details data-memory-details className="group">
                    <summary className={cn(SECTION_HEAD, "cursor-pointer select-none hover:text-ink-mid")}>
                        Details
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                        {r.evidence.map((e, i) => (
                            <div key={i} className="flex items-start gap-2 text-[12px] leading-[1.5] text-secondary">
                                <Dot tone={toTone(e.tone)} className="mt-1.5" />
                                <span>
                                    {e.text}
                                    {e.code ? (
                                        <span className="font-mono text-[11px] text-ink-hi">{e.code}</span>
                                    ) : null}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            ) : null}
        </section>
    );
}

const CARD_FRAME =
    "flex w-full max-w-[900px] flex-col gap-4 rounded-lg border border-edge-mid bg-surface px-[26px] py-[22px]";

export function MemoryCard({ model, p, change }: { model: AgentsViewModel; p: MemHygieneProject; change: MemChange }) {
    const fade = useFade();
    const card = memoryCard(p, change, Date.now());
    return (
        // keyed by change: the next card fades in
        <motion.article
            key={change.id}
            {...fade(viewFade)}
            data-memory-review-card
            data-card-kind={card.kind}
            data-decided={card.decided || undefined}
            className={CARD_FRAME}
        >
            <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                    <KindChip p={p} change={change} />
                    {card.head.text ? (
                        <span
                            data-memory-card-head
                            className={cn(
                                "text-[11.5px]",
                                card.head.tone === "warn" ? "text-warning-soft" : "text-muted"
                            )}
                        >
                            {card.head.text}
                        </span>
                    ) : null}
                </span>
                <h2 className="m-0 text-[17px] font-semibold leading-[1.35] text-primary">{card.title}</h2>
                <span className="break-all text-[11.5px] text-muted">{card.fileLine}</span>
            </div>
            {change.status === "conflict" ? <ConflictAlert p={p} change={change} /> : null}
            <CardBody card={card} />
            <div className="flex flex-col gap-2">
                <CardButtons model={model} p={p} change={change} card={card} />
                {card.status ? (
                    <span
                        role="status"
                        data-memory-card-status
                        data-tone={card.status.tone}
                        className={cn(
                            "flex items-start gap-2 text-[12.5px] leading-[1.5]",
                            TONE_TEXT[card.status.tone]
                        )}
                    >
                        <Dot tone={card.status.tone} className="mt-1.5" />
                        {card.status.text}
                    </span>
                ) : null}
                {card.hint ? <span className="text-[12px] leading-[1.5] text-muted">{card.hint}</span> : null}
            </div>
            <ReasonSection card={card} />
        </motion.article>
    );
}

export function MemoryDoneCard({ p }: { p: MemHygieneProject }) {
    const done = doneCard(p, Date.now());
    return (
        <article data-memory-review-card data-card-kind="done" className={cn(CARD_FRAME, "gap-1.5")}>
            <h2 className="m-0 text-[15px] font-semibold text-primary">{done.title}</h2>
            {done.next ? <span className="text-[12.5px] text-muted">{done.next}</span> : null}
        </article>
    );
}
