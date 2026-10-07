// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { answeredAskIdsAcross, buildFleetSnapshot, fleetCostUsd, needsHuman, type WorkerState } from "./jarvisderive";

// one channel's message list
function chan(messages: Partial<ChannelMessage>[]): ChannelMessage[] {
    return messages as ChannelMessage[];
}
function agent(over: Partial<AgentVM>): AgentVM {
    return { id: "t1", name: "claude", task: "", state: "working", ...over };
}

describe("buildFleetSnapshot", () => {
    it("resolves a dispatched worker to its live state, task, and ask", () => {
        const c = chan([{ kind: "dispatch", author: "claude", text: "harden webhooks", reforef: "tab:t1" }]);
        const agents = [agent({ id: "t1", name: "claude", state: "asking", task: "harden webhooks", ask: { questions: [{ question: "A or B?" }] } })];
        expect(buildFleetSnapshot(c, agents)).toEqual([
            { oref: "tab:t1", name: "claude", state: "asking", task: "harden webhooks", dispatchTask: "harden webhooks", askText: "A or B?" },
        ]);
    });

    it("marks a dispatched worker with no live row as gone, falling back to the dispatch runtime + task", () => {
        const c = chan([{ kind: "dispatch", author: "codex", text: "build auth", reforef: "tab:t2" }]);
        expect(buildFleetSnapshot(c, [])).toEqual([
            { oref: "tab:t2", name: "codex", state: "gone", task: "build auth", dispatchTask: "build auth" },
        ]);
    });

    it("surfaces the literal dispatch task for a live worker even when live.task is empty", () => {
        const c = chan([{ kind: "dispatch", author: "claude", text: "reply with token DELEG8", reforef: "tab:t1" }]);
        const agents = [agent({ id: "t1", name: "Provide delegation token", state: "working", task: "" })];
        expect(buildFleetSnapshot(c, agents)).toEqual([
            { oref: "tab:t1", name: "Provide delegation token", state: "working", dispatchTask: "reply with token DELEG8" },
        ]);
    });

    it("leaves dispatchTask undefined for a worker present only via a directive", () => {
        const c = chan([{ kind: "directive", author: "you", text: "do the thing", reforef: "tab:t9" }]);
        const snap = buildFleetSnapshot(c, [agent({ id: "t9", name: "web", state: "working", task: "live task" })]);
        expect(snap[0].dispatchTask).toBeUndefined();
        expect(snap[0].task).toBe("live task");
    });

    it("dedups a worker that was dispatched then steered into one entry", () => {
        const c = chan([
            { kind: "dispatch", author: "claude", text: "build", reforef: "tab:t1" },
            { kind: "directive", author: "you", text: "also add tests", reforef: "tab:t1" },
        ]);
        const snap = buildFleetSnapshot(c, [agent({ id: "t1", name: "claude", state: "working", task: "build" })]);
        expect(snap).toHaveLength(1);
        expect(snap[0].name).toBe("claude");
    });

    it("ignores non-dispatch messages and returns [] for an empty channel", () => {
        expect(buildFleetSnapshot(chan([{ kind: "human", author: "you", text: "hi", reforef: "" }]), [])).toEqual([]);
        expect(buildFleetSnapshot(chan([]), [])).toEqual([]);
    });

    it("carries the live ask id for an asking worker", () => {
        const c = chan([{ kind: "dispatch", author: "claude", text: "go", reforef: "tab:w1" }]);
        const agents = [agent({ id: "w1", name: "claude", state: "asking", ask: { oref: "block:w1", askId: "ask1", questions: [{ question: "q?" }] } })];
        const snap = buildFleetSnapshot(c, agents);
        expect(snap[0].askId).toBe("ask1");
    });

    it("carries live activity, cost, and context% for a live worker with usage", () => {
        const c = chan([{ kind: "dispatch", author: "claude", text: "go", reforef: "tab:t1" }]);
        const agents = [
            agent({
                id: "t1",
                name: "claude",
                state: "working",
                task: "go",
                activity: "editing auth.go",
                usage: { costusd: 1.25, contextpct: 42 },
            }),
        ];
        const snap = buildFleetSnapshot(c, agents);
        expect(snap[0].activity).toBe("editing auth.go");
        expect(snap[0].costUsd).toBe(1.25);
        expect(snap[0].contextPct).toBe(42);
    });

    it("leaves activity/cost/context undefined for a gone worker", () => {
        const c = chan([{ kind: "dispatch", author: "codex", text: "build", reforef: "tab:t2" }]);
        const snap = buildFleetSnapshot(c, []);
        expect(snap[0].activity).toBeUndefined();
        expect(snap[0].costUsd).toBeUndefined();
        expect(snap[0].contextPct).toBeUndefined();
    });

    it("folds an outcome message onto its worker", () => {
        const c = chan([
            { kind: "dispatch", author: "claude", text: "go", reforef: "tab:t1", ts: 1 },
            { kind: "outcome", author: "claude", text: "hardened webhooks", reforef: "tab:t1", ts: 2, data: JSON.stringify({ status: "done", summary: "hardened webhooks" }) },
        ]);
        const snap = buildFleetSnapshot(c, []);
        expect(snap[0].outcome).toEqual({ status: "done", summary: "hardened webhooks" });
    });

    it("ignores an outcome older than the latest dispatch (re-dispatched worker)", () => {
        const c = chan([
            { kind: "outcome", author: "claude", text: "old", reforef: "tab:t1", ts: 1, data: JSON.stringify({ status: "failed", summary: "old" }) },
            { kind: "dispatch", author: "claude", text: "go again", reforef: "tab:t1", ts: 2 },
        ]);
        const snap = buildFleetSnapshot(c, []);
        expect(snap[0].outcome).toBeUndefined();
    });
});

