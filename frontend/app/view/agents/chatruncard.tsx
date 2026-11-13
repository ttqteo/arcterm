// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run card Chat draws for every run a conversation started (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md,
// sections 4 and 5; the pure half is chatruncards.ts). It is the card the brainstorm's run has had since
// chat-brainstorm-review (chatbrainstormrun.tsx shares `RunCardBox`), now drawn at the `wsh runs start` call that started
// a run: the run's name, its kind and its stage, updated in place, and Open run. A start the run queue still holds is the
// same card in its own `Queued` stage, and moves to the run's stage when the queue starts it. When the run is over
// (landed, complete, cancelled) or its `[arc] Run … landed|held` message came, the card folds in place into a ✓ row.

import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUpRight, Play } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { runCardView, runDoneLine } from "./chatbrainstorm";
import { CardShell, DoneRow, FOCUS_RING, SMALL_BTN, type CardState } from "./chatbrainstormparts";
import { queuedState, runBody, runTag, type QueuedState, type RunBody } from "./chatruncardmodel";
import { queuedLabel, runCardFolded, runEndedLine, type RunCardSlot, type RunEnded } from "./chatruncards";
import { useRunInfo } from "./runlineagestore";
import { queuedRowsAtom, runQueueAtom, runQueueStartedAtom, useRunQueueFeed } from "./runqueuestore";
import type { StageTone } from "./runstage";

// the stage's dot by its tone: amber only for a run that needs the person (the card's one amber), green for a task at
// work, accent for the engine moving the run on, the quiet grey otherwise
const STAGE_DOT: Record<StageTone, string> = {
    working: "bg-working pulse-dot",
    running: "bg-accent pulse-dot",
    asking: "bg-asking pulse-dot",
    done: "bg-success",
    error: "bg-error",
    muted: "bg-muted",
};

// CardShell types its `extra` marks for the question card's two attributes; it spreads them onto the section whatever
// they are, so the run card's own mark (the id the scenarios find the card by) rides the same spread
const runMark = (id: string) => ({ "data-chat-run-card": id }) as Parameters<typeof CardShell>[0]["extra"];

/** The run card: the section with its header (kind, the state tag, Open run, and Open in Brainstorm beside it when an
 *  `agent` is passed, which only the brainstorm's own run does) and the body. `id` is the run's id, or the queue entry's
 *  while it waits. Open run shows with a `model` and a `runId` that Arc can find. */
