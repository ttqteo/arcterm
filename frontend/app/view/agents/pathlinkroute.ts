// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a file path link goes (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md): an agent's terminal or
// transcript opens it in that agent's panel, a plain terminal in the Code surface. The model is bound at boot,
// because the terminal's link provider lives outside React.

import { pushToast } from "@/app/cockpit/notificationstore";
import { isUnderRoot } from "@/app/cockpit/openfileroute";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { homeFromInfo } from "@/app/view/jarvis/projectpicker";
import { fireAndForget } from "@/util/util";
import { resolveCwd } from "./agentcwdresolve";
import { openFileInPanel, openRefInCode } from "./agentrailstore";
import type { FileRef } from "./agentrailtabs";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { liveEntriesByIdAtom } from "./livetranscriptatoms";
import { knownPathTail, matchKnownPath, resolvePath, transcriptCwds } from "./pathlinks";
import { railStateAtom } from "./railstore";
import { projectorFor } from "./transcriptregistry";

let boundModel: AgentsViewModel | null = null;

export function setPathLinkModel(model: AgentsViewModel | null): void {
    boundModel = model;
}

// the roster entry with a panel that a terminal block belongs to: an agent's TUI, never a plain terminal
export function panelOwnerOf(roster: AgentVM[], blockId: string): AgentVM | undefined {
    const owner = roster.find((a) => a.blockId === blockId);
    return owner != null && owner.kind !== "terminal" ? owner : undefined;
}

// the agent whose panel a palette pick opens in, or null for the Code surface
export function focusedPanelAgent(input: {
    surface: SurfaceKey;
    focusId: string | null | undefined;
    roster: AgentVM[];
    cwd: string | null | undefined;
    abs: string;
}): string | null {
    if (input.surface !== "agent" || input.focusId == null || input.cwd == null) {
        return null;
    }
    const agent = input.roster.find((a) => a.id === input.focusId);
    if (agent == null || agent.kind === "terminal") {
        return null;
    }
    return isUnderRoot(input.cwd, input.abs) ? agent.id : null;
}

function roster(model: AgentsViewModel): AgentVM[] {
    return [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
}

export function openPathFromTerminal(blockId: string, ref: FileRef): void {
    const model = boundModel;
    if (model == null) {
        return;
    }
    const owner = panelOwnerOf(roster(model), blockId);
    if (owner != null) {
        openFileInPanel(model, owner.id, ref);
        return;
    }
    fireAndForget(() => openRefInCode(model, ref));
}

// the home folder a ~ path names, asked of the server once; a failed ask is tried again next time
let home: Promise<string> | null = null;

export function homeDir(): Promise<string> {
    home ??= RpcApi.FileInfoCommand(TabRpcClient, { info: { path: "~" } })
        .then(homeFromInfo)
        .catch(() => "");
    return home.then((h) => {
        if (h === "") {
            home = null;
        }
        return h;
    });
}

export async function fileExists(abs: string): Promise<boolean> {
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        return info != null && !info.notfound && !info.isdir;
    } catch {
        return false;
    }
}

// the files an agent's tools named (read, edited, written), absolute and once each
export function touchedPaths(entries: AgentEntry[], cwd: string | null): string[] {
    const out = new Set<string>();
    for (const e of entries) {
        if (e.kind === "action" && e.path != null) {
            const abs = resolvePath(cwd, e.path);
            if (abs != null) {
                out.add(abs);
            }
        }
    }
    return [...out];
}

// the files in an agent's live entries (livetranscript.ts), already in memory; worked out again only when a chunk
// lands, which replaces the array
const liveTouchedMemo = new WeakMap<AgentEntry[], { cwd: string | null; paths: string[] }>();

function liveTouched(agentId: string, cwd: string | null): string[] {
    const entries = globalStore.get(liveEntriesByIdAtom)[agentId];
    if (entries == null) {
        return [];
    }
    const hit = liveTouchedMemo.get(entries);
    if (hit != null && hit.cwd === cwd) {
        return hit.paths;
    }
    const paths = touchedPaths(entries, cwd);
    liveTouchedMemo.set(entries, { cwd, paths });
    return paths;
}

// the live entries hold only the stream's window, so a path they do not explain reads the transcript, a few MB, at
// most this often per agent: the files its tools touched, and the other folders its shell worked in
const SNAPSHOT_MS = 5 * 60_000;
type Snapshot = { paths: string[]; cwds: string[] };
const NO_SNAPSHOT: Snapshot = { paths: [], cwds: [] };
const snapshots = new Map<string, { at: number; snap: Promise<Snapshot> }>();

