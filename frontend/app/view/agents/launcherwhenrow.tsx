// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run launcher's When row (docs/superpowers/specs/2026-11-16-run-start-choice-design.md, "The launcher row"): three
// pill badges, Run now, After run… and Queue, the one Jarvis suggests tagged, its reason on a line under them, and
// for After the project's live runs to tick. The state and its words are launcherwhen.ts; the suggestion is asked here,
// once when the row appears and again 400 ms after the goal, the plan, the project or the spec changes. Start never
// waits for it: until an answer lands the row reads Run now.
//
// It sits at the foot of the run's third column (launcherrunfields.tsx RunColumn), not in the fields above the columns:
// the goal box's area shrinks to what the Start column leaves it, so a row there is below the fold on a window of
// ordinary height, and the third column is the one with room.

import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { ColumnLabel } from "./launcherrows";
import {
    checkRunStart,
    launcherGoalAtom,
    launcherSpecPathAtom,
    launcherWhenAtom,
    markRunStartChecking,
    pickWhen,
    tickWhen,
} from "./launcherstore";
import { reasonLines, runNote, suggestedChoice, type WhenChoice } from "./launcherwhen";
import { planPathAtom, runShapeAtom, startAtom } from "./runconfigstore";

// how long the goal, plan, project or spec must sit still before the suggestion is asked again
const CHECK_PAUSE_MS = 400;

const CHOICES: { id: WhenChoice; label: string; hint: string }[] = [
    { id: "now", label: "Run now", hint: "Start the run at once" },
    { id: "after", label: "After run…", hint: "Wait until the runs you pick have landed, then start" },
    { id: "queue", label: "Queue", hint: "Start when there is room under the cap on active runs" },
];

function AfterList() {
    const when = useAtomValue(launcherWhenAtom);
    const live = when.suggestion?.live ?? [];
    if (live.length === 0) {
        return (
            <span data-when-list="empty" className="mx-2 text-[11px] leading-[1.45] text-muted">
                {when.checking ? "Reading the live runs…" : "No live run in this project to wait for."}
            </span>
        );
    }
    return (
        <div
            role="group"
            aria-label="Runs to wait for"
            data-when-list
            className="mx-2 flex max-h-[168px] flex-col gap-px overflow-y-auto rounded-[8px] border border-border bg-surface p-1"
        >
            {live.map((run) => {
                const on = when.ticked.includes(run.runid);
                const note = runNote(run);
                return (
                    <label
                        key={run.runid}
                        data-when-run={run.runid}
                        data-when-held={run.held ? "" : undefined}
                        title={run.held ? (run.heldreason ?? "") : undefined}
                        className={cn(
                            "flex min-w-0 items-start gap-2 rounded-[6px] px-2 py-1.5",
                            run.held ? "cursor-not-allowed" : "cursor-pointer hover:bg-surface-hover"
                        )}
                    >
                        <input
                            type="checkbox"
                            checked={on}
                            disabled={run.held}
                            onChange={() => tickWhen(run.runid)}
                            className="m-0 mt-[3px] h-[13px] w-[13px] shrink-0 cursor-[inherit] accent-accent"
                        />
                        <span className="flex min-w-0 flex-col">
                            <span
                                className={cn(
                                    "truncate text-[12.5px] font-semibold",
                                    run.held ? "text-muted" : "text-primary"
                                )}
                            >
                                {run.title}
                            </span>
                            {note !== "" ? (
                                <span data-when-run-note className="truncate text-[11px] text-muted">
                                    {note}
                                </span>
                            ) : null}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

/** The When row. `projectPath` is the picked project's folder (no check without one); `channelId` is its channel when it
 *  has one, which the suggestion may use to name the project. */
export function WhenRow({ projectPath, channelId }: { projectPath: string; channelId: string | null }) {
    const when = useAtomValue(launcherWhenAtom);
    const shape = useAtomValue(runShapeAtom);
    const start = useAtomValue(startAtom);
    const goal = useAtomValue(launcherGoalAtom);
    const planPath = useAtomValue(planPathAtom);
    const specPath = useAtomValue(launcherSpecPathAtom);
    // a plan start is named by its plan and has no goal (launchGoal)
    const planStart = shape === "orchestrator" && start === "plan";
    const goalText = planStart ? "" : goal.trim();
    const plan = planStart ? planPath.trim() : "";
    const lines = reasonLines(when);
    const suggested = suggestedChoice(when);

    // the first ask goes out as the row appears (the dialog opening on a run), later ones after the pause
    const first = useRef(true);
    useEffect(() => {
        if (projectPath === "") {
            return;
        }
        const pause = first.current ? 0 : CHECK_PAUSE_MS;
        first.current = false;
        // read Checking… at once, and drop an answer still on its way: it is for what was there before
        markRunStartChecking();
        const timer = setTimeout(() => {
            fireAndForget(() =>
                checkRunStart({
                    projectpath: projectPath,
                    goal: goalText,
                    ...(channelId != null ? { channelid: channelId } : {}),
                    ...(plan !== "" ? { planpath: plan } : {}),
                    ...(specPath !== "" ? { specpath: specPath } : {}),
                })
            );
        }, pause);
        return () => clearTimeout(timer);
    }, [projectPath, channelId, goalText, plan, specPath]);

    return (
        <div data-launcher-when className="flex shrink-0 flex-col gap-2">
            <ColumnLabel label="When" focused={false} className="pb-0" />
            <div role="group" aria-label="When" className="mx-2 flex flex-wrap gap-1.5">
                {CHOICES.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        data-when-choice={c.id}
                        aria-pressed={when.choice === c.id}
                        title={suggested === c.id ? `${c.hint} (Jarvis suggests it)` : c.hint}
                        onClick={() => pickWhen(c.id)}
                        className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold leading-[16px]",
                            when.choice === c.id
                                ? "border-accent-700 bg-accentbg text-accent-soft"
                                : "border-border bg-surface text-ink-mid hover:border-edge-mid hover:text-secondary"
                        )}
                    >
                        {c.label}
                        {suggested === c.id ? (
                            <span
                                data-when-suggested
                                className="rounded-full bg-pill px-1.5 text-[9.5px] font-medium leading-[14px] text-muted"
                            >
                                Jarvis
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>
            {lines.length > 0 ? (
                <div data-when-reason className="mx-2 flex flex-col gap-0.5 text-[11px] leading-[1.45] text-muted">
                    {lines.map((line, i) => (
                        <span key={i}>{line}</span>
                    ))}
                </div>
            ) : null}
            {when.choice === "after" ? <AfterList /> : null}
        </div>
    );
}
