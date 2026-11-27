// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Plan to review: the chunks an agent proposed for its initiative, held out of every count until the
// person accepts them. Accept, Rename in place and Drop per row; Accept all and continue, Accept all and Drop all
// under them. A decided row stays, with Undo, until the rail re-reads (planreviewstore.ts). Chat draws the same section
// as a card at the end of the conversation (`place="chat"`, chatplanreview.tsx), so a plan is seen where the person reads
// the reply that proposed it; both read and write the one store, so a decision in one shows in the other.

import { pushToast } from "@/app/cockpit/notificationstore";
import { springFoldHeight } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import {
    acceptProposed,
    dropProposed,
    renameChunk,
    restoreProposed,
    unacceptProposed,
} from "@/app/view/jarvis/effortstore";
import { continueMessage } from "@/app/view/jarvis/proposedmodel";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { cn } from "@/util/util";
import { Check, ListChecks, Pencil, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { sendToAgent } from "./agentsubmit";
import type { AgentVM } from "./agentsviewmodel";
import { canDrive } from "./consumers";
import { decisionsFor, planEditChunks, restoreAt, type PlanRow } from "./planreviewmodel";
import { holdDecisions, releaseDecision, usePlanReview, type PlanReviewView } from "./planreviewstore";
import { SectionLabel } from "./sectionlabel";

const ICON_BTN =
    "inline-flex h-[24px] w-[24px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-transparent text-ink-mid hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";
const FOOT_BTN =
    "inline-flex h-[26px] cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border px-[10px] text-[11.5px] font-semibold hover:border-edge-strong disabled:cursor-default disabled:opacity-50";
const FOOT_BTN_QUIET = "border-edge-mid bg-surface-raised text-secondary hover:bg-surface-hover";
const FOOT_BTN_MAIN = "border-edge-strong bg-surface-selected text-primary hover:bg-surface-hover";

const RING: Record<PlanRow["state"], string> = {
    proposed: "border-dashed border-asking",
    accepted: "border-solid border-edge-strong",
    dropped: "border-solid border-ink-faint opacity-50",
};

// `place`: the rail's tinted section (row buttons fold until hover, to keep the rail's width) or Chat's card (the buttons
// always show: the column is wide, and a card whose buttons hide reads as a notice). `exited`: Chat's agent has exited,
// so the card waits on no one (no amber dot); its writes still work, since they need no agent. `view`: what to draw in
// place of the store's live view. Chat passes the view it last showed, so a card folding away keeps its rows: the element
// AnimatePresence holds for the exit keeps that prop, while the live view has already emptied.
export function PlanReviewSection({
    agent,
    place = "rail",
    exited = false,
    view,
}: {
    agent: AgentVM;
    place?: "rail" | "chat";
    exited?: boolean;
    view?: PlanReviewView;
}) {
    const live = usePlanReview(agent.effortId);
    const { oref, effort, rows, decisions, proposed } = view ?? live;
    const chat = place === "chat";
    const footMotion = usePartMotion(springFoldHeight);
    const [renaming, setRenaming] = useState<{ label: string; draft: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    if (effort == null) {
        return null;
    }
    const chunks = effort.chunks ?? [];
    const plan = planEditChunks(chunks);
    // an all-digit label would be read as a position, so each call names a chunk the way chunkRef says
    const refOf = (label: string) => chunkRef(plan, label);
    const waiting = rows.filter((r) => r.state === "proposed").map((r) => r.label);
    // the continue types into its terminal: not while it sleeps (a dead PTY); Accept all still works
    const canContinue = canDrive(agent) && waiting.length > 0;

    // true when it went through; a failure leaves the rows as they were and says why under the buttons
    const run = async (send: () => Promise<void>, undoHold?: () => void): Promise<boolean> => {
        setError(null);
        setBusy(true);
        try {
            await send();
            return true;
        } catch (e) {
            undoHold?.();
            setError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    // the decision is held before it is sent: the last chunk decided empties the proposed list, which would drop
    // this section, and its Undo, for the moment between the reply and the hold
    const decide = (labels: string[], kind: "accepted" | "dropped", send: () => Promise<void>) => {
        const held = decisionsFor(chunks, labels, kind);
        holdDecisions(oref, held);
        return run(send, () => held.forEach((d) => releaseDecision(oref, d.label)));
    };
    const accept = (labels: string[]) =>
        decide(labels, "accepted", () =>
            acceptProposed(
                oref,
                labels.map((l) => refOf(l))
            )
        );
    const drop = (labels: string[]) => decide(labels, "dropped", () => dropProposed(oref, plan, labels));
    // the accept has landed by the time the message is typed, so a write that fails says so in a toast: the last
    // chunk accepted can drop this section, and its error line with it
    const acceptAndContinue = async () => {
        const first = waiting[0];
        if (!(await accept(waiting)) || !agent.blockId) {
            return;
        }
        try {
            await sendToAgent(agent.blockId, continueMessage(first));
        } catch (e) {
            pushToast({
                title: `Plan accepted, but ${agent.name} was not told to start`,
                message: e instanceof Error ? e.message : String(e),
                level: "error",
            });
        }
    };
    const undo = (label: string) => {
        const d = decisions.find((x) => x.label === label);
        if (d == null) {
            return;
        }
        void run(async () => {
            if (d.kind === "accepted") {
                await unacceptProposed(oref, refOf(label));
            } else {
                await restoreProposed(
                    oref,
                    label,
                    d.stage,
                    restoreAt(
                        d.before,
                        chunks.map((c) => c.label)
                    )
                );
            }
            releaseDecision(oref, label);
        });
    };
    const saveRename = () => {
        if (renaming == null) {
            return;
        }
        const next = renaming.draft.trim();
        if (next === "" || next === renaming.label) {
            setRenaming(null);
            return;
        }
        void run(async () => {
            await renameChunk(oref, plan, renaming.label, next);
            setRenaming(null);
        });
    };

    const count = proposed > 0 ? `${proposed} proposed` : "all decided";
    return (
        <section
            data-rail-section={chat ? undefined : "plan"}
            data-chat-plan={chat ? (proposed > 0 ? "waiting" : "decided") : undefined}
            aria-label="Plan to review"
            className={chat ? undefined : "pb-[14px]"}
        >
            <div
                className={
                    chat
                        ? "flex flex-col gap-[10px] rounded-[12px] border border-edge-strong bg-surface-raised px-[16px] py-[14px]"
                        : "flex flex-col gap-[8px] rounded-[8px] border border-asking/30 bg-askingbg px-[12px] pb-[12px] pt-[11px]"
                }
            >
                {chat ? (
                    // the header of Chat's other cards (chatinitiativecard.tsx): a glyph, what the card is, and the amber
                    // "Waiting on you" while a chunk is undecided
                    <div className="flex items-center gap-[8px] text-[12px] text-muted">
                        <ListChecks size={14} strokeWidth={2} className="flex-none" aria-hidden />
                        <span className="min-w-0 truncate">
                            Plan to review · <span className="tabular-nums">{count}</span>
                        </span>
                        {proposed > 0 && !exited ? (
                            <span className="ml-[6px] flex flex-none items-center gap-[6px] text-warning">
                                <span
                                    data-chat-plan-waiting
                                    aria-hidden="true"
                                    className="h-[6px] w-[6px] flex-none rounded-full bg-asking pulse-dot"
                                />
                                Waiting on you
                            </span>
                        ) : exited ? (
                            <span className="ml-[6px] flex-none text-muted">Agent exited</span>
                        ) : null}
                    </div>
                ) : (
                    <div className="flex items-center gap-[8px]">
                        <SectionLabel className="text-asking">Plan to review</SectionLabel>
                        <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-mid">{count}</span>
                    </div>
                )}
                <div className={cn("leading-[1.45] text-muted", chat ? "text-[12px]" : "text-[11px]")}>
                    <span className="text-secondary">{effort.title}</span> · proposed by {agent.name}. They count toward
                    progress once you accept them.
                </div>
                <div className="flex flex-col">
                    {rows.map((r) => {
                        const open = r.state === "proposed";
                        return (
                            <div
                                key={r.label}
                                data-plan-row={r.state}
                                className="group/plan flex min-h-[40px] items-center gap-[9px] border-t border-edge-faint py-[5px]"
                            >
                                <span
                                    aria-hidden
                                    className={cn(
                                        "h-[9px] w-[9px] flex-none rounded-full border-[1.5px]",
                                        RING[r.state]
                                    )}
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                    {renaming?.label === r.label ? (
                                        <input
                                            autoFocus
                                            value={renaming.draft}
                                            aria-label={`Rename ${r.label}`}
                                            onChange={(e) => setRenaming({ label: r.label, draft: e.target.value })}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                                    e.preventDefault();
                                                    saveRename();
                                                } else if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setRenaming(null);
                                                }
                                            }}
                                            onBlur={() => setRenaming(null)}
                                            className="min-w-0 rounded-[5px] border border-edge-strong bg-surface-code px-[6px] py-[2px] text-[12.5px] font-medium text-primary outline-none focus:border-accent"
                                        />
                                    ) : (
                                        // the whole title, over as many lines as it takes: a chunk is decided on what it says
                                        <span
                                            data-plan-row-label
                                            className={cn(
                                                "break-words text-[12.5px] font-medium leading-[1.45]",
                                                r.state === "dropped" ? "text-ink-faint line-through" : "text-primary"
                                            )}
                                        >
                                            {r.label}
                                        </span>
                                    )}
                                    {r.meta ? (
                                        <span className="truncate text-[10.5px] text-ink-mid">{r.meta}</span>
                                    ) : null}
                                </div>
                                {open ? (
                                    // on the rail, folded to no width until the pointer is over the row or a key focuses into it, so
                                    // a plan of eight is not 24 buttons and each title keeps the rail's width; gone while
                                    // the row is renamed, so the input keeps it too
                                    <span
                                        hidden={renaming?.label === r.label}
                                        className={
                                            chat
                                                ? "flex flex-none items-center"
                                                : "-ml-[9px] flex w-0 flex-none items-center overflow-hidden group-focus-within/plan:ml-0 group-focus-within/plan:w-auto group-hover/plan:ml-0 group-hover/plan:w-auto"
                                        }
                                    >
                                        <button
                                            type="button"
                                            aria-label="Accept"
                                            title="Accept"
                                            disabled={busy}
                                            onClick={() => void accept([r.label])}
                                            className={cn(ICON_BTN, "text-success hover:text-success")}
                                        >
                                            <Check size={12} strokeWidth={2.4} aria-hidden />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Rename"
                                            title="Rename"
                                            disabled={busy}
                                            onClick={() => setRenaming({ label: r.label, draft: r.label })}
                                            className={ICON_BTN}
                                        >
                                            <Pencil size={12} aria-hidden />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Drop"
                                            title="Drop"
                                            disabled={busy}
                                            onClick={() => void drop([r.label])}
                                            className={ICON_BTN}
                                        >
                                            <X size={12} strokeWidth={2.2} aria-hidden />
                                        </button>
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => undo(r.label)}
                                        className="flex-none cursor-pointer text-[10.5px] text-accent-soft hover:underline disabled:cursor-default disabled:opacity-50"
                                    >
                                        Undo
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
                {/* the footer folds away on the spring once nothing waits, so the card does not jump shorter. The column's
                    gap is taken back by the wrapper's margin and given to its inner padding, so a closed footer holds
                    none of it */}
                <AnimatePresence initial={false}>
                    {waiting.length > 0 ? (
                        <motion.div key="foot" {...footMotion} className={chat ? "-mt-[10px]" : "-mt-[8px]"}>
                            <div className={cn("flex flex-col", chat ? "gap-[10px] pt-[10px]" : "gap-[8px] pt-[8px]")}>
                                <div className="mt-[2px] flex flex-wrap gap-[6px]">
                                    {canContinue ? (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void acceptAndContinue()}
                                            className={cn(FOOT_BTN, FOOT_BTN_MAIN)}
                                        >
                                            Accept all and continue
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void accept(waiting)}
                                        className={cn(FOOT_BTN, FOOT_BTN_QUIET)}
                                    >
                                        Accept all
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void drop(waiting)}
                                        className={cn(FOOT_BTN, FOOT_BTN_QUIET)}
                                    >
                                        Drop all
                                    </button>
                                </div>
                                {canContinue ? (
                                    <div className="text-[10.5px] text-ink-mid">
                                        Continue sends “Plan accepted, start with {waiting[0]}” to {agent.name}.
                                    </div>
                                ) : null}
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
                {error != null ? (
                    <div role="alert" className="break-words text-[11px] text-error">
                        {error}
                    </div>
                ) : null}
            </div>
        </section>
    );
}
