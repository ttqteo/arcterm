// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { buildNeedsYouRows, channelProjects, escalationAgent, stripAge } from "./needsyoustripmodel";

const item = (over: Partial<AttentionItem>): AttentionItem =>
    ({
        kind: "dag-gate",
        key: "k",
        channelid: "c1",
        runid: "r1",
        taskid: "t-1",
        source: "ship it",
        text: "approve t-1",
        action: "Review",
        phaseidx: 0,
        waitingsince: 1000,
        ...over,
    }) as AttentionItem;

const agent = (over: Partial<AgentVM>): AgentVM =>
    ({ id: "t1", name: "worker", task: "", state: "asking", blockId: "b1", ...over }) as AgentVM;

const escalationMsg = (id: string, card: Record<string, unknown>): ChannelMessage =>
    ({
        id,
        kind: "jarvis-escalation",
        author: "jarvis",
        text: "",
        ts: 1,
        data: JSON.stringify({
            question: "which db?",
            options: [],
            askORef: "block:b1",
            workerORef: "tab:t1",
            ...card,
        }),
    }) as ChannelMessage;

const base = {
    filter: "all",
    channelProject: new Map<string, string>(),
    channelMessages: {} as Record<string, ChannelMessage[]>,
    roster: [] as AgentVM[],
};

describe("buildNeedsYouRows — which items", () => {
    it("keeps the five non-ask kinds and leaves asks and radar triage out", () => {
        const rows = buildNeedsYouRows({
            ...base,
            attention: [
                item({ key: "g", kind: "dag-gate" }),
                item({ key: "b", kind: "dag-blocked" }),
                item({ key: "a", kind: "ask" }),
                item({ key: "e", kind: "escalation" }),
                item({ key: "r", kind: "radar-triage", channelid: "" }),
                item({ key: "u", kind: "run-unverified" }),
                item({ key: "l", kind: "run-land-held" }),
            ],
        });
        expect(rows.map((r) => r.key)).toEqual(["g", "b", "e", "u", "l"]);
    });

    it("is empty when nothing but asks is waiting, so the strip is not drawn", () => {
        expect(buildNeedsYouRows({ ...base, attention: [item({ kind: "ask" })] })).toEqual([]);
        expect(buildNeedsYouRows({ ...base, attention: [] })).toEqual([]);
        expect(buildNeedsYouRows({ ...base, attention: undefined as unknown as AttentionItem[] })).toEqual([]);
    });

    it("keeps the server's order rather than sorting by age", () => {
        const rows = buildNeedsYouRows({
            ...base,
            attention: [item({ key: "new", waitingsince: 9000 }), item({ key: "old", waitingsince: 1000 })],
        });
        expect(rows.map((r) => r.key)).toEqual(["new", "old"]);
    });
});

describe("buildNeedsYouRows — project scope", () => {
    const channelProject = new Map([
        ["c1", "alpha"],
        ["c2", "beta"],
    ]);
    const attention = [
        item({ key: "a1", channelid: "c1" }),
        item({ key: "b1", channelid: "c2" }),
        item({ key: "x1", channelid: "c-legacy" }),
        item({ key: "n1", channelid: "" }),
    ];

    it("shows every item under all projects, including one whose channel resolves to no project", () => {
        const rows = buildNeedsYouRows({ ...base, channelProject, attention });
        expect(rows.map((r) => r.key)).toEqual(["a1", "b1", "x1", "n1"]);
    });

    it("scopes to the filtered project and drops what cannot be resolved", () => {
        const rows = buildNeedsYouRows({ ...base, channelProject, attention, filter: "alpha" });
        expect(rows.map((r) => r.key)).toEqual(["a1"]);
    });
});

describe("buildNeedsYouRows — the row", () => {
    it("carries the kind label, source, text and age stamp", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [item({ kind: "dag-gate", why: "2 of 5 done" })] });
        expect(row.kindLabel).toBe("Review task");
        expect(row.source).toBe("ship it");
        expect(row.text).toBe("approve t-1");
        expect(row.why).toBe("2 of 5 done");
        expect(row.waitingSince).toBe(1000);
        expect(row.tone).toBe("asking");
    });

    it("labels each kind and marks a blocked task as the one in error", () => {
        const labels = (kind: string) => buildNeedsYouRows({ ...base, attention: [item({ kind })] })[0];
        expect(labels("dag-blocked").kindLabel).toBe("Blocked task");
        expect(labels("dag-blocked").tone).toBe("error");
        expect(labels("run-unverified").kindLabel).toBe("Run to confirm");
        expect(labels("run-land-held").kindLabel).toBe("Run to land");
        expect(labels("escalation").kindLabel).toBe("Escalation");
        expect(labels("escalation").tone).toBe("asking");
    });

    it("reads no waiting-since stamp as no age", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [item({ waitingsince: 0 })] });
        expect(row.waitingSince).toBeNull();
    });

    it("offers the button the Brief's Waiting row offers", () => {
        const act = (over: Partial<AttentionItem>) => buildNeedsYouRows({ ...base, attention: [item(over)] })[0].act;
        expect(act({ kind: "dag-gate" })).toEqual({ label: "Approve", kind: "approve-dag" });
        expect(act({ kind: "dag-blocked", retry: true })).toEqual({ label: "Retry", kind: "retry-dag" });
        expect(act({ kind: "run-unverified", taskid: "" })).toEqual({ label: "Acknowledge", kind: "ack-run" });
        expect(act({ kind: "run-land-held", taskid: "" })).toEqual({ label: "Land again", kind: "land-run" });
    });

    it("only opens what needs a judgment rather than a button", () => {
        const act = (over: Partial<AttentionItem>) => buildNeedsYouRows({ ...base, attention: [item(over)] })[0].act;
        expect(act({ kind: "dag-gate", taskid: "" }).kind).toBe("open");
        expect(act({ kind: "dag-blocked", retry: false }).kind).toBe("open");
        expect(act({ kind: "escalation" }).kind).toBe("open");
    });

    it("hands the runner the ids the act needs", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [item({ kind: "dag-blocked", retry: true })] });
        expect(row.run).toEqual({
            wireKind: "dag-blocked",
            channelId: "c1",
            runId: "r1",
            taskId: "t-1",
            retry: true,
            source: "ship it",
            title: "approve t-1",
        });
    });

    it("opens the run in its channel, as Jarvis's Open does", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [item({})] });
        expect(row.open).toEqual({ kind: "channel", channelId: "c1", runId: "r1" });
    });

    it("opens the channel alone when the item names no run, and nothing when it names no channel", () => {
        const rows = buildNeedsYouRows({
            ...base,
            attention: [item({ key: "a", runid: "" }), item({ key: "b", channelid: "", runid: "" })],
        });
        expect(rows[0].open).toEqual({ kind: "channel", channelId: "c1", runId: null });
        expect(rows[1].open).toBeNull();
    });
});

