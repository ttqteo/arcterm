// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar strain band's pure model (spec 2026-11-13-sidecar-design.md, section 4; board E-strain-band; decision 9 of
// the part-2 plan): when the machine counts as strained, when the band steps down and clears, who weighs most, the
// band's words and the title bar's readout. The bridge (sidecarbridge.tsx) runs `trackStrain` over the machine readings
// and builds the snapshot's `strain`; the page (sidecarband.tsx, sidecartitlebar.tsx) reads the words from here. No
// store, no RPC, no React: the Sidecar page boots no store and imports this directly.

import type { SidecarHeavy, SidecarMachine, SidecarStrain, SidecarTile, StrainLevel } from "./sidecartypes";
import { formatTileAge } from "./sidecarwallmodel";

/** The machine's CPU counts as hot while every reading is over this, percent. */
export const CPU_HOT_PCT = 90;
/** ...for this long without a break, ms. */
export const CPU_HOT_MS = 120_000;
/** A gap between two readings longer than this restarts the CPU streak: no data is not proof, ms. */
export const CPU_GAP_MS = 15_000;
/** A lower level has to hold this long before the band steps down to it, ms. */
export const CLEAR_MS = 30_000;
/** The band names at most this many agents. */
export const MAX_HEAVY = 3;

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const MB = 2 ** 20;
const GB = 2 ** 30;

/** One look at the machine: the OS's memory pressure word, the memory free and the CPU (a percent, none before a reading). */
export interface MachineReading {
    at: number; // UnixMilli
    pressure: string; // "normal" | "high" | "critical"; any other word counts as normal
    memFree: number;
    memTotal: number;
    cpuPct?: number;
}

/** What the shown band says: the RAM and CPU parts that are up (or were, while it waits to clear). */
interface StrainParts {
    ram?: { since: number; critical: boolean };
    cpu?: { since: number; pct: number };
}

/** What `strainNow` answers; the bridge adds the counts and the heavy agents and so makes a SidecarStrain. */
export interface StrainState extends StrainParts {
    level: StrainLevel;
}

/** The track `trackStrain` carries from one reading to the next. Opaque to callers: copy it, never edit it. */
export interface StrainTrack {
    readonly lastAt: number | null; // the last reading taken
    readonly ramSince: number | null; // start of the current RAM-high streak
    readonly cpuSince: number | null; // start of the current streak of readings over CPU_HOT_PCT
    readonly shown: StrainLevel | null; // the level the band is at, after the hold
    readonly belowSince: number | null; // since when the raw level has been under `shown`
    readonly parts: StrainParts; // what the band says: kept while it holds
}

export const EMPTY_TRACK: StrainTrack = {
    lastAt: null,
    ramSince: null,
    cpuSince: null,
    shown: null,
    belowSince: null,
    parts: {},
};

// 0 = no strain, 1 = amber, 2 = red.
const LEVELS: (StrainLevel | null)[] = [null, "amber", "red"];
const RANK: Record<StrainLevel, number> = { amber: 1, red: 2 };

/** What RAM and CPU say once RAM is only high, not critical: a red band that steps down to amber stops saying critical. */
function lowered(parts: StrainParts): StrainParts {
    return {
        ...(parts.ram != null ? { ram: { since: parts.ram.since, critical: false } } : {}),
        ...(parts.cpu != null ? { cpu: parts.cpu } : {}),
    };
}

/**
 * Take one reading. RAM is high at pressure `high` or `critical` (red at `critical`); CPU is hot once every reading for
 * CPU_HOT_MS has been over CPU_HOT_PCT with no gap over CPU_GAP_MS. A higher level shows at once; a lower one only after
 * the raw level has stayed below the shown one for CLEAR_MS, one level at a time. A reading no newer than the last one is
 * ignored, so a late memorypressure event cannot rewind the track.
 */
