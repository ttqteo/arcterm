// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Keeps every attached brainstorm in step with its brainstorm.json, and re-attaches brainstorms from tab meta
// after a restart. The step is pure over an injected IO so it can be tested; BrainstormPoller runs it every
// BRAINSTORM_POLL_MS from the always-mounted cockpit root.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString } from "@/util/util";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import {
    BRAINSTORM_POLL_MS,
    brainstormFilePath,
    nextSentCheckAt,
    parseBrainstorm,
    parseBrainstormPath,
    settleSent,
    terminalAnswer,
    type BrainstormFile,
} from "./brainstormmodel";
import {
    attachBrainstorm,
    baselineBrainstormSeen,
    brainstormsAtom,
    detachBrainstorm,
    getBrainstorm,
    updateBrainstorm,
    type BrainstormState,
} from "./brainstormstore";
import { boardsFromCanvasJson, boardUrl, canvasDesignDir } from "./canvasmodel";
import { tauriCanvasIO } from "./canvaspoller";

const CANVAS_JSON = "canvas.json";
const HTTP_OK = 200;
// one failed read is an agent mid-write; the second in a row is a broken file
const FAILED_READS_FOR_ERROR = 2;

export type BrainstormIO = {
    stat(path: string): Promise<{ exists: boolean; modifiedMs: number | null }>;
    read(path: string): Promise<string>;
    // asks wavesrv to serve a project's design folder; the base URL it is served under, or null when it refuses
    serve(designDir: string): Promise<string | null>;
    canvasJson(url: string): Promise<unknown>;
};

function listsBoards(f: BrainstormFile): boolean {
    return f.parts.some((p) => p.boards != null && p.boards.length > 0);
}

// the thumbnails take their sizes from the canvas's canvas.json, re-read on each change of the brainstorm file
async function readBoards(
    s: BrainstormState,
    f: BrainstormFile,
    io: BrainstormIO
): Promise<Pick<BrainstormState, "base" | "boards"> | null> {
    if (f.canvas == null || !listsBoards(f)) {
        return null;
    }
    const base = s.base ?? (await io.serve(canvasDesignDir(s.cwd)));
    if (base == null) {
        return null;
    }
    return { base, boards: boardsFromCanvasJson(await io.canvasJson(boardUrl(base, f.canvas, CANVAS_JSON))) };
}

async function readFile(path: string, io: BrainstormIO): Promise<{ file: BrainstormFile } | { error: string }> {
    let text: string;
    try {
        text = await io.read(path);
    } catch (e) {
        return { error: `brainstorm.json could not be read: ${e instanceof Error ? e.message : String(e)}` };
    }
    const parsed = parseBrainstorm(text);
    return "file" in parsed ? { file: parsed.file } : { error: parsed.error };
}

export async function pollBrainstormOnce(s: BrainstormState, io: BrainstormIO): Promise<Partial<BrainstormState>> {
    const st = await io.stat(s.path);
    if (!st.exists) {
        return { removed: true };
    }
    if (st.modifiedMs != null && st.modifiedMs === s.modifiedMs && s.failedReads === 0 && !s.removed) {
        return {};
    }
    const read = await readFile(s.path, io);
    if ("error" in read) {
        const failedReads = s.failedReads + 1;
        return failedReads >= FAILED_READS_FOR_ERROR ? { failedReads, error: read.error } : { failedReads };
    }
    const patch: Partial<BrainstormState> = {
        file: read.file,
        error: null,
        failedReads: 0,
        removed: false,
        modifiedMs: st.modifiedMs,
    };
    return { ...patch, ...(await readBoards(s, read.file, io)) };
}

export function reconcileBrainstorms(
    attached: Record<string, Pick<BrainstormState, "path">>,
    roster: { id: string; brainstormFile?: string }[]
): { attach: { agentId: string; topic: string; cwd: string }[]; detach: string[] } {
    const attach: { agentId: string; topic: string; cwd: string }[] = [];
    for (const r of roster) {
        const parsed = r.brainstormFile ? parseBrainstormPath(r.brainstormFile) : null;
        // compared through brainstormFilePath, which is how an attached state spells its path
        if (parsed != null && attached[r.id]?.path !== brainstormFilePath(parsed.cwd, parsed.topic)) {
            attach.push({ agentId: r.id, ...parsed });
        }
    }
    // an empty roster is the boot window before the sidebar loads, not every agent gone
    const ids = new Set(roster.map((r) => r.id));
    const detach = roster.length === 0 ? [] : Object.keys(attached).filter((id) => !ids.has(id));
    return { attach, detach };
}

