// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resourcesOf } from "./sidecarresources";

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
        expect(resourcesOf(null, [])).toEqual({ state: "measuring", rows: [], others: [] });
        expect(resourcesOf(snap({ supported: false }), [])).toEqual({ state: "unsupported", rows: [], others: [] });
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
});
