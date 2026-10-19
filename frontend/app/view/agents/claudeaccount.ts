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
import { formatAgeShort, type AgentState, type AgentVM } from "./agentsviewmodel";
import { resumeArgsForClaude, sessionIdFromTranscript } from "./launch";
import { normalizeEmail, savedWindows, type ClaudeIdentity, type SavedSnapshot } from "./ratelimitstore";
import { agentProject, NO_LINEAGE, type Lineage } from "./runlineage";

export interface RestartCandidate {
    tabId: string;
    blockId: string;
    name: string;
    sessionId: string;
    checked: boolean;
    state: AgentState;
    project?: string; // the folder the dialog files it under: a run's agents take their lead's project
    run?: { id: string; title: string }; // the orchestrator run it leads or works for (keyed by the lead's run id)
    role?: string; // its part in that run: "lead", a task id, or a stage role
}

// Claude agents a switch to `newActive` can move: ones with a block to respawn and a session to resume,
// not already on that account. Background agents have no block and keep the old account until they end;
// terminals are not agents. Only idle ones start checked — a restart cuts a working turn short and drops
// an asking agent's pending question. `lineage` files each one under its project and run.
export function restartCandidates(
    agents: AgentVM[],
    newActive: string,
    lineage: Lineage = NO_LINEAGE
): RestartCandidate[] {
    const out: RestartCandidate[] = [];
    for (const a of agents) {
        if ((a.agent || "claude") !== "claude" || (a.kind != null && a.kind !== "agent")) {
            continue;
        }
        const sessionId = sessionIdFromTranscript(a.transcriptPath);
        if (!a.blockId || !sessionId || (a.usage?.account || "") === newActive) {
            continue;
        }
        const c: RestartCandidate = {
            tabId: a.id,
            blockId: a.blockId,
            name: a.name,
            sessionId,
            checked: a.state === "idle",
            state: a.state,
        };
        const project = agentProject(lineage, agents, a);
        if (project) {
            c.project = project;
        }
        const role = lineage.roles[a.id];
        const runId = role == null ? undefined : role.kind === "lead" ? role.runId : role.leadRunId;
        const info = runId ? lineage.runs[runId] : undefined;
        if (role != null && info != null) {
            c.run = { id: info.runId, title: info.title || info.runId.slice(0, 8) };
            c.role = role.kind === "lead" ? "lead" : role.kind === "worker" ? role.taskId : role.stageRole;
        }
        out.push(c);
    }
    return out;
}

export interface RestartRunGroup {
    id: string;
    title: string;
    items: RestartCandidate[]; // its lead first, then the rest in the order given
}

export interface RestartProjectGroup {
    project: string; // "" for agents with no project
    agents: RestartCandidate[]; // the ones that work for no run
    runs: RestartRunGroup[];
}

// The restart dialog's tree: a folder per project (by name, the no-project one last), holding its plain agents and
// then a section per run. A run's agents sit in their lead's project, so a run never splits across two folders.
export function groupRestartCandidates(candidates: RestartCandidate[]): RestartProjectGroup[] {
    const groups = new Map<string, RestartProjectGroup>();
    for (const c of candidates) {
        const project = c.project ?? "";
        let g = groups.get(project);
        if (g == null) {
            g = { project, agents: [], runs: [] };
            groups.set(project, g);
        }
        const of = c.run;
        if (of == null) {
            g.agents.push(c);
            continue;
        }
        let run = g.runs.find((r) => r.id === of.id);
        if (run == null) {
            run = { id: of.id, title: of.title, items: [] };
            g.runs.push(run);
        }
        if (c.role === "lead") {
            run.items.unshift(c);
        } else {
            run.items.push(c);
        }
    }
    return [...groups.values()].sort(
        (a, b) => Number(a.project === "") - Number(b.project === "") || a.project.localeCompare(b.project)
    );
}

export type CheckState = "all" | "some" | "none";

// What a group's checkbox shows for the `ids` under it: rows already resumed are left out, as they can no longer be
// picked; "none" when nothing is left.
export function groupCheckState(
    ids: readonly string[],
    checked: Readonly<Record<string, boolean>>,
    done: Readonly<Record<string, boolean>>
): CheckState {
    const open = ids.filter((id) => !done[id]);
    const n = open.filter((id) => checked[id]).length;
    return n === 0 ? "none" : n === open.length ? "all" : "some";
}

