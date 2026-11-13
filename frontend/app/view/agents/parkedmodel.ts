// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Held agents (the code's "parked launches"): a New agent launch arcterm holds because the machine is busy (memory
// pressure high or critical, or the CPU pegged) when the person launches it; one more agent then would push the machine
// to its peak. The dialog is the same as ever: its Launch agent holds the agent instead of starting it. A held agent
// keeps the dialog's project, agent, command, task and images, waits as a dashed row among its project's agents, and
// opens in the centre (heldpane.tsx) with Start now and a one-click Add to the initiative its task best matches. Nothing
// starts on its own when the machine calms down: the person starts it when they come back to it. Pure; parkedstore.ts
// holds the readings and the workspace meta, agenttree.tsx the row.

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

/** Pure: the row's name: the task's first line; with no task, the session it resumes, else the agent. */
export function parkedTitle(p: ParkedLaunch): string {
    const line = p.task
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l !== "");
    if (line != null) {
        return line;
    }
    return p.resumeof ? `Resume ${p.resumetitle || "session"}` : `New ${p.runtime} agent`;
}

/** Pure: what held it, as a row says it: "RAM" for memory pressure, "CPU" for a pegged CPU. */
function heldFor(p: ParkedLaunch): string {
    return p.reason?.startsWith("CPU") ? "CPU" : "RAM";
}

function imagesWord(n: number): string[] {
    return n === 0 ? [] : [n === 1 ? "1 image" : `${n} images`];
}

/** Pure: the row's second line, "held for RAM · resume · 2 images"; its age sits apart at the row's end. */
export function parkedMeta(p: ParkedLaunch): string {
    return [`held for ${heldFor(p)}`, ...(p.resumeof ? ["resume"] : []), ...imagesWord(p.images?.length ?? 0)].join(
        " · "
    );
}

/** Pure: the toast that says an agent was held, so a launch that started nothing is never silent. */
export function heldToast(p: ParkedLaunch): { title: string; message: string } {
    const why = p.reason ? `: ${p.reason.toLowerCase()}` : "";
    return {
        title: `${p.resumeof ? "Resume" : "Agent"} held${why}`,
        message: `${parkedTitle(p)}. It waits in its project's folder until you start it.`,
    };
}

/** Pure: how long it has been held, as the agent rows say an age ("3h", "<1m"). */
export function parkedAge(p: ParkedLaunch, now: number): string {
    return formatAgeShort(Math.max(0, now - p.ts));
}

/** Pure: the held view's divider line, its three parts: when ("Held 3h ago"), why ("memory pressure was high"), and
 *  what it costs ("uses no memory until you start it"). */
export function heldLine(p: ParkedLaunch, now: number): { when: string; why: string; cost: string } {
    const age = formatAgeShort(Math.max(0, now - p.ts));
    const reason = p.reason ?? "";
    const why = reason.startsWith("CPU")
        ? "the CPU was busy"
        : reason.startsWith("Memory pressure is ")
          ? `memory pressure was ${reason.slice("Memory pressure is ".length)}`
          : "the machine was busy";
    return {
        when: age === "<1m" ? "Held just now" : `Held ${age} ago`,
        why,
        cost: "uses no memory until you start it",
    };
}

/** Pure: how the machine is now, beside Start now: busy (the reason, "still"), calm with the free memory, or nothing
 *  to say with no reading. */
export function machineNow(
    reason: string | null,
    freeBytes: number | null,
    gb: (bytes: number) => string
): { tone: "busy" | "calm"; text: string } | null {
    if (reason != null) {
        return { tone: "busy", text: `${reason} still: starting it may make the machine lag` };
    }
    if (freeBytes == null) {
        return null;
    }
    return { tone: "calm", text: `Memory normal now · ${gb(freeBytes)} free` };
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
    parts.push(`Held from New agent (${p.runtime}).`);
    return { label, note: parts.join("\n\n") };
}

/** Pure: the launcher's line while the machine is busy: Launch agent holds the agent. */
export function busyLine(reason: string): string {
    return `${reason}: arcterm will hold this agent until you start it from its row.`;
}

// words too common to say which initiative a task belongs to
const STOP_WORDS =
    "the and for with from into onto that this then than when what which while where your you our are was were has " +
    "have had not but can its add fix make use new one two all any each per via out off too also";
const STOP = new Set(STOP_WORDS.split(" "));

/** Pure: a text's words worth matching: lowercased letters and digits (Vietnamese letters too), three or more long,
 *  common words left out. */
export function matchWords(text: string): Set<string> {
    const words: string[] = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** Pure: the initiative a held agent's task most likely belongs to, for the one-click Add: among the open initiatives
 *  of its project (none done or archived, and no topic, which gathers initiatives rather than holding chunks), the one
 *  whose title and chunk labels share the most words with the task; on a tie or no shared word, the most recently
 *  updated. Null when the project has none. Matching words costs nothing; a model would guess better, but it would
 *  start a process on a machine that was just too busy. */
export function suggestInitiative(
    task: string,
    project: string,
    efforts: readonly EffortSummary[]
): { oref: string; title: string } | null {
    const parents = new Set(efforts.flatMap((e) => (e.parentoid ? [`effort:${e.parentoid}`] : [])));
    const open = efforts.filter(
        (e) => e.project === project && e.status !== "done" && e.status !== "archived" && !parents.has(e.oref)
    );
    if (open.length === 0) {
        return null;
    }
    const want = matchWords(task);
    const score = (e: EffortSummary) => {
        const have = matchWords([e.title, ...(e.chunks ?? []).map((c) => c.label)].join(" "));
        let n = 0;
        for (const w of want) {
            if (have.has(w)) {
                n++;
            }
        }
        return n;
    };
    const best = open.map((e) => ({ e, n: score(e) })).sort((a, b) => b.n - a.n || b.e.updatedts - a.e.updatedts)[0].e;
    return { oref: best.oref, title: best.title };
}
