// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { buildAgentTree } from "./agenttreemodel";
import {
    askLine,
    changesLabel,
    doingLine,
    finishedRows,
    historyCounts,
    historyItems,
    isQuiet,
    overviewRows,
    projectSessions,
    runningCount,
    type HistoryItem,
} from "./projectoverviewmodel";
import type { Lineage, RunInfo } from "./runlineage";
import type { LiveSession } from "./sessionsarchivestore";

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
    const empty = { asking: [], working: [], terminals: [], runs: [] };
    it("is quiet with nothing asking, running or waiting", () => {
        expect(isQuiet(empty, 0)).toBe(true);
    });
    it("is quiet only when Finished is empty too", () => {
        expect(isQuiet(empty, 0, 1)).toBe(false);
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

describe("overviewRows with runs", () => {
    const a = (over: Partial<AgentVM>) =>
        ({ id: "a", name: "a", task: "", state: "working", kind: "claude", project: "arc", ...over }) as AgentVM;
    const lineage: Lineage = {
        roles: {
            lead: { kind: "lead", runId: "r1" },
            w1: { kind: "worker", leadRunId: "r1", taskId: "t-1" },
            w2: { kind: "worker", leadRunId: "r1", taskId: "t-2" },
            v: { kind: "stage", leadRunId: "r1", stageRole: "verifier" },
            ow: { kind: "worker", leadRunId: "r2", taskId: "t-1" },
        },
        runs: {
            r1: {
                runId: "r1",
                channelId: "c",
                title: "Ship it",
                project: "arc",
                dag: {
                    tasks: [
                        { id: "t-1", state: "done" },
                        { id: "t-2", state: "running" },
                    ],
                },
            } as RunInfo,
            r2: { runId: "r2", channelId: "c2", title: "Other", project: "other" } as RunInfo,
        },
    };
    // w1 still works on a task that is done: the tree does not count it, so neither does the Overview
    const agents = [
        a({ id: "plain" }),
        a({ id: "lead", state: "idle" }),
        a({ id: "w1", project: "r1-t-1" }),
        a({ id: "w2", project: "r1-t-2" }),
        a({ id: "v", project: "r1" }),
        a({ id: "ow", project: "arc" }),
    ];

    it("puts a run's members under its run, whatever their worktree project, and leaves another project's run out", () => {
        const rows = overviewRows(agents, [], "arc", lineage);
        expect(rows.working.map((x) => x.id)).toEqual(["plain"]);
        expect(rows.runs.map((r) => [r.run.runId, r.lead?.id, r.working, r.total])).toEqual([["r1", "lead", 2, 4]]);
    });

    it("counts the working agents as the tree folder's badge does", () => {
        const rows = overviewRows(agents, [], "arc", lineage);
        const group = buildAgentTree(
            agents,
            agents.map((x) => x.id),
            lineage
        ).find((r) => r.kind === "group" && r.project === "arc");
        expect(group?.kind === "group" ? group.running : -1).toBe(3);
        expect(runningCount(rows)).toBe(3);
    });

    it("counts a working lead as the tree does", () => {
        const rows = overviewRows(
            agents.map((x) => (x.id === "lead" ? { ...x, state: "working" as const } : x)),
            [],
            "arc",
            lineage
        );
        expect(rows.runs[0].working).toBe(3);
    });

    it("drops a run none of whose members works", () => {
        const idle = agents.map((x) => (x.id === "plain" ? x : { ...x, state: "idle" as const }));
        expect(overviewRows(idle, [], "arc", lineage).runs).toEqual([]);
    });

    it("drops a run whose only worker works on a task that is done", () => {
        const onDone = agents.map((x) => (x.id === "w1" ? x : { ...x, state: "idle" as const }));
        expect(overviewRows(onDone, [], "arc", lineage).runs).toEqual([]);
    });

    it("lists a run's asking members under Asking, as the project's own agents", () => {
        const asking = agents.map((x) => (x.id === "w2" ? { ...x, state: "asking" as const } : x));
        expect(overviewRows(asking, [], "arc", lineage).asking.map((x) => x.id)).toEqual(["w2"]);
    });

    it("places a run by its lead's project, as the tree does, not by the run's", () => {
        const moved: Lineage = {
            roles: { lead: lineage.roles.lead, w2: lineage.roles.w2 },
            runs: { r1: lineage.runs.r1 },
        };
        const inWorktree = [a({ id: "lead", project: "wt" }), a({ id: "w2", project: "r1-t-2" })];
        const tree = buildAgentTree(
            inWorktree,
            inWorktree.map((x) => x.id),
            moved
        );
        const groups = tree.flatMap((r) => (r.kind === "group" ? [[r.project, r.running]] : []));
        expect(groups).toEqual([["wt", 2]]);
        expect(runningCount(overviewRows(inWorktree, [], "wt", moved))).toBe(2);
        expect(overviewRows(inWorktree, [], "arc", moved).runs).toEqual([]);
    });
});

describe("finishedRows", () => {
    const a = (over: Partial<AgentVM>) =>
        ({ id: "a", name: "a", task: "", state: "idle", kind: "claude", project: "p", ...over }) as AgentVM;
    it("lists the project's idle agents with an unread turn, newest first", () => {
        const agents = [
            a({ id: "old", stateSince: 1 }),
            a({ id: "new", stateSince: 5 }),
            a({ id: "read", stateSince: 9 }),
            a({ id: "asking", state: "asking" }),
            a({ id: "elsewhere", project: "q" }),
        ];
        const unread = new Map([
            ["old", 1],
            ["new", 2],
            ["asking", 1],
            ["elsewhere", 1],
        ]);
        expect(finishedRows(agents, "p", unread).map((x) => x.id)).toEqual(["new", "old"]);
    });
    it("orders by idleSince when the idle agents carry no stateSince, as agentVMFromInput builds them", () => {
        const agents = [a({ id: "old", idleSince: 100 }), a({ id: "new", idleSince: 500 })];
        const unread = new Map([
            ["old", 1],
            ["new", 1],
        ]);
        expect(finishedRows(agents, "p", unread).map((x) => x.id)).toEqual(["new", "old"]);
    });
});

describe("projectSessions", () => {
    const s = (over: Partial<LiveSession>) =>
        ({
            id: "s",
            runtime: "claude",
            projectpath: "D:\\p",
            task: "t",
            lastactivets: 100,
            live: false,
            events: [],
            ...over,
        }) as LiveSession;
    const now = 8 * 86_400_000;
    it("keeps the project's ended sessions in the window, newest first, no run workers", () => {
        const list = [
            s({ id: "in", lastactivets: now - 1000 }),
            s({ id: "newer", lastactivets: now - 10, projectpath: "D:/p/" }),
            s({ id: "live", live: true, lastactivets: now }),
            s({ id: "worker", runid: "r1", lastactivets: now }),
            s({ id: "old", lastactivets: now - 8 * 86_400_000 }),
            s({ id: "other", projectpath: "D:/q", lastactivets: now }),
        ];
        expect(projectSessions(list, "D:/p", now, "").map((x) => x.id)).toEqual(["newer", "in"]);
    });
    it("filters on the task, ignoring case", () => {
        const list = [
            s({ id: "a", task: "Council store", lastactivets: 5 }),
            s({ id: "b", task: "Rail", lastactivets: 6 }),
        ];
        expect(projectSessions(list, "D:/p", 10, "council").map((x) => x.id)).toEqual(["a"]);
    });
    it("is empty while the archive is not loaded", () => {
        expect(projectSessions(null, "D:/p", 10, "")).toEqual([]);
    });
});

describe("historyItems", () => {
    const day = 86_400_000;
    const now = 10 * day;
    const council = (over: Partial<Council>) =>
        ({
            id: "c",
            project: "D:/p",
            feature: "f",
            state: "done",
            experts: [{}, {}, {}],
            updated: now - 100,
            created: 0,
            round: 1,
            tokens: 0,
            calls: 0,
            ...over,
        }) as Council;
    const run = (over: Partial<Run>) =>
        ({
            oid: "r",
            id: "r",
            goal: "Ship it\nmore",
            status: "done",
            channeloid: "ch",
            projectpath: "D:/p",
            createdts: now - 50,
            phases: [],
            ...over,
        }) as Run;
    const unverified = (reasons: string[]) =>
        ({
            capturedts: 1,
            hash: "",
            addtotal: 0,
            deltotal: 0,
            verification: { state: "unverified", reasons },
        }) as RunEvidence;

    it("merges councils and runs newest first, inside the window", () => {
        const out = historyItems(
            [council({ id: "c1", updated: now - 100 }), council({ id: "old", updated: now - 8 * day })],
            [run({ id: "r1", oid: "r1", createdts: now - 50 })],
            now,
            ""
        );
        expect(out.map((i) => i.key)).toEqual(["run:r1", "council:c1"]);
    });

    it("keeps a run to the window by when it was created, not when it ended", () => {
        const late = run({ id: "late", oid: "late", createdts: now - 9 * day, completedts: now - day });
        expect(historyItems([], [late], now, "")).toEqual([]);
    });

    it("reads a council's answer, else its state, and its experts", () => {
        const [withAnswer] = historyItems(
            [council({ summary: { answer: "Yes.", text: "", directions: [], outcomes: {}, at: 1 } })],
            [],
            now,
            ""
        );
        expect(withAnswer.line).toBe("Answer: Yes. · 3 experts");
        const [stopped] = historyItems([council({ state: "stopped", question: "Which db?" })], [], now, "");
        expect(stopped.title).toBe("Which db?");
        expect(stopped.line).toBe("Stopped · 3 experts");
    });

    it("reads a run's goal headline, its land, and what it left unverified until acknowledged", () => {
        const landed = run({
            basebranch: "main",
            land: { state: "landed", notes: ["a note"] },
            evidence: unverified(["x", "y"]),
        });
        const [item] = historyItems([], [landed], now, "");
        expect(item.title).toBe("Ship it");
        expect(item.line).toBe("Landed on main");
        expect(item.warn).toBe("3 not verified");
        const [acked] = historyItems([], [{ ...landed, verificationackts: 5 }], now, "");
        expect(acked.warn).toBe("");
    });

    it("counts the land's notes on a verified run, and warns on a done run only", () => {
        const notesOnly = run({ land: { state: "landed", notes: ["base moved"] } });
        expect(historyItems([], [notesOnly], now, "")[0].warn).toBe("1 not verified");
        const running = run({ status: "executing", evidence: unverified(["x"]) });
        expect(historyItems([], [running], now, "")[0].warn).toBe("");
    });

    it("filters on the title", () => {
        const out = historyItems([council({ feature: "Council store" })], [run({ goal: "Rail" })], now, "council");
        expect(out.map((i) => i.kind)).toEqual(["council"]);
    });
});

describe("historyCounts", () => {
    const item = (kind: "council" | "run") => ({ kind }) as HistoryItem;
    it("names the non-zero counts, singular or plural, with the tab each opens", () => {
        expect(historyCounts(14, [item("run"), item("council"), item("council")])).toEqual([
            { label: "14 sessions", tab: "sessions" },
            { label: "1 run", tab: "councils" },
            { label: "2 councils", tab: "councils" },
        ]);
        expect(historyCounts(0, [])).toEqual([]);
    });
});
