// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run's palette actions. Each `applies` is the condition the button's own view checks and each `run` the
// handler that button calls, so the palette and the view cannot disagree about when an action exists.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { diffScopeOfRun, openDiff } from "@/app/view/agents/agentdiffnav";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { steerWorker } from "@/app/view/agents/channelactions";
import { jumpToAgent } from "@/app/view/agents/channelsprimitives";
import { setRunParallelism } from "@/app/view/agents/leadcardactions";
import { isLeadDown, runAdjustable } from "@/app/view/agents/leadcardmodel";
import {
    cancellingRunIdsAtom,
    confirmCancelRun,
    endFinalStage,
    resumeRun,
    stopRunWorker,
    type FinalEndOutcome,
} from "@/app/view/agents/runactions";
import { clampParallelism, MAX_PARALLELISM } from "@/app/view/agents/runconfig";
import { runEventsAtom } from "@/app/view/agents/runeventstore";
import type { Lineage, RunInfo } from "@/app/view/agents/runlineage";
import { cancelSurvivors, canResume, currentPhaseIndex, isTerminal, runLiveWorkers } from "@/app/view/agents/runmodel";
import { openRunDag } from "@/app/view/agents/runrailsections";
import { runSteerLead } from "@/app/view/jarvis/briefcomposertarget";
import { openTarget } from "@/app/view/jarvis/openref";
import { doneBodyHasDiff, finalStageEndable, sheetLead } from "@/app/view/jarvis/runsheetmodel";
import { allRunsAtom, type ProjectRun } from "../palette-data";
import type { ThingAction, ThingKindDef } from "./types";

export interface RunThing {
    channelId: string;
    run: Run;
    info?: RunInfo; // the lineage's read of an orchestrator run: its dag, when one has loaded
    lead?: AgentVM; // the run sheet's Open lead
    steerLead?: AgentVM; // the lead the run composer steers
    liveCount: number; // sizes the cancel confirmation
    survivors: AgentVM[]; // a cancelled run's workers still running
    leadDown: boolean;
    cancelling: boolean;
    resumePhase: number; // the phase the blocked card resumes
    agents: AgentVM[]; // steerWorker resolves the lead's terminal from the roster
}

export interface RunThingExtra {
    events?: RunEvent[];
    cancelling?: boolean;
}

export function buildRunThing(p: ProjectRun, agents: AgentVM[], lineage: Lineage, extra: RunThingExtra = {}): RunThing {
    const { run } = p;
    return {
        channelId: p.channelId,
        run,
        info: lineage.runs[run.id],
        lead: sheetLead(run, agents),
        steerLead: runSteerLead(run, agents),
        liveCount: runLiveWorkers(run, agents, lineage).length,
        survivors: cancelSurvivors(run, agents),
        leadDown: isLeadDown(extra.events ?? []),
        cancelling: extra.cancelling ?? false,
        resumePhase: currentPhaseIndex(run),
        agents,
    };
}

function endFinal(outcome: FinalEndOutcome, label: string): ThingAction<RunThing> {
    return {
        id: `run:end-final-${outcome}`,
        label,
        group: "stop",
        applies: (t) => finalStageEndable(t.info?.dag ?? null),
        input: { kind: "text", placeholder: "Why end it? Recorded on the run; a fail's reason goes to the lead." },
        run: async (t, _deps, value) => {
            const reason = (value ?? "").trim();
            // the run records the reason, and a fail's is what the lead plans its fix round from
            if (reason === "") {
                throw new Error("Ending the final stage needs a reason");
            }
            await endFinalStage(t.channelId, t.run.id, outcome, reason);
        },
    };
}

