// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run a brainstorm started, as Chat draws it (docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md,
// section 4 and Builder decisions 8 and 12): a card at the end of the conversation with the run's name, its kind and its
// stage, updated in place, and one way in (Open run); once the run is landed, complete or cancelled the card is gone and
// the run is one ✓ row in the timeline. The run is read from the run store (`useRunInfo`), so the card moves with it; no
// task bar and no actions of its own: the run's own sheet is one click away. The card itself is the one every run of a
// conversation has (`RunCardBox`, chatruncard.tsx); a held run never reaches a done stage, so the `[arc] Run … held:`
// message wavesrv typed into the session (`ended`) folds the brainstorm's run as it does any other.

import { atom, useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useMemo, type ComponentProps } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { runCardView, runDoneLine, type RunCard } from "./chatbrainstorm";
import { DoneRow } from "./chatbrainstormparts";
import { RunCardBox } from "./chatruncard";
import { runBody, runTag } from "./chatruncardmodel";
import { runCardFolded, runEndedLine, type RunEnded } from "./chatruncards";
import { runInfoAtom, useRunInfo } from "./runlineagestore";

/** The whole end row of a run card, its wrapper included: the run the brainstorm started, read from the run store. Once
 *  the run is landed, complete or cancelled, or its run-ended message came (`ended`), it returns nothing (no wrapper, so
 *  no empty row holding the column's gap) and the run is `ChatBrainstormRunDone`'s ✓ row. Otherwise it draws the wrapper
 *  the conversation hands in as `rowProps` (its end row's motion props: the gap opens and closes on the spring) around
 *  the card. The wrapper carries the end row's `data-chat-brainstorm-row` mark itself, so a caller's `rowProps` need
 *  not. */
export function ChatBrainstormRunRow({
    agent,
    card,
    model,
    rowProps,
    ended,
}: {
    agent: AgentVM;
    card: RunCard;
    model: AgentsViewModel;
    rowProps: ComponentProps<typeof motion.div>;
    ended?: RunEnded | null;
}) {
    const read = useRunInfo(card.runId);
    const view = runCardView(read.run);
    if (runCardFolded(view, ended)) {
        return null;
    }
    return (
        <motion.div {...rowProps} data-chat-brainstorm-row>
            <RunCardBox
                id={card.runId}
                runId={card.runId}
                state={runTag(card.state !== "static", read.loaded && view.stage?.needsYou === true)}
                head={read.loaded && view.stage != null ? view.kind : "Run"}
                body={runBody(view, read.loaded)}
                label="The run this brainstorm started"
                model={model}
                agent={agent}
            />
        </motion.div>
    );
}

const NO_RUNS: ReadonlySet<string> = new Set();

/** Which of `runIds` are over (landed, complete or cancelled), for the conversation to tell whether the line that started
 *  a run draws its ✓ row or nothing (`pairedHidden`): the line is a row in the column or it is not there at all, so the
 *  conversation has to know before it draws the line, which a component of the row itself cannot say. The runs are read
 *  from the run store through one derived atom whose value is the done ids as a string, so a run changing stage
 *  re-renders the conversation only when one of them crosses into done. A run the store has not loaded reads as not
 *  done. The set is stable while the ids that are done are. */
export function useDoneRuns(runIds: readonly string[]): ReadonlySet<string> {
    const ids = runIds.join("\n");
    const doneAtom = useMemo(
        () =>
            atom((get) =>
                (ids === "" ? [] : ids.split("\n"))
                    .filter((id) => runCardView(get(runInfoAtom(id)).run).done)
                    .join("\n")
            ),
        [ids]
    );
    const done = useAtomValue(doneAtom);
    return useMemo(() => (done === "" ? NO_RUNS : new Set(done.split("\n"))), [done]);
}

/** A run that is over as one ✓ row, "Run · <name> · Landed", drawn in place of the `brainstorm: run <id>` message that
 *  started it. Nothing while the run is live (its card is at the end of the conversation) or while Arc has not read it.
 *  With its run-ended message (`ended`) the row is "Run 3fa21b0c landed · merged into main" (or "… held: <reason>") and
 *  opens to the message as written, whether or not the run is done: a held run never is. */
export function ChatBrainstormRunDone({ runId, ended }: { runId: string; ended?: RunEnded | null }) {
    const { run } = useRunInfo(runId);
    if (ended != null) {
        return <DoneRow kind="run" head={runEndedLine(runId, ended)} detail={ended.text} />;
    }
    const view = runCardView(run);
    return view.done ? <DoneRow kind="run" head={runDoneLine(view)} /> : null;
}
