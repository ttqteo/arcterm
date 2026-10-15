// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's display rules (spec 2026-10-15-tray-popover-design.md): sizes, the memory card's words, the
// bars' widths and the CPU line. traypage.tsx and traysubpages.tsx draw them. No React.

import type { TrayLevel, TrayStorage } from "./traytypes";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Binary units, labelled as Activity Monitor and Task Manager label them: GB from 0.1 GB up, so 0.3 GB reads as 0.3 GB. */
export function fmtSize(bytes: number): string {
    if (bytes < GIB / 10) {
        return `${Math.round(bytes / MIB)} MB`;
    }
    const g = bytes / GIB;
    return g < 100 ? `${g.toFixed(1).replace(/\.0$/, "")} GB` : `${Math.round(g)} GB`;
}

export function levelWord(level: TrayLevel): string | null {
    switch (level) {
        case "normal":
            return "Normal";
        case "high":
            return "High";
        case "critical":
            return "Critical";
        default:
            return null;
    }
}

/** What the heavy-job queue does at this level (pkg/jobqueue), under the memory figure. */
export function memoryCaption(level: TrayLevel, paused: boolean): string {
    if (paused) {
        return "Queue paused";
    }
    if (level === "critical") {
        return "No heavy job starts";
    }
    return level === "high" ? "Jobs run one at a time" : "Jobs start as RAM allows";
}

/** The whole percent of total in use, 0-100. */
export function usedPct(total: number, free: number): number {
    if (total <= 0) {
        return 0;
    }
    return Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100)));
}

/** A split bar: arcterm's share and the rest of what is used, in whole percent of total. */
export function split(total: number, used: number, arc: number): { arc: number; other: number } {
    if (total <= 0) {
        return { arc: 0, other: 0 };
    }
    const arcPct = Math.round((Math.min(used, Math.max(0, arc)) / total) * 100);
    const usedP = Math.min(100, Math.round((used / total) * 100));
    return { arc: arcPct, other: Math.max(0, usedP - arcPct) };
}

/** The CPU line's points in a w x h box, oldest left, 100 % at the top. */
export function sparkPoints(samples: number[], w = 140, h = 34): string {
    if (samples.length === 0) {
        return "";
    }
    const pts = samples.length === 1 ? [samples[0], samples[0]] : samples;
    const step = w / (pts.length - 1);
    const r = (n: number) => Math.round(n * 10) / 10;
    return pts.map((v, i) => `${r(i * step)},${r(h - (Math.min(100, Math.max(0, v)) / 100) * h)}`).join(" ");
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Clean up's "auto-clean took 1.1 GB today at 09:12": today's clean reads "today", an earlier one its date. */
export function autoCleanLine(last: TrayStorage["lastAuto"], now: number): string | null {
    if (last == null) {
        return null;
    }
    const at = new Date(last.ts);
    const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const day = sameDay(at, new Date(now)) ? "today" : at.toLocaleDateString([], { month: "short", day: "numeric" });
    return `auto-clean took ${fmtSize(last.bytes)} ${day} at ${clock}${last.error ? ` · ${last.error}` : ""}`;
}

export type PageState = "loading" | "offline" | "ready";

export function pageState(snapshot: unknown, offline: boolean): PageState {
    if (offline) {
        return "offline";
    }
    return snapshot == null ? "loading" : "ready";
}

// status colours by level: the word and its dot, and the memory bar
export const LEVEL_TEXT: Record<TrayLevel, string> = {
    normal: "text-working",
    high: "text-asking",
    critical: "text-error",
    unknown: "text-muted",
};
export const LEVEL_DOT: Record<TrayLevel, string> = {
    normal: "bg-working",
    high: "bg-asking",
    critical: "bg-error",
    unknown: "bg-muted",
};
export const LEVEL_BAR: Record<TrayLevel, string> = {
    normal: "bg-muted",
    high: "bg-asking",
    critical: "bg-error",
    unknown: "bg-muted",
};
// the 5h chip, as the app bar's meter colours it (usagemeters.tsx LEVEL_BAR / LEVEL_TXT)
export const USAGE_BAR = { ok: "bg-muted", warn: "bg-warning", hot: "bg-error" } as const;
export const USAGE_TEXT = { ok: "text-primary", warn: "text-warning", hot: "text-error" } as const;