describe("escalationAgent", () => {
    const esc = item({ kind: "escalation", key: "esc:m1" });

    it("joins through the card's worker tab", () => {
        const found = escalationAgent(
            esc,
            [escalationMsg("m1", {})],
            [agent({ id: "other", blockId: "bx" }), agent({})]
        );
        expect(found?.id).toBe("t1");
    });

    it("falls back to the ask's block when the card names no worker", () => {
        const found = escalationAgent(
            esc,
            [escalationMsg("m1", { workerORef: "" })],
            [agent({ id: "t9", blockId: "b1" })]
        );
        expect(found?.id).toBe("t9");
    });

    it("finds nothing when the agent is no longer in the roster", () => {
        expect(escalationAgent(esc, [escalationMsg("m1", {})], [agent({ id: "t2", blockId: "b2" })])).toBeUndefined();
    });

    it("finds nothing when the card has left the channel's message window or is not an escalation", () => {
        expect(escalationAgent(esc, [escalationMsg("m2", {})], [agent({})])).toBeUndefined();
        expect(escalationAgent(esc, undefined, [agent({})])).toBeUndefined();
        expect(
            escalationAgent(item({ kind: "dag-gate", key: "esc:m1" }), [escalationMsg("m1", {})], [agent({})])
        ).toBeUndefined();
    });

    it("finds nothing for a card with no readable payload", () => {
        const bad = { ...escalationMsg("m1", {}), data: "not json" } as ChannelMessage;
        expect(escalationAgent(esc, [bad], [agent({})])).toBeUndefined();
    });
});

describe("buildNeedsYouRows — escalation", () => {
    const attention = [item({ kind: "escalation", key: "esc:m1", taskid: "" })];
    const channelMessages = { c1: [escalationMsg("m1", {})] };

    it("opens the asking agent's card when it is in the roster", () => {
        const [row] = buildNeedsYouRows({ ...base, attention, channelMessages, roster: [agent({})] });
        expect(row.open).toEqual({ kind: "agent", agentId: "t1" });
    });

    it("opens the run when the agent is not in the roster", () => {
        const [row] = buildNeedsYouRows({ ...base, attention, channelMessages, roster: [] });
        expect(row.open).toEqual({ kind: "channel", channelId: "c1", runId: "r1" });
    });

    it("only an escalation joins an agent: another kind with the same message id still opens its run", () => {
        const rows = buildNeedsYouRows({
            ...base,
            attention: [item({ kind: "run-unverified", key: "esc:m1", taskid: "" })],
            channelMessages,
            roster: [agent({})],
        });
        expect(rows[0].open).toEqual({ kind: "channel", channelId: "c1", runId: "r1" });
    });
});

describe("channelProjects", () => {
    const registry = { alpha: { path: "D:\\work\\alpha" }, beta: { path: "/home/me/beta/" }, nopath: {} };
    const ch = (oid: string, projectpath?: string) => ({ oid, name: oid, projectpath }) as Channel;

    it("names a channel by the registered project at its path, whichever way the path is spelled", () => {
        const out = channelProjects([ch("c1", "D:/work/alpha"), ch("c2", "/home/me/beta")], registry);
        expect(out.get("c1")).toBe("alpha");
        expect(out.get("c2")).toBe("beta");
    });

    it("leaves a channel with no path, or at an unregistered path, out", () => {
        const out = channelProjects([ch("c3"), ch("c4", "/elsewhere"), ch("c5", "")], registry);
        expect(out.size).toBe(0);
    });

    it("reads missing inputs as empty", () => {
        expect(channelProjects(null, registry).size).toBe(0);
        expect(channelProjects([ch("c1", "D:/work/alpha")], null).size).toBe(0);
    });
});

describe("stripAge", () => {
    it("reads a wait as the cockpit's other ages do", () => {
        expect(stripAge(1_000, 1_000 + 30_000)).toBe("just now");
        expect(stripAge(1_000, 1_000 + 5 * 60_000)).toBe("5m");
        expect(stripAge(1_000, 1_000 + 3 * 3_600_000)).toBe("3h");
    });

    it("is blank without a stamp", () => {
        expect(stripAge(null, 5000)).toBe("");
    });

    it("never reads a negative wait", () => {
        expect(stripAge(10_000, 1_000)).toBe("just now");
    });
});
