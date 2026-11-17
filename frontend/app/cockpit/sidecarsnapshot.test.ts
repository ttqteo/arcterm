// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentAsk, AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { orbitTiles, scopeTiles, sidecarSnapshot, wallAgentIds, type CockpitScope } from "./sidecarsnapshot";
import type { SidecarTile, SidecarTileState } from "./sidecartypes";

const NOW = 1_800_000_000_000;

function agent(over: Partial<AgentVM> & { id: string }): AgentVM {
    return { name: over.id, task: "", state: "idle", ...over };
}

function ask(over: Partial<AgentAsk> = {}): AgentAsk {
    return {
        questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }, { label: "C" }] }],
        askId: "ask-1",
        ...over,
    };
}

function build(agents: AgentVM[], extra: { sent?: string[] } = {}) {
    return sidecarSnapshot(agents, new Set(extra.sent ?? []), NOW);
}

describe("sidecarSnapshot order and counts", () => {
    it("orders asking, working, review, idle, asleep, and counts need you / working / idle", () => {
        const snap = build([
            agent({ id: "asleep", sleeping: { since: NOW - 5000, freedBytes: 1 } }),
            agent({ id: "idle" }),
            agent({ id: "working", state: "working", activeMs: 10 }),
            agent({ id: "review", edited: true }),
            agent({ id: "committed", committed: true }),
            agent({ id: "asking", state: "asking", ask: ask() }),
        ]);
        expect(snap.tiles.map((t) => [t.id, t.state])).toEqual([
            ["asking", "asking"],
            ["working", "working"],
            ["review", "review"],
            ["committed", "review"],
            ["idle", "idle"],
            ["asleep", "asleep"],
        ]);
        expect(snap.counts).toEqual({ asking: 1, working: 1, idle: 4 });
        expect(snap.now).toBe(NOW);
    });

    it("puts the longest-blocked asking agent first and the longest-running working agent first", () => {
        const snap = build([
            agent({ id: "a-short", state: "asking", blockedMs: 1000, ask: ask() }),
            agent({ id: "a-long", state: "asking", blockedMs: 90_000, ask: ask() }),
            agent({ id: "w-short", state: "working", activeMs: 2000 }),
            agent({ id: "w-long", state: "working", activeMs: 600_000 }),
        ]);
        expect(snap.tiles.map((t) => t.id)).toEqual(["a-long", "a-short", "w-long", "w-short"]);
    });

    it("keeps roster order within review, idle and asleep", () => {
        const snap = build([
            agent({ id: "i1" }),
            agent({ id: "s1", sleeping: { since: 1, freedBytes: 1 } }),
            agent({ id: "r1", edited: true }),
            agent({ id: "i2" }),
            agent({ id: "s2", sleeping: { since: 2, freedBytes: 1 } }),
            agent({ id: "r2", committed: true }),
        ]);
        expect(snap.tiles.map((t) => t.id)).toEqual(["r1", "r2", "i1", "i2", "s1", "s2"]);
    });

    it("reads a sleeping agent as asleep even when it has edits", () => {
        const [t] = build([agent({ id: "x", edited: true, sleeping: { since: 5, freedBytes: 1 } })]).tiles;
        expect(t.state).toBe("asleep");
    });

    it("leaves plain terminals and tools out and keeps background agents", () => {
        const snap = build([
            agent({ id: "term", kind: "terminal" }),
            agent({ id: "tool", kind: "terminal", toolId: "lazygit" }),
            agent({ id: "bg", kind: "background", state: "working" }),
            agent({ id: "ag", kind: "agent" }),
            agent({ id: "plain" }),
        ]);
        expect(snap.tiles.map((t) => t.id)).toEqual(["bg", "ag", "plain"]);
        expect(snap.counts).toEqual({ asking: 0, working: 1, idle: 2 });
    });

    it("is empty for an empty roster", () => {
        expect(build([])).toEqual({ now: NOW, counts: { asking: 0, working: 0, idle: 0 }, tiles: [] });
    });

    it("does not mutate the roster", () => {
        const roster = [agent({ id: "i" }), agent({ id: "w", state: "working" })];
        build(roster);
        expect(roster.map((a) => a.id)).toEqual(["i", "w"]);
    });
});

