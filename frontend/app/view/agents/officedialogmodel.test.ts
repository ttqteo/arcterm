// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import {
    agentMeta,
    carryOver,
    carryWords,
    chipDialog,
    clampSel,
    dialogItems,
    dialogWords,
    enabledOf,
    liftAskLines,
    liftDialog,
    questionTabs,
    rowActionLabel,
    runTaskList,
    selAfterActivate,
    type DialogInput,
} from "./officedialogmodel";
import type { FloorSummary, PlanAgent, PlanRun } from "./officeplanmodel";

const agent = (over: Partial<AgentVM> = {}): AgentVM => ({
    id: "a1",
    name: "loom",
    task: "tray",
    state: "working",
    ...over,
});
const quill = agent({
    id: "q1",
    name: "quill",
    state: "asking",
    blockedMs: 180_000,
    ask: {
        questions: [
            {
                question: "Merge into main now?",
                options: [{ label: "Merge it" }, { label: "Rebase on main first" }, { label: "Not yet" }],
            },
        ],
    },
});
const twoParts = agent({
    id: "q2",
    state: "asking",
    ask: {
        questions: [
            { question: "Branch?", options: [{ label: "Keep feat/tray" }, { label: "Rename to feat/tray-popover" }] },
            { question: "Tests?", multiSelect: true, options: [{ label: "Unit" }, { label: "CDP" }] },
        ],
    },
});
const base = (over: Partial<DialogInput>): DialogInput => ({
    kind: "agent",
    activeQuestion: 0,
    selections: {},
    texts: {},
    ...over,
});
const labels = (input: DialogInput) => dialogItems(input).map((i) => i.label);

describe("dialogItems", () => {
    it("gives an agent at work Open (the full card), Reply, Terminal and Send to background", () => {
        const items = dialogItems(base({ agent: agent() }));
        expect(items.map((i) => i.label)).toEqual(["Open", "Reply", "Terminal", "Send to background"]);
        expect(items.map((i) => i.id)).toEqual(["open", "reply", "terminal", "background"]);
        expect(items.map((i) => i.key)).toEqual(["Space", "r", "t", "b"]);
        expect(items.some((i) => i.rule)).toBe(false);
    });

    it("offers Diff, after Terminal, to an agent whose box shows changed files", () => {
        expect(labels(base({ agent: agent(), hasDiff: true }))).toEqual([
            "Open",
            "Reply",
            "Terminal",
            "Diff",
            "Send to background",
        ]);
    });

    it("gives an asking agent its answers and Send, dim until something is picked, then Open on f under a line", () => {
        const items = dialogItems(base({ agent: quill }));
        expect(items.map((i) => i.label)).toEqual([
            "Merge it",
            "Rebase on main first",
            "Not yet",
            "Send",
            "Open",
            "Terminal",
        ]);
        expect(items.map((i) => i.key)).toEqual(["1", "2", "3", "Space", "f", "t"]);
        expect(items[3].dim).toBe(true);
        expect(items[4].rule).toBe(true);
        expect(items[5].rule).toBeFalsy();
    });

    it("marks a picked answer and lights Send", () => {
        const items = dialogItems(base({ agent: quill, selections: { 0: new Set([0]) } }));
        expect(items[0].checked).toBe(true);
        expect(items[1].checked).toBe(false);
        expect(items[3].dim).toBe(false);
    });

    it("shows the answers of the question its tab is on, and marks them as taking several", () => {
        const items = dialogItems(base({ agent: twoParts, activeQuestion: 1, selections: { 0: new Set([1]) } }));
        expect(items.slice(0, 2).map((i) => i.label)).toEqual(["Unit", "CDP"]);
        expect(items[0].multi).toBe(true);
        expect(items[2]).toMatchObject({ id: "send", dim: true });
    });

    it("gives an agent asking in its terminal Open, Reply and Terminal, and no Send to background", () => {
        expect(labels(base({ agent: agent({ state: "asking" }) }))).toEqual(["Open", "Reply", "Terminal"]);
    });

    it("gives a run's lead Open (the run's card), Reply, Terminal and Adjust when the run takes it", () => {
        const lead = agent({ id: "l1", state: "idle" });
        expect(labels(base({ kind: "lead", agent: lead, adjustable: true }))).toEqual([
            "Open",
            "Reply",
            "Terminal",
            "Adjust",
        ]);
        expect(labels(base({ kind: "lead", agent: lead }))).toEqual(["Open", "Reply", "Terminal"]);
    });

    it("leads a worker's seat with its row's own actions, numbered, then Open and Terminal under a line", () => {
        const items = dialogItems(
            base({
                kind: "worker",
                agent: agent({ id: "w1" }),
                rowActions: ["approve", "sendback", "retry", "skip"],
                canOpen: true,
            })
        );
        expect(items.map((i) => i.label)).toEqual(["Approve", "Send back", "Retry", "Skip", "Open", "Terminal"]);
        expect(items.slice(0, 4).map((i) => i.key)).toEqual(["1", "2", "3", "4"]);
        expect(items[4].rule).toBe(true);
    });

    it("gives an asking worker its answers, its row's actions after them with no number", () => {
        const items = dialogItems(base({ kind: "worker", agent: quill, rowActions: ["takeover"], canOpen: true }));
        expect(items.map((i) => i.label)).toEqual([
            "Merge it",
            "Rebase on main first",
            "Not yet",
            "Send",
            "Take over",
            "Open",
            "Terminal",
        ]);
        expect(items[4].key).toBeUndefined();
        expect(items[5]).toMatchObject({ key: "f", rule: true });
        expect(items[6].key).toBe("t");
    });

    it("leaves Tell to the full card, whose input takes the words: a worker at work offers Open and Terminal", () => {
        const items = dialogItems(
            base({ kind: "worker", agent: agent({ id: "w1" }), rowActions: ["tell"], canOpen: true })
        );
        expect(items.map((i) => i.label)).toEqual(["Open", "Terminal"]);
        expect(items.some((i) => i.rule)).toBe(false);
    });

    it("gives a seat with no worker or no tab, and a leadless run, only the full card and what they have", () => {
        expect(labels(base({ kind: "worker" }))).toEqual(["Open"]);
        expect(labels(base({ kind: "worker", agent: agent({ id: "w1" }) }))).toEqual(["Open"]);
        expect(labels(base({ kind: "leadless", adjustable: true }))).toEqual(["Open", "Adjust"]);
        expect(labels(base({ kind: "leadless" }))).toEqual(["Open"]);
    });
});