const RUN_ACTIONS: ThingAction<RunThing>[] = [
    {
        id: "run:open",
        label: "Open in Jarvis",
        group: "open",
        applies: () => true,
        run: async (t, { model }) => {
            await openTarget(model, { kind: "run", runId: t.run.id });
        },
    },
    {
        id: "run:dag",
        label: "Open the DAG",
        group: "open",
        applies: (t) => t.info?.dag != null,
        run: (t, { model }) => openRunDag(model, t.info),
    },
    {
        id: "run:diff",
        label: "Open the diff",
        group: "open",
        applies: (t) => doneBodyHasDiff(t.run),
        run: (t, { model }) => openDiff(model, diffScopeOfRun(t.run)),
    },
    {
        id: "run:lead-terminal",
        label: "Open the lead's terminal",
        group: "open",
        applies: (t) => t.lead != null,
        run: (t, { model }) => jumpToAgent(model, t.lead.id),
    },
    {
        id: "run:message",
        label: "Message the lead",
        group: "steer",
        applies: (t) => t.steerLead != null,
        input: { kind: "text", placeholder: "Message the lead…" },
        run: async (t, _deps, value) => {
            const text = (value ?? "").trim();
            if (text === "") {
                return;
            }
            const sent = await steerWorker({
                channelId: t.channelId,
                workerORef: `tab:${t.steerLead.id}`,
                agents: t.agents,
                text,
            });
            if (!sent) {
                throw new Error(`${t.steerLead.name} is no longer live — nothing was sent.`);
            }
        },
    },
    {
        id: "run:workers",
        label: "Workers at once",
        group: "steer",
        applies: (t) => t.info != null && runAdjustable(t.info),
        input: {
            kind: "pick",
            placeholder: "Workers at once",
            options: (t) =>
                Array.from({ length: MAX_PARALLELISM }, (_, i) => i + 1).map((n) => ({
                    value: String(n),
                    label: n === t.info?.dag?.parallelism ? `${n} at a time · now` : `${n} at a time`,
                })),
        },
        // straight to the RPC, not runCardAction: that parks a refusal on the lead card, which only grid runs
        // show, while a rejection here is shown by the palette
        run: (t, _deps, value) => setRunParallelism(t.info, clampParallelism(Number(value))),
    },
    {
        id: "run:relaunch",
        label: "Relaunch the lead",
        group: "steer",
        applies: (t) => t.leadDown,
        run: (t) =>
            RpcApi.DagActionCommand(TabRpcClient, {
                channelid: t.channelId,
                runid: t.run.id,
                taskid: "",
                action: "relaunch-lead",
            }),
    },
    {
        id: "run:resume",
        label: "Resume",
        group: "steer",
        applies: (t) => canResume(t.run, t.resumePhase),
        run: (t) => resumeRun(t.channelId, t.run.id, t.resumePhase),
    },
    {
        id: "run:stop-worker",
        label: "Stop a worker…",
        group: "stop",
        applies: (t) => t.survivors.length > 0,
        input: {
            kind: "pick",
            placeholder: "Stop which worker?",
            options: (t) => t.survivors.map((w) => ({ value: w.id, label: w.name })),
        },
        run: (t, _deps, value) => stopRunWorker(t.channelId, t.run.id, `tab:${value}`),
    },
    {
        id: "run:cancel",
        label: "Cancel run",
        group: "stop",
        destructive: true,
        applies: (t) => !isTerminal(t.run.status) && !t.cancelling,
        run: (t) => confirmCancelRun(t.channelId, t.run.id, t.liveCount),
    },
    endFinal("unverified", "End final stage: pass unverified"),
    endFinal("failed", "End final stage: fail"),
];

export const RUN_KIND: ThingKindDef<RunThing> = {
    kind: "run",
    noun: "Run",
    actions: RUN_ACTIONS,
    entries: (get, model) => {
        const agents = get(model.agentsAtom);
        const lineage = get(model.lineageAtom);
        const cancelling = get(cancellingRunIdsAtom);
        return get(allRunsAtom).map((p) => ({
            key: `run:${p.run.id}`,
            title: p.run.goal || "(untitled run)",
            thing: buildRunThing(p, agents, lineage, {
                events: get(runEventsAtom(p.run.id)),
                cancelling: cancelling.has(p.run.id),
            }),
        }));
    },
};