describe("sidecarSnapshot tile fields", () => {
    it("names the project and the runtime with its model", () => {
        const snap = build([
            agent({ id: "c", agent: "claude", model: "opus 5.5", project: "arcterm" }),
            agent({ id: "p", agent: "pi", model: "" }),
            agent({ id: "x", agent: "codex" }),
            agent({ id: "n" }),
        ]);
        const by = Object.fromEntries(snap.tiles.map((t) => [t.id, t]));
        expect(by.c.runtime).toBe("Claude · opus 5.5");
        expect(by.c.project).toBe("arcterm");
        expect(by.p.runtime).toBe("Pi");
        expect(by.x.runtime).toBe("Codex");
        expect(by.n.runtime).toBe("Agent");
        expect(by.n.project).toBeUndefined();
        expect(by.c.name).toBe("c");
    });

    it("carries the context percent, rounded, only when the agent reports one", () => {
        const snap = build([
            agent({ id: "a", usage: { contextpct: 61.4 } }),
            agent({ id: "b", usage: {} }),
            agent({ id: "c" }),
            agent({ id: "d", usage: { contextpct: Number.NaN } }),
        ]);
        const by = Object.fromEntries(snap.tiles.map((t) => [t.id, t]));
        expect(by.a.ctxPct).toBe(61);
        expect(by.b.ctxPct).toBeUndefined();
        expect(by.c.ctxPct).toBeUndefined();
        expect(by.d.ctxPct).toBeUndefined();
    });

    it("takes since from stateSince, else the age fields, else idleSince or sleeping.since", () => {
        const snap = build([
            agent({ id: "ask1", state: "asking", stateSince: 111, blockedMs: 5000, ask: ask() }),
            agent({ id: "ask2", state: "asking", blockedMs: 5000, ask: ask() }),
            agent({ id: "ask3", state: "asking", ask: ask() }),
            agent({ id: "work1", state: "working", stateSince: 222, activeMs: 9000 }),
            agent({ id: "work2", state: "working", activeMs: 9000 }),
            agent({ id: "idle1", idleSince: 333 }),
            agent({ id: "rev1", edited: true, idleSince: 444 }),
            agent({ id: "idle2" }),
            agent({ id: "sl1", idleSince: 1, sleeping: { since: 555, freedBytes: 1 } }),
        ]);
        const by = Object.fromEntries(snap.tiles.map((t) => [t.id, t.since]));
        expect(by.ask1).toBe(111);
        expect(by.ask2).toBe(NOW - 5000);
        expect(by.ask3).toBeUndefined();
        expect(by.work1).toBe(222);
        expect(by.work2).toBe(NOW - 9000);
        expect(by.idle1).toBe(333);
        expect(by.rev1).toBe(444);
        expect(by.idle2).toBeUndefined();
        expect(by.sl1).toBe(555);
    });

    it("gives only an asking agent an ask", () => {
        const snap = build([
            agent({ id: "w", state: "working", ask: ask() }),
            agent({ id: "i", ask: ask() }),
            agent({ id: "a", state: "asking", ask: ask() }),
        ]);
        const by = Object.fromEntries(snap.tiles.map((t) => [t.id, t]));
        expect(by.w.ask).toBeUndefined();
        expect(by.i.ask).toBeUndefined();
        expect(by.a.ask).toBeDefined();
    });
});