function transcriptSnapshot(agent: AgentVM, cwd: string | null): Promise<Snapshot> {
    const path = agent.transcriptPath;
    if (!path) {
        return Promise.resolve(NO_SNAPSHOT);
    }
    const key = `${path}|${cwd ?? ""}`;
    const hit = snapshots.get(key);
    if (hit != null && Date.now() - hit.at < SNAPSHOT_MS) {
        return hit.snap;
    }
    const snap = (async (): Promise<Snapshot> => {
        try {
            // Pi's parent-linked active branch needs the complete file; other runtimes tail the recent window
            const maxlines = agent.agent === "pi" ? -1 : 2000;
            const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, { path, maxlines });
            const lines = rtn.lines ?? [];
            return {
                paths: touchedPaths(projectorFor(agent.agent, path).project(lines), cwd),
                cwds: transcriptCwds(lines, cwd),
            };
        } catch {
            return NO_SNAPSHOT;
        }
    })();
    snapshots.set(key, { at: Date.now(), snap });
    return snap;
}

// the one file an agent touched that a relative path it named is the tail of: from its live entries when they have it,
// else from its transcript
async function touchedMatch(agent: AgentVM, cwd: string | null, path: string): Promise<string | null> {
    if (knownPathTail(path) == null) {
        return null;
    }
    const live = liveTouched(agent.id, cwd);
    const hit = matchKnownPath(path, live);
    if (hit != null) {
        return hit;
    }
    return matchKnownPath(path, [...live, ...(await transcriptSnapshot(agent, cwd)).paths]);
}

// for a terminal block's path link: the file the block's agent touched that the path names from another folder than
// its cwd; nothing for a plain terminal
export function touchedPathForBlock(blockId: string, cwd: string | null, path: string): Promise<string | null> {
    const model = boundModel;
    const owner = model == null ? undefined : panelOwnerOf(roster(model), blockId);
    return owner == null ? Promise.resolve(null) : touchedMatch(owner, cwd, path);
}

// the shell folders a path is tried under, past the agent's own: the most recent few, so a click checks a handful
const SHELL_CWDS_TRIED = 8;

// a path an agent named: under its working directory, else the one file it touched that the path is the tail of, else
// under a folder its shell cd'd into (it named the path from there, after an ls it ran)
async function locateAgentPath(agent: AgentVM, cwd: string | null, path: string): Promise<string | null> {
    const home = await homeDir();
    const abs = resolvePath(cwd, path, home);
    if (abs != null && (await fileExists(abs))) {
        return abs;
    }
    const known = await touchedMatch(agent, cwd, path);
    if (known != null && (await fileExists(known))) {
        return known;
    }
    if (knownPathTail(path) == null) {
        return null;
    }
    for (const dir of (await transcriptSnapshot(agent, cwd)).cwds.slice(0, SHELL_CWDS_TRIED)) {
        const there = resolvePath(dir, path, home);
        if (there != null && (await fileExists(there))) {
            return there;
        }
    }
    return null;
}

// a transcript's link: resolved against the agent's working directory, checked, then opened in its panel
export async function openAgentPath(agent: AgentVM, path: string, line?: number): Promise<void> {
    const model = boundModel;
    if (model == null) {
        return;
    }
    const cwd = await resolveCwd(agent.transcriptPath, agent.blockId);
    const abs = await locateAgentPath(agent, cwd, path);
    if (abs == null) {
        pushToast({ title: `File not found: ${path}`, message: "", level: "warn" });
        return;
    }
    openFileInPanel(model, agent.id, { abs, root: cwd, ...(line != null ? { line } : {}) });
}

// a transcript link's Show in Explorer: the file it names, found as a click finds it, selected in the file manager
export async function revealAgentPath(agent: AgentVM, path: string): Promise<void> {
    const cwd = await resolveCwd(agent.transcriptPath, agent.blockId);
    const abs = await locateAgentPath(agent, cwd, path);
    if (abs == null) {
        pushToast({ title: `File not found: ${path}`, message: "", level: "warn" });
        return;
    }
    getApi().revealPath(abs);
}

// a palette pick: the focused agent's panel when the Agent surface shows it and the file is under its directory
export function openInFocusedPanel(model: AgentsViewModel, abs: string, line?: number): boolean {
    const cwd = globalStore.get(railStateAtom)?.cwd ?? null;
    const agentId = focusedPanelAgent({
        surface: globalStore.get(model.surfaceAtom),
        focusId: globalStore.get(model.focusIdAtom),
        roster: globalStore.get(model.agentsAtom),
        cwd,
        abs,
    });
    if (agentId == null) {
        return false;
    }
    openFileInPanel(model, agentId, { abs, root: cwd, ...(line != null ? { line } : {}) });
    return true;
}
