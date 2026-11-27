// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The status line under a board's canvas, in the board cell and in Library → Boards: one line while the drawer works
// (Queued, Answering with its seconds, Still answering with Stop) and while the latest turn has failed (its reason and
// Retry); gone otherwise. Which turn it shows is statusTurn's (boardtalkmodel.ts). A rejected Stop or Retry shows on the
// line too. Questions about a board go through Chat (`@board`), so this is the only place a board's talk shows.

import { springFoldHeight } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useNow } from "../agents/narrationtimeline";
import { elapsedLabel, statusTurn, turnText, type TurnShown } from "./boardtalkmodel";

const STATE_LABEL: Partial<Record<TurnShown, { text: string; tone: string }>> = {
    waiting: { text: "Queued", tone: "text-muted" },
    answering: { text: "Answering", tone: "text-success" },
    slow: { text: "Still answering", tone: "text-warning" },
    failed: { text: "Couldn't draw", tone: "text-error" },
};

function LineButton({ attr, onClick, children }: { attr: string; onClick: () => void; children: string }) {
    return (
        <button
            type="button"
            {...{ [attr]: "" }}
            onClick={onClick}
            className="flex-none cursor-pointer text-[12px] text-accent hover:text-accenthover"
        >
            {children}
        </button>
    );
}

export function BoardStatus({
    talk,
    error,
    onStop,
    onRetry,
}: {
    talk: BoardTalk | null;
    // a rejected Stop or Retry; the next action that goes clears it
    error: string | null;
    onStop: () => void;
    onRetry: (turn: BoardTurn) => void;
}) {
    // an answering turn ticks: its seconds, and the 45 s that turns it slow
    const now = useNow((talk?.turns ?? []).some((t) => t.state === "answering"));
    const status = statusTurn(talk, now);
    const fold = usePartMotion(springFoldHeight);
    const shown = status != null || error != null;
    const label = status != null ? STATE_LABEL[status.view.state] : undefined;
    const running = status?.view.state === "answering" || status?.view.state === "slow";
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false}>
                {shown ? (
                    <motion.div key="status" {...fold} className="flex-none">
                        <div
                            data-board-status={status?.view.state ?? "error"}
                            data-board-status-turn={status?.turn.id ?? ""}
                            className="flex flex-col gap-0.5 border-t border-edge-mid bg-surface px-3 py-1.5 text-[12px]"
                        >
                            {status != null && label != null ? (
                                <div className="flex min-w-0 items-center gap-2">
                                    <span data-board-status-label className={cn("flex-none", label.tone)}>
                                        {running ? `${label.text} · ${elapsedLabel(status.view.seconds)}` : label.text}
                                    </span>
                                    <span
                                        data-board-status-text
                                        className="min-w-0 flex-1 truncate text-secondary"
                                        title={turnText(status.turn)}
                                    >
                                        {turnText(status.turn)}
                                    </span>
                                    {status.view.state === "slow" ? (
                                        <LineButton attr="data-board-status-stop" onClick={onStop}>
                                            Stop
                                        </LineButton>
                                    ) : null}
                                    {status.view.state === "failed" ? (
                                        <LineButton attr="data-board-status-retry" onClick={() => onRetry(status.turn)}>
                                            Retry
                                        </LineButton>
                                    ) : null}
                                </div>
                            ) : null}
                            {status?.view.state === "failed" ? (
                                <div
                                    data-board-status-reason
                                    className="text-[11.5px] leading-[1.4] text-muted [overflow-wrap:anywhere]"
                                >
                                    {status.turn.reason ? `${status.turn.reason} · nothing changed` : "Nothing changed"}
                                </div>
                            ) : null}
                            {error != null ? (
                                <div
                                    role="alert"
                                    data-board-status-error
                                    className="text-[11.5px] leading-[1.4] text-error [overflow-wrap:anywhere]"
                                >
                                    {error}
                                </div>
                            ) : null}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </MotionConfig>
    );
}
