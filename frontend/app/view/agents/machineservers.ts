// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers popover as pure functions (docs/superpowers/specs/2026-10-08-machine-servers-design.md): every
// listening process grouped by repo, each row's owner badge, the log a background task wrote for it (else the file
// its output goes to), its Stop confirm, what Restart in arcterm runs, and the chip's counts. machineserversstore.ts
// polls; machineserverspanel.tsx draws.

import { folderName, formFromServer, plainCommand, type ScriptSuggestion } from "./appsuggest";
import {
    matchEndedTask,
    matchLauncherTask,
    serverLabel,
    terminalLog,
    type DevServerRow,
    type TerminalLog,
} from "./devserversmodel";
import type { BackgroundTask } from "./transcriptprojection";

export type BadgeKind = "agent" | "terminal" | "service" | "app" | "noowner";

export interface MachineBadge {
    kind: BadgeKind;
    text: string;
    tabId?: string; // an agent's, terminal's or held service's tab, which a click opens
    serviceId?: string; // a held service's id: its Stop goes through wavesrv, which a kill from outside would only restart
}

export interface MachineRow {
    key: string; // pid:createms
    server: DevServerRow;
    label: string;
    badge: MachineBadge;
    log?: { agentId: string; task: BackgroundTask };
    termLog?: TerminalLog; // the arcterm terminal that holds the server: its pane is the log
    fileLog?: string; // with neither: the file its output goes to
    restart?: boolean; // a stray server in a repo: Restart in arcterm runs it again in a terminal
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

// what the model needs of a held service (ServiceStatus fits): its server runs in a terminal tab of its own
export interface MachineService {
    id: string;
    name: string;
    tabid?: string;
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

function resolveRow(
    s: DevServerRow,
    agents: MachineAgent[],
    bgTasks: Record<string, BackgroundTask[]>,
    services: MachineService[]
): MachineRow {
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
        case "terminal": {
            // a held service's server runs in the service's own tab: it reads as the app, not as a terminal
            const service = o.tabid ? services.find((x) => x.tabid === o.tabid) : undefined;
            if (service) {
                return {
                    ...base,
                    badge: { kind: "service", text: `app · ${service.name}`, tabId: o.tabid, serviceId: service.id },
                    termLog: terminalLog(s) ?? undefined,
                    stopConfirm: `Stop ${service.name}?`,
                };
            }
            return {
                ...base,
                badge: { kind: "terminal", text: `terminal · ${o.name || "Terminal"}`, tabId: o.tabid },
                termLog: terminalLog(s) ?? undefined,
            };
        }
        case "app":
            return { ...base, badge: { kind: "app", text: exeName(o.name) }, stopConfirm: `Stop ${exeName(o.name)}?` };
        default:
            for (const [agentId, tasks] of Object.entries(bgTasks)) {
                const task = matchLauncherTask(s.launchercmdline, tasks);
                if (task) {
                    return { ...base, badge: agentBadge(agentId), log: { agentId, task } };
                }
            }
            // a launcher that started the server and exited (`astro dev` daemonizes): the task that ended as it came up
            for (const [agentId, tasks] of Object.entries(bgTasks)) {
                const task = matchEndedTask(s.createms, tasks);
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

// a row with no log of its own reads the file its output goes to; one with no owner can be restarted in arcterm
function withExtras(r: MachineRow): MachineRow {
    const fileLog = r.log == null && r.termLog == null && r.server.logfile ? r.server.logfile : undefined;
    return { ...r, fileLog, restart: r.badge.kind === "noowner" || undefined };
}

// `services` are the held services (servicesAtom): a server whose owner is the terminal tab of one gets the `service`
// badge and a Stop that names the app; every other row is as without them.
export function buildMachineServers(
    servers: DevServerRow[],
    agents: MachineAgent[],
    bgTasks: Record<string, BackgroundTask[]>,
    services: MachineService[] = []
): MachineView {
    const byRepo = new Map<string, MachineRow[]>();
    const other: MachineRow[] = [];
    for (const s of servers) {
        const r = withExtras(resolveRow(s, agents, bgTasks, services));
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

// the agent whose side panel shows a file log: the focused one, else the first; null with no agent at all
export function logHost(focusId: string | undefined, agents: Pick<MachineAgent, "id" | "kind">[]): string | null {
    const live = agents.filter((a) => a.kind == null || a.kind === "agent");
    return (live.find((a) => a.id === focusId) ?? live[0])?.id ?? null;
}

export interface RestartPlan {
    command: string;
    cwd: string;
    projectName: string;
}

function pathKey(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// the one server script whose tool (its first word) names a path segment of cmdline; null for none or several
function toolScript(cmdline: string, scripts: ScriptSuggestion[]): ScriptSuggestion | null {
    const segs = new Set(cmdline.toLowerCase().split(/[\\/\s"]+/));
    const hits = scripts.filter((sc) => sc.server && segs.has(sc.body.trim().split(/\s+/)[0]?.toLowerCase() ?? ""));
    return hits.length === 1 ? hits[0] : null;
}

// What Restart in arcterm runs for a server: the line Pin as app would start it with (formFromServer), in its folder, in
// the registered project that holds that folder (the deepest), else one named after its repo's folder.
export function restartPlan(
    s: DevServerRow,
    scripts: ScriptSuggestion[],
    projects: { name: string; path: string }[]
): RestartPlan {
    const form = formFromServer(s, scripts);
    // a tool's own entry (`node …\astro\astro.js dev`) matches no script line: the folder's server script that runs
    // that tool does
    const tool = form.command === plainCommand(s.cmdline) ? toolScript(s.cmdline, scripts) : null;
    const dir = pathKey(form.dir);
    const project = projects
        .filter((p) => p.path && (dir === pathKey(p.path) || dir.startsWith(pathKey(p.path) + "/")))
        .sort((a, b) => b.path.length - a.path.length)[0];
    return {
        command: tool?.command ?? form.command,
        cwd: form.dir,
        projectName: project?.name ?? (folderName(s.repo || form.dir) || "Home"),
    };
}
