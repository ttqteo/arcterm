// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Canned snapshots for tray.html?fixture=<name>: one per board of the tray-popover canvas, for the CDP scenarios
// (scripts/cdp/scenarios.mjs tray-*). Not data anyone sees in the app.

import type { TrayPage, TraySnapshot } from "@/app/cockpit/traytypes";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export interface TrayFixture {
    snapshot: TraySnapshot | null;
    page?: TrayPage;
    offline?: boolean;
    lastHeard?: number;
}

const CPU = [
    30, 35, 26, 41, 47, 38, 59, 65, 53, 44, 62, 71, 56, 47, 35, 50, 68, 74, 59, 41, 32, 44, 53, 38, 47, 35, 41, 38, 38,
];

const main: TraySnapshot = {
    platform: "mac",
    machine: {
        memTotal: 16 * GB,
        memAvailable: 1.2 * GB,
        pressure: "high",
        cpuPct: 38,
        cpuSamples: CPU,
        diskName: "Macintosh HD",
        diskTotal: 245 * GB,
        diskFree: 127 * GB,
    },
    jobs: [
        {
            id: "j1",
            name: "go test ./pkg/orchestrate",
            bytes: 2.1 * GB,
            running: true,
            position: null,
            elapsedMs: 72_000,
            source: "tray-popover",
            reason: "",
            engine: false,
            canOpen: true,
        },
        {
            id: "j2",
            name: "task check:ts",
            bytes: 1.6 * GB,
            running: false,
            position: 1,
            elapsedMs: 40_000,
            source: "office-pixel-art",
            reason: "memory pressure high, one at a time",
            engine: false,
            canOpen: true,
        },
    ],
    jobsMode: "auto",
    pausedLeftMs: null,
    waits: [
        { key: "ask:1", kind: "ask", ask: true, title: "Second webview or a native menu?", tail: "tray-popover" },
        {
            key: "ask:2",
            kind: "ask",
            ask: true,
            title: "Keep the 2× sprite scale, or redraw every sprite at 1× for the smaller office canvas?",
            tail: "office-pixel-art",
        },
        { key: "plan:1", kind: "plan", ask: false, title: "Menu bar popover", tail: "3 proposed" },
        { key: "rule:1", kind: "rule", ask: false, title: "Never run prettier on scripts/*.mjs", tail: "learned" },
    ],
    waitsMore: 0,
    working: 4,
    usage: { pct: 62, elapsedPct: 64, level: "warn", title: "Claude's 5-hour window: resets in 1h 48m · week 31%" },
    storage: {
        arcBytes: 16.4 * GB,
        cleanableBytes: 6.2 * GB,
        storeBytes: 0.6 * GB,
        rows: [
            {
                category: "runworktrees",
                title: "Run worktrees",
                bytes: 4.1 * GB,
                detail: "3 trees from finished runs. Their branches stay.",
                action: "Clean all",
                cleanableBytes: 4.1 * GB,
                go: null,
            },
            {
                category: "sessions",
                title: "Old Claude sessions",
                bytes: 1.3 * GB,
                detail: "Not touched in 30 days. Kept in the trash for 7 days.",
                action: "Move to trash",
                cleanableBytes: 1.3 * GB,
                go: null,
            },
            {
                category: "housekeeping",
                title: "Logs, cache and trash",
                bytes: 0.8 * GB,
                detail: "Rolled logs, the session trash and the interface cache.",
                action: "Clean",
                cleanableBytes: 0.8 * GB,
                go: null,
            },
            {
                category: "buildoutput",
                title: "Build output",
                bytes: 9.6 * GB,
                detail: "node_modules, target, dist in 4 projects. Cleaned per project.",
                action: null,
                cleanableBytes: 0,
                go: "settings",
            },
            {
                category: "canvases",
                title: "Design canvases",
                bytes: 12 * MB,
                detail: "9 canvases. Cleaned one by one in the gallery.",
                action: null,
                cleanableBytes: 0,
                go: "gallery",
            },
        ],
        lastAuto: { bytes: 1.1 * GB, ts: new Date().setHours(9, 12, 0, 0), error: "" },
    },
    consumers: {
        rows: [
            {
                blockId: "b1",
                name: "tray-popover",
                kind: "Claude agent",
                bytes: 3.0 * GB,
                heaviest: { pid: 4101, command: "go test ./pkg/orchestrate", bytes: 2.1 * GB },
            },
            {
                blockId: "b2",
                name: "office-pixel-art",
                kind: "Claude agent",
                bytes: 2.1 * GB,
                heaviest: { pid: 4202, command: "npm run dev", bytes: 1.4 * GB },
            },
            { blockId: "b3", name: "notes-cleanup", kind: "Claude agent", bytes: 0.4 * GB, heaviest: null },
        ],
        ownBytes: 0.6 * GB,
        arcBytes: 6.1 * GB,
        otherBytes: 8.7 * GB,
    },
    heardAt: null,
};

