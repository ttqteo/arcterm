// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's display rules (spec 2026-10-15-tray-popover-design.md): sizes, the memory card's words, the
// bars' widths and the CPU load. traypage.tsx and traysubpages.tsx draw them. No React.

import type { TrayLevel, TrayStorage } from "./traytypes";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MB = 1000 * 1000;
const GB = 1000 * MB;

/** GB from 0.1 GB up, so 0.3 GB reads as 0.3 GB; one decimal under 100 GB, none when it is .0. */
function sizeIn(bytes: number, mb: number, gb: number): string {
    if (bytes < gb / 10) {
        return `${Math.round(bytes / mb)} MB`;
    }
    const g = bytes / gb;
    return g < 100 ? `${g.toFixed(1).replace(/\.0$/, "")} GB` : `${Math.round(g)} GB`;
}

/** Memory, in binary units labelled as Activity Monitor and Task Manager label them. */
export function fmtSize(bytes: number): string {
    return sizeIn(bytes, MIB, GIB);
}

/** Disk, in decimal units as Finder and System Settings count them: a 245 GB drive reads 245 GB, not 228. */
export function fmtDisk(bytes: number): string {
    return sizeIn(bytes, MB, GB);
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

/** The CPU card's load: the last second's, whole-machine, a dash before wavesrv's first reading. */
export function cpuLoad(pct: number | null): string {
    return pct == null ? "—" : `${Math.round(pct)}%`;
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
    return `auto-clean took ${fmtDisk(last.bytes)} ${day} at ${clock}${last.error ? ` · ${last.error}` : ""}`;
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
