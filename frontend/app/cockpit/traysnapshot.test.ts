// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    arcBytesByDisk,
    diskIndexOf,
    trayBadge,
    trayMemFree,
    traySnapshot,
    type TraySnapshotInput,
} from "./traysnapshot";

const GB = 1024 ** 3;
const NOW = 1_800_000_000_000;

function row(key: string, kind: string, source: string, detail: string | null): any {
    return { key, kind, source, detail, waitingsince: 0, primary: null, links: [], answers: [], form: null };
}

function input(over: Partial<TraySnapshotInput> = {}): TraySnapshotInput {
    return {
        platform: "mac",
        machine: {
            memtotal: 16 * GB,
            memavailable: 1.2 * GB,
            pressure: "high",
            cpupct: 38,
            swaptotal: 7 * GB,
            swapused: 6.3 * GB,
            disks: [{ name: "Macintosh HD", root: "/", total: 245 * GB, free: 127 * GB }],
        } as any,
        jobQueue: {
            slots: 1,
            mode: "auto",
            jobs: [
                {
                    id: "j2",
                    name: "task check:ts",
                    bytes: 1.6 * GB,
                    position: 1,
                    reason: "memory pressure high, one at a time",
                    queuedts: NOW - 40_000,
                    blockid: "b2",
                },
                {
                    id: "j1",
                    name: "go test ./pkg/orchestrate",
                    bytes: 2.1 * GB,
                    running: true,
                    queuedts: NOW - 90_000,
                    startedts: NOW - 72_000,
                    blockid: "b1",
                },
            ],
        } as any,
        agents: [
            { id: "a1", name: "tray-popover", blockId: "b1", state: "working", agent: "claude" },
            { id: "a2", name: "office-pixel-art", blockId: "b2", state: "asking", agent: "claude" },
            { id: "a3", name: "notes", blockId: "b3", state: "working" },
        ] as any,
        peekRows: [
            row("ask:1", "ask", "tray-popover", "Second webview or a native menu?"),
            row("plan:1", "plan-review", "Menu bar popover", null),
        ],
        donuts: [{ provider: "claude", fivehour: { pct: 62, reset: NOW / 1000 + 6480 }, week: { pct: 31 } }] as any,
        storage: {
            scannedts: NOW,
            scanning: false,
            storebytes: 0.6 * GB,
            categories: [
                { category: "runworktrees", bytes: 4.1 * GB, cleanablebytes: 4.1 * GB, items: [] },
                { category: "buildoutput", bytes: 9.6 * GB, cleanablebytes: 9.6 * GB, items: [] },
            ],
        } as any,
        consumers: null,
        heardAt: NOW - 3_000,
        now: NOW,
        ...over,
    };
}