export function RunCardBox({
    id,
    runId,
    state,
    head,
    body,
    label,
    model,
    agent,
}: {
    id: string;
    runId?: string;
    state: CardState;
    head: string;
    body: RunBody;
    label: string;
    model?: AgentsViewModel;
    agent?: AgentVM;
}) {
    const open =
        model != null && runId != null && body.kind !== "missing" ? (
            <button
                type="button"
                data-chat-bscard-run-open
                onClick={() => fireAndForget(() => openTarget(model, { kind: "run", runId }))}
                className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
            >
                Open run
                <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
            </button>
        ) : undefined;
    return (
        <CardShell
            kind="run"
            state={state}
            head={head}
            icon={<Play size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            agent={agent}
            action={open}
            label={label}
            extra={runMark(id)}
        >
            <div className="flex min-w-0 flex-col gap-[4px]">
                {body.kind === "loading" ? (
                    <span data-chat-bscard-run-loading className="text-[12.5px] leading-[1.5] text-muted">
                        Loading the run…
                    </span>
                ) : body.kind === "missing" ? (
                    <span data-chat-bscard-run-missing className="text-[12.5px] leading-[1.5] text-muted">
                        Arc cannot find this run.
                    </span>
                ) : (
                    <>
                        <span
                            data-chat-bscard-run-name
                            title={body.name}
                            className="truncate text-[15px] font-semibold leading-[1.45] text-primary"
                        >
                            {body.name}
                        </span>
                        {body.line != null ? (
                            <span
                                data-chat-bscard-run-stage={body.line.key}
                                data-chat-run-queued={body.queued ? "" : undefined}
                                title={body.line.label}
                                className="flex min-w-0 items-center gap-[8px] text-[12.5px] leading-[1.5] text-secondary"
                            >
                                <span
                                    aria-hidden="true"
                                    className={cn("h-[7px] w-[7px] flex-none rounded-full", STAGE_DOT[body.line.tone])}
                                />
                                <span className="min-w-0 truncate">{body.line.label}</span>
                            </span>
                        ) : null}
                    </>
                )}
            </div>
        </CardShell>
    );
}

const NO_QUEUED = atom<QueuedState | null>(null);

// one queued start read from the run queue, the run each entry became and the tree's rows (which resolve the title of
// the run an entry waits after)
function queuedStateAtom(entryId: string): Atom<QueuedState> {
    return atom((get) => queuedState(entryId, get(runQueueAtom), get(runQueueStartedAtom), get(queuedRowsAtom)));
}

// the run queue's feed, mounted only by a card that waits on the queue: one read, then every `runqueue:changed`
function QueueFeed(): null {
    useRunQueueFeed();
    return null;
}

/** The run card of one `wsh runs start` call (or a run no call names), in the conversation. `slot` says which run, or
 *  which queued start; `live` false (the agent exited) makes the card static; `ended` is the run's `[arc] Run … landed|held`
 *  message, which folds the card (a held run never reaches a done stage, so the message is what folds it). A run that is
 *  over, or ended, is one ✓ row: "Run · <name> · Landed", or "Run 3fa21b0c landed · merged into main" opening to the
 *  message. A queued start is a card in its `Queued` stage until the queue starts it, then the run's own; one that left
 *  the queue with no run to be found draws nothing. With `rowProps` the card (or its row) is wrapped as the conversation's
 *  end row, for a run that draws after the last item. `agent` is for the brainstorm's own run (Open in Brainstorm); the
 *  conversation passes none for any other. */
export function ChatRunCard({
    slot,
    model,
    agent,
    live,
    ended,
    rowProps,
}: {
    slot: RunCardSlot;
    model?: AgentsViewModel;
    agent?: AgentVM;
    live: boolean;
    ended?: RunEnded | null;
    rowProps?: ComponentProps<typeof motion.div>;
}): ReactNode {
    const entryId = "entryId" in slot ? slot.entryId : undefined;
    const queuedAtom = useMemo(() => (entryId == null ? NO_QUEUED : queuedStateAtom(entryId)), [entryId]);
    const queued = useAtomValue(queuedAtom);
    const waiting = queued != null && (queued.view.state === "waiting" || queued.view.state === "blocked");
    // a started entry follows its run: the slot's, else the one the queue's started record names
    const runId = waiting ? null : (slot.runId ?? (queued?.view.state === "started" ? queued.view.runId : null));
    const read = useRunInfo(runId);
    const view = runCardView(read.run);
    let card: ReactNode = null;
    if (waiting) {
        const blocked = queued.view.state === "blocked";
        card = (
            <RunCardBox
                id={entryId!}
                state={runTag(live, blocked)}
                head={queued.head}
                body={{
                    kind: "shown",
                    name: queued.name,
                    line: { key: "queued", label: queuedLabel(queued.view), tone: blocked ? "asking" : "muted" },
                    queued: true,
                }}
                label="A run this conversation queued"
                model={model}
                agent={agent}
            />
        );
    } else if (runId != null) {
        card = runCardFolded(view, ended) ? (
            <DoneRow
                kind="run"
                head={ended != null ? runEndedLine(runId, ended) : runDoneLine(view)}
                detail={ended?.text}
            />
        ) : (
            <RunCardBox
                id={runId}
                runId={runId}
                state={runTag(live, read.loaded && view.stage?.needsYou === true)}
                head={read.loaded && view.stage != null ? view.kind : "Run"}
                body={runBody(view, read.loaded)}
                label="A run this conversation started"
                model={model}
                agent={agent}
            />
        );
    }
    return (
        <>
            {entryId != null ? <QueueFeed /> : null}
            {rowProps != null && card != null ? (
                <motion.div {...rowProps} data-chat-brainstorm-row>
                    {card}
                </motion.div>
            ) : (
                card
            )}
        </>
    );
}