describe("the ▶ over the items", () => {
    const items = dialogItems(base({ agent: quill }));

    it("cannot rest on a dim Send", () => {
        expect(enabledOf(items)).toEqual([true, true, true, false, true, true]);
    });

    it("moves from an answer of a one-answer question to Send, and stays on any other item", () => {
        expect(selAfterActivate(items, 1)).toBe(3);
        expect(selAfterActivate(items, 4)).toBe(4);
        const multi = dialogItems(base({ agent: twoParts, activeQuestion: 1 }));
        expect(selAfterActivate(multi, 0)).toBe(0);
    });

    it("clamps a ▶ left past the end or on a dim item to the first item it can rest on", () => {
        expect(clampSel(items, 2)).toBe(2);
        expect(clampSel(items, 9)).toBe(0);
        expect(clampSel(items, 3)).toBe(0);
        expect(clampSel(items, -1)).toBe(0);
    });
});

describe("rowActionLabel", () => {
    it("names a review's choices and a row's actions as the card does", () => {
        expect(rowActionLabel("sendback")).toBe("Send back");
        expect(rowActionLabel("takeover")).toBe("Take over");
        expect(rowActionLabel("resolve")).toBe("Continue");
    });
});

describe("dialogWords", () => {
    const said = (text: string): AgentEntry => ({ kind: "message", text });

    it("puts an asking agent's question under what it said last", () => {
        expect(dialogWords(quill, [said("The branch is ready.")], 0)).toEqual({
            said: "The branch is ready.",
            main: "Merge into main now?",
        });
    });

    it("follows the question tab", () => {
        expect(dialogWords(twoParts, [], 1).main).toBe("Tests?");
    });

    it("says why the terminal holds the choices when the ask has none", () => {
        expect(dialogWords(agent({ state: "asking" }), [], 0).main).toBe(
            "It asked in its terminal; the choices are there."
        );
    });

    it("gives an idle agent its last words, or its idle reason when it said nothing", () => {
        expect(dialogWords(agent({ state: "idle", activity: "done" }), [said("Shipped.")], 0)).toEqual({
            said: "Shipped.",
        });
        expect(dialogWords(agent({ state: "idle", activity: "done" }), [], 0)).toEqual({ said: "done" });
        expect(dialogWords(agent({ activity: "running vitest" }), [], 0)).toEqual({ said: undefined });
    });
});

