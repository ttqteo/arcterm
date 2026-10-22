// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Held services as the cockpit words them (spec 2026-10-20-held-services-design.md, "States"): what a row says, what the
// page header's line says, which services the Agent tree lists and what a row's menu offers. Pure: wavesrv owns the
// state, this only turns a ServiceStatus into words. `nowMs` is a parameter so the retry seconds are testable.

// railapps.ts imports this file too: RAIL_FULL_TITLE is only read when a menu is built, never while the modules load
import { RAIL_FULL_TITLE } from "./railapps";

export type ServiceDot = "solid" | "hollow" | "pulse";
export type ServiceTone = "working" | "error" | "warning" | "muted";

export type ServiceRowWords = {
    words: string;
    port?: string;
    tone: ServiceTone;
    dot: ServiceDot;
    action?: "restart";
};

const STOPPABLE = new Set(["starting", "running", "retrying", "nopage"]);
const STARTABLE = new Set(["crashed", "porttaken", "elsewhere", "sleeping"]);
const RESTARTABLE = new Set(["starting", "running", "retrying", "nopage", "crashed"]);

export const canStop = (s: ServiceStatus): boolean => STOPPABLE.has(s.state);
// elsewhere is startable: Start probes the page again, and starts the service once it no longer answers. Sleeping is
// startable for the page header, where it brings an app stopped on screen back; its tree row and menu show no Start
// (showing the pane starts it).
export const canStart = (s: ServiceStatus): boolean => STARTABLE.has(s.state);
export const canRestart = (s: ServiceStatus): boolean => RESTARTABLE.has(s.state);

function retryIn(s: ServiceStatus, nowMs: number): string {
    return `retry in ${Math.max(0, Math.ceil(((s.retryatms ?? 0) - nowMs) / 1000))}s`;
}

function heldBy(s: ServiceStatus): string {
    return `${s.port ?? ""} is held by ${s.holder || "another program"}`;
}

export function serviceRowWords(s: ServiceStatus, nowMs: number): ServiceRowWords {
    switch (s.state) {
        case "starting":
            return { words: "starting…", tone: "working", dot: "pulse" };
        case "running":
            return { words: "", port: `:${s.port}`, tone: "working", dot: "solid" };
        case "elsewhere":
            return { words: "not started by arcterm", port: `:${s.port}`, tone: "working", dot: "hollow" };
        case "retrying":
            return { words: `crashed · ${retryIn(s, nowMs)}`, tone: "error", dot: "solid" };
        case "crashed":
            return { words: `crashed · exit ${s.exitcode ?? 0}`, tone: "error", dot: "solid", action: "restart" };
        case "porttaken":
            return { words: heldBy(s), tone: "warning", dot: "solid" };
        case "nopage":
            return { words: "running, no page after 30s", tone: "warning", dot: "solid" };
        // sleeping is the one idle state: a state this does not know (an older wavesrv's stopped) reads as it does
        case "sleeping":
        default:
            return { words: "sleeping", tone: "muted", dot: "hollow" };
    }
}

/** How long a service has been up: 40s, 5m, 2h 14m. */
export function upFor(ms: number): string {
    const secs = Math.max(0, Math.floor(ms / 1000));
    if (secs < 60) {
        return `${secs}s`;
    }
    const mins = Math.floor(secs / 60);
    if (mins < 60) {
        return `${mins}m`;
    }
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function serviceHeaderLine(s: ServiceStatus, nowMs: number): string {
    switch (s.state) {
        case "running":
            return `Running on 127.0.0.1:${s.port} · up ${upFor(nowMs - (s.startedms ?? nowMs))}`;
        case "starting":
            return `Starting… waiting for 127.0.0.1:${s.port}`;
        case "elsewhere":
            return `Not started by arcterm · 127.0.0.1:${s.port}`;
        case "retrying":
            return `Crashed · ${retryIn(s, nowMs)}`;
        case "crashed":
            return `Crashed · exit ${s.exitcode ?? 0}`;
        case "porttaken":
            return heldBy(s);
        case "nopage":
            return "Running, no page after 30s";
        case "sleeping":
        default:
            return "Sleeping · starts when shown";
    }
}

/** Pure: the services the Agent tree lists, every one that is up or in trouble (any state but sleeping) and the one
 *  whose tab is the selected row, so Stop on the row in view does not pull it out from under the pointer; and every
 *  service's tab, which is never a terminal row. projectTree then draws no folder that holds nothing else. */
export function treeServiceInput(
    list: readonly ServiceStatus[],
    selectedTab: string | null
): { services: { id: string; name: string; project: string; tabId?: string }[]; serviceTabs: Set<string> } {
    const services = list
        .filter((s) => s.state !== "sleeping" || (s.tabid != null && s.tabid === selectedTab))
        .map((s) => ({ id: s.id, name: s.name, project: s.project, tabId: s.tabid }));
    const serviceTabs = new Set(list.flatMap((s) => (s.tabid ? [s.tabid] : [])));
    return { services, serviceTabs };
}

export type ServiceMenuKey = "stop" | "restart" | "hide" | "browser" | "keepRunning" | "pin" | "edit";
export type ServiceMenuChoice =
    | { key: "separator" }
    | { key: ServiceMenuKey; label: string; enabled: boolean; checked?: boolean; title?: string };

const HIDE_TROUBLE_TITLE = "A service in trouble stays in the tree until it is fixed or restarted";

/** Pure: a service row's context menu, in order. There is no Start: showing the service starts it. `pinned` is
 *  whether it sits on the rail, `railFull` whether the rail holds its three. Hide takes the row out of the tree (the
 *  click moves the selection off it, so treeServiceInput drops it): an up one is stopped first; one in trouble keeps
 *  its row, so its Hide is off. */
export function serviceMenuChoices(
    s: ServiceStatus,
    { pinned, railFull }: { pinned: boolean; railFull: boolean }
): ServiceMenuChoice[] {
    const hideable = canStop(s) || s.state === "sleeping";
    return [
        { key: "stop", label: "Stop", enabled: canStop(s) },
        { key: "restart", label: "Restart", enabled: canRestart(s) },
        {
            key: "hide",
            label: canStop(s) ? "Stop and hide" : "Hide",
            enabled: hideable,
            ...(!hideable ? { title: HIDE_TROUBLE_TITLE } : {}),
        },
        { key: "separator" },
        ...(s.url ? [{ key: "browser" as const, label: "Open in the browser", enabled: true }] : []),
        { key: "keepRunning", label: "Keep running", enabled: true, checked: s.autostart },
        {
            key: "pin",
            label: pinned ? "Unpin from the rail" : "Pin to the rail",
            enabled: pinned || !railFull,
            ...(!pinned && railFull ? { title: RAIL_FULL_TITLE } : {}),
        },
        { key: "separator" },
        { key: "edit", label: "Edit in Setup → Tools", enabled: true },
    ];
}

/** The tools.json entry with "Keep running" set: on writes `autostart: true`, off drops the key (off is the default).
 * Every other key is kept as it is. */
export function withAutostart(entry: ToolKeywords, on: boolean): ToolKeywords {
    const { autostart: _, ...rest } = entry;
    return on ? { ...rest, autostart: true } : rest;
}
