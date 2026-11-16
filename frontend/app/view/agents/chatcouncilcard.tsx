// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council cards Chat draws for a council the agent started with `wsh council start`
// (docs/superpowers/specs/2026-11-14-chat-council-design.md, sections 1, 3 and 6; the pure half is chatcouncil.ts).
// `ChatCouncilCard` is the live card for a council that is queued, running or waiting on the person after round 1: the
// feature, the question, a chip per seat, the step, the elapsed time and the start line's estimate, with Stop (and Continue
// at the pause) acting from the card. `ChatCouncilEnded` is the card it becomes once the council has ended (it stays,
// updating in place, if the council runs again), and `ChatCouncilSummary` the panel around the agent's summary of it. All
// read the council from `councilAtom`, which
// `useChatCouncils` (chatcouncilstore.ts) loads and `council:changed` keeps current; the room itself stays where it is.

import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUpRight, Check, Clock, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { ERROR_LINE } from "./brainstormui";
import { CardShell, FOCUS_RING, PRIMARY_BTN, SMALL_BTN, StateDot, type CardState } from "./chatbrainstormparts";
import {
    COUNCIL_WORD,
    councilCardView,
    councilEndedCardView,
    councilRowView,
    hasCouncilReport,
    type CouncilAnchor,
    type CouncilEndedCardView,
    type SeatState,
} from "./chatcouncil";
import { useActions } from "./councilactions";
import { continueCouncil, councilAtom, stopCouncil, useCouncil } from "./councilstore";
import { useNow } from "./narrationtimeline";

// a seat's dot: green once it sent, the accent while it works, grey while it waits; its word rides in the title and for a
// screen reader, since a dot says nothing alone
const SEAT_DOT: Record<SeatState, string> = {
    done: "bg-success",
    working: "bg-accent pulse-dot",
    waiting: "bg-muted",
};
const SEAT_WORD: Record<SeatState, string> = { done: "sent", working: "writing", waiting: "waiting" };

const openCouncil = (model: AgentsViewModel, councilId: string, view?: "summary") =>
    fireAndForget(() => openTarget(model, { kind: "council", councilId, ...(view != null ? { view } : {}) }));

/** The live card of a council this conversation started that is queued, running or waiting on you. `live` false (the agent
 *  exited) draws it static: the council's word still in the header, Open council kept, no Stop and no Continue. A council
 *  not loaded yet draws nothing. A button, once pressed, is dead until `council:changed` brings the council a new state;
 *  a Stop or Continue wavesrv refuses shows its reason on the card and leaves the buttons as they were. */
