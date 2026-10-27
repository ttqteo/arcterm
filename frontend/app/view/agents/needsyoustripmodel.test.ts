// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    buildNeedsYouRows,
    channelProjects,
    escalationAgent,
    foldNeedsYouRows,
    groupAge,
    stripAge,
    whyLines,
    type StripRow,
} from "./needsyoustripmodel";

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
        expect(act({ kind: "run-unverified", taskid: "" })).toEqual({ label: "Accept", kind: "ack-run" });
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

describe("buildNeedsYouRows: a chunk that came due", () => {
    it("reads Due, opens its initiative, and offers Work on", () => {
        const due = item({
            kind: "chunk-due",
            key: "chunk-due:e1:m:2026-10-20",
            channelid: "",
            runid: "",
            taskid: "",
            oref: "effort:e1",
            text: "m",
        });
        const [row] = buildNeedsYouRows({
            attention: [due],
            filter: "all",
            channelProject: new Map(),
            channelMessages: {},
            roster: [],
        });
        expect(row.kindLabel).toBe("Due");
        expect(row.open).toEqual({ kind: "effort", effortId: "e1" });
        expect(row.act).toEqual({ label: "Work on", kind: "work-on" });
        // the agent Work on started is linked to the initiative: the same button now goes to it
        const [open] = buildNeedsYouRows({
            attention: [due],
            filter: "all",
            channelProject: new Map(),
            channelMessages: {},
            roster: [agent({ effortId: "e1", state: "idle" })],
        });
        expect(open.act).toEqual({ label: "Go to agent", kind: "work-on" });
    });
});

describe("buildNeedsYouRows: a plan to review", () => {
    const plan = item({
        kind: "plan-review",
        key: "plan-review:e1",
        channelid: "",
        runid: "",
        taskid: "",
        oref: "effort:e1",
        effortoid: "e1",
        text: "2 proposed",
    });
    const rowFor = (roster: AgentVM[]) =>
        buildNeedsYouRows({
            attention: [plan],
            filter: "all",
            channelProject: new Map(),
            channelMessages: {},
            roster,
        })[0];

    it("reads Plan to review, asks for you, and opens rather than acts", () => {
        const row = rowFor([]);
        expect(row.kindLabel).toBe("Plan to review");
        expect(row.tone).toBe("asking");
        expect(row.text).toBe("2 proposed");
        expect(row.act).toEqual({ label: "Open", kind: "open" });
    });

    it("opens the initiative when no agent is open on it", () => {
        expect(rowFor([agent({ id: "x", effortId: "e2" })]).open).toEqual({ kind: "effort", effortId: "e1" });
    });

    it("opens the agent when one is open on the initiative", () => {
        expect(rowFor([agent({ id: "t7", effortId: "e1", state: "idle" })]).open).toEqual({
            kind: "agent",
            agentId: "t7",
        });
    });
});

describe("buildNeedsYouRows: a blocked queue entry", () => {
    const blocked = item({
        kind: "run-queue-blocked",
        key: "run-queue-blocked:q-1a2b",
        channelid: "",
        runid: "",
        taskid: "",
        queueid: "q-1a2b",
        source: "Learned additions",
        text: "Did not start: Rail chắt lọc was held: dirty",
        action: "Start",
    });

    it("reads Run to start and offers Start now with Remove beside it", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [blocked] });
        expect(row.kindLabel).toBe("Run to start");
        expect(row.tone).toBe("asking");
        expect(row.text).toBe("Did not start: Rail chắt lọc was held: dirty");
        expect(row.act).toEqual({ label: "Start now", kind: "start-queued" });
        expect(row.secondAct).toEqual({ label: "Remove", kind: "remove-queued" });
        expect(row.open).toBeNull();
    });

    it("hands the runner the queue id", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [blocked] });
        expect(row.run).toMatchObject({ wireKind: "run-queue-blocked", queueId: "q-1a2b", runId: null });
    });

    it("gives every other kind no second act", () => {
        const rows = buildNeedsYouRows({
            ...base,
            attention: [
                item({ key: "g", kind: "dag-gate" }),
                item({ key: "b", kind: "dag-blocked", retry: true }),
                item({ key: "e", kind: "escalation" }),
                item({ key: "u", kind: "run-unverified" }),
                item({ key: "l", kind: "run-land-held" }),
            ],
        });
        expect(rows.map((r) => r.secondAct)).toEqual([null, null, null, null, null]);
    });
});

