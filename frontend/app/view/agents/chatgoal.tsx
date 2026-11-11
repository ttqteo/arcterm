// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The session's /goal as a strip above Chat's message box (the chat-goal-meter canvas, its A with B's meter): what it
// is, a mark per check of Claude Code's evaluator, how long it has run, and the newest verdict's reason a click away.
// A proposal says so and points to Terminal, where Claude Code's dialog takes the answer; ✕ clears an active goal.
// The words and the reading of the transcript are goal-core.ts's, shared with the band arc's Claude Code mod draws
// in the TUI.

import { cn } from "@/util/util";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { goalBandLine, goalChecks, type GoalState } from "../../../../claude/arc-mod/hooks/goal-core";
import { useNow } from "./narrationtimeline";

const FRAME: Record<GoalState["phase"], string> = {
    proposed: "border-warning/40 bg-askingbg",
    active: "border-edge-mid bg-surface",
    met: "border-success/40 bg-success/[0.08]",
    stopped: "border-error/40 bg-error/[0.08]",
};
const LABEL: Record<GoalState["phase"], string> = {
    proposed: "text-primary",
    active: "text-primary",
    met: "text-success-soft",
    stopped: "text-error-soft",
};
const MARK: Record<string, string> = { hit: "bg-success", miss: "bg-warning/55", next: "bg-edge-mid" };

function GoalGlyph({ phase }: { phase: GoalState["phase"] }) {
    if (phase === "proposed") {
        return <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-full bg-warning" />;
    }
    const color = phase === "stopped" ? "text-error" : "text-success";
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            aria-hidden
            className={cn("flex-none", color)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {phase === "met" ? (
                <path d="M20 6 9 17l-5-5" />
            ) : phase === "stopped" ? (
                <path d="M18 6 6 18M6 6l12 12" />
            ) : (
                <>
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="6" />
                    <circle cx="12" cy="12" r="2" />
                </>
            )}
        </svg>
    );
}

const WORD: Record<GoalState["phase"], string> = {
    proposed: "Claude proposes a goal",
    active: "Goal",
    met: "Goal met",
    stopped: "Goal stopped",
};

/** The strip, or nothing: no goal, or a met or stopped one you have sent a prompt after. */
export function ChatGoalStrip({
    goal,
    onClear,
    onOpenTerminal,
}: {
    goal: GoalState | null;
    onClear: () => void;
    onOpenTerminal: () => void;
}) {
    const [open, setOpen] = useState(false);
    const now = useNow(goal?.phase === "active");
    if (goal == null || goal.settledBeforePrompt) {
        return null;
    }
    const line = goalBandLine(goal, now);
    const marks = goalChecks(goal);
    const reason = goal.reason?.trim() ?? "";
    const lastMiss = goal.phase === "active" && goal.checks.length > 0;
    return (
        <div data-chat-goal={goal.phase} className={cn("mb-1.5 rounded-[10px] border text-[12px]", FRAME[goal.phase])}>
            <div className="flex min-w-0 items-center gap-2.5 py-[7px] pl-3 pr-2">
                <GoalGlyph phase={goal.phase} />
                <span className={cn("flex-none font-semibold", LABEL[goal.phase])}>{WORD[goal.phase]}</span>
                <span title={goal.condition} className="min-w-0 flex-1 truncate text-secondary">
                    {goal.condition}
                </span>
                {marks.length > 0 ? (
                    <span role="img" aria-label={`${goal.checks.length} checks`} className="flex flex-none gap-[3px]">
                        {marks.map((m, i) => (
                            <span key={i} className={cn("h-[5px] w-[14px] rounded-[3px]", MARK[m])} />
                        ))}
                    </span>
                ) : null}
                {line.meta !== "" ? <span className="flex-none tabular-nums text-muted">{line.meta}</span> : null}
                {goal.phase === "proposed" ? (
                    <button
                        type="button"
                        data-chat-goal-answer
                        onClick={onOpenTerminal}
                        className="flex-none cursor-pointer rounded-[7px] border border-edge-mid px-2.5 py-[3px] text-secondary hover:border-edge-strong hover:text-primary"
                    >
                        Answer in Terminal
                    </button>
                ) : null}
                {reason !== "" && goal.phase !== "proposed" ? (
                    <button
                        type="button"
                        data-chat-goal-reason
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                        title={open ? "Hide the evaluator's reason" : "The evaluator's reason"}
                        className={cn(
                            "flex flex-none cursor-pointer items-center gap-1 hover:text-primary",
                            lastMiss ? "text-warning-soft" : "text-muted"
                        )}
                    >
                        {lastMiss ? "not yet" : "why"}
                        {open ? (
                            <ChevronDown size={11} strokeWidth={2.2} aria-hidden />
                        ) : (
                            <ChevronUp size={11} strokeWidth={2.2} aria-hidden />
                        )}
                    </button>
                ) : null}
                {goal.phase === "active" ? (
                    <button
                        type="button"
                        data-chat-goal-clear
                        aria-label="Clear the goal"
                        title="Clear the goal (/goal clear)"
                        onClick={onClear}
                        className="flex flex-none cursor-pointer rounded-[5px] p-[3px] text-ink-faint hover:bg-surface-hover hover:text-primary"
                    >
                        <X size={13} strokeWidth={2} aria-hidden />
                    </button>
                ) : null}
            </div>
            {open && reason !== "" ? (
                <div
                    data-chat-goal-reason-text
                    className="border-t border-edge-faint px-3 py-2 leading-[1.5] text-secondary"
                >
                    {goal.phase === "active" ? (
                        <span className="mr-1.5 font-semibold text-warning-soft">
                            Check {goal.checks.length} · not yet
                        </span>
                    ) : null}
                    {reason}
                </div>
            ) : null}
        </div>
    );
}
