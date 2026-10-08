// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    BURN_WARN_TOKENS,
    buildConsumers,
    ramLabel,
    staleLine,
    stopWorkerMessage,
    switchToastText,
    type ConsumerRow,
} from "./consumers";

const MB = 2 ** 20;
const GB = 2 ** 30;

const vm = (id: string, over: Partial<AgentVM> = {}): AgentVM => ({
    id,
    name: `agent ${id}`,
    task: "",
    state: "working",
    agent: "claude",
    model: "sonnet",
    project: "arcterm",
    ...over,
});

const bucket = (model: string, output: number, cacheread = 0): UsageBucket => ({
    harness: "claude",
    provider: "anthropic",
    model,
    day: "2026-10-08",
    input: 0,
    output,
    reasoning: 0,
    cacheread,
    cachecreate: 0,
    cachecreate1h: 0,
    msgs: 1,
});

const agent = (tabid: string, over: Partial<ConsumerAgent> = {}): ConsumerAgent => ({
    tabid,
    blockid: `blk-${tabid}`,
    tokensread: true,
    ...over,
});

const reading = (
    agents: ConsumerAgent[],
    over: Partial<CommandGetConsumersRtnData> = {}
): CommandGetConsumersRtnData => ({
    totalbytes: 8 * GB,
    availablebytes: 1.3 * GB,
    windowms: 600_000,
    agents,
    ...over,
});

const ids = (rows: ConsumerRow[]) => rows.map((r) => r.id);

