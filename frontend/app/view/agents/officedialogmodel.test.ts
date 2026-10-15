// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import {
    agentMeta,
    clampSel,
    dialogItems,
    dialogWords,
    enabledOf,
    questionTabs,
    rowActionLabel,
    runTaskList,
    selAfterActivate,
    type DialogInput,
} from "./officedialogmodel";

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
    it("gives an agent at work Open, Reply, Terminal, Background, then the full card under a line", () => {
        const items = dialogItems(base({ agent: agent() }));
        expect(items.map((i) => i.label)).toEqual(["Open", "Reply", "Terminal", "Background", "Full card"]);
        expect(items.map((i) => i.key)).toEqual(["↵", "r", "t", "b", "f"]);
        expect(items.map((i) => !!i.rule)).toEqual([false, false, false, false, true]);
    });

    it("gives an asking agent its answers and Send, dim until something is picked, then Terminal under a line", () => {
        const items = dialogItems(base({ agent: quill }));
        expect(items.map((i) => i.label)).toEqual([
            "Merge it",
            "Rebase on main first",
            "Not yet",
            "Send",
            "Terminal",
            "Full card",
        ]);
        expect(items.map((i) => i.key)).toEqual(["1", "2", "3", "↵", "t", "f"]);
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

    it("gives an agent asking in its terminal Open, Reply and Terminal, and no Background", () => {
        expect(labels(base({ agent: agent({ state: "asking" }) }))).toEqual(["Open", "Reply", "Terminal", "Full card"]);
    });

    it("gives a run's lead Open lead, Reply, Terminal and Adjust when the run takes it", () => {
        const lead = agent({ id: "l1", state: "idle" });
        expect(labels(base({ kind: "lead", agent: lead, adjustable: true }))).toEqual([
            "Open lead",
            "Reply",
            "Terminal",
            "Adjust",
            "Full card",
        ]);
        expect(labels(base({ kind: "lead", agent: lead }))).toEqual(["Open lead", "Reply", "Terminal", "Full card"]);
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
        expect(items.map((i) => i.label)).toEqual([
            "Approve",
            "Send back",
            "Retry",
            "Skip",
            "Open",
            "Terminal",
            "Full card",
        ]);
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
            "Terminal",
            "Full card",
        ]);
        expect(items[4].key).toBeUndefined();
    });

    it("leaves Tell to the full card, whose input takes the words: a worker at work offers Open and Terminal", () => {
        const items = dialogItems(
            base({ kind: "worker", agent: agent({ id: "w1" }), rowActions: ["tell"], canOpen: true })
        );
        expect(items.map((i) => i.label)).toEqual(["Open", "Terminal", "Full card"]);
        expect(items[2].rule).toBe(true);
    });

    it("gives a seat with no worker, and a leadless run, only what they have", () => {
        expect(labels(base({ kind: "worker" }))).toEqual(["Full card"]);
        expect(labels(base({ kind: "leadless", adjustable: true }))).toEqual(["Adjust", "Full card"]);
        expect(labels(base({ kind: "leadless" }))).toEqual(["Full card"]);
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