describe("buildNeedsYouRows: a learned rule", () => {
    const learn = item({
        kind: "learn-proposal",
        key: "learn:skill:notes#short",
        learnid: "skill:notes#short",
        channelid: "",
        runid: "",
        taskid: "",
        source: "Skill · notes",
        text: "keep notes short",
        action: "Accept",
        why: "“too long” · “shorter please”",
    });

    it("carries the learn id, the rule text, its source and its quotes, and opens nothing", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [learn] });
        expect(row.kindLabel).toBe("Learned rule");
        expect(row.learnId).toBe("skill:notes#short");
        expect(row.text).toBe("keep notes short");
        expect(row.source).toBe("Skill · notes");
        expect(row.why).toBe("“too long” · “shorter please”");
        expect(row.open).toBeNull();
    });

    it("leaves learnId null on every other kind", () => {
        const [row] = buildNeedsYouRows({ ...base, attention: [item({ kind: "dag-gate" })] });
        expect(row.learnId).toBeNull();
    });

    it("is not hidden by a project filter, since a learning is tied to no channel", () => {
        const rows = buildNeedsYouRows({
            ...base,
            channelProject: new Map([["c1", "alpha"]]),
            attention: [learn, item({ key: "g", channelid: "c-other" })],
            filter: "alpha",
        });
        expect(rows.map((r) => r.key)).toEqual(["learn:skill:notes#short"]);
    });
});

describe("buildNeedsYouRows: a project's Overview", () => {
    const attention = [
        item({ key: "mine", kind: "run-land-held", channelid: "c-mine" }),
        item({ key: "theirs", kind: "run-land-held", channelid: "c-theirs" }),
        item({ key: "learn:skill:notes#k", kind: "learn-proposal", channelid: "", learnid: "skill:notes#k" }),
    ];
    const channelProject = new Map([
        ["c-mine", "arc"],
        ["c-theirs", "other"],
    ]);

    it("keeps the project's held run and leaves another project's out", () => {
        const rows = buildNeedsYouRows({ ...base, attention, channelProject, filter: "arc", learn: false });
        expect(rows.map((r) => r.key)).toEqual(["mine"]);
    });

    it("leaves learned rules out when told to, and keeps them by default, as the Cockpit does", () => {
        const keys = (learn?: boolean) =>
            buildNeedsYouRows({ ...base, attention, channelProject, filter: "arc", learn }).map((r) => r.key);
        expect(keys(false)).not.toContain("learn:skill:notes#k");
        expect(keys(undefined)).toContain("learn:skill:notes#k");
    });
});

describe("whyLines", () => {
    const row = (wireKind: string, why: string) => ({ why, run: { wireKind } as StripRow["run"] });

    it("lists each thing a run left unverified, without the prefix or the wsh runs ack hint", () => {
        const why =
            "Not verified: the CDP scenario could not start; the packaged build. Once read, accept it with `wsh runs ack r-1`.";
        expect(whyLines(row("run-unverified", why))).toEqual([
            "the CDP scenario could not start",
            "the packaged build",
        ]);
    });

    it("keeps one reason as one line", () => {
        const why = "Not verified: Final exited 3. Once read, accept it with `wsh runs ack r-1`.";
        expect(whyLines(row("run-unverified", why))).toEqual(["Final exited 3"]);
    });

    it("keeps any other kind's why whole, and gives nothing for none", () => {
        expect(whyLines(row("dag-gate", "a; b."))).toEqual(["a; b."]);
        expect(whyLines(row("run-unverified", "  "))).toEqual([]);
    });
});

describe("foldNeedsYouRows", () => {
    const rows = (kinds: string[]) =>
        buildNeedsYouRows({
            ...base,
            attention: kinds.map((kind, i) => item({ key: `k${i}`, kind })),
        });

    it("leaves two of a kind as rows", () => {
        const out = foldNeedsYouRows(rows(["run-unverified", "run-unverified"]));
        expect(out.map((e) => e.kind)).toEqual(["row", "row"]);
    });

    it("folds three of a kind into one group where the first stood", () => {
        const out = foldNeedsYouRows(rows(["dag-gate", "run-unverified", "run-unverified", "run-unverified"]));
        expect(out.map((e) => e.kind)).toEqual(["row", "group"]);
        const g = out[1];
        expect(g.kind === "group" && g.rows.map((r) => r.key)).toEqual(["k1", "k2", "k3"]);
        expect(g.kind === "group" && g.kindLabel).toBe("Run to confirm");
    });

    it("never folds a learned rule", () => {
        const learn = (i: number) =>
            item({ key: `learn:skill:notes#${i}`, kind: "learn-proposal", channelid: "", learnid: `skill:notes#${i}` });
        const out = foldNeedsYouRows(buildNeedsYouRows({ ...base, attention: [learn(1), learn(2), learn(3)] }));
        expect(out.map((e) => e.kind)).toEqual(["row", "row", "row"]);
    });
});

describe("groupAge", () => {
    const day = 86_400_000;
    const now = 10 * day;
    const at = (...since: (number | null)[]) => since.map((waitingSince) => ({ waitingSince }));

    it("reads newest to oldest, the unit once when both share it", () => {
        expect(groupAge(at(now - 4 * day, now - 5 * day), now)).toBe("4–5d");
    });

    it("keeps both units when they differ", () => {
        expect(groupAge(at(now - 3 * 3_600_000, now - 2 * day), now)).toBe("3h–2d");
    });

    it("reads one age when they read the same, and skips rows with no age", () => {
        expect(groupAge(at(now - 5 * day, now - 5 * day - 1000, null), now)).toBe("5d");
        expect(groupAge(at(null), now)).toBe("");
    });
});
