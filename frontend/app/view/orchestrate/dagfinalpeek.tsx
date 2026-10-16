// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The final stage's peek, in the shell beside its node: the verifier, each step with its command, the running
// output or how the stage ended, and the End final stage form.

import { globalStore } from "@/app/store/jotaiStore";
import { finalStageEndable } from "@/app/view/jarvis/runsheetmodel";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { jumpToAgent } from "../agents/channelsprimitives";
import { EndFinalForm } from "../agents/endfinalform";
import { finalRowFocusId, isFinalStageId, type FinalStageView, type FinalTone } from "../agents/finalstage";
import { FinalOutcome, FinalOutput, FinalShotsLink, FinalStepList } from "../agents/finalstageviews";
import { fmtDuration } from "../agents/runcompletion";
import { ActivityLine, StatusLine } from "../agents/statusline";
import { dagModalAgentsContextAtom } from "./dagmodalstate";
import { finalGlyph } from "./dagnodes";
import { DagPeekCard, PEEK_BTN, PEEK_BTN_ACCENT_OPEN, type PeekPlace } from "./dagpeekcard";
import { reviewerRouteOf } from "./taskroute";

// the output tail the card shows under the steps
const OUTPUT_LINES = 6;
const PAST_LABEL = "Earlier rounds";

const STATE_INK: Record<FinalTone, string> = {
    wait: "text-ink-mid",
    run: "text-accent-soft",
    pass: "text-success",
    fail: "text-error",
    warn: "text-warning",
};

export function DagFinalPeek({
    group,
    owner,
    view,
    place,
}: {
    group: TaskGroup;
    owner: Run;
    view: FinalStageView;
    place: PeekPlace;
}) {
    const agentsCtx = useAtomValue(dagModalAgentsContextAtom);
    const tabId = verifierTabId(group, owner, agentsCtx?.agents);
    const verifier = tabId != null ? agentsCtx?.agents.find((a) => a.id === tabId) : undefined;
    const { route, custom } = reviewerRouteOf(group, owner);
    const [ending, setEnding] = useState(false);
    const [endError, setEndError] = useState<string | null>(null);
    const endable = finalStageEndable(group);
    // a stage that stops being endable closes the form, or a later round's final stage would open on it
    if (ending && !endable) {
        setEnding(false);
    }
    const running = view.steps.find((s) => s.key === view.running);
    return (
        <DagPeekCard
            place={place}
            attrs={{ "data-dag-final-peek": "" }}
            label="Final verification details"
            closeLabel="Close final stage details"
            glyph={finalGlyph(view.tone)}
            title="Final verification"
            meta={
                <>
                    <span>final · round {view.round}</span>
                    <span>·</span>
                    <span className={STATE_INK[view.tone]}>
                        {view.tone === "run" ? "running" : view.state || "waiting"}
                    </span>
                    {view.endedByYou ? (
                        <>
                            <span>·</span>
                            <span>ended by you</span>
                        </>
                    ) : null}
                    {view.stageMs != null ? (
                        <>
                            <span>·</span>
                            <span>{fmtDuration(view.stageMs)}</span>
                        </>
                    ) : null}
                </>
            }
            panel={
                ending ? (
                    <div className="flex flex-col gap-1.5 border-t border-edge-mid bg-surface px-3 py-2.5">
                        <span className="text-[12px] font-semibold text-ink-hi">End the final stage</span>
                        <EndFinalForm
                            channelId={group.channelid}
                            runId={group.runid}
                            onClose={() => setEnding(false)}
                            onError={setEndError}
                        />
                    </div>
                ) : null
            }
            actions={
                endable ? (
                    <>
                        <button
                            type="button"
                            data-final-end
                            aria-expanded={ending}
                            onClick={() => {
                                setEndError(null);
                                setEnding(!ending);
                            }}
                            className={ending ? PEEK_BTN_ACCENT_OPEN : PEEK_BTN}
                        >
                            End final stage
                        </button>
                        {endError != null ? (
                            <span role="alert" className="min-w-0 truncate text-[11px] text-error" title={endError}>
                                {endError}
                            </span>
                        ) : null}
                    </>
                ) : null
            }
            hint={verifier != null ? "double-click opens the verifier · Esc closes" : "Esc closes"}
        >
            {verifier != null && agentsCtx != null ? (
                <VerifierSession agent={verifier} model={agentsCtx.model} group={group} owner={owner} />
            ) : (
                <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-edge-mid px-[9px] py-[7px] font-mono text-[11px] text-ink-mid">
                    <span aria-hidden className="size-1.5 flex-none rounded-full bg-edge-strong" />
                    {verifierLine(group, view)}
                </div>
            )}
            <dl className="m-0 grid grid-cols-[54px_minmax(0,1fr)] gap-x-2.5">
                <dt className="text-[11px] leading-4 text-ink-mid">Verifier</dt>
                <dd className="m-0 min-w-0 font-mono text-[11px] leading-4">
                    <div className="truncate text-secondary">
                        {route.runtime} / {route.model || "default"}
                    </div>
                    <div className="text-muted">{custom ? "reviewers route" : "same as lead"}</div>
                </dd>
            </dl>
            <div className="border-t border-edge-faint">
                <FinalStepList steps={view.steps} showCommand />
            </div>
            {view.output !== "" && running != null ? (
                <div className="flex flex-col gap-1">
                    <span className="font-mono text-[10.5px] text-ink-mid">{running.label} output · live</span>
                    <FinalOutput output={view.output} lines={OUTPUT_LINES} />
                </div>
            ) : null}
            <FinalOutcome view={view} pastLabel={PAST_LABEL} className="flex-none" />
            <FinalShotsLink group={group} />
        </DagPeekCard>
    );
}

