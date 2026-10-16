// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's sheet on a queued plan (spec 2026-10-16-brief-run-queue-design.md): what it waits on, its plan and
// route, and the three things the Agent tree's queued row does to it. The lines are queueSheetModel's.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { runAtom } from "@/app/view/agents/channelsstore";
import { runProgress } from "@/app/view/agents/runlineage";
import { openOriginSession, useOriginName } from "@/app/view/agents/runoriginstore";
import type { QueuedRow } from "@/app/view/agents/runqueuemodel";
import {
    confirmRemoveQueued,
    queuedRowsAtom,
    runQueueAtom,
    runQueuedNext,
    startQueuedNow,
} from "@/app/view/agents/runqueuestore";
import { runStage } from "@/app/view/agents/runstage";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { queueSheetModel } from "./briefqueue";
import { openQueueSheet } from "./briefqueuestore";
import { SHEET_BTN } from "./briefrunsheet";
import { REGION_LABEL } from "./briefstyle";
import { openOrPeekAddress } from "./openref";

const NO_RUN = atom<Run | null>(null);

// the link recipe of the run sheet's `started from` button (runsheet.tsx), at the reading's text size
const LINK_BTN =
    "inline-flex min-w-0 max-w-full cursor-pointer items-center text-left text-[13px] text-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