describe("questionTabs", () => {
    it("names the question a several-part ask is on, and which of how many", () => {
        expect(questionTabs(twoParts, 0)).toEqual({ head: "Branch?", at: 0, of: 2 });
        expect(questionTabs(twoParts, 5)).toEqual({ head: "Tests?", at: 1, of: 2 });
    });

    it("prefers the question's short header", () => {
        const headed = agent({
            state: "asking",
            ask: {
                questions: [
                    { header: "Branch", question: "Keep the branch name?", options: [] },
                    { question: "Tests?", options: [] },
                ],
            },
        });
        expect(questionTabs(headed, 0)?.head).toBe("Branch");
    });

    it("is nothing for one question, or for an agent not asking", () => {
        expect(questionTabs(quill, 0)).toBeUndefined();
        expect(questionTabs({ ...twoParts, state: "working" }, 0)).toBeUndefined();
    });
});

describe("agentMeta", () => {
    it("joins the model, the session's tokens, the context used and how long it has waited, worked or idled", () => {
        expect(agentMeta({ ...quill, model: "opus 5.5", usage: { contextpct: 21.4 } }, 0)).toBe(
            "opus 5.5 · 21% context · waiting 3m"
        );
        expect(agentMeta(agent({ activeMs: 720_000 }), 0)).toBe("12m");
        expect(agentMeta(agent({ state: "idle", idleSince: 0 }), 360_000)).toBe("idle 6m");
        expect(agentMeta(agent({ model: "sonnet", activeMs: 720_000 }), 0, 1_240_000)).toBe(
            "sonnet · 1.2M tokens · 12m"
        );
    });
});

describe("runTaskList", () => {
    it("lists the live rows, then the waiting ones, under a heading that counts them", () => {
        expect(runTaskList(["a"], ["b", "c"], [], 4)).toEqual({
            heading: "Working · 1, waiting · 2",
            shown: ["a", "b", "c"],
            more: 0,
        });
        expect(runTaskList([], ["b", "c", "d", "e", "f"], [], 4)).toEqual({
            heading: "Waiting · 5",
            shown: ["b", "c", "d", "e"],
            more: 1,
        });
        expect(runTaskList(["a", "b"], [], ["z"], 4)).toEqual({ heading: "Working · 2", shown: ["a", "b"], more: 0 });
    });

    it("falls back to the done rows, and to nothing before a plan", () => {
        expect(runTaskList([], [], ["x", "y"], 4)).toEqual({ heading: "Done · 2", shown: ["x", "y"], more: 0 });
        expect(runTaskList([], [], [], 4)).toEqual({ heading: "", shown: [], more: 0 });
    });
});

const floorOf = (floor: number, rooms: string[], asks = 0): FloorSummary => ({
    floor,
    label: floor === 0 ? "G" : String(floor),
    rooms,
    asks,
    lit: true,
});
const building = [
    floorOf(0, ["Home", "portfolio-journal", "vnstock-js", "vnstock-js-docs"]),
    floorOf(1, ["arcterm", "cuscofi-app", "mit-thesis", "cuscofi-production"], 3),
    floorOf(2, ["chotkeo"], 1),
];

describe("liftDialog", () => {
    it("lists one item per floor from the top down, the ground floor as Ground", () => {
        const d = liftDialog(building, 1);
        expect(d.kind).toBe("lift");
        expect(d.title).toBe("Lift");
        expect(d.items.map((i) => i.label)).toEqual(["Floor 2", "Floor 1", "Ground"]);
        expect(d.items.map((i) => i.id)).toEqual(["floor:2", "floor:1", "floor:0"]);
    });

    it("gives each floor its asks and its projects joined by a comma", () => {
        const d = liftDialog(building, 1);
        expect(d.items.map((i) => i.count)).toEqual([1, 3, 0]);
        expect(d.items[0].sub).toBe("chotkeo");
        expect(d.items[2].sub).toBe("Home, portfolio-journal, vnstock-js, vnstock-js-docs");
    });

    it("lists the floors top down however they come", () => {
        const d = liftDialog([...building].reverse(), 0);
        expect(d.items.map((i) => i.label)).toEqual(["Floor 2", "Floor 1", "Ground"]);
    });

    it("marks the shown floor current, and the ▶ cannot rest on it", () => {
        const d = liftDialog(building, 1);
        expect(d.items.map((i) => !!i.current)).toEqual([false, true, false]);
        expect(d.items[1].dim).toBe(true);
        expect(enabledOf(d.items)).toEqual([true, false, true]);
    });

    it("puts the ▶ on the first floor that is not the current one", () => {
        expect(clampSel(liftDialog(building, 1).items, -1)).toBe(0);
        expect(clampSel(liftDialog(building, 2).items, -1)).toBe(1);
        expect(clampSel(liftDialog(building, 0).items, -1)).toBe(0);
    });

    it("has nothing to pick with one floor", () => {
        const d = liftDialog([floorOf(0, ["Home"])], 0);
        expect(d.items).toHaveLength(1);
        expect(enabledOf(d.items)).toEqual([false]);
    });
});

