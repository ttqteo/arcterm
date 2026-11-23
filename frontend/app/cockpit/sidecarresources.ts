// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resource panel (the title bar's machine figures, clicked): what Sidecar itself, the rest of arcterm and each
// agent take in CPU and RAM, then the processes outside arcterm holding at least 200 MB. Built by the main window's
// bridge from a Resource Manager snapshot (pkg/resmon) and the pids the host says draw Sidecar's page (`sidecar_pids`).
// Pure: the bridge and the page both import it, the page for the types and `resourcesLost`.

import type { SidecarResourcePoint, SidecarResourceRow, SidecarResources } from "./sidecartypes";

const MB = 1024 * 1024;
/** How far back the charts reach. */
export const HISTORY_MS = 5 * 60_000;

// rounded so the 2 s poll's jitter does not re-emit a snapshot for a change no one could read
function roundMem(bytes: number): number {
    return Math.round(bytes / MB) * MB;
}

function roundCpu(pct: number): number {
    return Math.round(pct * 10) / 10;
}

type Figures = Pick<SidecarResourceRow, "cpu" | "mem" | "gpu">;

// a row's figures: none where the sampler could not read them (-1), CPU none before its second sample, GPU none at 0
function figures(cpu: number, mem: number, ready: boolean, gpu = 0): Figures {
    return {
        ...(ready && cpu >= 0 ? { cpu: roundCpu(cpu) } : {}),
        ...(mem >= 0 ? { mem: roundMem(mem) } : {}),
        ...(gpu >= 0.5 ? { gpu: Math.round(gpu) } : {}),
    };
}

// a group's GPU is its busiest process's, as Task Manager shows a group's
function gpuOf(rows: ProcessInfo[]): number {
    return rows.reduce((top, r) => Math.max(top, r.gpu ?? 0), 0);
}

function sum(rows: ProcessInfo[], ready: boolean): Figures {
    let cpu = 0;
    let mem = 0;
    let read = false;
    for (const r of rows) {
        if (r.mem >= 0) {
            mem += r.mem;
            read = true;
        }
        if (r.cpu > 0) {
            cpu += r.cpu;
        }
    }
    return read ? figures(cpu, mem, ready, gpuOf(rows)) : {};
}

/**
 * The charts' history with this snapshot's machine reading added, readings older than HISTORY_MS dropped. A snapshot
 * with no machine reading, not ready, or no newer than the last point leaves it as it was (the same array).
 */
export function pushHistory(
    history: readonly SidecarResourcePoint[],
    snap: ResMonSnapshotData | null,
    windowMs = HISTORY_MS
): SidecarResourcePoint[] {
    const m = snap?.machine;
    const last = history.at(-1);
    if (snap == null || m == null || !snap.ready || (last != null && snap.ts <= last.t)) {
        return history as SidecarResourcePoint[];
    }
    const point: SidecarResourcePoint = {
        t: snap.ts,
        cpu: Math.round(m.cpu),
        mem: m.memtotal > 0 ? Math.round((m.memused / m.memtotal) * 100) : 0,
        ...(m.gpu != null ? { gpu: Math.round(m.gpu) } : {}),
        ...(m.swaptotal != null && m.swaptotal > 0 ? { swap: roundMem(m.swapused ?? 0) } : {}),
    };
    const from = snap.ts - windowMs;
    return [...history.filter((p) => p.t >= from), point];
}

/** An other app's row key: its image name, case aside, as pkg/resmon groups them. */
export function otherKey(name: string): string {
    return `other:${name.toLowerCase()}`;
}

/** How long an End task's note stays on its row, ms. */
export const END_NOTE_MS = 8_000;

/**
 * What an End task came to, in the row's words: nothing when every process ended (the row leaves at the next reading,
 * and that is the answer), else why it did not, or how many did when some held out.
 */
export function endNote(rtn: ResMonKillRtnData | null, count: number | undefined): string | null {
    switch (rtn?.outcome) {
        case "killed":
            return count != null && rtn.killed < count ? `Ended ${rtn.killed} of ${count}` : null;
        case "gone":
            return "Already closed";
        case "refused":
            return "arcterm doesn't end this one";
        case "failed":
            return rtn.error ? `Couldn't end it: ${rtn.error}` : "Couldn't end it";
        default:
            return "Couldn't end it";
    }
}

const byMemDesc = (a: SidecarResourceRow, b: SidecarResourceRow) =>
    (b.mem ?? -1) - (a.mem ?? -1) || a.label.localeCompare(b.label);

