// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a pair starts from ⚖ under a reply in Chat (board K2; specs docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md
// and 2026-11-26-judge-on-reply-design.md): which live agents the judge menu offers, and the three ways a pair begins.
// Picking a live agent pairs at once. Waking the resting judge (the judge arcterm launched in an earlier round, asleep
// and hidden) pairs at once too, with `launched` so it rests again after this round. Opening a new judge briefs it
// (PairBrief), launches a claude tab on opus in the worker's folder, waits for that tab's row to report in, and only then
// pairs (PairStart with `briefed` and `launched`): a launch that never reports in leaves no pair. Each takes the `from` of
// the reply the pair starts from (the transcript record uuid ⚖ sits under); "" is the agent's latest reply, and then
// neither command carries a `from`, as before ⚖ existed.
// The choices (the launch's arguments, the folder, the label, who is offered, whether the judge is up) are pure functions
// tested in pairlaunch.test.ts; the openers below only run them in order.

import { launchAgent, type LaunchAgentOpts } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom } from "jotai";
import { showPair } from "./agentcenter";
import { resolveCwd } from "./agentcwdresolve";
import { openRailDecided } from "./agentrailstore";
import { shortTabId } from "./agentrowmodel";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM, type PendingLaunch } from "./agentsviewmodel";
import { runtimeStartupCommand } from "./launch";
import { canPair, hiddenJudgesOf, pairOf } from "./pairmodel";
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

/** The launch of a judge whose tab closed with its worker, for that worker resumed in a new tab: claude resuming the judge's
 *  own session on opus, in the worker's folder (where the judge first opened, so claude finds the session), with no task:
 *  the pair's brief, sent when it pairs, is its next prompt, as when a resting judge is woken. */
