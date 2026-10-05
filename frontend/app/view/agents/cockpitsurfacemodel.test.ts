// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { GridState } from "./agentgrid";
import type { AgentVM } from "./agentsviewmodel";
import {
    cardHasContent,
    dismissKey,
    hiddenAgentIds,
    resolveShownAgent,
    rosterLoadPhase,
    splitRecentlyIdle,
    toggleInSet,
    type ShownAgentInput,
} from "./cockpitsurfacemodel";
import { NO_LINEAGE, type Lineage } from "./runlineage";

function agent(over: Partial<AgentVM>): AgentVM {
    return { id: "t1", name: "claude", task: "", state: "working", ...over };
}

describe("dismissKey", () => {
    it("keys a dismissal by id and idle episode", () => {
        expect(dismissKey({ id: "t1", idleSince: 500 })).toBe("t1:500");
    });
    it("uses an empty episode suffix when idleSince is absent", () => {
        expect(dismissKey({ id: "t1", idleSince: undefined })).toBe("t1:");
    });
});

describe("rosterLoadPhase", () => {
    it("is loading, never empty, while an empty roster has not been read yet", () => {
        expect(rosterLoadPhase(false, 0)).toBe("loading");
    });
    it("is empty once the roster has been read and holds no agents", () => {
        expect(rosterLoadPhase(true, 0)).toBe("empty");
    });
    it("is ready whenever there are agents to show, read or not", () => {
        expect(rosterLoadPhase(false, 2)).toBe("ready");
        expect(rosterLoadPhase(true, 1)).toBe("ready");
    });
});

describe("splitRecentlyIdle", () => {
    const now = 100_000;
    it("routes within-grace, non-dismissed idle agents to recently and the rest to parked", () => {
        // isRecentlyIdle uses agentsviewmodel's IDLE_GRACE_MS; fresh idleSince = recent, old = parked.
        const fresh = agent({ id: "fresh", state: "idle", idleSince: now - 1000 });
        const old = agent({ id: "old", state: "idle", idleSince: now - 10 * 60_000 });
        const { recently, parked } = splitRecentlyIdle([fresh, old], now, new Set());
        expect(recently.map((a) => a.id)).toEqual(["fresh"]);
        expect(parked.map((a) => a.id)).toEqual(["old"]);
    });
    it("moves a dismissed-but-recent agent to parked (dismissal wins)", () => {
        const fresh = agent({ id: "fresh", state: "idle", idleSince: now - 1000 });
        const dismissed = new Set([dismissKey(fresh)]);
        const { recently, parked } = splitRecentlyIdle([fresh], now, dismissed);
        expect(recently).toEqual([]);
        expect(parked.map((a) => a.id)).toEqual(["fresh"]);
    });
});

describe("toggleInSet", () => {
    it("adds an absent id", () => {
        expect([...toggleInSet(new Set(["a"]), "b")].sort()).toEqual(["a", "b"]);
    });
    it("removes a present id", () => {
        expect([...toggleInSet(new Set(["a", "b"]), "a")]).toEqual(["b"]);
    });
    it("does not mutate the input set", () => {
        const input = new Set(["a"]);
        toggleInSet(input, "b");
        expect([...input]).toEqual(["a"]);
    });
});

describe("cardHasContent", () => {
    it("hides a just-launched agent that has reported nothing yet", () => {
        expect(cardHasContent(agent({ state: "working" }), false)).toBe(false);
    });
    it("hides an idle agent that never produced a transcript entry", () => {
        expect(cardHasContent(agent({ state: "idle" }), false)).toBe(false);
    });
    it("shows an agent once its transcript has entries", () => {
        expect(cardHasContent(agent({ state: "idle" }), true)).toBe(true);
    });
    it("shows seeded previous info before the live stream arrives", () => {
        expect(cardHasContent(agent({ previousInfo: [{ kind: "message", text: "hi" }] }), false)).toBe(true);
    });
    it("shows a working agent with a live activity line", () => {
        expect(cardHasContent(agent({ state: "working", activity: "reading a.ts" }), false)).toBe(true);
    });
    it("ignores an idle reason, which the card never renders", () => {
        expect(cardHasContent(agent({ state: "idle", activity: "done" }), false)).toBe(false);
    });
    it("always shows an asking agent", () => {
        expect(cardHasContent(agent({ state: "asking" }), false)).toBe(true);
    });
});

