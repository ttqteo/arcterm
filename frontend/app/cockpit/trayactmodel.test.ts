// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { trayActPlan, type TrayActContext } from "./trayactmodel";
import type { TrayAct } from "./traytypes";

const NOW = 1_800_000_000_000;

const open = { id: "p1", verb: "open", label: "Open", target: { kind: "oref", ref: "agent:a1" } };

function ctx(over: Partial<TrayActContext> = {}): TrayActContext {
    return {
        peekRows: [
            {
                key: "ask:1",
                kind: "ask",
                source: "x",
                detail: "q",
                waitingsince: 0,
                primary: open,
                links: [],
                answers: [],
                form: null,
            },
            {
                key: "gate:1",
                kind: "dag-gate",
                source: "run",
                detail: null,
                waitingsince: 0,
                primary: { id: "g", verb: "approve-task", label: "Approve" },
                links: [open],
                answers: [],
                form: null,
            },
        ] as any,
        agents: [{ id: "a1", name: "alpha", blockId: "b1", state: "working" }] as any,
        jobQueue: {
            slots: 1,
            mode: "auto",
            jobs: [
                { id: "j1", name: "task check:ts", bytes: 1, queuedts: NOW, blockid: "b1" },
                { id: "j2", name: "no owner", bytes: 1, queuedts: NOW },
            ],
        } as any,
        storage: {
            scannedts: NOW,
            categories: [
                {
                    category: "sessions",
                    bytes: 3,
                    items: [
                        { id: "s1", cleanable: true },
                        { id: "s2", cleanable: true, guarded: true },
                        { id: "s3", cleanable: false },
                    ],
                },
                { category: "runworktrees", bytes: 2, items: [{ id: "w1", cleanable: true }] },
            ],
        } as any,
        now: NOW,
        ...over,
    };
}

const plan = (act: TrayAct, over?: Partial<TrayActContext>) => trayActPlan(act, ctx(over));

describe("trayActPlan", () => {
    it("lands settings and surfaces after raising the window", () => {
        expect(plan({ kind: "open-tray-settings" })).toEqual({
            raise: true,
            step: { kind: "settings", section: "general" },
        });
        expect(plan({ kind: "open-storage-settings" })).toEqual({
            raise: true,
            step: { kind: "settings", section: "storage" },
        });
        expect(plan({ kind: "open-more" })).toEqual({ raise: true, step: { kind: "surface", surface: "jarvis" } });
        expect(plan({ kind: "open-gallery" })).toEqual({ raise: true, step: { kind: "gallery" } });
        expect(plan({ kind: "open-arcterm" })).toEqual({ raise: true, step: { kind: "nothing" } });
    });
    it("opens a wait through its own open escort, or only raises when it has none", () => {
        expect(plan({ kind: "open-wait", key: "ask:1" })).toEqual({ raise: true, step: { kind: "act", act: open } });
        expect(plan({ kind: "open-wait", key: "gate:1" })).toEqual({ raise: true, step: { kind: "act", act: open } });
        expect(plan({ kind: "open-wait", key: "gone" })).toEqual({ raise: true, step: { kind: "nothing" } });
    });
    it("opens a job's target and an agent by block id", () => {
        expect(plan({ kind: "open-job", id: "j1" })).toEqual({
            raise: true,
            step: { kind: "target", target: { kind: "agent", tabId: "a1" } },
        });
        expect(plan({ kind: "open-job", id: "j2" })).toEqual({ raise: true, step: { kind: "nothing" } });
        expect(plan({ kind: "open-agent", blockId: "b1" })).toEqual({
            raise: true,
            step: {
                kind: "act",
                act: { id: "tray:a1", verb: "open", label: "Open", target: { kind: "oref", ref: "agent:a1" } },
            },
        });
        expect(plan({ kind: "open-agent", blockId: "gone" })).toEqual({ raise: true, step: { kind: "nothing" } });
    });
    it("runs the queue's controls without raising the window", () => {
        expect(plan({ kind: "run-now", id: "j1" })).toEqual({ raise: false, step: { kind: "run-now", id: "j1" } });
        expect(plan({ kind: "skip", id: "j1" })).toEqual({ raise: false, step: { kind: "skip", id: "j1" } });
        expect(plan({ kind: "slots", value: "2" })).toEqual({
            raise: false,
            step: { kind: "config", patch: { "jobs:mode": "slots", "jobs:slots": 2 } },
        });
        expect(plan({ kind: "pause", ms: 3_600_000 })).toEqual({
            raise: false,
            step: { kind: "config", patch: { "jobs:pauseuntil": NOW + 3_600_000 } },
        });
        expect(plan({ kind: "pause", ms: null })).toEqual({
            raise: false,
            step: { kind: "config", patch: { "jobs:pauseuntil": 0 } },
        });
    });
    it("stops a process by its block and pid", () => {
        expect(plan({ kind: "stop", blockId: "b1", pid: 4202 })).toEqual({
            raise: false,
            step: { kind: "stop", blockid: "b1", pid: 4202 },
        });
    });
    it("cleans a category's cleanable, unguarded items, and gives sessions their age", () => {
        expect(plan({ kind: "clean", category: "sessions" })).toEqual({
            raise: false,
            step: { kind: "clean", category: "sessions", itemids: ["s1"], olderthandays: 30 },
        });
        expect(plan({ kind: "clean", category: "runworktrees" })).toEqual({
            raise: false,
            step: { kind: "clean", category: "runworktrees", itemids: ["w1"], olderthandays: undefined },
        });
        expect(plan({ kind: "clean", category: "runworktrees" }, { storage: null })).toMatchObject({
            step: { itemids: [] },
        });
    });
    it("keeps the popover's own state moves local", () => {
        expect(plan({ kind: "hello" })).toEqual({ raise: false, step: { kind: "hello" } });
        expect(plan({ kind: "page", page: "freeup" })).toEqual({
            raise: false,
            step: { kind: "page", page: "freeup" },
        });
    });
    it("leaves what only the host can do to the host", () => {
        for (const kind of ["close", "restart", "quit", "showlog", "open-monitor"] as const) {
            expect(plan({ kind })).toBeNull();
        }
    });
});