describe("traySnapshot", () => {
    it("reads the machine and orders the jobs running first", () => {
        const s = traySnapshot(input());
        expect(s.machine?.pressure).toBe("high");
        expect(s.machine?.cpuPct).toBe(38);
        expect(s.machine).toMatchObject({ swapTotal: 7 * GB, swapUsed: 6.3 * GB });
        expect(s.heardAt).toBe(NOW - 3_000);
        expect(s.jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
        expect(s.jobs[0]).toMatchObject({ running: true, elapsedMs: 72_000, source: "tray-popover", reason: "" });
        expect(s.jobs[1]).toMatchObject({
            running: false,
            position: 1,
            elapsedMs: 40_000,
            reason: "memory pressure high, one at a time",
        });
    });
    it("keeps the reason of a running job that started past a paused queue", () => {
        const jobQueue = {
            slots: 1,
            mode: "auto",
            jobs: [
                {
                    id: "j1",
                    name: "task check:ts",
                    bytes: GB,
                    running: true,
                    reason: "started at once: the queue is paused",
                    queuedts: NOW - 5_000,
                    startedts: NOW - 5_000,
                },
            ],
        } as any;
        const s = traySnapshot(input({ jobQueue }));
        expect(s.jobs[0]).toMatchObject({ running: true, reason: "started at once: the queue is paused" });
    });
    it("turns peek rows into waits: the question as title, its asker as tail", () => {
        const s = traySnapshot(input());
        expect(s.waits[0]).toEqual({
            key: "ask:1",
            kind: "ask",
            ask: true,
            title: "Second webview or a native menu?",
            tail: "tray-popover",
        });
        expect(s.waits[1]).toEqual({ key: "plan:1", kind: "plan", ask: false, title: "Menu bar popover", tail: "" });
        expect(s.working).toBe(2);
    });
    it("caps waits at five and counts the rest", () => {
        const rows = Array.from({ length: 7 }, (_, i) => row(`k${i}`, "ask", "a", `q${i}`));
        const s = traySnapshot(input({ peekRows: rows }));
        expect(s.waits).toHaveLength(5);
        expect(s.waitsMore).toBe(2);
    });
    it("reads Claude's 5h window, and leaves the chip out with no reading", () => {
        const s = traySnapshot(input());
        expect(s.usage?.pct).toBe(62);
        expect(s.usage?.elapsedPct).toBeCloseTo(64, 5); // 1h48m left of 5h: a percent, not windowElapsed's fraction
        expect(s.usage?.level).toBe("warn");
        expect(s.usage?.title).toContain("week 31%");
        expect(traySnapshot(input({ donuts: [] })).usage).toBeNull();
    });
    it("sums storage: arcterm is every category plus the store; only in-place cleans count as cleanable", () => {
        const s = traySnapshot(input());
        expect(s.storage?.arcBytes).toBeCloseTo(14.3 * GB, -3);
        expect(s.storage?.cleanableBytes).toBeCloseTo(4.1 * GB, -3);
        expect(s.storage?.rows.find((r) => r.category === "buildoutput")).toMatchObject({
            action: null,
            go: "settings",
        });
        expect(traySnapshot(input({ storage: null })).storage).toBeNull();
        const base = input().storage as StorageReport;
        const caches = {
            ...base,
            categories: [
                ...(base.categories ?? []),
                { category: "packagecaches", bytes: 5 * GB, cleanablebytes: 5 * GB, items: [] },
            ],
        };
        const shared = traySnapshot(input({ storage: caches })).storage;
        expect(shared?.arcBytes).toBeCloseTo(14.3 * GB, -3);
        expect(shared?.rows.some((r) => r.category === "packagecaches")).toBe(false);
    });
    it("places a path on the disk whose root it starts with, the system disk when none", () => {
        const roots = ["C:\\", "D:\\"];
        expect(diskIndexOf("D:\\work\\arcterm\\.worktrees\\x", roots)).toBe(1);
        expect(diskIndexOf("d:/work/arcterm", roots)).toBe(1);
        expect(diskIndexOf("C:\\Users\\me\\.claude", roots)).toBe(0);
        expect(diskIndexOf("E:\\elsewhere", roots)).toBe(0);
        expect(diskIndexOf("/Users/me/code", ["/"])).toBe(0);
    });
    it("splits arcterm's bytes by disk: the store and what no item holds go to the system disk", () => {
        const cats = [
            {
                category: "runworktrees",
                bytes: 5 * GB,
                cleanablebytes: 0,
                items: [{ id: "w", kind: "worktree", label: "w", path: "D:\\repo\\.worktrees\\w", bytes: 4 * GB }],
            },
            {
                category: "housekeeping",
                bytes: 2 * GB,
                cleanablebytes: 0,
                items: [{ id: "webviewcache", kind: "webviewcache", label: "cache", bytes: 2 * GB }],
            },
        ] as StorageCategoryReport[];
        const out = arcBytesByDisk(["C:\\", "D:\\"], cats, 1 * GB);
        expect(out[0]).toBeCloseTo(4 * GB, -3); // store 1 + cache 2 + the worktree category's unplaced 1
        expect(out[1]).toBeCloseTo(4 * GB, -3);
        expect(arcBytesByDisk([], cats, GB)).toEqual([]);
    });
    it("gives each disk its arcterm share, all of it on a Mac's one disk", () => {
        const s = traySnapshot(input());
        expect(s.machine?.disks).toHaveLength(1);
        expect(s.machine?.disks[0].arcBytes).toBeCloseTo(s.storage!.arcBytes, -3);
        expect(traySnapshot(input({ storage: null })).machine?.disks[0].arcBytes).toBe(0);
    });
    it("carries the last automatic clean, and null without one", () => {
        const storage = {
            scannedts: NOW,
            storebytes: 0,
            categories: [],
            lastauto: { ts: NOW - 3_600_000, reclaimed: 2 * GB },
        } as any;
        expect(traySnapshot(input({ storage })).storage?.lastAuto).toEqual({
            bytes: 2 * GB,
            ts: NOW - 3_600_000,
            error: "",
        });
        const failed = { ...storage, lastauto: { ts: NOW, reclaimed: 0, error: "disk is read-only" } };
        expect(traySnapshot(input({ storage: failed })).storage?.lastAuto).toEqual({
            bytes: 0,
            ts: NOW,
            error: "disk is read-only",
        });
        expect(traySnapshot(input()).storage?.lastAuto).toBeNull();
    });
    it("names consumers from the roster, heaviest first, and splits off other apps", () => {
        const consumers = {
            totalbytes: 16 * GB,
            availablebytes: 1.2 * GB,
            windowms: 0,
            agents: [
                {
                    tabid: "",
                    blockid: "b2",
                    rambytes: 2.1 * GB,
                    tokensread: false,
                    heaviest: { pid: 4202, command: "npm run dev", bytes: 1.4 * GB },
                },
                { tabid: "", blockid: "b1", rambytes: 3.0 * GB, tokensread: false },
            ],
            interfacebytes: 0.3 * GB,
            serverbytes: 0.2 * GB,
            hostbytes: 0.1 * GB,
        } as any;
        const s = traySnapshot(input({ consumers }));
        expect(s.consumers?.rows.map((r) => r.name)).toEqual(["tray-popover", "office-pixel-art"]);
        expect(s.consumers?.rows[1].heaviest).toEqual({ pid: 4202, command: "npm run dev", bytes: 1.4 * GB });
        expect(s.consumers?.ownBytes).toBeCloseTo(0.6 * GB, -3);
        expect(s.consumers?.arcBytes).toBeCloseTo(5.7 * GB, -3);
        expect(s.consumers?.otherBytes).toBeCloseTo(9.1 * GB, -3);
    });
    it("words each consumer's kind from its agent, and falls back to 'Agent'", () => {
        const consumers = {
            totalbytes: 16 * GB,
            availablebytes: 8 * GB,
            windowms: 0,
            agents: [
                { tabid: "", blockid: "b1", rambytes: 2 * GB, tokensread: false },
                { tabid: "", blockid: "b3", rambytes: 1 * GB, tokensread: false },
                { tabid: "", blockid: "gone", rambytes: 0.5 * GB, tokensread: false },
            ],
        } as any;
        const s = traySnapshot(input({ consumers }));
        expect(s.consumers?.rows.map((r) => [r.name, r.kind])).toEqual([
            ["tray-popover", "Claude agent"],
            ["notes", "Agent"],
            ["agent", "Agent"],
        ]);
    });
});

describe("trayBadge", () => {
    it("counts what waits and raises the dot only at critical", () => {
        expect(trayBadge([row("a", "ask", "x", "q")], "critical")).toEqual({ count: 1, alert: true });
        expect(trayBadge([], "high")).toEqual({ count: 0, alert: false });
    });
});

describe("traySnapshot's CPU", () => {
    it("has no load before wavesrv's first reading", () => {
        const m = input().machine!;
        const { cpupct: _, ...noCpu } = m;
        expect(traySnapshot(input({ machine: noCpu as any })).machine?.cpuPct).toBeNull();
    });
});

describe("trayMemFree", () => {
    it("sends the memory free while the setting is on and wavesrv has a reading", () => {
        expect(trayMemFree(true, 1.1 * 2 ** 30)).toBe(1.1 * 2 ** 30);
        expect(trayMemFree(false, 1.1 * 2 ** 30)).toBeNull();
        expect(trayMemFree(true, 0)).toBeNull();
    });
});
