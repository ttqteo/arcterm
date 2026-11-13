// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Parked launches: a New agent launch put off for later. While the machine is busy (memory pressure high or critical,
// or the CPU pegged), the New dialog's Enter parks the agent instead of starting it; one more agent then would push
// the machine to its peak. A parked launch keeps the dialog's project, agent, task and images, waits as a row in its
// project's folder, and opening it fills the dialog again. Nothing starts on its own when the machine calms down: the
// person starts it when they come back to it. Pure; parkedstore.ts holds the readings and the workspace meta,
// agenttree.tsx the row.

import { formatAgeShort } from "./agentsviewmodel";

/** A CPU this busy, in two readings in a row, is too busy for one more agent. One reading is a second's sample: a
 *  build's link step or a tab's paint spikes it, so a single one never parks. */
export const BUSY_CPU_PCT = 85;

/** One machine reading as GetMachineStatsCommand answers it: the memory pressure's word ("normal", "high",
 *  "critical", or "" with no reading) and the last second's CPU busy percent (none before wavesrv's first sample). */
export type MachineReading = { pressure: string; cpupct?: number };

/** Pure: why the machine is too busy for another agent, from its readings oldest first, or null when it is not (and
 *  with no reading). The latest pressure decides alone; the CPU needs its last two readings over BUSY_CPU_PCT. */
export function busyReason(readings: readonly MachineReading[]): string | null {
    const last = readings.at(-1);
    if (last == null) {
        return null;
    }
    if (last.pressure === "high" || last.pressure === "critical") {
        return `Memory pressure is ${last.pressure}`;
    }
    const cpu = readings.slice(-2).map((r) => r.cpupct);
    if (cpu.length === 2 && cpu.every((c) => c != null && c >= BUSY_CPU_PCT)) {
        return `CPU is ${Math.round(cpu[1])}% busy`;
    }
    return null;
}

/** Pure: the readings kept for busyReason, the newest appended: the last two, all it reads. */
export function keepReadings(readings: readonly MachineReading[], next: MachineReading): MachineReading[] {
    return [...readings, next].slice(-2);
}

/** Pure: the list with `entry` in it: one with the same id (a parked launch opened and parked again) is replaced where
 *  it stood, so it keeps its place; a new one goes last. */
export function withParked(list: readonly ParkedLaunch[], entry: ParkedLaunch): ParkedLaunch[] {
    return list.some((p) => p.id === entry.id) ? list.map((p) => (p.id === entry.id ? entry : p)) : [...list, entry];
}

/** Pure: the list with `entry` put back at `index` (an Undo of its removal, so it returns where it stood); clamped to
 *  the list, and the list as it is when the entry is already in it. */
export function withParkedAt(list: readonly ParkedLaunch[], entry: ParkedLaunch, index: number): ParkedLaunch[] {
    if (list.some((p) => p.id === entry.id)) {
        return [...list];
    }
    const at = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), entry, ...list.slice(at)];
}

/** Pure: the list without the entry `id`. */
export function withoutParked(list: readonly ParkedLaunch[], id: string): ParkedLaunch[] {
    return list.filter((p) => p.id !== id);
}

/** Pure: the row's name: the task's first line, or the agent's when it was parked with no task. */
export function parkedTitle(p: ParkedLaunch): string {
    const line = p.task
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l !== "");
    return line ?? `New ${p.runtime} agent`;
}

/** Pure: the row's second line, "Parked · claude · 2 images · 3h". */
export function parkedMeta(p: ParkedLaunch, now: number): string {
    const n = p.images?.length ?? 0;
    const images = n === 0 ? [] : [n === 1 ? "1 image" : `${n} images`];
    return ["Parked", p.runtime, ...images, formatAgeShort(Math.max(0, now - p.ts))].join(" · ");
}

/** Pure: the row's tooltip: the whole task, then why it waited. */
export function parkedTooltip(p: ParkedLaunch): string {
    const why = p.reason ? `Parked: ${p.reason}` : "Parked for later";
    return [p.task.trim() || parkedTitle(p), why].join("\n\n");
}

/** wavesrv's limit on a chunk's label. */
export const MAX_CHUNK_LABEL = 200;

/** Pure: a parked launch as an initiative chunk, when the person would rather plan it than start it: the label is the
 *  row's title on one line (clipped to wavesrv's limit), and the note carries what the label leaves out (the rest of
 *  the task, the agent it was meant for, the screenshots' paths), or null when the label already says it all. */
export function parkedChunk(p: ParkedLaunch): { label: string; note: string | null } {
    const title = parkedTitle(p).replace(/\s+/g, " ").trim();
    const label = title.length <= MAX_CHUNK_LABEL ? title : `${title.slice(0, MAX_CHUNK_LABEL - 1).trimEnd()}…`;
    const task = p.task.trim();
    const images = p.images ?? [];
    const parts: string[] = [];
    if (task !== "" && task !== label) {
        parts.push(task);
    }
    if (images.length > 0) {
        parts.push(["Screenshots:", ...images.map((i) => `- ${i}`)].join("\n"));
    }
    if (parts.length === 0) {
        return { label, note: null };
    }
    parts.push(`Parked from New agent (${p.runtime}).`);
    return { label, note: parts.join("\n\n") };
}

/** Pure: the launcher's line while the machine is busy, naming the two ways on. */
export function busyLine(reason: string, parkKey: string, anywayKey: string): string {
    return `${reason}: ${parkKey} parks this agent for later, ${anywayKey} starts it anyway.`;
}