describe("liftAskLines", () => {
    it("says where the asks on the other floors are, the top floor first", () => {
        expect(liftAskLines(building, 0).map((l) => l.text)).toEqual(["▲ 1 on 2", "▲ 3 on 1"]);
        expect(liftAskLines(building, 1).map((l) => l.text)).toEqual(["▲ 1 on 2"]);
        expect(liftAskLines(building, 2).map((l) => l.text)).toEqual(["▼ 3 on 1"]);
    });

    it("lists the floors above before the floors below", () => {
        const b = [floorOf(0, ["a"], 2), floorOf(1, ["b"], 1), floorOf(2, ["c"], 4)];
        const lines = liftAskLines(b, 1);
        expect(lines.map((l) => l.text)).toEqual(["▲ 4 on 2", "▼ 2 on G"]);
        expect(lines.map((l) => l.up)).toEqual([true, false]);
    });

    it("leaves out the shown floor and the floors with no ask", () => {
        expect(liftAskLines([floorOf(0, ["a"], 5), floorOf(1, ["b"])], 0)).toEqual([]);
    });
});

describe("liftDialog while a room is carried", () => {
    it("is the map of the floors, with New floor on top", () => {
        const d = liftDialog(building, 1, { project: "mit-thesis" });
        expect(d.items.map((i) => i.id)).toEqual(["floor:new", "floor:2", "floor:1", "floor:0"]);
        expect(d.items[0]).toMatchObject({ label: "New floor", dim: false });
    });

    it("says Floor full for a floor with no slot left for the room, and takes no drop there", () => {
        const d = liftDialog(building, 1, { project: "chotkeo" });
        const ground = d.items.find((i) => i.id === "floor:0")!;
        expect(ground).toMatchObject({ sub: "Floor full", full: true, dim: true });
        expect(d.items.find((i) => i.id === "floor:2")).toMatchObject({ sub: "chotkeo", dim: false });
    });

    it("counts a floor's own room out, so the floor it is on is not full for it", () => {
        const d = liftDialog(building, 1, { project: "Home" });
        expect(d.items.find((i) => i.id === "floor:0")).toMatchObject({
            sub: "Home, portfolio-journal, vnstock-js, vnstock-js-docs",
            dim: false,
        });
        expect(d.items.find((i) => i.id === "floor:0")?.full).toBeUndefined();
    });

    it("takes no New floor for the only room of the top floor", () => {
        expect(liftDialog(building, 2, { project: "chotkeo" }).items[0]).toMatchObject({ id: "floor:new", dim: true });
        expect(liftDialog(building, 2, { project: "Home" }).items[0].dim).toBe(false);
    });

    it("has no New floor and no full floor when nothing is carried", () => {
        const d = liftDialog(building, 1);
        expect(d.items.some((i) => i.id === "floor:new" || i.full)).toBe(false);
    });
});

const person = (id: string, name: string, state: PlanAgent["state"], finished = false): PlanAgent => ({
    id,
    name,
    state,
    finished,
});
const run = (id: string, title: string, over: Partial<PlanRun> = {}): PlanRun => ({
    id,
    title,
    done: false,
    leadAsking: false,
    tasks: [],
    ...over,
});

