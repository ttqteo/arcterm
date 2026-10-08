// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers popover as pure functions (docs/superpowers/specs/2026-10-08-machine-servers-design.md): every
// listening process grouped by repo, each row's owner badge, the log a background task wrote for it, its Stop
// confirm, and the chip's counts. machineserversstore.ts polls; machineserverspanel.tsx draws.

import { matchLauncherTask, serverLabel, type DevServerRow } from "./devserversmodel";
import type { BackgroundTask } from "./transcriptprojection";

export type BadgeKind = "agent" | "terminal" | "app" | "noowner";

export interface MachineBadge {
    kind: BadgeKind;
    text: string;
    tabId?: string; // an agent's or terminal's tab, which a click opens
}

export interface MachineRow {
    key: string; // pid:createms
    server: DevServerRow;
    label: string;
    badge: MachineBadge;
    log?: { agentId: string; task: BackgroundTask };
    stopConfirm: string;
}

export interface MachineGroup {
    repo: string;
    title: string;
    rows: MachineRow[];
}

export interface MachineView {
    groups: MachineGroup[];
    other: MachineRow[];
    otherNames: string; // "Code, com.docker.backend"
    repoCount: number; // the chip's number: servers inside a repo
    noOwnerCount: number;
}

// what the model needs of a roster entry (AgentVM fits)
export interface MachineAgent {
    id: string; // tab id
    name: string;
    agent?: string; // harness
    kind?: "agent" | "terminal" | "background";
}

const NO_OWNER: MachineBadge = { kind: "noowner", text: "no owner" };

// "D:\Workspace\SIEM\apps\portal" -> "SIEM/apps/portal": the last three segments, a drive letter not one of them
// ("D:\work\arcterm" -> "work/arcterm")
export function repoTitle(repo: string): string {
    const segs = repo.split(/[\\/]/).filter((s) => s !== "" && !/^[A-Za-z]:$/.test(s));
    return segs.length > 0 ? segs.slice(-3).join("/") : repo;
}

function exeName(name: string | undefined): string {
    return (name ?? "").replace(/\.exe$/i, "");
}

function resolveRow(s: DevServerRow, agents: MachineAgent[], bgTasks: Record<string, BackgroundTask[]>): MachineRow {
    const base = { key: `${s.pid}:${s.createms}`, server: s, label: serverLabel(s), stopConfirm: "Stop?" };
    const agentBadge = (tabId: string, fallback?: string, harness?: string): MachineBadge => {
        const a = agents.find((x) => x.id === tabId);
        return { kind: "agent", text: `${harness ?? a?.agent ?? "agent"} · ${a?.name ?? fallback ?? tabId}`, tabId };
    };
    const o = s.owner;
    switch (o?.kind) {
        case "agent": {
            const tabId = o.tabid ?? "";
            const task = matchLauncherTask(s.launchercmdline, bgTasks[tabId] ?? []);
            return {
                ...base,
                badge: agentBadge(tabId, o.name, o.harness),
                log: task ? { agentId: tabId, task } : undefined,
            };
        }
        case "terminal":
            return { ...base, badge: { kind: "terminal", text: `terminal · ${o.name || "Terminal"}`, tabId: o.tabid } };
        case "app":
            return { ...base, badge: { kind: "app", text: exeName(o.name) }, stopConfirm: `Stop ${exeName(o.name)}?` };
        default:
            for (const [agentId, tasks] of Object.entries(bgTasks)) {
                const task = matchLauncherTask(s.launchercmdline, tasks);
                if (task) {
                    return { ...base, badge: agentBadge(agentId), log: { agentId, task } };
                }
            }
            // "no owner" flags a stray server in a repo; outside one, an app whose launcher exited reads as itself
            if (!s.repo) {
                return {
                    ...base,
                    badge: { kind: "app", text: exeName(s.name) },
                    stopConfirm: `Stop ${exeName(s.name)}?`,
                };
            }
            return { ...base, badge: NO_OWNER };
    }
}

export function buildMachineServers(
    servers: DevServerRow[],
    agents: MachineAgent[],
    bgTasks: Record<string, BackgroundTask[]>
): MachineView {
    const byRepo = new Map<string, MachineRow[]>();
    const other: MachineRow[] = [];
    for (const s of servers) {
        const r = resolveRow(s, agents, bgTasks);
        if (s.repo) {
            byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), r]);
        } else {
            other.push(r);
        }
    }
    const hasNoOwner = (g: MachineGroup) => g.rows.some((r) => r.badge.kind === "noowner");
    const groups = [...byRepo].map(([repo, rows]) => ({ repo, title: repoTitle(repo), rows }));
    groups.sort((a, b) => Number(hasNoOwner(b)) - Number(hasNoOwner(a)) || a.title.localeCompare(b.title));
    const inRepo = groups.flatMap((g) => g.rows);
    return {
        groups,
        other,
        otherNames: [...new Set(other.map((r) => exeName(r.server.name)))].join(", "),
        repoCount: inRepo.length,
        noOwnerCount: inRepo.filter((r) => r.badge.kind === "noowner").length,
    };
}

// how often the footer asks for every listener: fast while the popover is open
export function machinePollMs(open: boolean): number {
    return open ? 3000 : 15000;
}