export function trackStrain(t: StrainTrack, r: MachineReading): StrainTrack {
    if (t.lastAt != null && r.at <= t.lastAt) {
        return t;
    }
    const ramHigh = r.pressure === "high" || r.pressure === "critical";
    const critical = r.pressure === "critical";
    const ramSince = ramHigh ? (t.ramSince ?? r.at) : null;

    const gap = t.lastAt != null && r.at - t.lastAt > CPU_GAP_MS;
    const cpuOver = r.cpuPct != null && r.cpuPct > CPU_HOT_PCT;
    const cpuSince = cpuOver ? (gap ? r.at : (t.cpuSince ?? r.at)) : null;
    const cpuHot = cpuOver && cpuSince != null && r.at - cpuSince >= CPU_HOT_MS;

    const raw: StrainParts = {
        ...(ramHigh && ramSince != null ? { ram: { since: ramSince, critical } } : {}),
        ...(cpuHot && cpuSince != null && r.cpuPct != null ? { cpu: { since: cpuSince, pct: r.cpuPct } } : {}),
    };
    const rawRank = critical ? 2 : ramHigh || cpuHot ? 1 : 0;
    const shownRank = t.shown == null ? 0 : RANK[t.shown];

    let shown = t.shown;
    let belowSince = t.belowSince;
    let parts = t.parts;
    if (rawRank >= shownRank) {
        // at the shown level, or above it: show it at once and say what is up now
        shown = LEVELS[rawRank];
        belowSince = null;
        parts = raw;
    } else {
        // under the shown level: hold it, and step down one level once the raw level has stayed under for CLEAR_MS
        belowSince = belowSince ?? r.at;
        if (r.at - belowSince >= CLEAR_MS) {
            const down = shownRank - 1;
            shown = LEVELS[down];
            parts = down === 0 ? {} : down === rawRank ? raw : lowered(parts);
            belowSince = down > rawRank ? r.at : null;
        }
    }
    return { lastAt: r.at, ramSince, cpuSince, shown, belowSince, parts };
}

/** The band's level and what it says, or null when the band does not show. */
export function strainNow(t: StrainTrack): StrainState | null {
    if (t.shown == null) {
        return null;
    }
    return { level: t.shown, ...t.parts };
}

/** Who the band measures by: RAM when RAM is up (also when both are: RAM is the one that kills processes), else CPU. */
export function strainBy(s: StrainState): "ram" | "cpu" {
    return s.ram != null || s.cpu == null ? "ram" : "cpu";
}

type HeavyProcess = NonNullable<SidecarHeavy["process"]>;

/**
 * The agents that weigh most by the band's measure, heaviest first: at most MAX_HEAVY, only agents the Sidecar shows as
 * tiles (a terminal is not one), only those with a reading above 0. RAM comes from the consumers reading (`tabid` is the
 * tile id; its `heaviest` process is what Stop ends), CPU from the per-agent CPU reading (`blockid`, which `blockOf`
 * maps a tile id to; its `top` process). `notes` holds the last Stop or Sleep outcome by tile id.
 */
export function heavyAgents(
    by: "ram" | "cpu",
    tiles: Pick<SidecarTile, "id" | "name">[],
    consumers: CommandGetConsumersRtnData | null,
    cpu: AgentCpuData | null,
    blockOf: (tileId: string) => string | undefined,
    notes: Record<string, string>
): SidecarHeavy[] {
    const rows: SidecarHeavy[] = [];
    const add = (id: string, name: string, weight: Partial<SidecarHeavy>, process: HeavyProcess | undefined) => {
        const note = notes[id];
        rows.push({
            id,
            name,
            ...weight,
            ...(process != null ? { process } : {}),
            ...(note != null ? { note } : {}),
        });
    };
    if (by === "ram") {
        const names = new Map(tiles.map((t) => [t.id, t.name]));
        const seen = new Set<string>();
        for (const a of consumers?.agents ?? []) {
            const name = names.get(a.tabid);
            const bytes = a.rambytes ?? 0;
            if (name == null || !(bytes > 0) || seen.has(a.tabid)) {
                continue;
            }
            seen.add(a.tabid);
            const h = a.heaviest;
            add(
                a.tabid,
                name,
                { ramBytes: bytes },
                h != null ? { pid: h.pid, command: h.command, ramBytes: h.bytes } : undefined
            );
        }
        rows.sort((x, y) => (y.ramBytes ?? 0) - (x.ramBytes ?? 0));
    } else {
        const byBlock = new Map((cpu?.agents ?? []).map((a) => [a.blockid, a]));
        for (const t of tiles) {
            const block = blockOf(t.id);
            const a = block != null ? byBlock.get(block) : undefined;
            if (a == null || !(a.cpu > 0)) {
                continue;
            }
            const top = a.top;
            add(
                t.id,
                t.name,
                { cpuPct: a.cpu },
                top != null ? { pid: top.pid, command: top.command, cpuPct: top.cpu } : undefined
            );
        }
        rows.sort((x, y) => (y.cpuPct ?? 0) - (x.cpuPct ?? 0));
    }
    return rows.slice(0, MAX_HEAVY);
}

