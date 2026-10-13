// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    buildConsumers,
    BURN_WARN_TOKENS,
    canPick,
    canSleep,
    closePickedConfirm,
    closePickedLabel,
    holdOrder,
    PANEL_WIDTH,
    panelPlacement,
    pickedRows,
    pickState,
    ramBar,
    ramLabel,
    sleepingByProject,
    staleLine,
    stopWorkerMessage,
    switchToastText,
    togglePickAll,
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
            // the roster's label carries the version (modelLabel): "opus 5.5"
            [vm("opus", { model: "opus 5.5" }), vm("sonnet"), vm("pi", { agent: "pi", model: "opus 5.5" })],
            "ram"
        );
        const byId = Object.fromEntries(view.groups[0].rows.map((r) => [r.id, r]));
        expect([byId.opus.opus, byId.opus.canSonnet]).toEqual([true, true]);
        expect([byId.sonnet.opus, byId.sonnet.canSonnet]).toEqual([false, false]);
        expect([byId.pi.opus, byId.pi.canSonnet]).toEqual([false, false]);
    });

    it("puts a sleeping agent in a last Sleeping group with no RAM, whatever it ranks", () => {
        const dag = { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" };
        const sleeping = { since: 1, freedBytes: 330 * MB };
        const view = buildConsumers(
            reading([
                agent("zzz", { rambytes: 5 * GB }),
                agent("nap"),
                agent("w1", { rambytes: 1 * MB, dag }),
                agent("nap2", { rambytes: 9 * GB }),
            ]),
            [vm("zzz"), vm("nap", { sleeping }), vm("w1"), vm("nap2", { sleeping })],
            "ram"
        );
        expect(view.groups.map((g) => [g.key, g.label])).toEqual([
            ["agents", undefined],
            ["85548d0b-aaaa", "Run 85548d0b"],
            ["sleeping", "Sleeping"],
        ]);
        const asleep = view.groups[2].rows;
        expect(ids(asleep)).toEqual(["nap", "nap2"]); // no RAM to rank by: by name
        expect(asleep.every((r) => r.sleeping && r.ramBytes === undefined && !r.canSleep && !r.canSonnet)).toBe(true);
        expect(
            view.groups
                .slice(0, 2)
                .flatMap((g) => g.rows)
                .some((r) => r.sleeping)
        ).toBe(false);
    });

    it("keeps the Sleeping group last when holdOrder holds the rows", () => {
        const awake = [vm("a"), vm("nap")];
        const opened = holdOrder(
            buildConsumers(
                reading([agent("nap", { rambytes: 2 * GB }), agent("a", { rambytes: 1 * GB })]),
                awake,
                "ram"
            ),
            null
        );
        expect(opened.order).toEqual(["nap", "a"]);
        // nap falls asleep while the panel is open: its held place is first, its group stays last
        const roster = [vm("a"), vm("nap", { sleeping: { since: 1, freedBytes: 0 } })];
        const next = holdOrder(
            buildConsumers(reading([agent("nap"), agent("a", { rambytes: 1 * GB })]), roster, "ram"),
            opened.order
        );
        expect(next.view.groups.map((g) => g.key)).toEqual(["agents", "sleeping"]);
        expect(next.order).toEqual(["a", "nap"]);
    });

    it("offers Sleep only to an awake idle claude, pi or agy agent that belongs to no run", () => {
        const dag = { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" };
        const slept = { since: 1, freedBytes: 0 };
        const view = buildConsumers(
            reading([
                agent("claude"),
                agent("pi"),
                agent("agy"),
                agent("codex"),
                agent("busy"),
                agent("asking"),
                agent("nap"),
                agent("worker", { dag }),
                agent("lead"),
            ]),
            [
                vm("claude", { state: "idle" }),
                vm("lead", { state: "idle", runId: "85548d0b-aaaa" }),
                vm("pi", { state: "idle", agent: "pi" }),
                vm("agy", { state: "idle", agent: "agy" }),
                vm("codex", { state: "idle", agent: "codex" }),
                vm("busy", { state: "working" }),
                vm("asking", { state: "asking" }),
                vm("nap", { state: "idle", sleeping: slept }),
                vm("worker", { state: "idle" }),
            ],
            "ram"
        );
        const rows = view.groups.flatMap((g) => g.rows);
        const can = Object.fromEntries(rows.map((r) => [r.id, r.canSleep]));
        expect(can).toEqual({
            claude: true,
            pi: true,
            agy: true,
            codex: false,
            busy: false,
            asking: false,
            nap: false,
            worker: false,
            lead: false,
        });
        expect(rows.find((r) => r.id === "nap")?.sleeping).toBe(true);
        expect(rows.find((r) => r.id === "claude")?.sleeping).toBe(false);
    });

    it("canSleep reads the roster agent alone: no run, no terminal, not asleep", () => {
        expect(canSleep(vm("a", { state: "idle" }))).toBe(true);
        expect(canSleep(vm("a", { state: "idle", agent: "agy" }))).toBe(true);
        expect(canSleep(vm("a", { state: "idle", kind: "terminal" }))).toBe(false);
        expect(canSleep(vm("a", { state: "idle", kind: "background" }))).toBe(false);
        expect(canSleep(vm("a", { state: "idle", agent: undefined }))).toBe(false);
        expect(canSleep(vm("a", { state: "idle", runId: "r" }))).toBe(false);
        expect(canSleep(vm("a", { state: "working" }))).toBe(false);
    });

    it("never offers → Sonnet to a sleeping agent", () => {
        const view = buildConsumers(
            reading([agent("nap")]),
            [vm("nap", { model: "opus", state: "idle", sleeping: { since: 1, freedBytes: 0 } })],
            "ram"
        );
        expect(view.groups[0].rows[0].opus).toBe(true);
        expect(view.groups[0].rows[0].canSonnet).toBe(false);
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

    it("never warns about a sleeping agent, whatever it spent before it slept", () => {
        const view = buildConsumers(
            reading([
                agent("nap", { tokens: [bucket("claude-opus-4-8", BURN_WARN_TOKENS + 1)] }),
                agent("a", { tokens: [bucket("claude-opus-4-8", 10)] }),
            ]),
            [vm("nap", { sleeping: { since: 1, freedBytes: 0 } }), vm("a")],
            "ram"
        );
        expect(view.groups.flatMap((g) => g.rows).filter((r) => r.burn)).toEqual([]);
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

    it("totals the whole app: its own processes and every agent, read or not in the roster", () => {
        const view = buildConsumers(
            reading([agent("a", { rambytes: 300 * MB }), agent("ghost", { rambytes: 100 * MB }), agent("b")], {
                interfacebytes: 1 * GB,
                serverbytes: 121 * MB,
                terminalsbytes: 12 * MB,
            }),
            [vm("a"), vm("b")],
            "ram"
        );
        expect(view.appBytes).toBe(1 * GB + 121 * MB + 12 * MB + 300 * MB + 100 * MB);
    });

    it("sums every agent's RAM for the arcterm section, read or not in the roster", () => {
        const view = buildConsumers(
            reading([agent("a", { rambytes: 300 * MB }), agent("ghost", { rambytes: 100 * MB }), agent("b")]),
            [vm("a"), vm("b")],
            "ram"
        );
        expect(view.agentsBytes).toBe(400 * MB);
    });

    it("counts no agents as 0 and agents with no reading as absent", () => {
        expect(buildConsumers(reading([]), [], "ram").agentsBytes).toBe(0);
        expect(buildConsumers(reading([agent("a")]), [vm("a")], "ram").agentsBytes).toBeUndefined();
    });

    it("leaves the total absent until something is read", () => {
        expect(buildConsumers(reading([agent("a")]), [vm("a")], "ram").appBytes).toBeUndefined();
    });
});

describe("holdOrder", () => {
    const dag = { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" };
    const roster = [vm("a"), vm("b"), vm("w1"), vm("c")];
    // a's RAM is the heaviest, b's tokens are
    const read = (extra: ConsumerAgent[] = []) =>
        reading([
            agent("a", { rambytes: 900 * MB, tokens: [bucket("claude-sonnet-4-6", 10)] }),
            agent("b", { rambytes: 100 * MB, tokens: [bucket("claude-sonnet-4-6", 5000)] }),
            agent("w1", { rambytes: 50 * MB, tokens: [bucket("claude-sonnet-4-6", 1)], dag }),
            ...extra,
        ]);
    const order = (v: ReturnType<typeof holdOrder>) => v.view.groups.flatMap((g) => ids(g.rows));

    it("keeps the view's ranking when the panel opens", () => {
        const opened = holdOrder(buildConsumers(read(), roster, "ram"), null);
        expect(order(opened)).toEqual(["a", "b", "w1"]);
        expect(opened.order).toEqual(["a", "b", "w1"]);
    });

    it("does not move a row when a reading ranks by tokens", () => {
        const opened = holdOrder(buildConsumers(read(), roster, "ram"), null);
        const switched = holdOrder(buildConsumers(read(), roster, "tokens"), opened.order);
        expect(order(switched)).toEqual(["a", "b", "w1"]);
        expect(switched.view.groups.map((g) => g.key)).toEqual(["agents", "85548d0b-aaaa"]);
    });

    it("puts an agent that started since after the held rows, and drops one that ended", () => {
        const opened = holdOrder(buildConsumers(read(), roster, "ram"), null);
        const next = holdOrder(
            buildConsumers(
                reading([
                    agent("c", { rambytes: 5 * GB }),
                    agent("b", { rambytes: 100 * MB }),
                    agent("w1", { rambytes: 50 * MB, dag }),
                ]),
                roster,
                "ram"
            ),
            opened.order
        );
        expect(order(next)).toEqual(["b", "c", "w1"]);
        expect(next.order).toEqual(["b", "c", "w1"]);
    });
});

describe("panelPlacement", () => {
    const view = { width: 1600, height: 900 };

    it("rises from a footer opener, its right edge on the opener's", () => {
        expect(panelPlacement({ top: 880, bottom: 896, right: 1400 }, view)).toEqual({
            right: 200,
            bottom: 26,
            origin: "bottom right",
        });
    });

    it("drops from an app bar opener", () => {
        expect(panelPlacement({ top: 8, bottom: 32, right: 1100 }, view)).toEqual({
            right: 500,
            top: 38,
            origin: "top right",
        });
    });

    it("stays inside the window at either edge", () => {
        expect(panelPlacement({ top: 880, bottom: 896, right: 1598 }, view).right).toBe(8);
        expect(panelPlacement({ top: 880, bottom: 896, right: 100 }, view).right).toBe(1600 - PANEL_WIDTH - 8);
    });

    it("keeps the footer's right end when nothing opened it", () => {
        expect(panelPlacement(null, view)).toEqual({ right: 16, bottom: 42, origin: "bottom right" });
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

describe("ramBar", () => {
    it("splits the used RAM into arcterm's share and the rest", () => {
        const bar = ramBar({ totalBytes: 32 * GB, freeBytes: 8 * GB, appBytes: 4 * GB });
        expect(bar.appPct).toBeCloseTo(12.5);
        expect(bar.otherPct).toBeCloseTo(62.5);
        expect(bar.otherBytes).toBe(20 * GB);
    });

    it("caps arcterm's share at what is in use", () => {
        const bar = ramBar({ totalBytes: 16 * GB, freeBytes: 14 * GB, appBytes: 3 * GB });
        expect(bar.appPct).toBeCloseTo(12.5);
        expect(bar.otherPct).toBe(0);
    });

    it("draws nothing before arcterm's RAM is read, or with no total", () => {
        expect(ramBar({ totalBytes: 16 * GB, freeBytes: 8 * GB }).appPct).toBe(0);
        expect(ramBar({ totalBytes: 0, freeBytes: 0, appBytes: GB })).toEqual({
            appPct: 0,
            otherPct: 0,
            otherBytes: 0,
        });
    });
});

describe("buildConsumers with the Resource Manager snapshot", () => {
    const resmon = (rows: ProcessInfo[], cpu: number): ResMonSnapshotData => ({
        supported: true,
        ready: true,
        ts: 1,
        cpu: 14,
        mem: GB,
        totalmem: 16 * GB,
        busycpu: false,
        busymem: false,
        groups: [
            { key: "job:1", ownerkind: "agenttab", ownerid: "blk-a", label: "a", killable: true, cpu, mem: GB, rows },
        ],
    });
    const p = (pid: number, depth: number, name: string, extra: Partial<ProcessInfo> = {}): ProcessInfo => ({
        pid,
        depth,
        name,
        mem: 10 * MB,
        mempct: 0,
        cpu: 0,
        numthreads: 1,
        ...extra,
    });

    it("gives an agent its CPU and heaviest command by its block; an asleep agent and one without a group get none", () => {
        const snap = resmon(
            [
                p(1, 0, "claude.exe", { tag: "agent" }),
                p(2, 1, "git.exe", { command: "git.exe log --all -p", mem: 203 * MB }),
            ],
            4.1
        );
        const view = buildConsumers(
            reading([agent("a"), agent("b"), agent("nap")]),
            [vm("a"), vm("b"), vm("nap", { sleeping: { since: 1, freedBytes: 0 } })],
            "ram",
            snap
        );
        const byId = Object.fromEntries(view.groups.flatMap((g) => g.rows).map((r) => [r.id, r]));
        expect(byId.a.work).toMatchObject({
            cpu: 4.1,
            command: { label: "git log --all -p", pid: 2, ownerid: "blk-a" },
        });
        expect(byId.b.work).toBeUndefined();
        expect(byId.nap.work).toBeUndefined();
    });

    it("leaves work out with no snapshot", () => {
        const view = buildConsumers(reading([agent("a")]), [vm("a")], "ram");
        expect(view.groups[0].rows[0].work).toBeUndefined();
    });
});

describe("picking agents to close", () => {
    const sleeping = { since: 1, freedBytes: 0 };
    const view = buildConsumers(
        reading([
            agent("work", { rambytes: 900 * MB }),
            agent("idle", { rambytes: 300 * MB }),
            agent("lead", { rambytes: 200 * MB }),
            agent("w1", { rambytes: 500 * MB, dag: { channelid: "c", runid: "run12345678", taskid: "1" } }),
            agent("z1"),
            agent("z2"),
        ]),
        [
            vm("work", { name: "Lumen" }),
            vm("idle", { state: "idle" }),
            vm("lead", { state: "idle", runId: "run12345678" }),
            vm("w1", { runId: "child" }),
            vm("z1", { state: "idle", sleeping }),
            vm("z2", { state: "idle", sleeping }),
        ],
        "ram"
    );
    const rowsOf = (key: string) => view.groups.find((g) => g.key === key)!.rows;
    const all = view.groups.flatMap((g) => g.rows);
    const byId = (id: string) => all.find((r) => r.id === id)!;

    it("picks only an agent no run owns: a run's lead and workers close with their run", () => {
        expect(all.filter(canPick).map((r) => r.id)).toEqual(["work", "idle", "z1", "z2"]);
    });

    it("reads a group's tick over its pickable rows", () => {
        expect(pickState(new Set(), rowsOf("sleeping"))).toBe("none");
        expect(pickState(new Set(["z1"]), rowsOf("sleeping"))).toBe("some");
        expect(pickState(new Set(["z1", "z2"]), rowsOf("sleeping"))).toBe("all");
        // the lead and the worker can never be ticked, so they do not hold the agents' tick at "some"
        expect(pickState(new Set(["work", "idle"]), [...rowsOf("agents"), ...rowsOf("run12345678")])).toBe("all");
    });

    it("ticks a whole group, and a second press clears it, leaving the other picks", () => {
        const once = togglePickAll(new Set(["work"]), rowsOf("sleeping"));
        expect([...once].sort()).toEqual(["work", "z1", "z2"]);
        expect([...togglePickAll(once, rowsOf("sleeping"))]).toEqual(["work"]);
        // part of the group ticked: the press ticks the rest
        expect([...togglePickAll(new Set(["z1"]), rowsOf("sleeping"))].sort()).toEqual(["z1", "z2"]);
    });

    it("keeps the picks still on view, in the panel's order, and never one a run owns", () => {
        expect(ids(pickedRows(view, new Set(["z2", "gone", "work", "w1", "lead"])))).toEqual(["work", "z2"]);
    });

    it("words the Close button with how many it closes and how many of them are working", () => {
        expect(closePickedLabel([byId("z1")])).toBe("Close 1 agent");
        expect(closePickedLabel([byId("z1"), byId("idle")])).toBe("Close 2 agents");
        expect(closePickedLabel([byId("z1"), byId("work")])).toBe("Close 2 agents · 1 working");
    });

    it("asks first only when a picked agent is working, naming it", () => {
        expect(closePickedConfirm([byId("z1"), byId("idle")])).toBeNull();
        expect(closePickedConfirm([byId("z1"), byId("work")])).toBe(
            "Lumen is working. Closing stops it mid-turn and can't be undone; its conversation stays under Conversations."
        );
        expect(closePickedConfirm([byId("work"), { ...byId("idle"), state: "working", name: "Fern" }])).toBe(
            "Lumen and Fern are working. Closing stops them mid-turn and can't be undone; their conversations stay under Conversations."
        );
    });
});

describe("sleepingByProject", () => {
    const sleeping = { since: 1, freedBytes: 0 };
    const rowsOf = (vms: AgentVM[]) =>
        buildConsumers(reading(vms.map((v) => agent(v.id))), vms, "tokens").groups.find((g) => g.key === "sleeping")!
            .rows;

    it("bunches the sleeping agents by project, each where its first agent sat, keeping their order", () => {
        const rows = rowsOf([
            vm("a1", { name: "a", state: "idle", sleeping, project: "arcterm" }),
            vm("t1", { name: "b", state: "idle", sleeping, project: "thesis" }),
            vm("a2", { name: "c", state: "idle", sleeping, project: "arcterm" }),
            vm("h1", { name: "d", state: "idle", sleeping, project: undefined }),
        ]);
        expect(sleepingByProject(rows).map((p) => [p.project, ids(p.rows)])).toEqual([
            ["arcterm", ["a1", "a2"]],
            ["thesis", ["t1"]],
            ["Home", ["h1"]],
        ]);
    });

    it("ticks one project's sleeping agents at once with the group tick helpers", () => {
        const rows = rowsOf([
            vm("a1", { state: "idle", sleeping, project: "arcterm" }),
            vm("t1", { state: "idle", sleeping, project: "thesis" }),
        ]);
        const thesis = sleepingByProject(rows).find((p) => p.project === "thesis")!;
        expect([...togglePickAll(new Set(), thesis.rows)]).toEqual(["t1"]);
        expect(pickState(new Set(["t1"]), thesis.rows)).toBe("all");
    });
});
