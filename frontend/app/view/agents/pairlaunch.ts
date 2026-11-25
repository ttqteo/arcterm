// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a pair starts from the agent header (board K2; spec docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md):
// which live agents the Add judge menu offers, and the two ways a pair begins. Picking a live agent pairs at once.
// Opening a new judge briefs it (PairBrief), launches a claude tab on opus in the worker's folder, waits for that tab's row
// to report in, and only then pairs (PairStart with `briefed`): a launch that never reports in leaves no pair.
// The choices (the launch's arguments, the folder, the label, who is offered, whether the judge is up) are pure functions
// tested in pairlaunch.test.ts; the two openers below only run them in order.

import { launchAgent, type LaunchAgentOpts } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom } from "jotai";
import { showPair } from "./agentcenter";
import { resolveCwd } from "./agentcwdresolve";
import { shortTabId } from "./agentrowmodel";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM, type PendingLaunch } from "./agentsviewmodel";
import { runtimeStartupCommand } from "./launch";
import { pairOf } from "./pairmodel";
import { railCwdsAtom } from "./railstore";

/** How long a judge arcterm launched has to report in before the pair is given up on. A cold claude start is seconds; this
 *  leaves room for a slow disk or a first login. */
export const JUDGE_BOOT_MS = 120_000;

/** The roster name of a judge arcterm launched: it names the agent it judges. */
export function judgeLabel(workerName: string): string {
    return `Judge: ${workerName}`;
}

/** The launch of a new judge: claude on opus, in the worker's own folder (no branch of its own: it reads the same code),
 *  with the brief as its task. The launch keeps its default focus, which is what starts the process: a tab's terminal
 *  starts it when it mounts in the focus pane. */
export function judgeLaunchOpts(a: {
    workerName: string;
    project: string;
    folder: string;
    brief: string;
}): LaunchAgentOpts {
    return {
        runtime: "claude",
        startupCommand: runtimeStartupCommand("claude"),
        extraArgs: ["--model", "opus"],
        task: a.brief,
        projectPath: a.folder,
        projectName: a.project,
        label: judgeLabel(a.workerName),
    };
}

/** Where a new judge opens: the worker's own folder (its worktree when it has one, so the judge reads the same code), else
 *  the project's root. Null with neither: a judge launched with no folder would open in the wrong place. */
export function judgeFolder(
    agentFolder: string | null | undefined,
    projectRoot: string | null | undefined
): string | null {
    return agentFolder?.trim() || projectRoot?.trim() || null;
}

/** An agent a pair can take on either side: claude or pi (the harnesses whose reply wavesrv reads), a real tab. */
export function canPair(agent: Pick<AgentVM, "agent" | "kind" | "blockId">): boolean {
    return (
        (agent.agent === "claude" || agent.agent === "pi") &&
        agent.kind !== "terminal" &&
        agent.kind !== "background" &&
        agent.blockId != null
    );
}

export type JudgeChoice = { id: string; name: string; short: string; state: string };

/** The live agents the menu offers as the judge of `worker`: the project's claude and pi agents that are in no pair (an
 *  agent is in at most one, on either side), in roster order. An asleep agent's state stays idle, so it reads asleep. */
export function judgeChoices(
    agents: readonly AgentVM[],
    worker: string,
    project: string,
    pairs: readonly PairInfo[]
): JudgeChoice[] {
    return agents
        .filter((a) => a.id !== worker && canPair(a) && projectOf(a) === project && pairOf(pairs, a.id) == null)
        .map((a) => ({
            id: a.id,
            name: a.name,
            short: shortTabId(a.id),
            state: a.sleeping != null ? "asleep" : a.state,
        }));
}

/** PairStart's data: the default way to pair (heavy commands held until the judge answers; tokencap 0 is wavesrv's default
 *  of 3,000,000). `briefed` says the judge was launched with PairBrief's text as its task. */
export function pairStartData(workerTab: string, judgeTab: string, briefed: boolean): CommandPairStartData {
    return { workertab: workerTab, judgetab: judgeTab, holdheavy: true, tokencap: 0, note: "", briefed };
}