// a labelled line of the reading; the data-queue-sheet-* hooks ride in on `rest`
function Field({ label, children, ...rest }: { label: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
    return (
        <div className="flex items-baseline gap-2.5" {...rest}>
            <span className={cn(REGION_LABEL, "w-[76px] text-muted")}>{label}</span>
            <div className="min-w-0 flex-1 text-[13px] leading-[1.5] text-ink-mid">{children}</div>
        </div>
    );
}

// the stage of the run an entry waits on, worded as the Runs row words it (runRowFace): the stage label, and how many
// of the plan's tasks are done when the lineage holds its dag. Nothing for a run that is not loaded.
function useAfterStage(model: AgentsViewModel, runId: string | undefined): string | undefined {
    const run = useAtomValue(runId ? runAtom(runId) : NO_RUN);
    const lineage = useAtomValue(model.lineageAtom);
    if (run == null) {
        return undefined;
    }
    const dag = lineage.runs[run.id]?.dag;
    const label = runStage({ status: run.status, land: run.land, dag }).label.toLowerCase();
    const { done, total } = runProgress(dag);
    return dag != null && total > 0 ? `${label} ${done}/${total}` : label;
}

function QueueSheetBody({ model, row }: { model: AgentsViewModel; row: QueuedRow }) {
    const { entry } = row;
    const entries = useAtomValue(runQueueAtom);
    const originName = useOriginName(model, entry.data.origintabid);
    // the cap and the active runs are the server's to count: read them once per queue change
    const [cap, setCap] = useState({ maxActive: 0, active: 0 });
    useEffect(() => {
        let live = true;
        RpcApi.RunQueueListCommand(TabRpcClient)
            .then((data) => {
                if (live) {
                    setCap({ maxActive: data.maxactive, active: data.active });
                }
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [entries]);
    // the model names the run it waits on; its stage is read from that run, then the model words the line
    const waitsRunId = queueSheetModel(row, { ...cap, originName, now: 0 }).waits.runId;
    const afterStage = useAfterStage(model, waitsRunId);
    const m = queueSheetModel(row, { ...cap, afterStage, originName, now: Date.now() });
    const [starting, setStarting] = useState(false);
    const start = () => {
        setStarting(true);
        // a refusal toasts and leaves the entry as it was; an accepted start takes the entry out of the queue, which
        // the sheet follows to the run (briefsheet.tsx)
        fireAndForget(async () => {
            try {
                await startQueuedNow(entry);
            } finally {
                setStarting(false);
            }
        });
    };
    const openWaits = () => {
        if (m.waits.runId != null) {
            fireAndForget(() => openOrPeekAddress(model, "run:" + m.waits.runId));
        } else if (m.waits.entryId != null) {
            openQueueSheet(m.waits.entryId);
        }
    };
    return (
        <div className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="sc flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-4 pb-3.5 pt-4 [&>*]:flex-none">
                <div className="flex items-center gap-[9px]">
                    <span
                        className={cn(
                            "h-[7px] w-[7px] flex-none rounded-full",
                            m.blocked ? "bg-warning" : "bg-edge-strong"
                        )}
                    />
                    <span
                        data-queue-sheet-chip
                        className="flex-none text-[15px] font-bold tracking-[-.01em] text-primary"
                    >
                        {m.chip}
                    </span>
                </div>
                <Field label="waits on" data-queue-sheet-waits="">
                    {m.waits.runId != null || m.waits.entryId != null ? (
                        <button
                            type="button"
                            title={m.waits.runId != null ? "Open the run this waits on" : "Open the plan this waits on"}
                            onClick={openWaits}
                            className={LINK_BTN}
                        >
                            <span className="truncate">{m.waits.text}</span>
                        </button>
                    ) : (
                        m.waits.text
                    )}
                </Field>
                {m.reason != null ? (
                    <p
                        data-queue-sheet-reason
                        className="whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-warning"
                    >
                        {m.reason}
                    </p>
                ) : null}
                {m.plan != null ? (
                    // text, not a button: the Brief has no panel to open a file in
                    <Field label="plan" data-queue-sheet-plan="">
                        <span className="select-text break-all font-mono text-[12px]">{m.plan}</span>
                    </Field>
                ) : null}
                {m.goal != null ? (
                    <Field label="goal" data-queue-sheet-goal="">
                        <span className="select-text whitespace-pre-wrap break-words">{m.goal}</span>
                    </Field>
                ) : null}
                <Field label="route" data-queue-sheet-route="">
                    {m.route}
                </Field>
                {/* the label would only repeat the line's first word */}
                <div
                    data-queue-sheet-queued=""
                    className="flex min-w-0 flex-wrap items-baseline text-[11.5px] leading-[1.5] text-muted"
                >
                    <span>{m.queued}</span>
                    {m.queuedBy != null ? (
                        <>
                            <span aria-hidden> · </span>
                            <button
                                type="button"
                                data-queue-sheet-origin={m.queuedBy.tabId}
                                title={`Go to ${m.queuedBy.name}, the session that queued this`}
                                onClick={() => openOriginSession(model, m.queuedBy!.tabId)}
                                className={cn(LINK_BTN, "text-[11.5px] text-ink-mid hover:text-accent-soft")}
                            >
                                <span className="truncate">from {m.queuedBy.name}</span>
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-edge-faint px-4 py-2.5">
                <button
                    type="button"
                    data-queue-sheet-act="start"
                    disabled={starting}
                    title="Start now, past the cap and past what it waits on"
                    onClick={start}
                    className={SHEET_BTN}
                >
                    {starting ? "Starting…" : "Start now"}
                </button>
                {m.runNext ? (
                    <button
                        type="button"
                        data-queue-sheet-act="next"
                        title="Move to the head of the queue"
                        onClick={() => fireAndForget(() => runQueuedNext(entry))}
                        className={SHEET_BTN}
                    >
                        Run next
                    </button>
                ) : null}
                <button
                    type="button"
                    data-queue-sheet-act="remove"
                    title="Take it out of the queue; it will not start"
                    onClick={() => confirmRemoveQueued(entry)}
                    className={SHEET_BTN}
                >
                    Remove
                </button>
            </div>
        </div>
    );
}

/** The sheet body for a queued plan. An entry that is not in the queue draws nothing: briefsheet.tsx follows it to
 *  its run, or closes the sheet. */
export function QueueSheet({ model, entryId }: { model: AgentsViewModel; entryId: string }) {
    const rows = useAtomValue(queuedRowsAtom);
    const row = rows.find((r) => r.entry.id === entryId);
    return row != null ? <QueueSheetBody model={model} row={row} /> : null;
}
