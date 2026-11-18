// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resource panel (the title bar's machine figures, clicked): what Sidecar itself, the rest of arcterm and each
// agent take in CPU and RAM, then the processes outside arcterm holding at least 200 MB. Built by the main window's
// bridge from a Resource Manager snapshot (pkg/resmon) and the pids the host says draw Sidecar's page (`sidecar_pids`).
// Pure: the bridge and the page both import it, the page for the types only.

import type { SidecarResourceRow, SidecarResources } from "./sidecartypes";

const MB = 1024 * 1024;

// rounded so the 2 s poll's jitter does not re-emit a snapshot for a change no one could read
function roundMem(bytes: number): number {
    return Math.round(bytes / MB) * MB;
}

function roundCpu(pct: number): number {
    return Math.round(pct * 10) / 10;
}

// a row's figures: none where the sampler could not read them (-1), CPU none before its second sample
function figures(cpu: number, mem: number, ready: boolean): Pick<SidecarResourceRow, "cpu" | "mem"> {
    return {
        ...(ready && cpu >= 0 ? { cpu: roundCpu(cpu) } : {}),
        ...(mem >= 0 ? { mem: roundMem(mem) } : {}),
    };
}

function sum(rows: ProcessInfo[], ready: boolean): Pick<SidecarResourceRow, "cpu" | "mem"> {
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
    return read ? figures(cpu, mem, ready) : {};
}

const byMemDesc = (a: SidecarResourceRow, b: SidecarResourceRow) =>
    (b.mem ?? -1) - (a.mem ?? -1) || a.label.localeCompare(b.label);

/**
 * The panel's rows. Sidecar first (the processes drawing its page), then the rest of arcterm (its host, wavesrv, the
 * shared WebView2 processes and the main window's page), then each agent and run command by RAM. A snapshot not in yet
 * reads as measuring; one off Windows, where pkg/resmon reads nothing, as unsupported.
 */
export function resourcesOf(snap: ResMonSnapshotData | null, sidecarPids: readonly number[]): SidecarResources {
    if (snap == null) {
        return { state: "measuring", rows: [], others: [] };
    }
    if (!snap.supported) {
        return { state: "unsupported", rows: [], others: [] };
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
        .map((g) => ({ key: g.key, label: g.label, kind: "agent" as const, ...figures(g.cpu, g.mem, ready) }))
        .sort(byMemDesc);
    const others: SidecarResourceRow[] = (snap.others ?? []).map((o) => ({
        key: `other:${o.name.toLowerCase()}`,
        label: o.name,
        kind: "other" as const,
        count: o.count,
        ...figures(o.cpu, o.mem, ready),
    }));
    return {
        state: ready ? "ready" : "measuring",
        rows: [sidecar, rest, ...agents],
        others,
        ...(snap.othersmin != null && snap.othersmin > 0 ? { othersMin: snap.othersmin } : {}),
    };
}
