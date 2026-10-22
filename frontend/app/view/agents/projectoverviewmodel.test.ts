// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { askLine, changesLabel, doingLine, isQuiet, overviewRows } from "./projectoverviewmodel";

const vm = (id: string, over: Partial<AgentVM> = {}): AgentVM => ({ id, name: id, task: "", state: "idle", ...over });

describe("overviewRows", () => {
    const agents = [
        vm("a1", { project: "arc", state: "asking", blockedMs: 1_000 }),
        vm("a2", { project: "arc", state: "asking", blockedMs: 9_000 }),
        vm("w1", { project: "arc", state: "working" }),
        vm("i1", { project: "arc", state: "idle" }),
        vm("x1", { project: "other", state: "working" }),
    ];
    const terminals = [
        vm("t1", { project: "arc", kind: "terminal", running: true }),
        vm("t2", { project: "arc", kind: "terminal", running: false }),
        vm("t3", { project: "other", kind: "terminal", running: true }),
    ];

    it("keeps only the project's agents, asking longest-blocked first, then working", () => {
        const rows = overviewRows(agents, terminals, "arc");
        expect(rows.asking.map((a) => a.id)).toEqual(["a2", "a1"]);
        expect(rows.working.map((a) => a.id)).toEqual(["w1"]);
    });

    it("lists the project's terminals that run a command, never an idle shell", () => {
        expect(overviewRows(agents, terminals, "arc").terminals.map((t) => t.id)).toEqual(["t1"]);
    });

    it("leaves another project's rows out", () => {
        const rows = overviewRows(agents, terminals, "other");
        expect(rows.asking).toEqual([]);
        expect(rows.working.map((a) => a.id)).toEqual(["x1"]);
        expect(rows.terminals.map((t) => t.id)).toEqual(["t3"]);
    });
});

describe("isQuiet", () => {
    const empty = { asking: [], working: [], terminals: [] };
    it("is quiet with nothing asking, running or waiting", () => {
        expect(isQuiet(empty, 0)).toBe(true);
    });
    it("is not quiet while a Needs you item waits", () => {
        expect(isQuiet(empty, 1)).toBe(false);
    });
    it("is not quiet while a terminal runs", () => {
        expect(isQuiet({ ...empty, terminals: [vm("t")] }, 0)).toBe(false);
    });
});

describe("lines", () => {
    it("reads an ask's first question, else the activity", () => {
        expect(askLine(vm("a", { ask: { questions: [{ question: "Which table?" }] } }))).toBe("Which table?");
        expect(askLine(vm("a", { activity: "waiting on approval" }))).toBe("waiting on approval");
    });
    it("reads the live activity, else the task", () => {
        expect(doingLine(vm("a", { activity: "Editing x.ts", task: "t" }))).toBe("Editing x.ts");
        expect(doingLine(vm("a", { task: "Fix the row" }))).toBe("Fix the row");
    });
    it("reads a running terminal as a terminal: its name is already its command", () => {
        expect(doingLine(vm("t", { kind: "terminal", name: "sleep 30", running: true }))).toBe("terminal");
    });
    it("words the change count", () => {
        expect(changesLabel(null)).toBe("");
        expect(changesLabel({ files: 0 })).toBe("no uncommitted changes");
        expect(changesLabel({ files: 1 })).toBe("1 file");
        expect(changesLabel({ files: 6 })).toBe("6 files");
    });
});
