// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Settings → Claude account model: which running agents a switch offers to restart, and the last
// known quota a row shows for each account. Switching itself is a settings write (claude:activeaccount);
// wavesrv applies it to its own environment, so anything spawned afterwards runs on the new account. A
// running agent only moves when it is respawned: restartOnAccount resumes its session in the same block.
// See docs/superpowers/specs/2026-10-07-claude-account-switch-design.md.

import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentState, AgentVM } from "./agentsviewmodel";
import { resumeArgsForClaude, sessionIdFromTranscript } from "./launch";
import { FIVE_HOUR_MS, rateLimitKey, WEEK_MS, windowFromSaved, type SavedSnapshot } from "./ratelimitstore";

export interface RestartCandidate {
    tabId: string;
    blockId: string;
    name: string;
    sessionId: string;
    checked: boolean;
    state: AgentState;
}

// Claude agents a switch to `newActive` can move: ones with a block to respawn and a session to resume,
// not already on that account. Background agents have no block and keep the old account until they end;
// terminals are not agents. Only idle ones start checked — a restart cuts a working turn short and drops
// an asking agent's pending question.
export function restartCandidates(agents: AgentVM[], newActive: string): RestartCandidate[] {
    const out: RestartCandidate[] = [];
    for (const a of agents) {
        if ((a.agent || "claude") !== "claude" || (a.kind != null && a.kind !== "agent")) {
            continue;
        }
        const sessionId = sessionIdFromTranscript(a.transcriptPath);
        if (!a.blockId || !sessionId || (a.usage?.account || "") === newActive) {
            continue;
        }
        out.push({
            tabId: a.id,
            blockId: a.blockId,
            name: a.name,
            sessionId,
            checked: a.state === "idle",
            state: a.state,
        });
    }
    return out;
}

export interface RowQuota {
    fivehourpct?: number;
    weekpct?: number;
    capturedAt: number;
}

// The account's last snapshot, with a window that has rolled over since reading 0; null when no agent
// on it has reported yet. `id` is the account id, "" for Default.
export function rowQuota(saved: Record<string, SavedSnapshot>, id: string, now: number): RowQuota | null {
    const s = saved[rateLimitKey("claude", id)];
    if (s == null) {
        return null;
    }
    return {
        fivehourpct: windowFromSaved(s.fivehourpct, s.fivehourreset, s.capturedAt, FIVE_HOUR_MS, now).pct,
        weekpct: windowFromSaved(s.weekpct, s.weekreset, s.capturedAt, WEEK_MS, now).pct,
        capturedAt: s.capturedAt,
    };
}

// Respawn the agent's block as `claude --resume <session>`, the same sequence as
// TermViewModel.forceRestartController. The new process starts from wavesrv's current environment, so
// it runs on whichever account is active now.
export async function restartOnAccount(c: RestartCandidate): Promise<void> {
    const oref = WOS.makeORef("block", c.blockId);
    const block = WOS.getObjectValue<Block>(oref) ?? (await WOS.reloadWaveObject<Block>(oref));
    if (block == null) {
        throw new Error("block not found");
    }
    const baseArgs = (block.meta?.["agent:baseargs"] as string[] | undefined) ?? [];
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref,
        meta: { "cmd:args": resumeArgsForClaude(c.sessionId, baseArgs) },
    });
    await RpcApi.ControllerDestroyCommand(TabRpcClient, c.blockId);
    await RpcApi.ControllerResyncCommand(TabRpcClient, {
        tabid: c.tabId,
        blockid: c.blockId,
        forcerestart: true,
        rtopts: block.runtimeopts,
    });
}
