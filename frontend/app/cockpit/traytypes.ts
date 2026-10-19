// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit sends the menu bar / tray popover and what it sends back (spec 2026-10-15-tray-popover-design.md).
// The popover (frontend/tauri/tray.tsx) holds no store of its own: traybridge.tsx builds a TraySnapshot from the
// cockpit's stores and emits it as tray:snapshot; the popover emits each click as a TrayAct on tray:act. Plain data
// only: it crosses a Tauri event.

export type TrayLevel = "normal" | "high" | "critical" | "unknown";
export type TrayPage = "main" | "freeup" | "storage";
export type TrayPlatform = "mac" | "win" | "other";

export interface TrayMachine {
    memTotal: number;
    memAvailable: number;
    pressure: TrayLevel;
    cpuPct: number | null; // the last second's whole-machine load, 0-100; null before wavesrv's first reading
    swapTotal: number; // not in memTotal; 0 with no swap file
    swapUsed: number;
    disks: TrayDisk[]; // the system disk first
}

export interface TrayDisk {
    name: string;
    root: string; // where its paths start: `C:\` or "/"
    total: number;
    free: number;
    arcBytes: number; // arcterm's share of it; 0 until Settings → Storage has scanned once
}

export interface TrayJob {
    id: string;
    name: string;
    bytes: number; // its peak RAM
    running: boolean;
    position: number | null; // its place in the queue while queued
    elapsedMs: number; // running for, or waiting for
    source: string; // the agent or run it belongs to
    reason: string; // why a queued job waits, or why a running one started past the queue; "" when there is nothing to say
    engine: boolean; // the engine's own job: no Skip
    canOpen: boolean;
}

export interface TrayWait {
    key: string;
    kind: string; // briefingmodel kindWord: "ask", "gate", "plan", "rule", …
    ask: boolean;
    title: string;
    tail: string;
}

export interface TrayUsage {
    pct: number;
    elapsedPct: number | null; // how much of the 5-hour window has passed, for the tick
    level: "ok" | "warn" | "hot";
    title: string; // the chip's tooltip: the reset and the week
}

export interface TrayStorageRow {
    category: string;
    title: string;
    bytes: number;
    detail: string;
    action: string | null; // the clean's verb when it cleans in place
    cleanableBytes: number;
    go: "settings" | "gallery" | null; // where it is cleaned one by one
}

export interface TrayStorage {
    arcBytes: number;
    cleanableBytes: number;
    storeBytes: number;
    rows: TrayStorageRow[];
    lastAuto: { bytes: number; ts: number; error: string } | null; // the last automatic clean; ts in ms
}

export interface TrayConsumerRow {
    blockId: string;
    name: string;
    kind: string; // the agent's kind, "Claude agent"
    bytes: number | null;
    heaviest: { pid: number; command: string; bytes: number } | null;
}

export interface TrayConsumers {
    rows: TrayConsumerRow[]; // heaviest first
    ownBytes: number | null; // arcterm's app, server and webview
    arcBytes: number | null; // the agents plus ownBytes
    otherBytes: number | null; // the rest of the used memory
}

export interface TraySnapshot {
    platform: TrayPlatform;
    machine: TrayMachine | null; // null until the first reading
    jobs: TrayJob[];
    jobsMode: string; // jobqueue.ts paceValue
    pausedLeftMs: number | null;
    waits: TrayWait[]; // at most five
    waitsMore: number;
    working: number;
    usage: TrayUsage | null;
    storage: TrayStorage | null; // null until Settings → Storage has scanned once
    consumers: TrayConsumers | null; // read only while Free up shows
    heardAt: number | null; // when the cockpit last got an answer from wavesrv: the offline page's "Last heard"
}

export type TrayAct =
    | { kind: "hello" } // the page has loaded, maybe still hidden (src-tauri/src/tray.rs builds it on a hover)
    | { kind: "shown" } // the page is on screen: the host logs the open's time
    | { kind: "page"; page: TrayPage }
    | { kind: "close" }
    | { kind: "open-arcterm" }
    | { kind: "open-wait"; key: string }
    | { kind: "open-more" }
    | { kind: "open-job"; id: string }
    | { kind: "open-agent"; blockId: string }
    | { kind: "open-storage-settings" }
    | { kind: "open-gallery" }
    | { kind: "open-tray-settings" }
    | { kind: "open-monitor" }
    | { kind: "run-now"; id: string }
    | { kind: "skip"; id: string }
    | { kind: "slots"; value: string }
    | { kind: "pause"; ms: number | null }
    | { kind: "stop"; blockId: string; pid: number }
    | { kind: "clean"; category: string }
    | { kind: "restart" }
    | { kind: "showlog" }
    | { kind: "quit" };
