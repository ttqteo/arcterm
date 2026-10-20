// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Held services as the cockpit words them (spec 2026-10-20-held-services-design.md, "States"): what a row says, what the
// page header's line says, what the app bar chip sums up, and in what order the popover lists them. Pure: wavesrv owns
// the state, this only turns a ServiceStatus into words. `nowMs` is a parameter so the retry seconds are testable.

export type ServiceDot = "solid" | "hollow" | "pulse";
export type ServiceTone = "working" | "error" | "warning" | "muted";

export type ServiceRowWords = {
    words: string;
    port?: string;
    tone: ServiceTone;
    dot: ServiceDot;
    action?: "start" | "restart";
};

const STOPPABLE = new Set(["starting", "running", "retrying", "nopage"]);
const STARTABLE = new Set(["stopped", "crashed", "porttaken", "elsewhere", "sleeping"]);
const RESTARTABLE = new Set(["starting", "running", "retrying", "nopage", "crashed"]);

export const canStop = (s: ServiceStatus): boolean => STOPPABLE.has(s.state);
// elsewhere is startable: Start probes the page again, and starts the service once it no longer answers. Sleeping is
// startable for the page header and the menu; its tree row and popover row show no Start (showing the pane starts it).
export const canStart = (s: ServiceStatus): boolean => STARTABLE.has(s.state);
// The popover's hover Start: every startable row except a sleeping one, which wakes when its row is opened.
export const canStartFromPopover = (s: ServiceStatus): boolean => canStart(s) && s.state !== "sleeping";
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
        case "sleeping":
            return { words: "sleeping", tone: "muted", dot: "hollow" };
        default:
            return { words: "stopped", tone: "muted", dot: "hollow", action: "start" };
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
            return "Sleeping · starts when shown";
        default:
            return "Stopped";
    }
}

const isCrashed = (s: ServiceStatus) => s.state === "crashed" || s.state === "retrying";
const isWarning = (s: ServiceStatus) => s.state === "porttaken" || s.state === "nopage";

export type ServicesChip = { hidden: boolean; label: string; tone: "error" | "warning" | "muted"; title: string };

/** The app bar chip: the running count, "· N crashed" when any is retrying or crashed. Error when any crashed, else
 * warning when any has a taken port or no page, else muted. Hidden while it would read a bare 0: nothing runs and
 * nothing needs a look. */
export function servicesChip(list: ServiceStatus[]): ServicesChip {
    const running = list.filter((s) => s.state === "running").length;
    const crashed = list.filter(isCrashed).length;
    const attention = list.filter(isWarning).length;
    if (running === 0 && crashed === 0 && attention === 0) {
        return { hidden: true, label: "", tone: "muted", title: "" };
    }
    const stopped = list.filter((s) => s.state === "stopped").length;
    const tone = crashed > 0 ? "error" : attention > 0 ? "warning" : "muted";
    const label = crashed > 0 ? `${running} · ${crashed} crashed` : `${running}`;
    const parts = [`${running} running`];
    if (crashed > 0) {
        parts.push(`${crashed} crashed`);
    }
    if (attention > 0) {
        parts.push(`${attention} need${attention === 1 ? "s" : ""} a look`);
    }
    if (stopped > 0) {
        parts.push(`${stopped} stopped`);
    }
    return { hidden: false, label, tone, title: `Services: ${parts.join(" · ")}` };
}

function orderGroup(s: ServiceStatus): number {
    if (isCrashed(s)) {
        return 0;
    }
    if (isWarning(s)) {
        return 1;
    }
    return s.state === "stopped" || s.state === "sleeping" ? 3 : 2;
}

/** The popover's order: those that need the person first (crashed, then amber), then up, then stopped and sleeping; by
 * name inside each. Returns a new list. */
export function popoverOrder(list: ServiceStatus[]): ServiceStatus[] {
    return [...list].sort((a, b) => orderGroup(a) - orderGroup(b) || a.name.localeCompare(b.name));
}

/** The tools.json entry with "Keep running" set: on writes `autostart: true`, off drops the key (off is the default).
 * Every other key is kept as it is. */
export function withAutostart(entry: ToolKeywords, on: boolean): ToolKeywords {
    const { autostart: _, ...rest } = entry;
    return on ? { ...rest, autostart: true } : rest;
}