export function judgeResumeOpts(a: {
    workerName: string;
    project: string;
    folder: string;
    session: string;
}): LaunchAgentOpts {
    return {
        runtime: "claude",
        startupCommand: `${runtimeStartupCommand("claude")} --resume ${a.session} --model opus`,
        task: "",
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

export type JudgeChoice = { id: string; name: string; short: string; state: string };

/** The judge the menu offers first, as Wake: the resting judge of `workerId` (a judge arcterm launched whose pair ended and
 *  that sleeps, hidden, until a new round) that is on the roster and asleep, or null. A worker resumed in a new tab finds
 *  it by its session (pairmodel.ts restsUnder). The list is newest first, so with
 *  several the first is the one of the latest round. A resting judge that something woke is a plain agent again, and the
 *  live list offers it like any other. */
export function restingJudgeOf(
    resting: readonly PairResting[],
    agents: readonly Pick<AgentVM, "id" | "sleeping" | "transcriptPath">[],
    workerId: string
): PairResting | null {
    return hiddenJudgesOf(workerId, resting, agents)[0] ?? null;
}

/** The live agents the menu offers as the judge of `worker`: the project's claude and pi agents that are in no pair (an
 *  agent is in at most one, on either side), in roster order. An asleep agent's state stays idle, so it reads asleep. The
 *  resting judge the menu offers first (restingJudgeOf over `resting`) is left out, so it shows once. */
export function judgeChoices(
    agents: readonly AgentVM[],
    worker: string,
    project: string,
    pairs: readonly PairInfo[],
    resting: readonly PairResting[] = []
): JudgeChoice[] {
    const wake = restingJudgeOf(resting, agents, worker)?.tab;
    return agents
        .filter(
            (a) =>
                a.id !== worker &&
                a.id !== wake &&
                canPair(a) &&
                projectOf(a) === project &&
                pairOf(pairs, a.id) == null
        )
        .map((a) => ({
            id: a.id,
            name: a.name,
            short: shortTabId(a.id),
            state: a.sleeping != null ? "asleep" : a.state,
        }));
}

/** PairStart's data: the default way to pair (heavy commands held until the judge answers; tokencap 0 is wavesrv's default
 *  of 3,000,000). `briefed` says the judge was launched with PairBrief's text as its task. `launched` says the judge is a tab
 *  arcterm launched for the job (a new judge, or a resting one woken): it sleeps and leaves the tree when the round ends,
 *  and an agent the person picked from the live list is not. `from` is the transcript record uuid of the reply the pair
 *  starts from; "" (the default) is the agent's latest reply, and the field is then left off. */
export function pairStartData(
    workerTab: string,
    judgeTab: string,
    briefed: boolean,
    launched: boolean,
    from: string = ""
): CommandPairStartData {
    return {
        workertab: workerTab,
        judgetab: judgeTab,
        holdheavy: true,
        tokencap: 0,
        note: "",
        briefed,
        launched,
        ...(from !== "" ? { from } : {}),
    };
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

// launches a judge for `worker` (the options are made once its folder is known), waits for it to report in, and pairs. The
// launch takes the focus (its process starts when its terminal mounts), so the judge's tab shows while it boots; once
// paired the focus goes back to the worker and the conversation opens. A person who went elsewhere while it booted is left
// there. Every failure is a toast, and nothing is paired.
async function launchAndPair(
    model: AgentsViewModel,
    worker: AgentVM,
    project: string,
    from: string,
    briefed: boolean,
    optsFor: (folder: string) => Promise<LaunchAgentOpts>
): Promise<void> {
    try {
        const folder = judgeFolder(
            globalStore.get(railCwdsAtom)[worker.id] || (await resolveCwd(worker.transcriptPath, worker.blockId)),
            globalStore.get(atoms.fullConfigAtom)?.projects?.[project]?.path
        );
        if (folder == null) {
            throw new Error(`no folder found for ${worker.name}`);
        }
        const judgeTab = await launchAgent(model, await optsFor(folder));
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
        const view = await RpcApi.PairStartCommand(
            TabRpcClient,
            pairStartData(worker.id, judgeTab, briefed, true, from)
        );
        const at = globalStore.get(model.focusIdAtom);
        if (at === judgeTab || at === worker.id) {
            globalStore.set(model.focusIdAtom, worker.id);
            showPair(view.id);
            openRailDecided(worker.id);
        }
    } catch (e) {
        addFailed(worker, e);
    }
}

/** Open a new judge for `worker` (board K2's first row): brief it, launch it, and pair once it has reported in
 *  (launchAndPair). `from` names the reply to judge (the brief and the pair both carry it): a `from` the transcript does
 *  not hold fails the brief, before anything is launched. */
export function openNewJudge(
    model: AgentsViewModel,
    worker: AgentVM,
    project: string,
    from: string = ""
): Promise<void> {
    return launchAndPair(model, worker, project, from, true, async (folder) => {
        const brief = await RpcApi.PairBriefCommand(TabRpcClient, {
            workertab: worker.id,
            ...(from !== "" ? { from } : {}),
        });
        return judgeLaunchOpts({ workerName: worker.name, project, folder, brief: brief.text });
    });
}

/** Resume the judge of `worker`'s earlier rounds whose tab closed with it (resumableJudgeOf: the worker was resumed in a new
 *  tab), and pair once it has reported in. It keeps what it read; it is not briefed at launch, so the pair sends the brief
 *  as its first prompt, and it is `launched`, so it rests again when this round ends. `from` is the reply to judge. */
export function resumeJudge(
    model: AgentsViewModel,
    worker: AgentVM,
    project: string,
    judge: PairResting,
    from: string = ""
): Promise<void> {
    return launchAndPair(model, worker, project, from, false, async (folder) =>
        judgeResumeOpts({ workerName: worker.name, project, folder, session: judge.session ?? "" })
    );
}

// pairs `worker` with an agent that is already up and opens the conversation; a toast on failure
async function pairWith(worker: AgentVM, judgeTab: string, launched: boolean, from: string): Promise<void> {
    try {
        const view = await RpcApi.PairStartCommand(
            TabRpcClient,
            pairStartData(worker.id, judgeTab, false, launched, from)
        );
        showPair(view.id);
        openRailDecided(worker.id);
    } catch (e) {
        addFailed(worker, e);
    }
}

/** Pair `worker` with a live agent the person picked (board K2's list), and open the conversation. A toast on failure. The
 *  agent is not `launched`: it goes back to the tree as a plain agent when the round ends. `from` is the reply to judge. */
export function pickJudge(worker: AgentVM, judgeTab: string, from: string = ""): Promise<void> {
    return pairWith(worker, judgeTab, false, from);
}

/** Wake the resting judge of `worker` (the judge menu's first entry) and open the conversation, as pickJudge does. It is
 *  not briefed again: the send of the pair's brief is what wakes it, and it keeps what it read in the earlier rounds. It
 *  is `launched`, so it rests again when this round ends. `from` is the reply to judge. A toast on failure. */
export function wakeJudge(worker: AgentVM, judgeTab: string, from: string = ""): Promise<void> {
    return pairWith(worker, judgeTab, true, from);
}