describe("chipDialog", () => {
    const room = { title: "arcterm", chip: { hidden: ["a5", "a6", "a7", "r3"] } } as Parameters<typeof chipDialog>[0];
    const agents = [
        person("a1", "Canvas", "working"),
        person("a5", "Sleepwatch", "idle", true),
        person("a6", "Tray popover", "asking"),
        person("a7", "Worktree cleanup", "working"),
    ];
    const runs = [run("r1", "Land queue"), run("r3", "Tray popover run", { done: true })];

    it("is titled after the room and lists what did not fit, not who sits", () => {
        const d = chipDialog(room, agents, runs);
        expect(d.kind).toBe("chip");
        expect(d.title).toBe("arcterm · not at a desk");
        expect(d.items.map((i) => i.id)).toEqual(["hidden:a6", "hidden:a5", "hidden:a7", "hidden:r3"]);
    });

    it("names each with its state word, asking ones first and flagged", () => {
        const d = chipDialog(room, agents, runs);
        expect(d.items.map((i) => [i.label, i.word, !!i.ask])).toEqual([
            ["Tray popover", "Needs you", true],
            ["Sleepwatch", "done", false],
            ["Worktree cleanup", "working", false],
            ["Tray popover run", "done", false],
        ]);
    });

    it("puts a run that asks before the others, among the asking", () => {
        const asking = run("r3", "Menu sync", { tasks: [{ id: "t", label: "x", state: "running", asking: true }] });
        const d = chipDialog(room, agents, [asking]);
        expect(d.items.map((i) => i.id)).toEqual(["hidden:a6", "hidden:r3", "hidden:a5", "hidden:a7"]);
        expect(d.items[1]).toMatchObject({ word: "Needs you", ask: true });
    });

    it("lists nothing for a room with no chip", () => {
        expect(chipDialog({ title: "Home", chip: undefined }, agents, runs).items).toEqual([]);
    });
});

describe("carryWords", () => {
    it("says by keyboard what the target holds, under Moving <room>, with the keys", () => {
        const w = carryWords({ project: "cuscofi-app", by: "key", over: "swap", other: "mit-thesis" });
        expect(w).toEqual({
            head: "Moving cuscofi-app",
            line: "Swap with mit-thesis",
            keys: "← ↑ ↓ → slot · PgUp PgDn floor · Space put down · Esc cancel",
        });
        expect(carryWords({ project: "a", by: "key", over: "empty" }).line).toBe("Put it here");
        expect(carryWords({ project: "a", by: "key", over: "new" }).line).toBe("Put it on a new floor");
        expect(carryWords({ project: "a", by: "key", over: "own" }).line).toBe("Back where it was");
    });

    it("says by pointer what dropping does, under the room's name and counts", () => {
        const w = carryWords({
            project: "mit-thesis",
            by: "pointer",
            over: "swap",
            other: "arcterm",
            counts: "1 agent",
        });
        expect(w).toEqual({
            head: "mit-thesis",
            sub: "1 agent",
            line: "Drop to swap with arcterm",
            keys: "Esc cancel",
        });
        expect(carryWords({ project: "a", by: "pointer", over: "empty" }).line).toBe("Drop here");
        expect(carryWords({ project: "a", by: "pointer", over: "floor", floor: "Floor 2" }).line).toBe(
            "Drop to move it to Floor 2"
        );
        expect(carryWords({ project: "a", by: "pointer", over: "new" }).line).toBe("Drop to build a new floor");
        expect(carryWords({ project: "a", by: "pointer", over: "none" }).line).toBe("Drop on a room or a floor");
    });
});

describe("carryOver", () => {
    const rooms = [
        { slot: 0, kind: "agents", title: "arcterm" },
        { slot: 1, kind: "agents", title: "cuscofi-app" },
        { slot: 2, kind: "empty", title: "Empty room" },
    ];
    const from = { floor: 1, slot: 1 };

    it("finds the room to swap with, or an empty slot, on the floor shown", () => {
        expect(carryOver({ floor: 1, slot: 0 }, from, 1, rooms, "cuscofi-app")).toEqual({
            over: "swap",
            other: "arcterm",
        });
        expect(carryOver({ floor: 1, slot: 2 }, from, 1, rooms, "cuscofi-app")).toEqual({ over: "empty" });
    });

    it("knows the room's own place, a new floor, another floor, and no target", () => {
        expect(carryOver({ floor: 1, slot: 1 }, from, 1, rooms, "cuscofi-app")).toEqual({ over: "own" });
        expect(carryOver("new", from, 1, rooms, "cuscofi-app")).toEqual({ over: "new" });
        expect(carryOver({ floor: 2, slot: 0 }, from, 1, rooms, "cuscofi-app")).toEqual({ over: "floor" });
        expect(carryOver(null, from, 1, rooms, "cuscofi-app")).toEqual({ over: "none" });
    });

    it("reads the slot on the floor shown after a ride, where the room itself is not", () => {
        expect(
            carryOver({ floor: 2, slot: 0 }, from, 2, [{ slot: 0, kind: "agents", title: "chotkeo" }], "cuscofi-app")
        ).toEqual({
            over: "swap",
            other: "chotkeo",
        });
    });
});