export function ChatCouncilCard({
    councilId,
    anchor,
    model,
    live,
}: {
    councilId: string;
    anchor: CouncilAnchor;
    model: AgentsViewModel;
    live: boolean;
}): ReactNode {
    const c = useAtomValue(councilAtom(councilId));
    // the council a queued one waits for, loaded by this card as the room's queued body does
    const holder = useCouncil(c?.state === "queued" && c.queuedafter ? c.queuedafter : null);
    const now = useNow(c?.state === "running");
    const acts = useActions();
    // the council's state when a button was pressed: both buttons stay dead until it is another one
    const [pressedAt, setPressedAt] = useState<string | null>(null);
    if (c == null) {
        return null;
    }
    const view = councilCardView(c, anchor, holder, now);
    const state: CardState = !live ? "static" : view.state === "awaiting" ? "waiting" : "working";
    const off = acts.busy.size > 0 || pressedAt === c.state;
    const act = async (key: "stop" | "continue") => {
        const ok =
            key === "stop"
                ? await acts.run(key, "Stop", () => stopCouncil(c.id))
                : await acts.run(key, "Continue", () => continueCouncil({ id: c.id }));
        if (ok) {
            setPressedAt(c.state);
        }
    };
    const stop = (
        <button
            type="button"
            data-chat-council-stop
            disabled={off}
            onClick={() => void act("stop")}
            className={cn(SMALL_BTN, FOCUS_RING)}
        >
            Stop
        </button>
    );
    return (
        <CardShell
            kind="council"
            state={state}
            head={view.head}
            icon={
                view.state === "queued" ? (
                    <Clock size={14} strokeWidth={2} className="flex-none" aria-hidden />
                ) : (
                    <Users size={14} strokeWidth={2} className="flex-none" aria-hidden />
                )
            }
            tag={
                view.state === "queued" ? (
                    <span data-chat-council-queued title={view.tag} className="min-w-0 truncate">
                        {view.tag}
                    </span>
                ) : (
                    <>
                        {live ? <StateDot state={state} /> : null}
                        <span
                            {...(view.state === "running" ? { "data-chat-council-round": "" } : null)}
                            className="min-w-0 truncate"
                        >
                            {view.tag}
                        </span>
                    </>
                )
            }
            action={
                <button
                    type="button"
                    data-chat-council-open
                    onClick={() => openCouncil(model, councilId)}
                    className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
                >
                    Open council
                    <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                </button>
            }
            label={`${view.head}: ${view.title}`}
            extra={{ "data-chat-council": councilId, "data-chat-council-state": view.state }}
        >
            <div className="flex min-w-0 flex-col gap-[4px]">
                <span
                    data-chat-council-title
                    title={view.title}
                    className={cn(
                        "truncate font-semibold text-primary",
                        view.state === "queued" ? "text-[14px] leading-[1.45]" : "text-[15px] leading-[1.45]"
                    )}
                >
                    {view.title}
                </span>
                {view.state === "awaiting" ? (
                    <span data-chat-council-line className="text-[12.5px] leading-[1.5] text-muted">
                        {view.line}
                    </span>
                ) : view.state === "running" && view.question !== "" ? (
                    <span
                        data-chat-council-question
                        title={view.question}
                        className="line-clamp-2 text-[12.5px] leading-[1.5] text-muted"
                    >
                        {view.question}
                    </span>
                ) : null}
            </div>
            {view.state === "running" ? (
                <>
                    <div role="list" aria-label="Experts" className="flex flex-wrap gap-[6px]">
                        {view.seats.map((s) => (
                            <span
                                key={s.id}
                                role="listitem"
                                data-chat-council-seat={s.id}
                                data-seat-state={s.state}
                                title={`${s.name}: ${SEAT_WORD[s.state]}`}
                                className={cn(
                                    "inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-full border border-edge-mid px-[9px] py-[3px] text-[12px]",
                                    s.state === "working" ? "bg-surface text-primary" : "text-muted"
                                )}
                            >
                                <span
                                    aria-hidden="true"
                                    className={cn("h-[6px] w-[6px] flex-none rounded-full", SEAT_DOT[s.state])}
                                />
                                <span className="truncate">{s.name}</span>
                                <span className="sr-only">{SEAT_WORD[s.state]}</span>
                            </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-[10px] text-[12px] text-muted">
                        {view.elapsed !== "" ? (
                            <span data-chat-council-elapsed className="tabular-nums">
                                {view.elapsed}
                            </span>
                        ) : null}
                        {view.elapsed !== "" && view.estimate != null ? <span aria-hidden="true">·</span> : null}
                        {view.estimate != null ? <span data-chat-council-estimate>{view.estimate}</span> : null}
                        {live ? <span className="ml-auto flex-none">{stop}</span> : null}
                    </div>
                </>
            ) : null}
            {view.state === "awaiting" && live ? (
                <div className="flex items-center gap-[8px]">
                    <button
                        type="button"
                        data-chat-council-continue
                        disabled={off}
                        onClick={() => void act("continue")}
                        className={cn(PRIMARY_BTN, FOCUS_RING)}
                    >
                        Continue
                    </button>
                    {stop}
                </div>
            ) : null}
            {acts.error != null ? (
                <div role="alert" data-chat-council-error className={ERROR_LINE}>
                    {acts.error}
                </div>
            ) : null}
        </CardShell>
    );
}

// the glyph before the ended card's tag: a done council's ✓ in the success ink, a council running again the working dot,
// and the row's own marks (■ stopped, ! failed, – not run) otherwise
function tagMark(mark: CouncilEndedCardView["mark"]): ReactNode {
    switch (mark) {
        case "✓":
            return <Check size={12} strokeWidth={2.6} className="flex-none text-success" aria-hidden />;
        case "working":
            return <StateDot state="working" />;
        case "!":
            return (
                <span aria-hidden="true" className="font-bold text-error">
                    !
                </span>
            );
        case "■":
            return (
                <span aria-hidden="true" className="text-[10px]">
                    ■
                </span>
            );
        default:
            return <span aria-hidden="true">{mark}</span>;
    }
}

// Open report on a council with a report, else Open council: the ended card's link and the summary panel's, in the run
// card's Open run look
function OpenCouncilButton({
    model,
    councilId,
    report,
}: {
    model: AgentsViewModel;
    councilId: string;
    report: boolean;
}): ReactNode {
    return (
        <button
            type="button"
            {...(report ? { "data-chat-council-report": "" } : { "data-chat-council-open": "" })}
            onClick={() => openCouncil(model, councilId, report ? "summary" : undefined)}
            className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
        >
            {report ? "Open report" : "Open council"}
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        </button>
    );
}

/** The card of a council that has ended once, at the end of the conversation after its runs, in the brainstorm's run
 *  card's shape: `Council · review`, where it stands (✓ Done · 5 directions · 11 min, ■ Stopped in round 2, ! Failed,
 *  – Not run, or Running again while a follow-up runs), Open report (or Open council), the feature, and what it came to
 *  (a done council's answer, else the reason). It updates in place with the council. A council the store does not know
 *  draws nothing, unless a not-run line named it: that card needs only the line's own words. */
export function ChatCouncilEnded({
    councilId,
    anchor,
    model,
}: {
    councilId: string;
    anchor: CouncilAnchor;
    model: AgentsViewModel;
}): ReactNode {
    const c = useAtomValue(councilAtom(councilId));
    // no ended card words a running clock (a council running again reads its step), so the read of the clock is frozen
    const now = useNow(false);
    if (c == null && anchor.kind !== "notrun") {
        return null;
    }
    const view = councilEndedCardView(c, anchor, now);
    return (
        <CardShell
            kind="council"
            state="static"
            head={view.head}
            icon={<Users size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            tag={
                <>
                    {tagMark(view.mark)}
                    <span data-chat-council-tag className="min-w-0 truncate">
                        {view.tag}
                    </span>
                </>
            }
            action={<OpenCouncilButton model={model} councilId={councilId} report={view.action === "report"} />}
            label={`${view.head}: ${view.title}`}
            extra={{ "data-chat-council-row": councilId, "data-chat-council-end": view.end }}
        >
            <div className="flex min-w-0 flex-col gap-[4px]">
                <span
                    data-chat-council-title
                    title={view.title}
                    className="truncate text-[15px] font-semibold leading-[1.45] text-primary"
                >
                    {view.title}
                </span>
                {view.line != null ? (
                    <span
                        data-chat-council-line
                        title={view.line}
                        className="flex min-w-0 items-center gap-[8px] text-[12.5px] leading-[1.5] text-secondary"
                    >
                        {view.end === "done" ? (
                            <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-success" />
                        ) : null}
                        <span className="min-w-0 truncate">{view.line}</span>
                    </span>
                ) : null}
            </div>
        </CardShell>
    );
}

/** The agent's summary of a council (chatcouncil.ts `councilSummaries` finds the prose), drawn inside a panel of its own
 *  in the accent tint: a header naming the council (`Council · review · 5 directions · 11 min`) with Open report, then the
 *  prose as it was written. Until the council has a report to sum up (`hasCouncilReport`), or while it is not loaded, the
 *  prose draws plain. */
export function ChatCouncilSummary({
    councilId,
    model,
    children,
}: {
    councilId: string;
    model: AgentsViewModel;
    children: ReactNode;
}): ReactNode {
    const c = useAtomValue(councilAtom(councilId));
    const now = useNow(false);
    if (!hasCouncilReport(c)) {
        return children;
    }
    const row = councilRowView(c, { kind: "started", councilId }, now);
    return (
        <section
            data-chat-council-summary={councilId}
            aria-label={`${row.head}: summary`}
            className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-accent/40"
        >
            <div className="flex min-w-0 items-center gap-[8px] border-b border-accent/30 bg-accentbg px-[16px] py-[8px] text-[12px] text-secondary">
                <Users size={14} strokeWidth={2} className="flex-none text-accent" aria-hidden />
                <span data-chat-council-summary-head className="min-w-0 truncate">
                    <span className="font-semibold text-primary">{COUNCIL_WORD}</span>
                    {row.head.slice(COUNCIL_WORD.length)}
                </span>
                <span className="ml-auto flex flex-none items-center">
                    <OpenCouncilButton model={model} councilId={councilId} report={row.action === "report"} />
                </span>
            </div>
            <div className="min-w-0 bg-accent/[0.04] px-[16px] py-[12px]">{children}</div>
        </section>
    );
}