// the current round's verifier session: who it is, Open in Agent, and what it is doing
function VerifierSession({
    agent,
    model,
    group,
    owner,
}: {
    agent: AgentVM;
    model: AgentsViewModel;
    group: TaskGroup;
    owner: Run;
}) {
    return (
        <>
            <div className="flex min-w-0 items-center gap-2 rounded-[8px] border border-edge-mid bg-surface px-[9px] py-[7px]">
                <StatusLine agent={agent} nowAtom={model.nowAtom} className="min-w-0 flex-1" />
                <button
                    type="button"
                    onClick={() => openFinalFromGraph(group, owner)}
                    className="flex-none cursor-pointer rounded-[6px] border border-accent/50 px-2 py-[3px] font-mono text-[10.5px] font-bold text-accent-soft hover:border-accent"
                >
                    Open in Agent ↗
                </button>
            </div>
            <ActivityLine agent={agent} nowAtom={model.nowAtom} className="-mt-1" />
        </>
    );
}

// where the verifier is while it has no session to show: when it starts, why it did not run, or how it ended
function verifierLine(group: TaskGroup, view: FinalStageView): string {
    const verifier = view.steps[view.steps.length - 1];
    if (verifier.state === "notrun") {
        // every step after the one the stage ended at did not run
        const at = view.steps[view.steps.findIndex((s) => s.state === "notrun") - 1];
        if (view.endedByYou) {
            return `Verifier did not run: you ended the stage${at ? ` during ${at.label}` : ""}`;
        }
        return `Verifier did not run${at ? `: the stage ended at ${at.label}` : ""}`;
    }
    if (verifier.state !== "waiting") return `Verifier ${verifier.text}`;
    if (view.state === "" && view.waitsOn.length > 0) {
        return `Starts once every task has merged · waits on ${view.waitsOn.join(", ")}`;
    }
    if (group.finalcmd) return "Verifier starts after Final";
    const beside = view.steps.filter((s) => s.key === "check" || s.key === "verify").map((s) => s.label);
    return beside.length > 0 ? `Verifier starts alongside ${beside.join(" and ")}` : "Verifier starts with the stage";
}

// the current round's verifier session, when its tab is in the roster
export function verifierTabId(group: TaskGroup, owner: Run, agents: AgentVM[] | undefined): string | undefined {
    if (agents == null) return undefined;
    const id = finalRowFocusId({ runId: owner.id, dag: group }, agents);
    return isFinalStageId(id) ? undefined : id;
}

// openFinalFromGraph opens the verifier in Agent, from the peek's link, a double-click or Enter. With no
// verifier session in the roster there is nothing to open.
export function openFinalFromGraph(group: TaskGroup, owner: Run): void {
    const ctx = globalStore.get(dagModalAgentsContextAtom);
    const tabId = verifierTabId(group, owner, ctx?.agents);
    if (ctx != null && tabId != null) jumpToAgent(ctx.model, tabId);
}
