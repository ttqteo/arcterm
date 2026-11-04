// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ship's two effects (shipmodel.ts is the pure rule and the prompts): one live git read of an agent's repo when its turn
// ends on git work, kept per agent, and the hand-over of a Ship, Commit or merge prompt to its session.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { resolveCwd } from "./agentcwdresolve";
import type { AgentVM } from "./agentsviewmodel";
import { parseGitChanges } from "./gitstatus";
import { railCwdsAtom } from "./railstore";
import { SHIP_PROMPTS, type ShipGit, type ShipKind } from "./shipmodel";

// the last read per agent id; an agent with no entry has not been read, or its cwd is not a repo
export const shipGitAtom = atom<Record<string, ShipGit>>({}) as PrimitiveAtom<Record<string, ShipGit>>;

// a newer read of the same agent supersedes one still in flight
const loadSeq = new Map<string, number>();

function put(id: string, git: ShipGit | null): void {
    const cur = globalStore.get(shipGitAtom);
    if (git == null) {
        if (!(id in cur)) {
            return;
        }
        const { [id]: _, ...rest } = cur;
        globalStore.set(shipGitAtom, rest);
        return;
    }
    globalStore.set(shipGitAtom, { ...cur, [id]: git });
}

/** Reads the agent's repo once: what is uncommitted and how far it is ahead of its upstream. Best-effort: a failed read
 *  leaves no entry, so the header offers nothing. */
export async function loadShipGit(agent: Pick<AgentVM, "id" | "transcriptPath" | "blockId">): Promise<void> {
    const seq = (loadSeq.get(agent.id) ?? 0) + 1;
    loadSeq.set(agent.id, seq);
    try {
        const cwd = globalStore.get(railCwdsAtom)[agent.id] || (await resolveCwd(agent.transcriptPath, agent.blockId));
        if (!cwd) {
            if (loadSeq.get(agent.id) === seq) {
                put(agent.id, null);
            }
            return;
        }
        const ch = await RpcApi.GitChangesCommand(TabRpcClient, { cwd });
        if (loadSeq.get(agent.id) !== seq) {
            return;
        }
        put(
            agent.id,
            ch.isrepo
                ? {
                      dirty: parseGitChanges(ch.statusz, ch.numstat).files.length,
                      ahead: ch.upstreamahead ?? 0,
                      upstream: ch.upstream ?? "",
                  }
                : null
        );
    } catch {
        if (loadSeq.get(agent.id) === seq) {
            put(agent.id, null);
        }
    }
}

/** Hands `text` to the agent's session as a prompt of its own. The read is dropped at once, so the chip leaves before
 *  the agent's working status arrives and a second click cannot send it twice. */
export async function promptAgent(agent: Pick<AgentVM, "id" | "name" | "blockId">, text: string): Promise<void> {
    if (agent.blockId == null) {
        return;
    }
    put(agent.id, null);
    try {
        await RpcApi.AgentPromptCommand(TabRpcClient, { blockid: agent.blockId, text });
    } catch (err) {
        pushToast({
            title: `Could not send to ${agent.name}`,
            message: err instanceof Error ? err.message : String(err),
            level: "error",
        });
    }
}

export function shipAgent(agent: Pick<AgentVM, "id" | "name" | "blockId">, kind: ShipKind): Promise<void> {
    return promptAgent(agent, SHIP_PROMPTS[kind]);
}