export const tauriBrainstormIO: BrainstormIO = {
    async stat(path) {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        return info == null || info.notfound
            ? { exists: false, modifiedMs: null }
            : { exists: true, modifiedMs: info.modtime ?? null };
    },
    async read(path) {
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path } });
        return data?.data64 ? base64ToString(data.data64) : "";
    },
    serve: tauriCanvasIO.serve,
    async canvasJson(url) {
        const res = await tauriCanvasIO.get(url);
        return res.status === HTTP_OK ? res.json : undefined;
    },
};

// `wsh agent-hook` stamps the agent's block on every prompt it submits, the terminal's included
function turnStartOf(agent: AgentVM | undefined): number | undefined {
    if (!agent?.blockId) {
        return undefined;
    }
    return globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", agent.blockId)))?.meta?.[
        "agent:turnstartts"
    ];
}

// the sent line after a poll, and the check send it leaves behind once the agent has taken it
export function settleBrainstorm(
    cur: Pick<BrainstormState, "sent" | "sentCheckAt" | "file" | "modifiedMs">,
    patch: Partial<BrainstormState>,
    agent: AgentVM | undefined,
    turnStartMs: number | undefined
): Pick<BrainstormState, "sent" | "sentCheckAt"> {
    const modifiedMs = patch.modifiedMs !== undefined ? patch.modifiedMs : cur.modifiedMs;
    const file = patch.file ?? cur.file;
    const settled = settleSent(cur.sent, modifiedMs, agent);
    const sent = settled ?? (file != null ? terminalAnswer(file, modifiedMs, agent, turnStartMs) : null);
    return { sent, sentCheckAt: nextSentCheckAt(cur.sentCheckAt, cur.sent, settled, agent?.builderCheck) };
}

// A result that lands after the brainstorm was detached or replaced is dropped rather than written over it. The
// sent line settles against the agent as the roster has it, before the overlay reads a question as asking.
async function pollAndMerge(agentId: string, agent: AgentVM | undefined, io: BrainstormIO): Promise<void> {
    const s = getBrainstorm(agentId);
    if (s == null || s.removed) {
        return;
    }
    const patch = await pollBrainstormOnce(s, io);
    const cur = getBrainstorm(agentId);
    if (cur == null || cur.path !== s.path) {
        return;
    }
    const settled = settleBrainstorm(cur, patch, agent, turnStartOf(agent));
    if (Object.keys(patch).length > 0 || settled.sent !== cur.sent || settled.sentCheckAt !== cur.sentCheckAt) {
        updateBrainstorm(agentId, (c) => (c.path === s.path ? { ...c, ...patch, ...settled } : c));
    }
    if (patch.file != null) {
        baselineBrainstormSeen(s.path, patch.file);
    }
}

// a poll can outlast the interval (a slow wavesrv), so one agent's reads never stack
const busy = new Set<string>();
// a reveal that lands mid-poll reads once more after it: that poll may have read the file before the write
const again = new Set<string>();

function pollAgent(model: AgentsViewModel, agentId: string): void {
    busy.add(agentId);
    (async () => {
        const agent = globalStore.get(model.baseRosterAtom).find((a) => a.id === agentId);
        await pollAndMerge(agentId, agent, tauriBrainstormIO);
    })()
        .catch((e) => console.warn("brainstorm poll failed", agentId, e))
        .finally(() => {
            busy.delete(agentId);
            if (again.delete(agentId)) {
                pollAgent(model, agentId);
            }
        });
}

// the agent's hook reveals the brainstorm after each write of its file, so reading it then, instead of on the
// next tick, shows the write as it lands; the interval stays for writes no hook reports
export function pollBrainstormNow(model: AgentsViewModel, agentId: string): void {
    if (busy.has(agentId)) {
        again.add(agentId);
        return;
    }
    pollAgent(model, agentId);
}

export function BrainstormPoller({ model }: { model: AgentsViewModel }): null {
    useEffect(() => {
        const tick = () => {
            const roster = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
            const { attach, detach } = reconcileBrainstorms(globalStore.get(brainstormsAtom), roster);
            detach.forEach(detachBrainstorm);
            for (const a of attach) {
                attachBrainstorm(a.agentId, a, Date.now());
            }
            for (const id of Object.keys(globalStore.get(brainstormsAtom))) {
                if (!busy.has(id)) {
                    pollAgent(model, id);
                }
            }
        };
        tick();
        const t = setInterval(tick, BRAINSTORM_POLL_MS);
        return () => clearInterval(t);
    }, [model]);
    return null;
}
