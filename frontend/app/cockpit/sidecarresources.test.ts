// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pushHistory, resourcesOf } from "./sidecarresources";

const MB = 1024 * 1024;

function row(pid: number, mem: number, cpu = 0): ProcessInfo {
    return { pid, depth: 0, mem, mempct: -1, cpu, numthreads: -1 } as ProcessInfo;
}

function group(ownerkind: string, key: string, label: string, rows: ProcessInfo[], cpu = 0, mem = 0): ResMonGroup {
    return { key, ownerkind, label, killable: false, cpu, mem, rows };
}

function snap(over: Partial<ResMonSnapshotData> = {}): ResMonSnapshotData {
    return {
        supported: true,
        ready: true,
        ts: 1,
        cpu: 0,
        mem: 0,
        totalmem: 16 * 1024 * MB,
        busycpu: false,
        busymem: false,
        groups: [],
        ...over,
    };
}

describe("resourcesOf", () => {
    it("reads measuring before a snapshot and unsupported off Windows", () => {
        expect(resourcesOf(null, [])).toEqual({ state: "measuring", rows: [], others: [], history: [] });
        expect(resourcesOf(snap({ supported: false }), [])).toEqual({
            state: "unsupported",
            rows: [],
            others: [],
            history: [],
        });
    });

    it("splits Sidecar's renderer out of arcterm's processes and lists agents by RAM", () => {
        const s = snap({
            groups: [
                group("arc", "arc", "arcterm", [
                    row(10, 100 * MB, 1),
                    row(11, 900 * MB, 4.04),
                    row(12, 150 * MB, 0.5),
                    row(13, -1),
                ]),
                group("agenttab", "job:1:1", "small agent", [], 2, 200 * MB),
                group("agenttab", "job:2:2", "big agent", [], 10, 800 * MB),
            ],
        });
        const r = resourcesOf(s, [12]);
        expect(r.state).toBe("ready");
        expect(r.rows.map((x) => [x.label, x.cpu, x.mem])).toEqual([
            ["Sidecar", 0.5, 150 * MB],
            ["arcterm", 5, 1000 * MB],
            ["big agent", 10, 800 * MB],
            ["small agent", 2, 200 * MB],
        ]);
    });

    it("leaves Sidecar's figures out when the host named no process", () => {
        const s = snap({ groups: [group("arc", "arc", "arcterm", [row(10, 100 * MB)])] });
        const sidecar = resourcesOf(s, []).rows[0];
        expect(sidecar).toEqual({ key: "sidecar", label: "Sidecar", kind: "sidecar" });
    });

    it("has no CPU before the second sample", () => {
        const s = snap({ ready: false, groups: [group("arc", "arc", "arcterm", [row(10, 100 * MB, 3)])] });
        const r = resourcesOf(s, [10]);
        expect(r.state).toBe("measuring");
        expect(r.rows[0]).toEqual({ key: "sidecar", label: "Sidecar", kind: "sidecar", mem: 100 * MB });
    });

    it("carries the heavy processes outside arcterm with their count and threshold", () => {
        const s = snap({
            others: [{ name: "chrome.exe", count: 12, cpu: 1.26, mem: 1057.8 * MB }],
            othersmin: 200 * MB,
        });
        const r = resourcesOf(s, []);
        expect(r.others).toEqual([
            { key: "other:chrome.exe", label: "chrome.exe", kind: "other", count: 12, cpu: 1.3, mem: 1058 * MB },
        ]);
        expect(r.othersMin).toBe(200 * MB);
    });

    it("carries an agent's runtime and an other app's icon, for the rows' marks", () => {
        const icon = "data:image/png;base64,AA==";
        const s = snap({
            groups: [{ ...group("agenttab", "job:1:1", "agent", [], 1, 10 * MB), runtime: "claude" }],
            others: [
                { name: "chrome.exe", count: 1, cpu: 0, mem: 300 * MB, icon },
                { name: "vmmem", count: 1, cpu: 0, mem: 300 * MB },
            ],
        });
        const r = resourcesOf(s, []);
        expect(r.rows[2].runtime).toBe("claude");
        expect(r.others.map((o) => o.icon)).toEqual([icon, undefined]);
        expect("icon" in r.others[1]).toBe(false);
    });

    it("takes a group's GPU from its busiest process, and leaves an idle GPU out", () => {
        const busy = { ...row(10, 100 * MB), gpu: 12.4 } as ProcessInfo;
        const s = snap({
            groups: [
                group("arc", "arc", "arcterm", [busy, { ...row(11, 50 * MB), gpu: 3 } as ProcessInfo]),
                group("agenttab", "job:1:1", "agent", [row(20, 10 * MB)], 1, 10 * MB),
            ],
        });
        const r = resourcesOf(s, [10]);
        expect(r.rows[0].gpu).toBe(12);
        expect(r.rows[1].gpu).toBe(3);
        expect(r.rows[2].gpu).toBeUndefined();
    });
});

describe("pushHistory", () => {
    const machine = (cpu: number, used: number, gpu?: number) => ({
        cpu,
        memused: used * MB,
        memtotal: 1000 * MB,
        ...(gpu != null ? { gpu } : {}),
    });

    it("adds a reading as whole percents and drops what is older than the window", () => {
        let h = pushHistory([], snap({ ts: 1000, machine: machine(12.6, 250, 40.4) }), 3000);
        h = pushHistory(h, snap({ ts: 3000, machine: machine(20, 500) }), 3000);
        expect(h).toEqual([
            { t: 1000, cpu: 13, mem: 25, gpu: 40 },
            { t: 3000, cpu: 20, mem: 50 },
        ]);
        h = pushHistory(h, snap({ ts: 5000, machine: machine(30, 750) }), 3000);
        expect(h.map((p) => p.t)).toEqual([3000, 5000]);
    });

    it("keeps the same history for a snapshot with no reading, not ready, or not newer", () => {
        const h = pushHistory([], snap({ ts: 1000, machine: machine(1, 1) }));
        expect(pushHistory(h, null)).toBe(h);
        expect(pushHistory(h, snap({ ts: 2000 }))).toBe(h);
        expect(pushHistory(h, snap({ ts: 2000, ready: false, machine: machine(1, 1) }))).toBe(h);
        expect(pushHistory(h, snap({ ts: 1000, machine: machine(1, 1) }))).toBe(h);
    });
});