// A group's checkbox clicked: a group with every open row checked clears them, anything else checks them all.
// Resumed rows keep their value.
export function toggleGroup(
    ids: readonly string[],
    checked: Readonly<Record<string, boolean>>,
    done: Readonly<Record<string, boolean>>
): Record<string, boolean> {
    const value = groupCheckState(ids, checked, done) !== "all";
    const next = { ...checked };
    for (const id of ids) {
        if (!done[id]) {
            next[id] = value;
        }
    }
    return next;
}

export interface RowQuota {
    fivehourpct?: number;
    weekpct?: number;
    capturedAt: number;
}

// The account's last snapshot, with a window that has rolled over since reading 0; null when no agent
// on it has reported yet. `key` is the account's claudeQuotaKey, so a token account tied to the email of
// an account that was once the /login one shows that account's snapshot.
export function rowQuota(saved: Record<string, SavedSnapshot>, key: string, now: number): RowQuota | null {
    const s = saved[key];
    if (s == null) {
        return null;
    }
    const { fivehour, week } = savedWindows(s, now);
    return { fivehourpct: fivehour.pct, weekpct: week.pct, capturedAt: s.capturedAt };
}

// The Default row's name: the /login account's email, else "Claude login".
export function defaultAccountName(loginEmail: string | undefined): string {
    const email = loginEmail?.trim();
    return email ? email : "Claude login";
}

// The account a new claude launch runs on, for the New dialog's footer: the active token account's label, else
// Default's name. "" while /login is the only account (no account holds a token), so nothing is shown.
// `activeId` is activeClaudeAccountAtom ("" for Default).
export function launchAccountName(activeId: string, identity: ClaudeIdentity): string {
    if (!identity.accounts.some((a) => !a.notoken)) {
        return "";
    }
    const account = identity.accounts.find((a) => a.id === activeId);
    return account != null ? account.label : defaultAccountName(identity.loginEmail);
}

// A window at or past this is about to run out.
export const QUOTA_WARN_PCT = 90;

function pctText(pct: number | undefined): string {
    return pct == null ? "—" : `${Math.round(pct)}%`;
}

// A row's quota line, and whether either window is at QUOTA_WARN_PCT or more.
export function quotaLine(q: RowQuota | null, now: number): { text: string; warn: boolean } {
    if (q == null) {
        return { text: "Not used yet", warn: false };
    }
    return {
        text: `5h ${pctText(q.fivehourpct)} · week ${pctText(q.weekpct)} · ${formatAgeShort(now - q.capturedAt)} ago`,
        warn: (q.fivehourpct ?? 0) >= QUOTA_WARN_PCT || (q.weekpct ?? 0) >= QUOTA_WARN_PCT,
    };
}

// The Add account dialog's steps: sign-in (the live `claude setup-token`), paste, then naming the account.
export type AddStep =
    | { kind: "signin" }
    | { kind: "paste"; busy: boolean; error: string | null }
    | { kind: "name"; account: ClaudeAccountData }
    | { kind: "error"; message: string };

export type AddAction =
    | { type: "init" }
    | { type: "paste" }
    | { type: "back" }
    | { type: "saving" }
    | { type: "refused"; message: string }
    | { type: "added"; account: ClaudeAccountData }
    | { type: "failed"; message: string };

export function addAccountStep(s: AddStep | undefined, a: AddAction): AddStep {
    switch (a.type) {
        case "init":
        case "back":
            return { kind: "signin" };
        case "paste":
            return { kind: "paste", busy: false, error: null };
        case "saving":
            return s?.kind === "paste" ? { ...s, busy: true, error: null } : (s ?? { kind: "signin" });
        case "refused":
            return { kind: "paste", busy: false, error: a.message };
        case "added":
            return { kind: "name", account: a.account };
        case "failed":
            return { kind: "error", message: a.message };
    }
}

// The emails to offer when tying a token account to one: the /login account's, and every account whose
// snapshot arcterm has saved (the ones it has seen). Sorted, no duplicates.
export function knownClaudeEmails(saved: Record<string, SavedSnapshot>, identity: ClaudeIdentity): string[] {
    const emails = new Set<string>();
    const login = normalizeEmail(identity.loginEmail);
    if (login) {
        emails.add(login);
    }
    for (const key of Object.keys(saved)) {
        const email = key.startsWith("claude:") ? key.slice("claude:".length) : "";
        if (email.includes("@")) {
            emails.add(email);
        }
    }
    return [...emails].sort();
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