describe("sidecarSnapshot asks", () => {
    const askTile = (a: AgentAsk | undefined) => build([agent({ id: "a", state: "asking", ask: a })]).tiles[0].ask!;

    it("answers one single-select question with 1 to 9 options from the tile", () => {
        expect(askTile(ask())).toEqual({
            question: "Which one?",
            options: ["A", "B", "C"],
            answerable: true,
            key: "ask-1",
        });
        const nine = Array.from({ length: 9 }, (_, i) => ({ label: `o${i + 1}` }));
        expect(askTile(ask({ questions: [{ question: "q", options: nine }] })).answerable).toBe(true);
        expect(askTile(ask({ questions: [{ question: "q", options: [{ label: "only" }] }] })).answerable).toBe(true);
    });

    it("does not answer several questions, a multi-select, no options or more than 9 from the tile", () => {
        const opts = [{ label: "A" }, { label: "B" }];
        const two = askTile(
            ask({
                questions: [
                    { question: "first?", options: opts },
                    { question: "second?", options: opts },
                ],
            })
        );
        expect(two.answerable).toBe(false);
        expect(two.question).toBe("first?");
        expect(two.options).toEqual(["A", "B"]);

        expect(askTile(ask({ questions: [{ question: "q", multiSelect: true, options: opts }] })).answerable).toBe(
            false
        );
        expect(askTile(ask({ questions: [{ question: "q", options: [] }] })).answerable).toBe(false);
        expect(askTile(ask({ questions: [{ question: "q" }] })).answerable).toBe(false);
        const ten = Array.from({ length: 10 }, (_, i) => ({ label: `o${i + 1}` }));
        // an ask with no id has nothing an answer could name: it is answered in the main window
        expect(askTile(ask({ askId: undefined })).answerable).toBe(false);
        const tooMany = askTile(ask({ questions: [{ question: "q", options: ten }] }));
        expect(tooMany.answerable).toBe(false);
        expect(tooMany.options).toHaveLength(10);
    });

    it("says what an asking agent with no structured ask waits on, and does not offer to answer it", () => {
        const prompt = build([agent({ id: "p", state: "asking", atPrompt: true })]).tiles[0].ask!;
        expect(prompt.answerable).toBe(false);
        expect(prompt.options).toEqual([]);
        expect(prompt.question).toBe("A permission prompt is waiting in its terminal.");
        const text = build([agent({ id: "t", state: "asking", ask: ask({ questions: [] }) })]).tiles[0].ask!;
        expect(text.answerable).toBe(false);
        expect(text.question).toBe("It asked in its terminal; the choices are there.");
    });

    it("flags sent from the ask's id, and only while that ask is the current one", () => {
        const roster = [
            agent({ id: "a", state: "asking", ask: ask({ askId: "k1" }) }),
            agent({ id: "b", state: "asking", ask: ask({ askId: "k2" }) }),
            agent({ id: "c", state: "asking", ask: ask({ askId: undefined }) }),
        ];
        const by = Object.fromEntries(build(roster, { sent: ["k1", ""] }).tiles.map((t) => [t.id, t]));
        expect(by.a.sent).toBe(true);
        expect(by.b.sent).toBeFalsy();
        expect(by.c.sent).toBeFalsy();
    });
});

describe("wallAgentIds", () => {
    const scope = (over: Partial<CockpitScope> = {}): CockpitScope => ({
        now: NOW,
        dismissed: new Set(),
        backgrounded: new Set(),
        projectFilter: "all",
        liveOnly: false,
        hidden: new Set(),
        ...over,
    });
    const ids = (agents: AgentVM[], over: Partial<CockpitScope> = {}) => [...wallAgentIds(agents, scope(over))].sort();

    it("shows the asking, the working and the agents idle for under 5 minutes, not the older idle ones", () => {
        const agents = [
            agent({ id: "ask", state: "asking" }),
            agent({ id: "work", state: "working" }),
            agent({ id: "fresh", idleSince: NOW - 60_000 }),
            agent({ id: "old", idleSince: NOW - 6 * 3_600_000 }),
            agent({ id: "never" }),
            agent({ id: "asleep", idleSince: NOW - 2 * 86_400_000, sleeping: { since: NOW - 86_400_000 } } as AgentVM),
        ];
        expect(ids(agents)).toEqual(["ask", "fresh", "work"]);
    });

    it("leaves out a dismissed just-finished agent, the Background lane, the hidden and the terminals", () => {
        const agents = [
            agent({ id: "fresh", idleSince: NOW - 60_000 }),
            agent({ id: "bg", state: "working" }),
            agent({ id: "empty", state: "working" }),
            agent({ id: "term", state: "working", kind: "terminal" } as AgentVM),
            agent({ id: "work", state: "working" }),
        ];
        expect(
            ids(agents, {
                dismissed: new Set([`fresh:${NOW - 60_000}`]),
                backgrounded: new Set(["bg"]),
                hidden: new Set(["empty"]),
            })
        ).toEqual(["work"]);
    });

    it("a dismissal of an earlier idle episode does not hide the new one", () => {
        expect(ids([agent({ id: "a", idleSince: NOW - 1000 })], { dismissed: new Set(["a:123"]) })).toEqual(["a"]);
    });

    it("follows the Cockpit's project filter and Live only", () => {
        const agents = [
            agent({ id: "arc", state: "working", project: "arcterm" }),
            agent({ id: "arc-done", project: "arcterm", idleSince: NOW - 1000 }),
            agent({ id: "thesis", state: "working", project: "mit-thesis" }),
        ];
        expect(ids(agents, { projectFilter: "arcterm" })).toEqual(["arc", "arc-done"]);
        expect(ids(agents, { liveOnly: true })).toEqual(["arc", "thesis"]);
    });

    it("keeps an asking agent whatever the project filter or its lane", () => {
        const agents = [
            agent({ id: "arc", state: "working", project: "arcterm" }),
            agent({ id: "thesis", state: "asking", project: "mit-thesis" }),
            agent({ id: "bg-ask", state: "asking", project: "arcterm" }),
            agent({ id: "bg-work", state: "working", project: "arcterm" }),
        ];
        const shown = ids(agents, { projectFilter: "arcterm", backgrounded: new Set(["bg-ask", "bg-work"]) });
        expect([...shown].sort()).toEqual(["arc", "bg-ask", "thesis"]);
    });
});

