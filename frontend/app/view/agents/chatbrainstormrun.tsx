// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run a brainstorm started, as Chat draws it (docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md,
// section 4 and Builder decisions 8 and 12): a card at the end of the conversation with the run's name, its kind and its
// stage, updated in place, and one way in (Open run); once the run is landed, complete or cancelled the card is gone and
// the run is one ✓ row in the timeline. The run is read from the run store (`useRunInfo`), so the card moves with it; no
// task bar and no actions of its own: the run's own sheet is one click away.

import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { ArrowUpRight, Play } from "lucide-react";
import { motion } from "motion/react";
import type { ComponentProps } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { runCardView, runDoneLine, type RunCard, type RunCardView } from "./chatbrainstorm";
import { CardShell, DoneRow, FOCUS_RING, SMALL_BTN, type CardState } from "./chatbrainstormparts";
import { useRunInfo } from "./runlineagestore";
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

// What the header tag says. A live run is the engine's work, not the person's turn, so the tag says Working and turns
// amber (Waiting on you) only when the run itself needs the person; an exited agent is static whatever the run does.
function tagState(card: RunCard, view: RunCardView, loaded: boolean): CardState {
    if (card.state === "static") {
        return "static";
    }
    return loaded && view.stage?.needsYou === true ? "waiting" : "working";
}

function RunCardBox({
    agent,
    card,
    model,
    view,
    loaded,
}: {
    agent: AgentVM;
    card: RunCard;
    model: AgentsViewModel;
    view: RunCardView;
    loaded: boolean;
}) {
    // a run that is loaded but unknown to Arc (deleted) has no name or stage to show and nothing to open
    const missing = loaded && view.stage == null;
    const stage = loaded ? view.stage : null;
    const open = () => fireAndForget(() => openTarget(model, { kind: "run", runId: card.runId }));
    return (
        <CardShell
            kind="run"
            state={tagState(card, view, loaded)}
            head={loaded && !missing ? view.kind : "Run"}
            icon={<Play size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            agent={agent}
            label="The run this brainstorm started"
        >
            <div className="flex min-w-0 items-center gap-[12px]">
                <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                    {!loaded ? (
                        <span data-chat-bscard-run-loading className="text-[12.5px] leading-[1.5] text-muted">
                            Loading the run…
                        </span>
                    ) : missing ? (
                        <span data-chat-bscard-run-missing className="text-[12.5px] leading-[1.5] text-muted">
                            Arc cannot find this run.
                        </span>
                    ) : (
                        <>
                            <span
                                data-chat-bscard-run-name
                                title={view.name}
                                className="truncate text-[15px] font-semibold leading-[1.45] text-primary"
                            >
                                {view.name}
                            </span>
                            {stage != null ? (
                                <span
                                    data-chat-bscard-run-stage={stage.key}
                                    title={stage.label}
                                    className="flex min-w-0 items-center gap-[8px] text-[12.5px] leading-[1.5] text-secondary"
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn("h-[7px] w-[7px] flex-none rounded-full", STAGE_DOT[stage.tone])}
                                    />
                                    <span className="min-w-0 truncate">{stage.label}</span>
                                </span>
                            ) : null}
                        </>
                    )}
                </div>
                {!missing ? (
                    <button
                        type="button"
                        data-chat-bscard-run-open
                        onClick={open}
                        className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
                    >
                        Open run
                        <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                    </button>
                ) : null}
            </div>
        </CardShell>
    );
}

/** The whole end row of a run card, its wrapper included: the run the brainstorm started, read from the run store. Once
 *  the run is landed, complete or cancelled it returns nothing (no wrapper, so no empty row holding the column's gap) and
 *  the run is `ChatBrainstormRunDone`'s ✓ row. Otherwise it draws the wrapper the conversation hands in as `rowProps` (its
 *  end row's motion props: the gap opens and closes on the spring) around the card. The wrapper carries the end row's
 *  `data-chat-brainstorm-row` mark itself, so a caller's `rowProps` need not. */
export function ChatBrainstormRunRow({
    agent,
    card,
    model,
    rowProps,
}: {
    agent: AgentVM;
    card: RunCard;
    model: AgentsViewModel;
    rowProps: ComponentProps<typeof motion.div>;
}) {
    const read = useRunInfo(card.runId);
    const view = runCardView(read.run);
    if (view.done) {
        return null;
    }
    return (
        <motion.div {...rowProps} data-chat-brainstorm-row>
            <RunCardBox agent={agent} card={card} model={model} view={view} loaded={read.loaded} />
        </motion.div>
    );
}

/** A run that is over as one ✓ row, "Run · <name> · Landed", drawn in place of the `brainstorm: run <id>` message that
 *  started it. Nothing while the run is live (its card is at the end of the conversation) or while Arc has not read it. */
export function ChatBrainstormRunDone({ runId }: { runId: string }) {
    const { run } = useRunInfo(runId);
    const view = runCardView(run);
    return view.done ? <DoneRow kind="run" head={runDoneLine(view)} /> : null;
}
