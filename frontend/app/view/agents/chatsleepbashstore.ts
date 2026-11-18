// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Per agent, session-only: the `!` commands run while it slept (chatsleepbash.ts), oldest first, until a message you
// send carries them (takeSleepRuns) or their × drops them. A run's result comes from wavesrv's ShellRunCommand.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue } from "jotai";
import { wakeAgent, wakeErrorToast } from "./agentsleep";
import { submitToAgent } from "./agentsubmit";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { withResultLines } from "./chatinitiative";
import { addPending, deliveredPending, dropPendingIds } from "./chatpendingstore";
import { fixMessage, runBlocks, type SleepRun } from "./chatsleepbash";

const NONE: SleepRun[] = [];

// the server stops a run at 2 minutes; the call waits a little past that for its answer
const RUN_CALL_TIMEOUT_MS = 135_000;

const runsAtom = atom<ReadonlyMap<string, SleepRun[]>>(new Map());

let nextId = 0;

function update(agentId: string, f: (list: SleepRun[]) => SleepRun[]): void {
    const m = new Map(globalStore.get(runsAtom));
    const next = f(m.get(agentId) ?? NONE);
    if (next.length === 0) {
        m.delete(agentId);
    } else {
        m.set(agentId, next);
    }
    globalStore.set(runsAtom, m);
}

function settle(agentId: string, id: string, patch: Partial<SleepRun>): void {
    update(agentId, (list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

/** Runs `command` in the sleeping agent's folder without waking it; its row shows at once and fills in when it ends. */
export async function runWhileAsleep(agentId: string, cwd: string, command: string): Promise<void> {
    const id = `asleep-run-${++nextId}`;
    update(agentId, (list) => [...list, { id, command, cwd, at: Date.now() }]);
    if (cwd === "") {
        settle(agentId, id, { error: "The agent has no folder to run in." });
        return;
    }
    try {
        const r = await RpcApi.ShellRunCommand(TabRpcClient, { cwd, command }, { timeout: RUN_CALL_TIMEOUT_MS });
        settle(agentId, id, {
            result: {
                command,
                stdout: r.stdout ?? "",
                stderr: r.stderr ?? "",
                exit: r.timedout ? "timeout" : r.exitcode,
                truncated: r.truncated,
                durMs: r.durms,
            },
        });
    } catch (e) {
        settle(agentId, id, { error: e instanceof Error ? e.message : String(e) });
    }
}

/** The finished runs, oldest first, to ride the message being sent; they leave the list. A run still going stays for
 *  the message after, and one that could not run stays until its ×. A send that fails puts them back. */
export function takeSleepRuns(agentId: string): SleepRun[] {
    const taken = (globalStore.get(runsAtom).get(agentId) ?? NONE).filter((r) => r.result != null);
    if (taken.length > 0) {
        update(agentId, (list) => list.filter((r) => r.result == null));
    }
    return taken;
}

/** Runs a send did not deliver, back in the list in the order they ran. */
export function putBackSleepRuns(agentId: string, runs: readonly SleepRun[]): void {
    if (runs.length === 0) {
        return;
    }
    update(agentId, (list) =>
        [...runs, ...list.filter((r) => !runs.some((t) => t.id === r.id))].sort((a, b) => a.at - b.at)
    );
}

export function dropSleepRun(agentId: string, id: string): void {
    update(agentId, (list) => list.filter((r) => r.id !== id));
}

export function useSleepRuns(agentId: string): SleepRun[] {
    return useAtomValue(runsAtom).get(agentId) ?? NONE;
}

/** Ask agent to fix: a message naming the failed run, with every finished run in front of it, that wakes a sleeping
 *  agent or is typed into one woken meanwhile. Its bubble shows from the press, as a typed message's does. */
export async function askToFix(
    agent: Pick<AgentVM, "id" | "name" | "blockId" | "sleeping">,
    runId: string,
    entries: AgentEntry[] | undefined
): Promise<void> {
    const run = (globalStore.get(runsAtom).get(agent.id) ?? NONE).find((r) => r.id === runId);
    if (run?.result == null) {
        return;
    }
    const text = fixMessage(run.result);
    const runs = takeSleepRuns(agent.id);
    const wire = withResultLines(runBlocks(runs), text);
    const asleep = agent.sleeping != null;
    const pendingId = entries != null ? addPending(agent.id, text, entries, false, asleep, !asleep) : null;
    try {
        if (asleep) {
            await wakeAgent(agent.id, { message: wire });
            if (pendingId != null) {
                deliveredPending(agent.id, pendingId);
            }
        } else if (agent.blockId != null) {
            await submitToAgent(agent.blockId, wire);
            if (pendingId != null) {
                deliveredPending(agent.id, pendingId);
            }
        } else {
            throw new Error("The agent has no terminal to send to.");
        }
    } catch (e) {
        putBackSleepRuns(agent.id, runs);
        if (pendingId != null) {
            dropPendingIds(agent.id, [pendingId]);
        }
        if (asleep) {
            wakeErrorToast(agent.name, e);
        } else {
            pushToast({
                title: "Couldn't send to the agent",
                message: e instanceof Error ? e.message : String(e),
                level: "error",
            });
        }
    }
}
