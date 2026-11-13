// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council cards Chat draws for a council the agent started with `wsh council start`
// (docs/superpowers/specs/2026-11-14-chat-council-design.md, sections 1, 3 and 6; the pure half is chatcouncil.ts).
// `ChatCouncilCard` is the live card for a council that is queued, running or waiting on the person after round 1: the
// feature, the question, a chip per seat, the step, the elapsed time and the start line's estimate, with Stop (and Continue
// at the pause) acting from the card. `ChatCouncilRow` is the one ✓ row it folds into once the council has ended (and the row
// stays, updating in place, if the council runs again). Both read the council from `councilAtom`, which
// `useChatCouncils` (chatcouncilstore.ts) loads and `council:changed` keeps current; the room itself stays where it is.

import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUpRight, Clock, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { ERROR_LINE } from "./brainstormui";
import {
    CardShell,
    DoneRow,
    FOCUS_RING,
    PRIMARY_BTN,
    SMALL_BTN,
    StateDot,
    type CardState,
} from "./chatbrainstormparts";
import {
    councilCardView,
    councilRowView,
    type CouncilAnchor,
    type CouncilRowView,
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

// the row's link, in the accent: the board's Open report / Open council
const ROW_LINK = `cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-[12.5px] font-semibold text-accent hover:text-accenthover ${FOCUS_RING}`;

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

// the glyph in the row's mark box: the ✓ is DoneRow's own, a council running again is the working dot
function rowMark(mark: CouncilRowView["mark"]): ReactNode {
    switch (mark) {
        case "✓":
            return undefined;
        case "working":
            return <StateDot state="working" />;
        case "!":
            return <span className="font-bold text-error">!</span>;
        case "■":
            return <span className="text-[10px]">■</span>;
        default:
            return mark;
    }
}

/** The one-line row of a council that has ended once, drawn at the `wsh council start` call that began it: ✓ with the
 *  mode, the count of directions or ideas and the elapsed time (done, Open report), ■ stopped, ! failed, – not run (each with
 *  its reason, Open council), or a working row while the council runs again (its header chip, Open council). It updates
 *  in place with the council. A council the store does not know draws nothing, unless a not-run line named it: that row
 *  needs only the line's own words. */
export function ChatCouncilRow({
    councilId,
    anchor,
    model,
}: {
    councilId: string;
    anchor: CouncilAnchor;
    model: AgentsViewModel;
}): ReactNode {
    const c = useAtomValue(councilAtom(councilId));
    // no row words a running clock (a council running again reads its step), so the read of the clock is frozen
    const now = useNow(false);
    if (c == null && anchor.kind !== "notrun") {
        return null;
    }
    const view = councilRowView(c, anchor, now);
    const report = view.action === "report";
    return (
        <DoneRow
            kind="council"
            head={view.head}
            text={view.text}
            mark={rowMark(view.mark)}
            action={
                <button
                    type="button"
                    {...(report ? { "data-chat-council-report": "" } : { "data-chat-council-open": "" })}
                    onClick={() => openCouncil(model, councilId, report ? "summary" : undefined)}
                    className={ROW_LINK}
                >
                    {report ? "Open report" : "Open council"}
                </button>
            }
            extra={{ "data-chat-council-row": councilId, "data-chat-council-end": view.end }}
        />
    );
}