describe("hiddenAgentIds", () => {
    it("hides a plain agent with nothing to show and keeps one with entries", () => {
        const roster = [agent({ id: "empty" }), agent({ id: "talking", state: "idle" })];
        expect([...hiddenAgentIds(roster, new Set(["talking"]), NO_LINEAGE)]).toEqual(["empty"]);
    });
    it("never hides a run's lead or worker, whose rows live on the run card", () => {
        const lineage: Lineage = {
            roles: {
                lead: { kind: "lead", runId: "r1" },
                worker: { kind: "worker", leadRunId: "r1", taskId: "1" },
            },
            runs: { r1: { runId: "r1", channelId: "c1", title: "run", project: "p" } },
        };
        const roster = [agent({ id: "lead" }), agent({ id: "worker" })];
        expect(hiddenAgentIds(roster, new Set(), lineage).size).toBe(0);
    });
    it("hides an agent whose run is not in the lineage, as the grid shows it as a plain card", () => {
        const lineage: Lineage = { roles: { orphan: { kind: "worker", leadRunId: "gone", taskId: "1" } }, runs: {} };
        expect([...hiddenAgentIds([agent({ id: "orphan" })], new Set(), lineage)]).toEqual(["orphan"]);
    });
});

describe("resolveShownAgent", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    const term = { id: "term" };
    const grid = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });
    const input = (over: Partial<ShownAgentInput<{ id: string }>> = {}): ShownAgentInput<{ id: string }> => ({
        focused: undefined,
        agents: [a, b, c],
        terminals: [term],
        firstInOrder: "c",
        grid: grid([]),
        eligible: new Set(["a", "b", "c"]),
        seeded: true,
        ...over,
    });

    it("shows what is focused, a terminal included, whatever the grid says", () => {
        expect(resolveShownAgent(input({ focused: term, grid: grid(["a", "b"]) }))).toEqual({
            agent: term,
            hold: false,
        });
        expect(resolveShownAgent(input({ focused: b, grid: grid(["a"]), seeded: false }))).toEqual({
            agent: b,
            hold: false,
        });
    });
    it("lets a focused agent beat the hold, even while the roster loads and none of the saved cells has arrived", () => {
        const held = { grid: grid(["x", "y"]), eligible: new Set(["a"]), seeded: false };
        expect(resolveShownAgent(input({ ...held, focused: b }))).toEqual({ agent: b, hold: false });
    });
    it("resumes on the grid's focused cell rather than the roster's first agent", () => {
        expect(resolveShownAgent(input({ grid: grid(["a", "b"], "b") })).agent).toBe(b);
    });
    it("falls to the first live cell of an unseeded grid, and to the neighbour of an exited cell once seeded", () => {
        const saved = grid(["a", "b", "c"], "b");
        const live = new Set(["a", "c"]);
        expect(resolveShownAgent(input({ grid: saved, eligible: live, seeded: false })).agent).toBe(a);
        expect(resolveShownAgent(input({ grid: saved, eligible: live, seeded: true })).agent).toBe(c);
    });
    it("holds, showing nothing, while the roster loads and none of the saved cells has arrived", () => {
        const held = { grid: grid(["x", "y"]), eligible: new Set(["a"]), seeded: false };
        expect(resolveShownAgent(input(held))).toEqual({ agent: undefined, hold: true });
        expect(resolveShownAgent(input({ ...held, seeded: true }))).toEqual({ agent: c, hold: false });
    });
    it("without a usable grid takes the first in order, then the first agent, then the first terminal", () => {
        expect(resolveShownAgent(input()).agent).toBe(c);
        expect(resolveShownAgent(input({ firstInOrder: undefined })).agent).toBe(a);
        expect(resolveShownAgent(input({ firstInOrder: "gone" })).agent).toBe(a);
        expect(resolveShownAgent(input({ agents: [], eligible: new Set() })).agent).toBe(term);
    });
    it("shows nothing for an empty roster, and does not hold an empty grid", () => {
        expect(resolveShownAgent(input({ agents: [], terminals: [], eligible: new Set(), seeded: false }))).toEqual({
            agent: undefined,
            hold: false,
        });
    });
});
