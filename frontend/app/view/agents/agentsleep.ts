// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Agent sleep, the cockpit's side. An idle agent is put to sleep by wavesrv: its process ends and its RAM is freed, its
// row, its terminal output and its conversation stay. The server marks the block (agent:sleeping), and sleepingOf reads
// that into AgentVM.sleeping. Wake, or a message sent to the agent, relaunches it with --resume (AgentsWakeCommand).
// The pure helpers here are what the row, the card over the terminal and the Consumers panel word and decide from;
// wakeAgent, sleepWithConfirm and useViewingSync are the thin calls into the server.

import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { centerModeAtom, type CenterMode } from "./agentcenter";
import type { GridState } from "./agentgrid";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort, type AgentVM } from "./agentsviewmodel";
import { ramLabel } from "./consumers";
import { agentGridAtom } from "./gridstore";
import { viewingIds } from "./unreadagents";

// the server holds a wake with a message until the resumed agent reports in, for up to 60 s; the call outlives that
const WAKE_TIMEOUT_MS = 70_000;
// the server waits up to 5 s for the process tree to die (3 s, then a kill and 2 s more): longer than an RPC default
const SLEEP_TIMEOUT_MS = 15_000;
// the server forgets what is on screen after a while, so a window that stopped pushing (a crash) pins nothing
const VIEWING_REFRESH_MS = 60_000;

/** Pure: the sleep keys of a block's meta as AgentVM.sleeping, or undefined for an awake agent (agent:sleeping absent,
 *  0, or not a time). A missing size counts as nothing freed; an empty failure reason as none. */
export function sleepingOf(meta: Record<string, unknown> | undefined | null): AgentVM["sleeping"] {
    const since = meta?.["agent:sleeping"];
    if (typeof since !== "number" || !(since > 0)) {
        return undefined;
    }
    const freed = meta?.["agent:sleepfreed"];
    const failed = meta?.["agent:wakefailed"];
    return {
        since,
        freedBytes: typeof freed === "number" && freed > 0 ? freed : 0,
        ...(typeof failed === "string" && failed !== "" ? { wakeFailed: failed } : {}),
    };
}

/** Pure: the age column of a sleeping agent ("sleeping 2h"), "" for one that is awake. */
export function sleepingAge(vm: Pick<AgentVM, "sleeping">, now: number): string {
    return vm.sleeping ? `sleeping ${formatAgeShort(Math.max(0, now - vm.sleeping.since))}` : "";
}

/** Pure: the agents whose terminal is on screen, as a sorted list: the focused agent, and every cell of the grid when it
 *  is one of them (viewingIds, which the unread badge counts as seen). The server never sleeps these. Sorted, so two
 *  pushes of the same view compare equal. */
export function viewingTabIds(
    windowFocused: boolean,
    onAgentSurface: boolean,
    center: CenterMode,
    focusId: string | undefined,
    grid: GridState
): string[] {
    return [...viewingIds(windowFocused, onAgentSurface, center, focusId, grid)].sort();
}

/** Pure: the toast after a sleep: "Put Lumen to sleep · freed 330 MB"; the size is left out when it was not measured. */
export function sleepToastText(name: string, freedBytes: number | undefined): string {
    return freedBytes ? `Put ${name} to sleep · freed ${ramLabel(freedBytes)}` : `Put ${name} to sleep`;
}

/** Pure: what the confirm says when background work runs under the agent: sleeping ends its process and so the work. */
export function backgroundConfirmText(name: string, labels: string[]): string {
    const one = labels.length === 1;
    const tasks = one ? "1 task" : `${labels.length} tasks`;
    return `${name} has ${tasks} still running: ${labels.join("; ")}. Sleeping ends the agent's process, which stops ${one ? "it" : "them"}; ${one ? "it does" : "they do"} not resume when the agent wakes.`;
}

/** Wake a sleeping agent: relaunch it with --resume (fresh: without, the Start fresh after a resume that failed). With a
 *  message, the server delivers it once the agent reports in. Resolves when the agent is back; rejects with the server's
 *  reason (the session file is gone, it did not report in within 60 s), which the caller shows. */
export async function wakeAgent(tabId: string, opts: { message?: string; fresh?: boolean } = {}): Promise<void> {
    await RpcApi.AgentsWakeCommand(
        TabRpcClient,
        { tab: tabId, message: opts.message, fresh: opts.fresh },
        { timeout: WAKE_TIMEOUT_MS }
    );
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** The error toast after a wake that threw: its title names the agent, its message is the server's reason. */
export function wakeErrorToast(name: string | undefined, e: unknown): void {
    pushToast({
        title: name ? `Couldn't wake ${name}` : "Couldn't wake the agent",
        message: errorText(e),
        level: "error",
    });
}

async function sleepNow(agent: Pick<AgentVM, "id" | "name">, force: boolean): Promise<void> {
    try {
        const rtn = await RpcApi.AgentsSleepCommand(
            TabRpcClient,
            { tab: agent.id, ...(force ? { force: true } : {}) },
            { timeout: SLEEP_TIMEOUT_MS }
        );
        if (!force && rtn?.background?.length) {
            // nothing slept: background work runs under it, which sleeping would stop
            modalsModel.pushModal("ConfirmModal", {
                title: "Sleep agent",
                message: backgroundConfirmText(agent.name, rtn.background),
                confirmLabel: "Sleep anyway",
                destructive: true,
                onConfirm: () => fireAndForget(() => sleepNow(agent, true)),
            });
            return;
        }
        pushToast({ title: sleepToastText(agent.name, rtn?.freedbytes), message: "", level: "info" });
    } catch (e) {
        pushToast({ title: `Couldn't put ${agent.name} to sleep`, message: errorText(e), level: "error" });
    }
}

/** The one Sleep action (the row's menu, the Consumers panel): sleep the agent, or when background tasks run under it
 *  ask first and, once confirmed, sleep anyway. Toasts the result or the server's error; never rejects. */
export function sleepWithConfirm(agent: Pick<AgentVM, "id" | "name">): Promise<void> {
    return sleepNow(agent, false);
}

/** Tells the server which agents are on screen, so it never sleeps one the person is looking at: on every change of the
 *  view and once a minute. In the always-mounted shell, since the view changes on every surface. */
export function useViewingSync(model: AgentsViewModel): void {
    const focusId = useAtomValue(model.focusIdAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const center = useAtomValue(centerModeAtom);
    const grid = useAtomValue(agentGridAtom);
    const focused = useAtomValue(atoms.documentHasFocus);
    const ids = viewingTabIds(focused, surface === "agent", center, focusId, grid);
    const latest = useRef(ids);
    latest.current = ids;
    const push = () => fireAndForget(() => RpcApi.AgentsSetViewingCommand(TabRpcClient, { tabids: latest.current }));
    const key = ids.join(",");
    useEffect(push, [key]);
    useEffect(() => {
        const timer = setInterval(push, VIEWING_REFRESH_MS);
        return () => clearInterval(timer);
    }, []);
}
