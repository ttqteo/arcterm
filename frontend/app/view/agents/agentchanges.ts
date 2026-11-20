// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The change set the per-agent views count (the card pill, the details rail, the Hub peek). A Claude agent counts only
// its own edits, rebuilt from its transcript, so other writers in a shared checkout stay out; any other agent counts
// its checkout since the session started. The Diff surface reads the same range through filesstore.ts.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { editsApply } from "./agentedits";
import { HISTORY_RPC_TIMEOUT_MS } from "./historyquery";

export interface AgentChanges {
    ch: CommandGitChangesRtnData;
    // the list is the agent's own edits, ch.ref..end ("" end: none yet)
    edits: boolean;
    end: string;
}

type AgentRef = { transcriptPath?: string; runtime?: string };

// One read per agent at a time. The card, the rail and the Cockpit's own mount ask together when the page loads, and the
// backend rebuilds B and H for every ask that finds no cached answer, so concurrent asks write the same git objects: a
// Windows write of a loose object another git is renaming fails with "Permission denied". Everyone who asks while a read
// is in flight shares it; the next ask finds the backend's cache.
const inflight = new Map<string, Promise<AgentChanges>>();

// A failed edits read throws: each reader already decides what an unreadable range shows.
export function readAgentChanges(cwd: string, agent: AgentRef, startTs: number | null): Promise<AgentChanges> {
    if (!editsApply(agent.runtime)) {
        return readCheckout(cwd, startTs);
    }
    const key = `${cwd}\0${agent.transcriptPath ?? ""}`;
    const pending = inflight.get(key);
    if (pending) {
        return pending;
    }
    const read = readEdits(cwd, agent, startTs).finally(() => inflight.delete(key));
    inflight.set(key, read);
    return read;
}

async function readCheckout(cwd: string, startTs: number | null): Promise<AgentChanges> {
    const ch = await RpcApi.GitChangesCommand(TabRpcClient, { cwd, sessionstartts: startTs ?? undefined });
    return { ch, edits: false, end: "" };
}

async function readEdits(cwd: string, agent: AgentRef, startTs: number | null): Promise<AgentChanges> {
    const r = await RpcApi.GitAgentEditsCommand(
        TabRpcClient,
        { cwd, transcriptpath: agent.transcriptPath ?? "" },
        { timeout: HISTORY_RPC_TIMEOUT_MS }
    );
    if (!r.base) {
        // no edits of its own yet: the checkout's read supplies the branch, whether this is a repository and the
        // session-start commit (`ref`, which the rail's Commits section lists from); its files are not the agent's, so
        // they are dropped
        const { ch } = await readCheckout(cwd, startTs);
        return { ch: { ...ch, statusz: "", numstat: "", numstaterror: undefined }, edits: true, end: "" };
    }
    const ch = await RpcApi.GitChangesCommand(TabRpcClient, { cwd, ref: r.base, end: r.end });
    return { ch, edits: true, end: r.end };
}
