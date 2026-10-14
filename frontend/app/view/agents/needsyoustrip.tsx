// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Needs you": what waits on you in the Cockpit that is not a card. Asks are cards below it; this lists the review
// gates, blocked tasks, runs to acknowledge or land, and escalations that Jarvis's Waiting list used to be the only
// place to act on. The model is needsyoustripmodel.ts; the button and its call are the Brief's own (attentionact.ts,
// attentionrun.ts). A proposed learned rule has no such button: it is Accept, Edit or Dismiss (LearnDecide), with the
// words that raised it behind a Why toggle. Hidden when nothing waits.

import { pushToast } from "@/app/cockpit/notificationstore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AttentionAct } from "@/app/view/jarvis/attentionact";
import { runAttentionAct } from "@/app/view/jarvis/attentionrun";
import { REGION_LABEL, ROW_BORDER, SMALL_BTN, TONE_TEXT } from "@/app/view/jarvis/briefstyle";
import { workOnDueChunk } from "@/app/view/jarvis/initiativeworkaction";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { attentionAtom, loadAttention } from "./attentionstore";
import { channelMessagesAtom, channelsAtom } from "./channelsstore";
import { buildNeedsYouRows, channelProjects, stripAge, type StripRow } from "./needsyoustripmodel";
import { projectsAtom } from "./projectsstore";

const feedback = {
    done: (title: string) => pushToast({ title, message: "", level: "info" }),
    fail: (title: string) => pushToast({ title, message: "", level: "error" }),
};

const ACT_BTN =
    "min-w-[66px] flex-none cursor-pointer rounded-[6px] border px-2 py-[3px] text-[10.5px] font-semibold hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

const openTitle = (row: StripRow) =>
    row.open?.kind === "agent"
        ? "Go to the asking agent's card"
        : row.open?.kind === "effort"
          ? "Open the initiative"
          : "Open the run";