describe("buildConsumers", () => {
    it("joins each reading to its roster agent and drops one the roster does not know", () => {
        const view = buildConsumers(reading([agent("a", { rambytes: 300 * MB }), agent("ghost")]), [vm("a")], "ram");
        expect(view.groups).toHaveLength(1);
        expect(view.groups[0].rows.map((r) => [r.id, r.name, r.ramBytes])).toEqual([["a", "agent a", 300 * MB]]);
        expect(view.freeBytes).toBe(1.3 * GB);
        expect(view.totalBytes).toBe(8 * GB);
    });

    it("sorts by RAM heaviest first, an unread value last", () => {
        const view = buildConsumers(
            reading([agent("a", { rambytes: 100 * MB }), agent("b"), agent("c", { rambytes: 900 * MB })]),
            [vm("a"), vm("b"), vm("c")],
            "ram"
        );
        expect(ids(view.groups[0].rows)).toEqual(["c", "a", "b"]);
    });

    it("sorts by tokens of the window", () => {
        const view = buildConsumers(
            reading([
                agent("a", { rambytes: 900 * MB, tokens: [bucket("claude-sonnet-4-6", 10)] }),
                agent("b", { rambytes: 100 * MB, tokens: [bucket("claude-opus-4-8", 5000)] }),
            ]),
            [vm("a"), vm("b")],
            "tokens"
        );
        expect(ids(view.groups[0].rows)).toEqual(["b", "a"]);
        expect(view.groups[0].rows[0].tokens).toBe(5000);
        expect(view.groups[0].rows[0].spendUsd).toBeGreaterThan(0);
    });

    it("counts tokens without cache reads, and prices every class", () => {
        const view = buildConsumers(
            reading([
                agent("a", { tokens: [bucket("claude-opus-4-8", 1000)] }),
                agent("b", { tokens: [bucket("claude-opus-4-8", 1000, 5_000_000)] }),
            ]),
            [vm("a"), vm("b")],
            "tokens"
        );
        const byId = Object.fromEntries(view.groups[0].rows.map((r) => [r.id, r]));
        expect(byId.b.tokens).toBe(1000);
        expect(byId.b.spendUsd).toBeGreaterThan(byId.a.spendUsd ?? 0);
        expect(byId.b.burn).toBe(false); // 5M cache reads are not a burn
    });

    it("leaves tokens absent when the transcript was not read", () => {
        const view = buildConsumers(reading([agent("a", { tokensread: false })]), [vm("a")], "tokens");
        expect(view.groups[0].rows[0].tokens).toBeUndefined();
        expect(view.groups[0].rows[0].spendUsd).toBeUndefined();
    });

    it("groups a run's workers under their run and orders groups by their heaviest row", () => {
        const dag = { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" };
        const view = buildConsumers(
            reading([
                agent("mine", { rambytes: 300 * MB }),
                agent("w1", { rambytes: 2.5 * GB, dag }),
                agent("w2", { rambytes: 200 * MB, dag: { ...dag, taskid: "t-4" } }),
            ]),
            [vm("mine"), vm("w1"), vm("w2")],
            "ram"
        );
        expect(view.groups.map((g) => [g.key, g.label])).toEqual([
            ["85548d0b-aaaa", "Run 85548d0b"],
            ["agents", undefined],
        ]);
        expect(ids(view.groups[0].rows)).toEqual(["w1", "w2"]);
    });

    it("offers → Sonnet only to Claude on Opus", () => {
        const view = buildConsumers(
            reading([agent("opus"), agent("sonnet"), agent("pi")]),
            [vm("opus", { model: "opus" }), vm("sonnet"), vm("pi", { agent: "pi", model: "opus" })],
            "ram"
        );
        const byId = Object.fromEntries(view.groups[0].rows.map((r) => [r.id, r]));
        expect([byId.opus.opus, byId.opus.canSonnet]).toEqual([true, true]);
        expect([byId.sonnet.opus, byId.sonnet.canSonnet]).toEqual([false, false]);
        expect([byId.pi.opus, byId.pi.canSonnet]).toEqual([false, false]);
    });

    it("warns about the busiest agent only above the threshold", () => {
        const over = buildConsumers(
            reading([
                agent("a", { tokens: [bucket("claude-opus-4-8", BURN_WARN_TOKENS + 1)] }),
                agent("b", { tokens: [bucket("claude-opus-4-8", 10)] }),
            ]),
            [vm("a"), vm("b")],
            "ram"
        );
        expect(over.groups[0].rows.filter((r) => r.burn).map((r) => r.id)).toEqual(["a"]);
        const under = buildConsumers(
            reading([agent("a", { tokens: [bucket("claude-opus-4-8", 10)] })]),
            [vm("a")],
            "ram"
        );
        expect(under.groups[0].rows[0].burn).toBe(false);
    });

    it("lists arcterm's own processes and keeps an unread one absent", () => {
        const view = buildConsumers(
            reading([], { serverbytes: 121 * MB, hostbytes: 47 * MB, terminalsbytes: 12 * MB }),
            [],
            "ram"
        );
        expect(view.own).toEqual([
            { label: "Interface", bytes: undefined },
            { label: "Server", bytes: 121 * MB },
            { label: "Host", bytes: 47 * MB },
            { label: "Terminals", bytes: 12 * MB },
        ]);
        expect(view.groups).toEqual([]);
    });
});

describe("copy", () => {
    it("ramLabel shows MB under a gigabyte and GB above", () => {
        expect(ramLabel(300 * MB)).toBe("300 MB");
        expect(ramLabel(2.5 * GB)).toBe("2.5 GB");
    });

    it("stopWorkerMessage names the task and its run, not the tab", () => {
        const row = { name: "arcterm", dag: { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" } } as ConsumerRow;
        expect(stopWorkerMessage(row)).toBe(
            "Stop worker t-3 of run 85548d0b? Its task stops and is not retried; tasks after it wait until you Retry or Skip it in the run."
        );
    });

    it("switchToastText says when the switch lands", () => {
        expect(switchToastText("loom", false, false)).toBe("loom switched to Sonnet");
        expect(switchToastText("loom", true, true)).toBe("loom switched to Sonnet");
        expect(switchToastText("loom", true, false)).toBe("loom switches to Sonnet from its next turn");
    });

    it("staleLine names when the last reading landed", () => {
        expect(staleLine(new Date(2026, 9, 8, 12, 3).getTime())).toBe("Couldn't read usage · last at 12:03");
        expect(staleLine(null)).toBe("Couldn't read usage");
    });
});
