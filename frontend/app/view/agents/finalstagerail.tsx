// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's section for a Final verification row, the stage's own and its verifier's session alike:
// the round and its time, each step, the stage's facts, the screenshots, and a line per earlier round.

import * as WOS from "@/app/store/wos";
import { reviewerRouteOf } from "@/app/view/orchestrate/taskroute";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import type { AgentsViewModel } from "./agents";
import { FinalPastRounds, FinalShotsLink, FinalStepList, useFinalStageView } from "./finalstageviews";
import { shortModel } from "./modelname";
import { fmtDuration } from "./runcompletion";
import { stageLabel, type RunInfo } from "./runlineage";
import { SectionLabel } from "./sectionlabel";

const SHORT_COMMIT = 7;
const NONE = "—";

// mono only for a value read character by character (a commit SHA); the rest is UI text
function Fact({
    label,
    title,
    mono,
    children,
}: {
    label: string;
    title?: string;
    mono?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-baseline gap-[10px] border-b border-edge-faint py-[5px]">
            <span className="shrink-0 text-[12px] text-muted">{label}</span>
            <span
                title={title}
                className={cn(
                    "min-w-0 flex-1 truncate text-right text-[11.5px] font-medium text-secondary",
                    mono && "font-mono"
                )}
            >
                {children}
            </span>
        </div>
    );
}

export function FinalStageRail({ model, run }: { model: AgentsViewModel; run: RunInfo }) {
    const now = useAtomValue(model.nowAtom);
    const view = useFinalStageView(run.dag, run.runId, run.channelId, now);
    const owner = useAtomValue(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", run.runId)));
    const stage = run.dag?.final;
    const reviewers = run.dag && owner ? reviewerRouteOf(run.dag, owner).route : undefined;
    return (
        <div data-final-rail className="flex flex-col gap-[6px]">
            <div className="flex items-baseline justify-between gap-[8px]">
                <SectionLabel>{stageLabel("verifier")}</SectionLabel>
                <span className="whitespace-nowrap text-[11px] tabular-nums font-semibold text-muted">
                    round {view.round}
                    {view.stageMs != null ? ` · ${fmtDuration(view.stageMs)}` : ""}
                </span>
            </div>
            <FinalStepList steps={view.steps} />
            <div className="flex flex-col">
                <Fact label="Commit" title={stage?.commit || undefined} mono>
                    {stage?.commit ? stage.commit.slice(0, SHORT_COMMIT) : NONE}
                </Fact>
                <Fact label="Tree" title={stage?.tree || undefined}>
                    {stage?.tree || NONE}
                </Fact>
                <Fact label="Reviewers">
                    {reviewers ? `${reviewers.runtime} · ${shortModel(reviewers.model)}` : NONE}
                </Fact>
            </div>
            <FinalShotsLink group={run.dag} />
            {/* the earlier rounds alone: what this round came to is the pane's, or the verifier's own terminal */}
            <FinalPastRounds past={view.past} />
        </div>
    );
}
