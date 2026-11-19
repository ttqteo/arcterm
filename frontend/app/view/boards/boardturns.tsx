// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board's talk as the turns under its canvas (the split beside Chat) or in its column (expanded, and Library → Boards).
// Each turn reads its state from turnView: drawn, forwarded to the agent, answering, slow, failed or stopped. Recent mode
// is the split's: the last few turns, one line each, an "N earlier" line that opens the rest. Full mode lists every turn
// with the agent's copied reply under a forwarded question. What a button does is the caller's.

import { cn } from "@/util/util";
import { useNow } from "../agents/narrationtimeline";
import {
    drawnSummary,
    elapsedLabel,
    recentTurns,
    talkTime,
    turnText,
    turnView,
    type TurnShown,
    type TurnView,
} from "./boardtalkmodel";

export type BoardTurnsMode = "recent" | "full";

export interface BoardTurnsProps {
    talk: BoardTalk | null;
    mode: BoardTurnsMode;
    onShow: (turn: BoardTurn) => void;
    onOtherWay: (turn: BoardTurn) => void;
    onStop: (turn: BoardTurn) => void;
    onRetry: (turn: BoardTurn) => void;
    // recent mode's "N earlier" line: the split opens the whole board
    onEarlier?: () => void;
    // Send to agent needs a live agent; a board whose agent ended can still be drawn on
    canForward?: boolean;
}

// a state's word and tone. A forwarded turn has no word of its own: its note ("forwarded · answered in Chat") says it.
const STATE_LABEL: Record<TurnShown, { text: string; tone: string } | null> = {
    waiting: { text: "Queued", tone: "text-muted" },
    answering: { text: "Answering", tone: "text-success" },
    slow: { text: "Still answering", tone: "text-warning" },
    drawn: { text: "Drawn", tone: "text-success" },
    forwarded: null,
    failed: { text: "Couldn't answer", tone: "text-error" },
    stopped: { text: "Stopped", tone: "text-muted" },
};

const OTHER_WAY_LABEL = { forward: "Send to agent", draw: "Draw instead" } as const;

function TurnButton({
    attr,
    tone,
    onClick,
    children,
}: {
    attr: string;
    tone: string;
    onClick: () => void;
    children: string;
}) {
    return (
        <button
            type="button"
            {...{ [attr]: "" }}
            onClick={onClick}
            className={cn("flex-none cursor-pointer text-[12px] hover:text-primary", tone)}
        >
            {children}
        </button>
    );
}

interface TurnRowProps extends Pick<
    BoardTurnsProps,
    "mode" | "canForward" | "onShow" | "onOtherWay" | "onStop" | "onRetry"
> {
    turn: BoardTurn;
    now: number;
    agentTitle: string; // who a waiting forward waits for
}