const quiet: TraySnapshot = {
    ...main,
    machine: {
        ...main.machine!,
        pressure: "normal",
        memAvailable: 9.4 * GB,
        cpuPct: 6,
        cpuSamples: Array.from({ length: 29 }, () => 6),
        diskFree: 131 * GB,
    },
    storage: { ...main.storage!, arcBytes: 12.1 * GB, cleanableBytes: 0.3 * GB },
    jobs: [],
    waits: [],
    working: 2,
    usage: { pct: 12, elapsedPct: 22, level: "ok", title: "Claude's 5-hour window: resets in 3h 54m · week 33%" },
};

const critical: TraySnapshot = {
    ...main,
    machine: { ...main.machine!, pressure: "critical", memAvailable: 0.3 * GB, cpuPct: 71 },
    jobs: [
        { ...main.jobs[0], elapsedMs: 220_000 },
        {
            id: "j2",
            name: "task check:ts",
            bytes: 1.6 * GB,
            running: false,
            position: 1,
            elapsedMs: 125_000,
            source: "office-pixel-art",
            reason: "memory pressure critical",
            engine: false,
            canOpen: true,
        },
        {
            id: "j3",
            name: "npm run build",
            bytes: 1.2 * GB,
            running: false,
            position: 2,
            elapsedMs: 50_000,
            source: "notes-cleanup",
            reason: "memory pressure critical",
            engine: false,
            canOpen: true,
        },
    ],
};

const paused: TraySnapshot = {
    ...main,
    machine: { ...main.machine!, pressure: "normal", memAvailable: 5.8 * GB, cpuPct: 52 },
    pausedLeftMs: 52 * 60_000,
    jobs: [
        main.jobs[0],
        {
            ...main.jobs[1],
            running: true,
            position: null,
            reason: "started at once: the queue is paused",
            elapsedMs: 40_000,
        },
    ],
    usage: { pct: 91, elapsedPct: 92, level: "hot", title: "Claude's 5-hour window: resets in 22m · week 78%" },
};

const windows: TraySnapshot = {
    ...main,
    platform: "win",
    machine: {
        ...main.machine!,
        memTotal: 32 * GB,
        memAvailable: 2.4 * GB,
        diskName: "Local Disk (C:)",
        diskTotal: 476 * GB,
        diskFree: 312 * GB,
    },
    storage: { ...main.storage!, arcBytes: 19.0 * GB, cleanableBytes: 7.4 * GB },
};

export const TRAY_FIXTURES: Record<string, TrayFixture> = {
    main: { snapshot: main },
    freeup: { snapshot: main, page: "freeup" },
    storage: { snapshot: main, page: "storage" },
    quiet: { snapshot: quiet },
    critical: { snapshot: critical },
    paused: { snapshot: paused },
    // local time, so the offline page's clock reads 14:29 in any zone
    offline: { snapshot: null, offline: true, lastHeard: new Date(2026, 9, 15, 14, 29).getTime() },
    windows: { snapshot: windows },
};