// the cockpit's needs-you count: needsHuman over the ask ids answered in any channel's message list
describe("answeredAskIdsAcross", () => {
    const answeredCard = (askId: string) =>
        JSON.stringify({ askORef: "block:a", askId, workerORef: "tab:x", question: "q", options: [{ label: "y" }], choice: 0 });
    const answeredMsg = (askId: string) =>
        ({ id: "1", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: answeredCard(askId) }) as ChannelMessage;
    const testAgent = (id: string, state: string, askId?: string) =>
        ({
            id,
            name: "claude",
            state,
            ask: askId ? { oref: "block:a", askId, questions: [{ question: "q?" }] } : undefined,
        }) as unknown as AgentVM;
    const needsYou = (lists: ChannelMessage[][], agents: AgentVM[]) => {
        const answered = answeredAskIdsAcross(lists);
        return agents.filter((a) => needsHuman(a, answered)).length;
    };

    it("counts an asking worker with no answered card", () => {
        expect(needsYou([[]], [testAgent("w1", "asking", "ask-1")])).toBe(1);
    });
    it("drops an asking worker whose ask Jarvis already answered", () => {
        expect(needsYou([[answeredMsg("ask-1")]], [testAgent("w1", "asking", "ask-1")])).toBe(0);
    });
    it("keeps a NEW ask from a worker whose PREVIOUS ask was answered", () => {
        expect(needsYou([[answeredMsg("ask-old")]], [testAgent("w1", "asking", "ask-new")])).toBe(1);
    });
    it("ignores non-asking workers", () => {
        expect(needsYou([[]], [testAgent("w1", "working")])).toBe(0);
    });
    it("dedupes an ask answered in a channel that is not the active one", () => {
        const active: ChannelMessage[] = [];
        const other = [answeredMsg("ask-1")];
        expect([...answeredAskIdsAcross([active, other])]).toEqual(["ask-1"]);
        expect(needsYou([active, other], [testAgent("w1", "asking", "ask-1")])).toBe(0);
    });
    it("is 0 for no channels and no agents", () => {
        expect(needsYou([], [])).toBe(0);
    });
});

describe("buildFleetSnapshot dismiss", () => {
    const dispatch = (oref: string, ts: number) => ({ id: String(ts), kind: "dispatch", author: "claude", text: "go", reforef: oref, ts });
    const dismiss = (oref: string, ts: number) => ({ id: "d" + ts, kind: "dismiss", author: "you", text: "", reforef: oref, ts });
    const chan = (msgs: unknown[]) => msgs as ChannelMessage[];

    it("hides a gone worker dismissed after its dispatch", () => {
        const snap = buildFleetSnapshot(chan([dispatch("tab:w1", 1), dismiss("tab:w1", 2)]), [] as unknown as AgentVM[]);
        expect(snap.find((w) => w.oref === "tab:w1")).toBeUndefined();
    });
    it("keeps a gone worker re-dispatched after its dismiss", () => {
        const snap = buildFleetSnapshot(chan([dispatch("tab:w1", 1), dismiss("tab:w1", 2), dispatch("tab:w1", 3)]), [] as unknown as AgentVM[]);
        expect(snap.find((w) => w.oref === "tab:w1")?.state).toBe("gone");
    });
    it("never hides a live worker even if a dismiss exists", () => {
        const agents = [{ id: "w1", name: "claude", state: "working", task: "" }] as unknown as AgentVM[];
        const snap = buildFleetSnapshot(chan([dispatch("tab:w1", 1), dismiss("tab:w1", 2)]), agents);
        expect(snap.find((w) => w.oref === "tab:w1")?.state).toBe("working");
    });
    it("ignores a dismiss for an oref never dispatched", () => {
        const snap = buildFleetSnapshot(chan([dispatch("tab:w1", 1), dismiss("tab:ghost", 2)]), [] as unknown as AgentVM[]);
        expect(snap).toHaveLength(1);
        expect(snap[0].oref).toBe("tab:w1");
    });
});

describe("fleetCostUsd", () => {
    const w = (over: Partial<WorkerState>): WorkerState => ({ oref: "tab:x", name: "claude", state: "working", ...over });
    it("sums costUsd across live workers", () => {
        expect(fleetCostUsd([w({ costUsd: 1.25 }), w({ costUsd: 0.75 })])).toBe(2);
    });
    it("ignores workers with no cost (gone or unreported)", () => {
        expect(fleetCostUsd([w({ costUsd: 1.5 }), w({ state: "gone" }), w({})])).toBe(1.5);
    });
    it("is 0 for an empty fleet", () => {
        expect(fleetCostUsd([])).toBe(0);
    });
});