describe("scopeTiles", () => {
    it("keeps the named tiles in order and the whole roster's counts", () => {
        const snap = build([
            agent({ id: "a", state: "working" }),
            agent({ id: "b" }),
            agent({ id: "c", state: "asking" }),
        ]);
        const scoped = scopeTiles(snap, new Set(["a", "c"]));
        expect(scoped.tiles.map((t) => t.id)).toEqual(["c", "a"]);
        expect(scoped.counts).toEqual(snap.counts);
    });
});

describe("orbitTiles", () => {
    const t = (id: string, state: SidecarTileState, failed = false): SidecarTile => ({
        id,
        name: id,
        runtime: "Claude",
        state,
        ...(failed ? { failed } : {}),
    });
    it("keeps all of 8 or fewer, in order", () => {
        const tiles = [t("a", "working"), t("b", "asking")];
        expect(orbitTiles(tiles, new Set(), 8)).toEqual({ tiles, more: 0 });
    });
    it("past 8: waiting or failed first, then working, then finished, in snapshot order", () => {
        const tiles = [
            t("w1", "working"),
            t("r1", "review"),
            t("a1", "asking"),
            t("w2", "working"),
            t("i1", "idle"),
            t("f1", "working", true),
            t("w3", "working"),
            t("r2", "review"),
            t("q1", "review"),
            t("i2", "idle"),
        ];
        const r = orbitTiles(tiles, new Set(["q1"]), 8); // q1 has a question row: it waits on you
        expect(r.tiles.map((x) => x.id)).toEqual(["a1", "f1", "q1", "w1", "w2", "w3", "r1", "i1"]);
        expect(r.more).toBe(2);
    });
    it("leaves asleep agents out of the orbit and counts them in more", () => {
        const r = orbitTiles([t("s1", "asleep"), t("w1", "working")], new Set(), 8);
        expect(r.tiles.map((x) => x.id)).toEqual(["w1"]);
        expect(r.more).toBe(1);
    });
    it("ranks only past 8: nine awake tiles with an asking one last put it first", () => {
        const tiles = [
            t("w1", "working"),
            t("w2", "working"),
            t("w3", "working"),
            t("w4", "working"),
            t("w5", "working"),
            t("w6", "working"),
            t("w7", "working"),
            t("w8", "working"),
            t("a1", "asking"),
        ];
        const r = orbitTiles(tiles, new Set(), 8);
        expect(r.tiles.map((x) => x.id)).toEqual(["a1", "w1", "w2", "w3", "w4", "w5", "w6", "w7"]);
        expect(r.more).toBe(1);
        // exactly 8 are never ranked: the asking one stays where the snapshot put it
        const eight = [...tiles.slice(0, 7), t("a2", "asking")];
        expect(orbitTiles(eight, new Set(), 8).tiles.map((x) => x.id)).toEqual(eight.map((x) => x.id));
    });
});