/** The × memory: the level the band was hidden at, kept only while the band stays at that level and forgotten when it differs or goes. */
export function nextHidden(hidden: StrainLevel | null, level: StrainLevel | null): StrainLevel | null {
    return level != null && hidden === level ? hidden : null;
}

/** Whether the band shows: there is strain, and it is not at the level the × hid. */
export function bandShows(level: StrainLevel | null, hidden: StrainLevel | null): boolean {
    return level != null && level !== hidden;
}

/** Board E's two titles. */
export function bandTitle(s: SidecarStrain): string {
    return s.level === "red" ? "The machine is about to run out of memory" : "The machine is strained";
}

/** "3 min" (the wall's hours-and-minutes past an hour), "<1 min" before a minute. */
function ageWords(ms: number): string {
    if (ms < MIN_MS) {
        return "<1 min";
    }
    if (ms < HOUR_MS) {
        return `${Math.floor(ms / MIN_MS)} min`;
    }
    return formatTileAge(ms);
}

function osName(m: SidecarMachine | undefined): string {
    switch (m?.platform) {
        case "windows":
            return "Windows";
        case "macos":
            return "macOS";
        default:
            return "The system";
    }
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * The band's second line, as board E reads. Amber: `RAM high for 3 min (2.1 GB free of 32 GB) · CPU over 90% for 2 min ·
 * 7 agents working, 2 heavy jobs running`. Red: `RAM critical (0.6 GB free, swap 9.2 GB) · CPU at 98% for 4 min · Windows
 * may start killing processes`. A part that does not apply is left out. `now` is the page's clock (the snapshot's `now`
 * plus the time since it arrived).
 */
export function bandWhy(s: SidecarStrain, m: SidecarMachine | undefined, now: number): string {
    const parts: string[] = [];
    if (s.ram != null) {
        if (s.ram.critical) {
            const detail: string[] = [];
            if (m != null) {
                detail.push(`${formatBytes(m.memFree)} free`);
                if (m.swapUsed != null && m.swapUsed > 0) {
                    detail.push(`swap ${formatBytes(m.swapUsed)}`);
                }
            }
            parts.push(detail.length > 0 ? `RAM critical (${detail.join(", ")})` : "RAM critical");
        } else {
            const of = m != null && m.memTotal > 0 ? ` of ${formatBytes(m.memTotal)}` : "";
            const free = m != null ? ` (${formatBytes(m.memFree)} free${of})` : "";
            parts.push(`RAM high for ${ageWords(now - s.ram.since)}${free}`);
        }
    }
    if (s.cpu != null) {
        const age = ageWords(now - s.cpu.since);
        parts.push(
            s.level === "red" ? `CPU at ${Math.round(s.cpu.pct)}% for ${age}` : `CPU over ${CPU_HOT_PCT}% for ${age}`
        );
    }
    if (s.level === "red") {
        parts.push(`${osName(m)} may start killing processes`);
    } else {
        const counts: string[] = [];
        if (s.working > 0) {
            counts.push(`${plural(s.working, "agent", "agents")} working`);
        }
        if (s.heavyJobs > 0) {
            counts.push(`${plural(s.heavyJobs, "heavy job", "heavy jobs")} running`);
        }
        if (counts.length > 0) {
            parts.push(counts.join(", "));
        }
    }
    return parts.join(" · ");
}

type Tone = "normal" | "amber" | "red";

/**
 * The title bar's machine figures, shortened to the numbers (`2.1 GB`, `93%`; "—" before a reading) and how to tone each:
 * RAM amber while it is up, red when critical; CPU amber while it is up.
 */
export function machineReadout(
    m: SidecarMachine | undefined,
    s: SidecarStrain | undefined
): { ram: string; cpu: string; ramTone: Tone; cpuTone: Tone } {
    return {
        ram: m != null ? formatBytes(m.memFree) : "—",
        cpu: m?.cpuPct != null ? `${Math.round(m.cpuPct)}%` : "—",
        ramTone: s?.ram == null ? "normal" : s.ram.critical ? "red" : "amber",
        cpuTone: s?.cpu == null ? "normal" : "amber",
    };
}

/** Binary units under the names people use (a 32 GB machine says 32 GB): "2.1 GB", "32 GB", "300 MB" (MB under half a GB). */
export function formatBytes(n: number): string {
    if (!(n > 0)) {
        return "0 MB";
    }
    if (n < GB / 2) {
        return `${Math.round(n / MB)} MB`;
    }
    return `${(n / GB).toFixed(1).replace(/\.0$/, "")} GB`;
}