/**
 * The panel's rows. Sidecar first (the processes drawing its page), then the rest of arcterm (its host, wavesrv, the
 * shared WebView2 processes and the main window's page), then each agent and run command by RAM. A snapshot not in yet
 * reads as measuring; one off Windows and macOS, where pkg/resmon reads nothing, as unsupported.
 */
export function resourcesOf(
    snap: ResMonSnapshotData | null,
    sidecarPids: readonly number[],
    history: SidecarResourcePoint[] = [],
    notes: ReadonlyMap<string, string> = new Map(),
    failed: string | null = null
): SidecarResources {
    if (snap == null) {
        return { state: "measuring", rows: [], others: [], history, ...(failed != null ? { failed } : {}) };
    }
    if (!snap.supported) {
        return { state: "unsupported", rows: [], others: [], history: [] };
    }
    const ready = snap.ready;
    const mine = new Set(sidecarPids);
    const arc = snap.groups.find((g) => g.ownerkind === "arc");
    const arcRows = arc?.rows ?? [];
    const sidecar: SidecarResourceRow = {
        key: "sidecar",
        label: "Sidecar",
        kind: "sidecar",
        ...(mine.size > 0
            ? sum(
                  arcRows.filter((r) => mine.has(r.pid)),
                  ready
              )
            : {}),
    };
    const rest: SidecarResourceRow = {
        key: "arcterm",
        label: "arcterm",
        kind: "arcterm",
        ...sum(
            arcRows.filter((r) => !mine.has(r.pid)),
            ready
        ),
    };
    const agents: SidecarResourceRow[] = snap.groups
        .filter((g) => g.ownerkind !== "arc")
        .map((g) => ({
            key: g.key,
            label: g.label,
            kind: "agent" as const,
            ...(g.runtime ? { runtime: g.runtime } : {}),
            ...figures(g.cpu, g.mem, ready, gpuOf(g.rows)),
        }))
        .sort(byMemDesc);
    const others: SidecarResourceRow[] = (snap.others ?? []).map((o) => {
        const key = otherKey(o.name);
        const note = notes.get(key);
        return {
            key,
            label: o.name,
            kind: "other" as const,
            count: o.count,
            ...(o.icon ? { icon: o.icon } : {}),
            ...(o.endable ? { endable: true } : {}),
            ...(note != null ? { note } : {}),
            ...figures(o.cpu, o.mem, ready, o.gpu ?? 0),
        };
    });
    return {
        state: ready ? "ready" : "measuring",
        rows: [sidecar, rest, ...agents],
        others,
        ...(snap.othersmin != null && snap.othersmin > 0 ? { othersMin: snap.othersmin } : {}),
        history,
        ...(snap.machine != null && snap.machine.memtotal > 0 ? { memTotal: snap.machine.memtotal } : {}),
        ...(snap.machine?.swaptotal != null && snap.machine.swaptotal > 0
            ? { swapTotal: roundMem(snap.machine.swaptotal) }
            : {}),
    };
}

/** Why a resources read failed, as the panel says it: a timeout (the backend busy, often with the machine at 100% CPU)
 *  in words, anything else as the error said it. */
export function readFailure(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return /timeout/i.test(msg) ? "the Resource Manager did not answer in time" : msg;
}

/**
 * Whether Sidecar's page must ask the bridge for the resources again: it wants them, and a snapshot that arrived after
 * its last ask carries none, so the bridge has dropped the panel. The bridge shuts it on every hello, and it says hello
 * on its own at mount when it finds Sidecar open (a main window reloaded, or arcterm restarted with Sidecar restored):
 * a hello that lands after the page's open act wiped it, and the panel sat on "Measuring…" until it was closed and
 * opened again. A snapshot from before the ask (`heardAt <= askedAt`) is not a refusal: the ask is on its way.
 */
export function resourcesLost(
    want: boolean,
    snap: { resources?: SidecarResources } | undefined,
    heardAt: number,
    askedAt: number
): boolean {
    return want && snap != null && snap.resources == null && heardAt > askedAt;
}

/**
 * The resources the page draws for its opening number `ask`: none (the panel or the column measures) until the bridge
 * answers that opening. A snapshot the bridge sent before it heard a close still carries the closed panel's or
 * column's readings and history, and drawn in a panel opened right after, it showed that stale history for about half
 * a second, then nothing (the close's snapshot), then the fresh series.
 */
export function resourcesFor(resources: SidecarResources | undefined, ask: number): SidecarResources | undefined {
    return resources != null && resources.ask === ask ? resources : undefined;
}