/** Where a launched judge is. Its launch is pending until its tab's first status reports in (the roster lists a tab only
 *  then), and a pending launch also clears when its tab closes (cockpitshell.tsx), so a cleared launch is "up" only when the
 *  tab is on the roster: otherwise it is gone, and nothing may be paired with it. */
export function judgeBoot(
    tabId: string,
    pending: readonly PendingLaunch[],
    agents: readonly Pick<AgentVM, "id">[]
): "booting" | "up" | "gone" {
    if (pending.some((p) => p.tabId === tabId)) {
        return "booting";
    }
    return agents.some((a) => a.id === tabId) ? "up" : "gone";
}

// resolves once judgeBoot stops saying booting, or after JUDGE_BOOT_MS; nothing stays subscribed after
function waitForBoot(model: AgentsViewModel, tabId: string): Promise<"up" | "gone" | "timeout"> {
    const boot = atom((get) => judgeBoot(tabId, get(model.pendingLaunchesAtom), get(model.agentsAtom)));
    return new Promise((resolve) => {
        const finish = (outcome: "up" | "gone" | "timeout") => {
            clearTimeout(timer);
            unsub();
            resolve(outcome);
        };
        const check = () => {
            const now = globalStore.get(boot);
            if (now !== "booting") {
                finish(now);
            }
        };
        const timer = setTimeout(() => finish("timeout"), JUDGE_BOOT_MS);
        const unsub = globalStore.sub(boot, check);
        check();
    });
}

function addFailed(worker: Pick<AgentVM, "name">, e: unknown): void {
    pushToast({
        level: "error",
        title: `Couldn't add a judge to ${worker.name}`,
        message: e instanceof Error ? e.message : String(e),
    });
}

/** Open a new judge for `worker` (board K2's first row): brief it, launch it, and pair once it has reported in. The launch
 *  takes the focus (its process starts when its terminal mounts), so the judge's tab shows while it boots; once paired the
 *  focus goes back to the worker and the conversation opens. A person who went elsewhere while it booted is left there.
 *  Every failure is a toast, and nothing is paired. */
export async function openNewJudge(model: AgentsViewModel, worker: AgentVM, project: string): Promise<void> {
    try {
        const folder = judgeFolder(
            globalStore.get(railCwdsAtom)[worker.id] || (await resolveCwd(worker.transcriptPath, worker.blockId)),
            globalStore.get(atoms.fullConfigAtom)?.projects?.[project]?.path
        );
        if (folder == null) {
            throw new Error(`no folder found for ${worker.name}`);
        }
        const brief = await RpcApi.PairBriefCommand(TabRpcClient, { workertab: worker.id });
        const judgeTab = await launchAgent(
            model,
            judgeLaunchOpts({ workerName: worker.name, project, folder, brief: brief.text })
        );
        const boot = await waitForBoot(model, judgeTab);
        if (boot !== "up") {
            pushToast({
                level: "error",
                title: "The judge did not start",
                message:
                    boot === "gone"
                        ? "Its tab closed before it reported in, so nothing was paired."
                        : `It had not reported in after ${Math.round(JUDGE_BOOT_MS / 60_000)} minutes, so nothing was paired. Its tab is still open.`,
            });
            return;
        }
        const view = await RpcApi.PairStartCommand(TabRpcClient, pairStartData(worker.id, judgeTab, true));
        const at = globalStore.get(model.focusIdAtom);
        if (at === judgeTab || at === worker.id) {
            globalStore.set(model.focusIdAtom, worker.id);
            showPair(view.id);
        }
    } catch (e) {
        addFailed(worker, e);
    }
}

/** Pair `worker` with a live agent the person picked (board K2's list), and open the conversation. A toast on failure. */
export async function pickJudge(worker: AgentVM, judgeTab: string): Promise<void> {
    try {
        const view = await RpcApi.PairStartCommand(TabRpcClient, pairStartData(worker.id, judgeTab, false));
        showPair(view.id);
    } catch (e) {
        addFailed(worker, e);
    }
}