// A learned rule's row: the rule, where it would go, and what to do with it. Why folds the user's own words that
// raised it; Edit swaps the rule for an input (Enter accepts the edited line, Escape cancels). onDecide resolves true
// once the call went through, so a failed accept (a skill at its 20 additions) leaves the card and the input as they were.
function LearnRow({
    row,
    now,
    busy,
    onDecide,
}: {
    row: StripRow;
    now: number;
    busy: boolean;
    onDecide: (row: StripRow, accept: boolean, text?: string) => Promise<boolean>;
}) {
    const [whyOpen, setWhyOpen] = useState(false);
    const [draft, setDraft] = useState<string | null>(null);
    const accept = () => {
        const text = draft?.trim();
        if (draft != null && !text) {
            return;
        }
        fireAndForget(() => onDecide(row, true, text));
    };
    const btn = cn(SMALL_BTN, "disabled:cursor-default disabled:opacity-50");
    return (
        <div
            data-needs-you-row={row.key}
            data-learn-id={row.learnId}
            className={cn("flex flex-col py-1.5 hover:bg-surface-hover", ROW_BORDER)}
        >
            <div className="flex items-center gap-[13px]">
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
                {draft != null ? (
                    <input
                        type="text"
                        data-testid="learn-edit-input"
                        aria-label="Edit the learned rule"
                        autoFocus
                        maxLength={200}
                        value={draft}
                        disabled={busy}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setDraft(null);
                            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                e.stopPropagation();
                                accept();
                            }
                        }}
                        className="min-w-0 flex-1 rounded-[6px] border border-accent bg-background px-2 py-[3px] text-[13px] text-primary outline-none disabled:opacity-50"
                    />
                ) : (
                    <span title={row.text} className="min-w-0 flex-1 truncate text-[13px] text-ink-hi">
                        {row.text}
                    </span>
                )}
                <span
                    className={cn(
                        "w-10 flex-none text-right text-[11px] font-semibold tabular-nums",
                        TONE_TEXT[row.tone]
                    )}
                >
                    {stripAge(row.waitingSince, now)}
                </span>
                <div className="flex flex-none items-center gap-1.5">
                    {row.why ? (
                        <button
                            type="button"
                            data-testid="learn-why"
                            aria-expanded={whyOpen}
                            title="What you said that raised this"
                            onClick={() => setWhyOpen((o) => !o)}
                            className="cursor-pointer rounded-[6px] px-1.5 py-[3px] text-[10.5px] font-semibold text-ink-mid hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            Why {whyOpen ? "▾" : "▸"}
                        </button>
                    ) : null}
                    <button type="button" data-testid="learn-accept" disabled={busy} onClick={accept} className={btn}>
                        Accept
                    </button>
                    {draft != null ? null : (
                        <button
                            type="button"
                            data-testid="learn-edit"
                            disabled={busy}
                            onClick={() => setDraft(row.text)}
                            className={btn}
                        >
                            Edit
                        </button>
                    )}
                    <button
                        type="button"
                        data-testid="learn-dismiss"
                        disabled={busy}
                        title="Never propose this again"
                        onClick={() => fireAndForget(() => onDecide(row, false))}
                        className={btn}
                    >
                        Dismiss
                    </button>
                </div>
            </div>
            {whyOpen && row.why ? (
                <p data-testid="learn-why-quotes" className="pb-0.5 pl-[282px] pt-1 text-[11.5px] text-ink-mid">
                    {row.why}
                </p>
            ) : null}
        </div>
    );
}

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
        if (to.kind === "effort") {
            fireAndForget(() => openOrPeek(model, { kind: "effort", effortId: to.effortId }, e));
            return;
        }
        fireAndForget(() =>
            openOrPeek(model, { kind: "channel", channelId: to.channelId, runId: to.runId ?? undefined }, e)
        );
    };
    const setRowBusy = (key: string, on: boolean) =>
        setBusy((cur) => {
            const next = new Set(cur);
            if (on) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
    const decideLearn = async (row: StripRow, accept: boolean, text?: string): Promise<boolean> => {
        if (row.learnId == null) {
            return false;
        }
        setRowBusy(row.key, true);
        try {
            await RpcApi.LearnDecideCommand(TabRpcClient, { id: row.learnId, accept, ...(text ? { text } : {}) });
        } catch (e) {
            // the card stays: a skill at its 20 additions, or one removed since, says why in the error
            feedback.fail(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setRowBusy(row.key, false);
        }
        await loadAttention();
        feedback.done(accept ? `Learned: ${row.text}` : "Learned rule dismissed");
        return true;
    };
    const act = (row: StripRow, which: AttentionAct, e: React.MouseEvent) => {
        if (which.kind === "open") {
            open(row, e);
            return;
        }
        if (which.kind === "work-on") {
            if (row.open?.kind === "effort") {
                const effortId = row.open.effortId;
                fireAndForget(() => workOnDueChunk(model, "effort:" + effortId, row.text));
            }
            return;
        }
        setRowBusy(row.key, true);
        fireAndForget(async () => {
            try {
                await runAttentionAct(which, row.run, feedback);
            } finally {
                setRowBusy(row.key, false);
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
                {rows.map((row) =>
                    row.learnId != null ? (
                        <LearnRow key={row.key} row={row} now={now} busy={busy.has(row.key)} onDecide={decideLearn} />
                    ) : (
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
                                        data-strip-act={row.act.kind}
                                        title={row.act.kind === "open" ? openTitle(row) : undefined}
                                        disabled={busy.has(row.key)}
                                        onClick={(e) => act(row, row.act, e)}
                                        className={cn(
                                            ACT_BTN,
                                            row.act.label === "Approve"
                                                ? "border-success/35 bg-success/12 text-success"
                                                : "border-edge-mid text-secondary"
                                        )}
                                    >
                                        {row.act.label}
                                    </button>
                                )}
                                {row.secondAct != null ? (
                                    <button
                                        type="button"
                                        data-strip-act={row.secondAct.kind}
                                        disabled={busy.has(row.key)}
                                        onClick={(e) => act(row, row.secondAct!, e)}
                                        className={cn(ACT_BTN, "border-edge-mid text-secondary")}
                                    >
                                        {row.secondAct.label}
                                    </button>
                                ) : null}
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
                    )
                )}
            </div>
        </section>
    );
}
