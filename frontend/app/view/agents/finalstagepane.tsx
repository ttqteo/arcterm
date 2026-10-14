// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's middle pane while the final stage's own row is focused: the stage has no session yet, so
// where a terminal would be it shows the pipeline, the running command with its output tail, and what an ended
// stage came to. A click on a step that ended shows the output it kept.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { shownStep, type FinalStepKey } from "./finalstage";
import {
    EndFinalStage,
    FinalKeptOutput,
    FinalOutcome,
    FinalOutput,
    FinalShotsLink,
    FinalStepCells,
    useFinalStageView,
} from "./finalstageviews";
import { stageLabel, type RunInfo } from "./runlineage";
import { FINAL_FILL } from "./runstrip";

export function FinalStagePane({ model, run }: { model: AgentsViewModel; run: RunInfo }) {
    const now = useAtomValue(model.nowAtom);
    const view = useFinalStageView(run.dag, run.runId, run.channelId, now);
    const [picked, setPicked] = useState<FinalStepKey | null>(null);
    // with no output yet (Tree, or a command's first seconds) the step list stands alone
    const shown = shownStep(view, picked);
    const outputRef = useRef<HTMLDivElement>(null);
    // a tail is read from its end, so each publish keeps the newest lines in view
    useEffect(() => {
        outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
    }, [view.output]);

    return (
        <div data-final-pane className="flex min-h-0 flex-1 flex-col bg-background">
            {/* not clipped: the end form opens under its button */}
            <div className="flex flex-none items-center gap-[10px] border-b border-border px-[22px] py-[12px]">
                <span
                    aria-hidden
                    className={cn(
                        "h-[7px] w-[7px] flex-none rounded-full",
                        view.tone === "wait" ? "border border-muted" : FINAL_FILL[view.tone]
                    )}
                />
                <span className="flex-none text-[13px] font-semibold text-foreground">{stageLabel("verifier")}</span>
                <span className="min-w-0 truncate text-[10.5px] tabular-nums text-ink-mid">{view.headline}</span>
                <span className="flex-1" />
                <EndFinalStage group={run.dag} channelId={run.channelId} runId={run.runId} />
            </div>
            {view.steps.length > 0 ? (
                <div className="flex-none border-b border-edge-faint px-[22px] py-[12px]">
                    <FinalStepCells
                        steps={view.steps}
                        shown={shown?.key}
                        onPick={(key) => setPicked(picked === key ? null : key)}
                    />
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col gap-[10px] px-[22px] py-[14px]">
                {shown?.state === "running" ? (
                    <>
                        <span className="flex-none break-all font-mono text-[12px] text-ink-hi">$ {shown.command}</span>
                        <div ref={outputRef} className="sc min-h-0 flex-1 overflow-y-auto">
                            <FinalOutput output={view.output} />
                        </div>
                        <span className="flex-none text-[10.5px] text-muted">
                            output tail · the engine publishes it every 10s
                        </span>
                    </>
                ) : shown?.kept ? (
                    <>
                        <span className="flex-none break-all font-mono text-[12px] text-ink-hi">$ {shown.command}</span>
                        <div className="sc min-h-0 flex-1 overflow-auto">
                            <FinalKeptOutput key={shown.key} kept={shown.kept} />
                        </div>
                        <span className="flex-none text-[10.5px] tabular-nums text-muted">
                            {shown.label} {shown.text} · click it again to close
                        </span>
                    </>
                ) : (
                    <>
                        <FinalOutcome view={view} />
                        {view.state === "failed" ? (
                            <span className="flex-none text-[12px] text-muted">
                                The lead has this failure and decides what happens next.
                            </span>
                        ) : null}
                        <FinalShotsLink group={run.dag} />
                    </>
                )}
            </div>
        </div>
    );
}
