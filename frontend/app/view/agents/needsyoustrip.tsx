// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Needs you": what waits on you in the Cockpit that is not a card. Asks are cards below it; this lists the review
// gates, blocked tasks, runs to acknowledge or land, and escalations that Jarvis's Waiting list used to be the only
// place to act on. The model is needsyoustripmodel.ts; the button and its call are the Brief's own (attentionact.ts,
// attentionrun.ts). Hidden when nothing waits.

import { pushToast } from "@/app/cockpit/notificationstore";
import { runAttentionAct } from "@/app/view/jarvis/attentionrun";
import { REGION_LABEL, ROW_BORDER, SMALL_BTN, TONE_TEXT } from "@/app/view/jarvis/briefstyle";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { attentionAtom } from "./attentionstore";
import { channelMessagesAtom, channelsAtom } from "./channelsstore";
import { buildNeedsYouRows, channelProjects, stripAge, type StripRow } from "./needsyoustripmodel";
import { projectsAtom } from "./projectsstore";

const feedback = {
    done: (title: string) => pushToast({ title, message: "", level: "info" }),
    fail: (title: string) => pushToast({ title, message: "", level: "error" }),
};

const openTitle = (row: StripRow) => (row.open?.kind === "agent" ? "Go to the asking agent's card" : "Open the run");

export function NeedsYouStrip({
    model,
    onFocusAgent,
}: {
    model: AgentsViewModel;
    // an escalation's Open, when its asking agent is in the roster: the Cockpit knows where that card is
    onFocusAgent: (agentId: string) => void;
}) {
    const attention = useAtomValue(attentionAtom);
    const channels = useAtomValue(channelsAtom);
    const registry = useAtomValue(projectsAtom);
    const channelMessages = useAtomValue(channelMessagesAtom);
    const roster = useAtomValue(model.agentsAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const now = useAtomValue(model.structuralNowAtom);
    // rows whose call is in flight: the list reloads only once it lands, and a second press would send it twice
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
    const channelProject = useMemo(() => channelProjects(channels, registry), [channels, registry]);
    const rows = useMemo(
        () => buildNeedsYouRows({ attention, filter, channelProject, channelMessages, roster }),
        [attention, filter, channelProject, channelMessages, roster]
    );
    if (rows.length === 0) {
        return null;
    }

    const open = (row: StripRow, e?: React.MouseEvent) => {
        const to = row.open;
        if (to == null) {
            return;
        }
        if (to.kind === "agent") {
            onFocusAgent(to.agentId);
            return;
        }
        fireAndForget(() =>
            openOrPeek(model, { kind: "channel", channelId: to.channelId, runId: to.runId ?? undefined }, e)
        );
    };
    const act = (row: StripRow, e: React.MouseEvent) => {
        if (row.act.kind === "open") {
            open(row, e);
            return;
        }
        setBusy((cur) => new Set(cur).add(row.key));
        fireAndForget(async () => {
            try {
                await runAttentionAct(row.act, row.run, feedback);
            } finally {
                setBusy((cur) => {
                    const next = new Set(cur);
                    next.delete(row.key);
                    return next;
                });
            }
        });
    };

    return (
        <section
            data-cockpit-needs-you
            aria-label="Needs you"
            className="shrink-0 border-b border-border bg-background px-5 pb-1.5 pt-2"
        >
            <div className="flex items-center gap-2 pb-1">
                <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-asking" />
                <span className={cn(REGION_LABEL, "text-asking")}>Needs you</span>
                <span className="text-[10.5px] font-semibold tabular-nums text-ink-mid">{rows.length}</span>
            </div>
            <div className="flex max-h-[30vh] flex-col overflow-y-auto">
                {rows.map((row) => (
                    <div
                        key={row.key}
                        data-needs-you-row={row.key}
                        className={cn("flex items-center gap-[13px] py-1.5 hover:bg-surface-hover", ROW_BORDER)}
                    >
                        <span
                            className={cn(
                                "w-[116px] flex-none truncate text-[10.5px] font-semibold tracking-[.02em]",
                                TONE_TEXT[row.tone]
                            )}
                        >
                            {row.kindLabel}
                        </span>
                        <span title={row.source} className="w-[140px] flex-none truncate text-[11px] text-ink-mid">
                            {row.source}
                        </span>
                        <span
                            title={row.why ? `${row.text} — ${row.why}` : row.text}
                            className="min-w-0 flex-1 truncate text-[13px] text-ink-hi"
                        >
                            {row.text}
                            {row.why ? <span className="text-ink-mid"> — {row.why}</span> : null}
                        </span>
                        <span
                            className={cn(
                                "w-10 flex-none text-right text-[11px] font-semibold tabular-nums",
                                TONE_TEXT[row.tone]
                            )}
                        >
                            {stripAge(row.waitingSince, now)}
                        </span>
                        <div className="flex flex-none items-center gap-1.5">
                            {row.act.kind === "open" && row.open == null ? null : (
                                <button
                                    type="button"
                                    data-needs-you-act={row.act.kind}
                                    title={row.act.kind === "open" ? openTitle(row) : undefined}
                                    disabled={busy.has(row.key)}
                                    onClick={(e) => act(row, e)}
                                    className={cn(
                                        "min-w-[66px] flex-none cursor-pointer rounded-[6px] border px-2 py-[3px] text-[10.5px] font-semibold hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50",
                                        row.act.label === "Approve"
                                            ? "border-success/35 bg-success/12 text-success"
                                            : "border-edge-mid text-secondary"
                                    )}
                                >
                                    {row.act.label}
                                </button>
                            )}
                            {row.act.kind !== "open" && row.open != null ? (
                                <button
                                    type="button"
                                    data-needs-you-open={row.open.kind}
                                    title={openTitle(row)}
                                    onClick={(e) => open(row, e)}
                                    className={SMALL_BTN}
                                >
                                    Open
                                </button>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