function TurnRow({ turn, now, mode, canForward, agentTitle, ...on }: TurnRowProps) {
    const view: TurnView = turnView(turn, now, agentTitle);
    const label = STATE_LABEL[view.state];
    const running = view.state === "answering" || view.state === "slow";
    const text = turnText(turn);
    const reply = turn.forward?.reply;
    const showOtherWay = view.otherWay != null && (view.otherWay === "draw" || canForward !== false);
    const full = mode === "full";

    const status =
        label != null ? (
            <span data-board-turn-label className={cn("flex-none", label.tone)}>
                {running ? `${label.text} · ${elapsedLabel(view.seconds)}` : label.text}
            </span>
        ) : null;
    const detail = view.state === "drawn" ? <span className="flex-none text-muted">{drawnSummary(turn)}</span> : null;
    const note =
        view.forwardNote != null ? (
            <span data-board-turn-note className="flex-none text-secondary">
                {view.forwardNote}
            </span>
        ) : null;
    const actions = (
        <>
            {view.canShow ? (
                <TurnButton attr="data-board-turn-show" tone="text-accent" onClick={() => on.onShow(turn)}>
                    Show
                </TurnButton>
            ) : null}
            {view.state === "slow" ? (
                <TurnButton attr="data-board-turn-stop" tone="text-secondary" onClick={() => on.onStop(turn)}>
                    Stop
                </TurnButton>
            ) : null}
            {view.state === "failed" || view.state === "stopped" ? (
                <TurnButton attr="data-board-turn-retry" tone="text-accent" onClick={() => on.onRetry(turn)}>
                    Retry
                </TurnButton>
            ) : null}
            {showOtherWay ? (
                <TurnButton attr="data-board-turn-other" tone="text-secondary" onClick={() => on.onOtherWay(turn)}>
                    {OTHER_WAY_LABEL[view.otherWay!]}
                </TurnButton>
            ) : null}
        </>
    );
    // a failed turn says what happened and that the board is as it was; the reason can run long, so it wraps
    const reason =
        view.state === "failed" ? (
            <div data-board-turn-reason className="text-[11.5px] leading-[1.4] text-muted [overflow-wrap:anywhere]">
                {turn.reason ? `${turn.reason} · nothing changed` : "Nothing changed"}
            </div>
        ) : null;

    if (!full) {
        return (
            <div data-board-turn={turn.id} data-board-turn-state={view.state} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                    {status}
                    <span className="min-w-0 flex-1 truncate text-primary" title={text}>
                        {text}
                    </span>
                    {detail}
                    {note}
                    {actions}
                </div>
                {reason}
            </div>
        );
    }
    const when = talkTime(turn.answeredts || turn.ts, now);
    return (
        <div data-board-turn={turn.id} data-board-turn-state={view.state} className="flex min-w-0 flex-col gap-1">
            <span className="text-primary [overflow-wrap:anywhere]">{text}</span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                {status}
                {detail}
                {note}
                {turn.on ? <span className="flex-none">on {turn.on}</span> : null}
                <span className="flex-none tabular-nums">{when}</span>
                {actions}
            </div>
            {reason}
            {reply ? (
                <div
                    data-board-turn-reply
                    className="border-l-2 border-edge-strong pl-2 text-ink-hi [overflow-wrap:anywhere]"
                >
                    {reply}
                </div>
            ) : null}
        </div>
    );
}

export function BoardTurns({ talk, mode, canForward, onEarlier, ...on }: BoardTurnsProps) {
    const all = talk?.turns ?? [];
    // answering turns tick: the seconds, and the 45 s that turns one slow
    const now = useNow(all.some((t) => t.state === "answering"));
    const agentTitle = talk?.agent?.title ?? "";
    if (all.length === 0) {
        return mode === "full" ? (
            <div data-board-turns="full" className="px-[14px] py-[14px] text-[12px] text-muted">
                No turns yet.
            </div>
        ) : null;
    }
    if (mode === "full") {
        return (
            <div
                data-board-turns="full"
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[14px] py-[14px] text-[12.5px] leading-[1.5]"
            >
                <span className="text-[12px] text-muted">Turns</span>
                {all.map((turn) => (
                    <TurnRow
                        key={turn.id}
                        turn={turn}
                        now={now}
                        mode="full"
                        canForward={canForward}
                        agentTitle={agentTitle}
                        {...on}
                    />
                ))}
            </div>
        );
    }
    const { turns, earlier } = recentTurns(talk);
    return (
        <div
            data-board-turns="recent"
            className="flex max-h-[40vh] flex-none flex-col gap-1 overflow-y-auto border-t border-edge-mid px-3 py-2 text-[12px]"
        >
            {earlier > 0 ? (
                <button
                    type="button"
                    data-board-turns-earlier
                    onClick={onEarlier}
                    disabled={onEarlier == null}
                    className="cursor-pointer self-start text-[11.5px] text-muted hover:text-primary disabled:cursor-default"
                >
                    {earlier} earlier
                </button>
            ) : null}
            {turns.map((turn) => (
                <TurnRow
                    key={turn.id}
                    turn={turn}
                    now={now}
                    mode="recent"
                    canForward={canForward}
                    agentTitle={agentTitle}
                    {...on}
                />
            ))}
        </div>
    );
}
