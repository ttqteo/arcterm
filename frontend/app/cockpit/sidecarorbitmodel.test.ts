// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    coreLabel,
    coreTone,
    dashKey,
    frameOf,
    laneBars,
    needHow,
    nodeLine,
    nodeTone,
    orbitPoints,
    pings,
    ringDash,
    screenState,
    selectionAfter,
    waitingIds,
    type DashSel,
} from "./sidecarorbitmodel";
import type { SidecarNeed, SidecarRunBox, SidecarSnapshot, SidecarSpan, SidecarTile } from "./sidecartypes";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

function tile(id: string, over: Partial<SidecarTile> = {}): SidecarTile {
    return { id, name: id, runtime: "Claude", state: "working", ...over };
}

function need(key: string, over: Partial<SidecarNeed> = {}): SidecarNeed {
    return { key, kind: "jarvis", who: "arcterm", since: NOW - MIN, text: "A gate waits", ...over };
}

function ask(id: string, over: Partial<SidecarNeed> = {}): SidecarNeed {
    return need(`ask:${id}`, {
        kind: "ask",
        id,
        who: id,
        text: "Merge into main?",
        options: ["Merge", "Keep the branch"],
        answerable: true,
        askKey: `k-${id}`,
        ...over,
    });
}

function question(id: string): SidecarNeed {
    return need(`q:${id}`, { kind: "question", id, who: id, text: "Bạn chọn (a) hay (b)?" });
}

function run(over: Partial<SidecarRunBox> = {}): SidecarRunBox {
    return { id: "r1", leadId: "lead", title: "Sidecar orbit", done: 7, total: 9, failed: false, ...over };
}

const noStrain: Pick<SidecarSnapshot, "needs" | "strain"> = {};
const strain = (level: "amber" | "red", by: "ram" | "cpu"): SidecarSnapshot["strain"] => ({
    level,
    by,
    working: 3,
    heavyJobs: 1,
    heavy: [],
});

describe("screenState", () => {
    it("a failed need wins, even over a critical strain", () => {
        const needs = [ask("a"), need("g", { failed: true })];
        expect(screenState({ needs, strain: strain("red", "ram") })).toBe("failed");
    });

    it("a red strain is critical, with or without needs", () => {
        expect(screenState({ needs: [], strain: strain("red", "ram") })).toBe("critical");
        expect(screenState({ needs: [ask("a")], strain: strain("red", "ram") })).toBe("critical");
    });

    it("an amber strain is high", () => {
        expect(screenState({ needs: [ask("a")], strain: strain("amber", "cpu") })).toBe("high");
    });

    it("nothing waiting and no strain is calm, with the needs left out or empty", () => {
        expect(screenState(noStrain)).toBe("calm");
        expect(screenState({ needs: [] })).toBe("calm");
    });

    it("something waiting and no strain is normal", () => {
        expect(screenState({ needs: [ask("a")] })).toBe("normal");
    });
});

describe("frameOf", () => {
    it("failed and critical are framed red, high amber, calm and normal not at all", () => {
        expect(frameOf("failed")).toBe("error");
        expect(frameOf("critical")).toBe("error");
        expect(frameOf("high")).toBe("warning");
        expect(frameOf("normal")).toBe("none");
        expect(frameOf("calm")).toBe("none");
    });
});

describe("coreTone and coreLabel", () => {
    it("error when a need failed, muted at 0 needs, else warning", () => {
        expect(coreTone({ needs: [ask("a"), need("g", { failed: true })] })).toBe("error");
        expect(coreTone({ needs: [] })).toBe("muted");
        expect(coreTone({})).toBe("muted");
        expect(coreTone({ needs: [ask("a")] })).toBe("warning");
    });

    it("names a RAM strain on the core's bottom line, and nothing else", () => {
        expect(coreLabel({ strain: strain("red", "ram") })).toBe("⚠ RAM critical");
        expect(coreLabel({ strain: strain("amber", "ram") })).toBe("⚠ RAM high");
        expect(coreLabel({ strain: strain("amber", "cpu") })).toBeNull();
        expect(coreLabel({})).toBeNull();
    });
});

describe("nodeLine", () => {
    const since = NOW - 3 * MIN;

    it("an asking agent: its question and the age", () => {
        const t = tile("a", {
            state: "asking",
            since,
            ask: { question: "merge into main?", options: ["Yes"], answerable: true, key: "k" },
        });
        expect(nodeLine(t, undefined, NOW, 0)).toBe("asks: merge into main? · 3m");
    });

    it("cuts a long question to 32 characters, the ellipsis included, and joins its lines", () => {
        const long = tile("a", {
            state: "asking",
            since,
            ask: { question: "x".repeat(40), options: [], answerable: false },
        });
        expect(nodeLine(long, undefined, NOW, 0)).toBe(`asks: ${"x".repeat(31)}… · 3m`);
        const exact = tile("a", {
            state: "asking",
            since,
            ask: { question: "y".repeat(32), options: [], answerable: false },
        });
        expect(nodeLine(exact, undefined, NOW, 0)).toBe(`asks: ${"y".repeat(32)} · 3m`);
        const lines = tile("a", {
            state: "asking",
            since,
            ask: { question: "Merge it\n\n  now?", options: [], answerable: false },
        });
        expect(nodeLine(lines, undefined, NOW, 0)).toBe("asks: Merge it now? · 3m");
    });

    it("an asking agent with no ask still says it asks", () => {
        expect(nodeLine(tile("a", { state: "asking", since }), undefined, NOW, 0)).toBe("asks · 3m");
    });

    it("working", () => {
        expect(nodeLine(tile("w", { since: NOW - 11 * MIN }), undefined, NOW, 0)).toBe("working · 11m");
    });

    it("a run's lead: the run's progress and its age", () => {
        const r = run({ since: NOW - 94 * MIN });
        expect(nodeLine(tile("lead", { since }), r, NOW, 0)).toBe("run · 7 of 9 · 1h 34m");
        expect(nodeLine(tile("lead", { since }), run(), NOW, 0)).toBe("run · 7 of 9");
    });

    it("another agent while a run shows keeps its own line", () => {
        expect(nodeLine(tile("w", { since }), run({ since: NOW - 94 * MIN }), NOW, 0)).toBe("working · 3m");
    });

    it("a lead that asks or failed says so before the run", () => {
        const r = run({ since: NOW - 94 * MIN });
        const asks = tile("lead", { state: "asking", since, ask: { question: "ok?", options: [], answerable: false } });
        expect(nodeLine(asks, r, NOW, 0)).toBe("asks: ok? · 3m");
        expect(nodeLine(tile("lead", { since: NOW - 4 * MIN, failed: true }), r, NOW, 0)).toBe("failed · 4m");
    });

    it("failed", () => {
        expect(nodeLine(tile("f", { failed: true, since: NOW - 4 * MIN }), undefined, NOW, 0)).toBe("failed · 4m");
    });

    it("finished: the lines it changed when there are some, else the age", () => {
        const done = tile("d", { state: "review", since: NOW - 4 * MIN, diff: { adds: 4005, dels: 755 } });
        expect(nodeLine(done, undefined, NOW, 0)).toBe("finished · +4005 −755");
        expect(nodeLine({ ...done, diff: undefined }, undefined, NOW, 0)).toBe("finished · 4m");
        expect(nodeLine({ ...done, diff: { adds: 0, dels: 0 } }, undefined, NOW, 0)).toBe("finished · 4m");
        expect(nodeLine(tile("i", { state: "idle", since: NOW - 4 * MIN }), undefined, NOW, 0)).toBe("finished · 4m");
    });

    it("leaves the age out when the tile has no since", () => {
        expect(nodeLine(tile("w"), undefined, NOW, 0)).toBe("working");
        expect(nodeLine(tile("i", { state: "idle" }), undefined, NOW, 0)).toBe("finished");
    });

    it("adds the time since the snapshot arrived", () => {
        expect(nodeLine(tile("w", { since }), undefined, NOW, 2 * MIN)).toBe("working · 5m");
    });
});

describe("nodeTone and pings", () => {
    const none = new Set<string>();

    it("warning for an asking agent or one with a question row", () => {
        expect(nodeTone(tile("a", { state: "asking" }), none)).toBe("warning");
        expect(nodeTone(tile("q", { state: "review" }), new Set(["q"]))).toBe("warning");
        expect(nodeTone(tile("q", { state: "review" }), none)).toBe("secondary");
    });

    it("error for a failed agent, success for a working one, secondary for a finished one", () => {
        expect(nodeTone(tile("f", { failed: true }), none)).toBe("error");
        expect(nodeTone(tile("f", { state: "asking", failed: true }), none)).toBe("error");
        expect(nodeTone(tile("w"), none)).toBe("success");
        expect(nodeTone(tile("r", { state: "review" }), none)).toBe("secondary");
        expect(nodeTone(tile("i", { state: "idle" }), none)).toBe("secondary");
    });

    it("pings for warning and error only", () => {
        expect(pings(tile("a", { state: "asking" }), none)).toBe(true);
        expect(pings(tile("q", { state: "review" }), new Set(["q"]))).toBe(true);
        expect(pings(tile("f", { failed: true }), none)).toBe(true);
        expect(pings(tile("w"), none)).toBe(false);
        expect(pings(tile("r", { state: "review" }), none)).toBe(false);
    });

    it("waitingIds holds the agents with a question row", () => {
        expect([...waitingIds([ask("a"), question("q1"), need("g"), question("q2")])].sort()).toEqual(["q1", "q2"]);
        expect(waitingIds(undefined).size).toBe(0);
    });
});

describe("orbitPoints", () => {
    it("no points for none", () => {
        expect(orbitPoints(0, 100, 100, 80, 60)).toEqual([]);
    });

    it("one point is at the top", () => {
        const [p] = orbitPoints(1, 100, 100, 80, 60);
        expect(p.x).toBeCloseTo(100, 0);
        expect(p.y).toBeCloseTo(40, 0);
    });

    it("four points: top, right, bottom, left (clockwise)", () => {
        const ps = orbitPoints(4, 100, 100, 80, 60);
        const want = [
            [100, 40],
            [180, 100],
            [100, 160],
            [20, 100],
        ];
        expect(ps).toHaveLength(4);
        ps.forEach((p, i) => {
            expect(p.x).toBeCloseTo(want[i][0], 0);
            expect(p.y).toBeCloseTo(want[i][1], 0);
        });
    });

    it("eight points on an ellipse, 45 degrees apart from the top", () => {
        const ps = orbitPoints(8, 100, 100, 80, 60);
        const k = Math.SQRT1_2;
        const want = [
            [100, 40],
            [100 + 80 * k, 100 - 60 * k],
            [180, 100],
            [100 + 80 * k, 100 + 60 * k],
            [100, 160],
            [100 - 80 * k, 100 + 60 * k],
            [20, 100],
            [100 - 80 * k, 100 - 60 * k],
        ];
        expect(ps).toHaveLength(8);
        ps.forEach((p, i) => {
            expect(p.x).toBeCloseTo(want[i][0], 0);
            expect(p.y).toBeCloseTo(want[i][1], 0);
        });
    });
});

describe("ringDash", () => {
    const c = 2 * Math.PI * 10;

    it("the share of the circumference, and the rest as the gap", () => {
        const half = ringDash(50, 10);
        expect(half.dash).toBeCloseTo(c / 2, 6);
        expect(half.gap).toBeCloseTo(c / 2, 6);
        expect(ringDash(0, 10)).toEqual({ dash: 0, gap: c });
        expect(ringDash(100, 10).gap).toBeCloseTo(0, 6);
    });

    it("clamps to 0..100, and an unknown share is empty", () => {
        expect(ringDash(150, 10).dash).toBeCloseTo(c, 6);
        expect(ringDash(-5, 10)).toEqual({ dash: 0, gap: c });
        expect(ringDash(undefined, 10)).toEqual({ dash: 0, gap: c });
        expect(ringDash(Number.NaN, 10)).toEqual({ dash: 0, gap: c });
    });
});

describe("laneBars", () => {
    const W = 720; // 6 px a minute over the 2 hours
    const span = (state: SidecarSpan["state"], fromMin: number, toMin?: number): SidecarSpan => ({
        state,
        from: NOW - fromMin * MIN,
        ...(toMin == null ? {} : { to: NOW - toMin * MIN }),
    });

    it("a span inside the window: its place and length, and its state", () => {
        expect(laneBars([span("working", 60, 30)], NOW, W)).toEqual([{ x: 360, w: 180, state: "working" }]);
    });

    it("a span with no end runs to now", () => {
        expect(laneBars([span("asking", 10)], NOW, W)).toEqual([{ x: 660, w: 60, state: "asking" }]);
    });

    it("a span that began before the window's edge starts at the edge", () => {
        expect(laneBars([span("working", 180, 60)], NOW, W)).toEqual([{ x: 0, w: 360, state: "working" }]);
    });

    it("a span that ended before the window's edge is dropped, one that ended at it too", () => {
        expect(laneBars([span("working", 180, 121), span("finished", 150, 120)], NOW, W)).toEqual([]);
    });

    it("at least 2 px wide, and kept inside the lane's right edge", () => {
        const [tiny] = laneBars([{ state: "failed", from: NOW - 60 * MIN, to: NOW - 60 * MIN + 1000 }], NOW, W);
        expect(tiny).toEqual({ x: 360, w: 2, state: "failed" });
        const [edge] = laneBars([{ state: "working", from: NOW }], NOW, W);
        expect(edge).toEqual({ x: W - 2, w: 2, state: "working" });
    });

    it("keeps the spans' order, and draws nothing in a lane with no width", () => {
        const bars = laneBars([span("working", 100, 80), span("asking", 80, 60), span("finished", 60)], NOW, W);
        expect(bars.map((b) => b.state)).toEqual(["working", "asking", "finished"]);
        expect(laneBars([span("working", 60, 30)], NOW, 0)).toEqual([]);
    });
});

describe("needHow", () => {
    it("an answerable ask lists its first four options by key", () => {
        expect(needHow(ask("a"))).toBe("1 Merge · 2 Keep the branch");
        expect(needHow(ask("a", { options: ["a", "b", "c", "d", "e", "f"] }))).toBe("1 a · 2 b · 3 c · 4 d");
    });

    it("an ask whose answer went out says Sent", () => {
        expect(needHow(ask("a", { sent: true }))).toBe("Sent");
    });

    it("an ask that cannot be answered here, and a question, are answered in the main window", () => {
        expect(needHow(ask("a", { answerable: false }))).toBe("Enter: reply in the main window");
        expect(needHow(ask("a", { askKey: undefined }))).toBe("Enter: reply in the main window");
        expect(needHow(ask("a", { options: [] }))).toBe("Enter: reply in the main window");
        expect(needHow(question("q"))).toBe("Enter: reply in the main window");
    });

    it("a Jarvis row opens in the main window", () => {
        expect(needHow(need("g"))).toBe("Enter: open in the main window");
    });
});

describe("dashKey", () => {
    const needs = [ask("a1"), question("q1"), need("g1")];
    const nodes = [tile("n1"), tile("n2"), tile("n3")];
    const inNeeds = (index: number): DashSel => ({ area: "needs", index, key: needs[index].key });
    const inOrbit = (index: number): DashSel => ({ area: "orbit", index, key: nodes[index].id });

    it("down and up move through Needs you, from none to the first, and stop at the ends", () => {
        expect(dashKey("ArrowDown", "orbit", null, needs, nodes)).toEqual({ kind: "select", sel: inNeeds(0) });
        expect(dashKey("ArrowUp", "orbit", null, needs, nodes)).toEqual({ kind: "select", sel: inNeeds(0) });
        expect(dashKey("ArrowDown", "orbit", inNeeds(0), needs, nodes)).toEqual({ kind: "select", sel: inNeeds(1) });
        expect(dashKey("ArrowDown", "orbit", inNeeds(2), needs, nodes)).toEqual({ kind: "select", sel: inNeeds(2) });
        expect(dashKey("ArrowUp", "orbit", inNeeds(1), needs, nodes)).toEqual({ kind: "select", sel: inNeeds(0) });
        expect(dashKey("ArrowUp", "orbit", inNeeds(0), needs, nodes)).toEqual({ kind: "select", sel: inNeeds(0) });
    });

    it("up and down from a node go to the first row of Needs you; with no rows they are no one's", () => {
        expect(dashKey("ArrowDown", "orbit", inOrbit(1), needs, nodes)).toEqual({ kind: "select", sel: inNeeds(0) });
        expect(dashKey("ArrowDown", "orbit", null, [], nodes)).toBeNull();
    });

    it("up and down work on the compact window too", () => {
        expect(dashKey("ArrowDown", "compact", inNeeds(0), needs, nodes)).toEqual({ kind: "select", sel: inNeeds(1) });
    });

    it("left and right move through the orbit's nodes on P, wrapping; from none to the first", () => {
        expect(dashKey("ArrowRight", "orbit", null, needs, nodes)).toEqual({ kind: "select", sel: inOrbit(0) });
        expect(dashKey("ArrowLeft", "orbit", null, needs, nodes)).toEqual({ kind: "select", sel: inOrbit(0) });
        expect(dashKey("ArrowRight", "orbit", inOrbit(0), needs, nodes)).toEqual({ kind: "select", sel: inOrbit(1) });
        expect(dashKey("ArrowRight", "orbit", inOrbit(2), needs, nodes)).toEqual({ kind: "select", sel: inOrbit(0) });
        expect(dashKey("ArrowLeft", "orbit", inOrbit(0), needs, nodes)).toEqual({ kind: "select", sel: inOrbit(2) });
        expect(dashKey("ArrowRight", "orbit", inNeeds(1), needs, nodes)).toEqual({ kind: "select", sel: inOrbit(0) });
        expect(dashKey("ArrowRight", "orbit", null, needs, [])).toBeNull();
    });

    it("left and right are not the compact window's", () => {
        expect(dashKey("ArrowRight", "compact", inOrbit(0), needs, nodes)).toBeNull();
        expect(dashKey("ArrowLeft", "compact", null, needs, nodes)).toBeNull();
    });

    it("Enter opens an ask's or a question's agent, a Jarvis row's need, a node's agent", () => {
        expect(dashKey("Enter", "orbit", inNeeds(0), needs, nodes)).toEqual({ kind: "open", id: "a1" });
        expect(dashKey("Enter", "orbit", inNeeds(1), needs, nodes)).toEqual({ kind: "open", id: "q1" });
        expect(dashKey("Enter", "orbit", inNeeds(2), needs, nodes)).toEqual({ kind: "need", key: "g1" });
        expect(dashKey("Enter", "orbit", inOrbit(1), needs, nodes)).toEqual({ kind: "open", id: "n2" });
    });

    it("Enter with nothing selected, or a selection past the list, does nothing", () => {
        expect(dashKey("Enter", "orbit", null, needs, nodes)).toBeNull();
        expect(dashKey("Enter", "orbit", { area: "needs", index: 7 }, needs, nodes)).toBeNull();
        expect(dashKey("Enter", "orbit", { area: "orbit", index: 7 }, needs, nodes)).toBeNull();
        expect(dashKey("Enter", "compact", { area: "needs", index: 0 }, [], [])).toBeNull();
    });

    it("1-9 answers the selected ask with a 0-based option, naming its agent and its ask", () => {
        expect(dashKey("1", "orbit", inNeeds(0), needs, nodes)).toEqual({
            kind: "answer",
            id: "a1",
            option: 0,
            key: "k-a1",
        });
        expect(dashKey("2", "compact", inNeeds(0), needs, nodes)).toEqual({
            kind: "answer",
            id: "a1",
            option: 1,
            key: "k-a1",
        });
    });

    it("1-9 answers only an answerable, unsent ask that has the option", () => {
        expect(dashKey("3", "orbit", inNeeds(0), needs, nodes)).toBeNull(); // two options
        const sent = [ask("a1", { sent: true })];
        expect(dashKey("1", "orbit", { area: "needs", index: 0 }, sent, nodes)).toBeNull();
        const plain = [ask("a1", { answerable: false })];
        expect(dashKey("1", "orbit", { area: "needs", index: 0 }, plain, nodes)).toBeNull();
        expect(dashKey("1", "orbit", inNeeds(1), needs, nodes)).toBeNull(); // a question
        expect(dashKey("1", "orbit", inNeeds(2), needs, nodes)).toBeNull(); // a Jarvis row
        expect(dashKey("1", "orbit", inOrbit(0), needs, nodes)).toBeNull(); // a node
        expect(dashKey("1", "orbit", null, needs, nodes)).toBeNull();
    });

    it("other keys are not its own", () => {
        expect(dashKey("x", "orbit", inNeeds(0), needs, nodes)).toBeNull();
        expect(dashKey("Escape", "orbit", inNeeds(0), needs, nodes)).toBeNull();
        expect(dashKey("0", "orbit", inNeeds(0), needs, nodes)).toBeNull();
    });
});

describe("selectionAfter", () => {
    const n = (...keys: string[]): SidecarNeed[] => keys.map((k) => need(k));
    const t = (...ids: string[]): SidecarTile[] => ids.map((id) => tile(id));

    it("no selection stays none", () => {
        expect(selectionAfter(null, n("a", "b"), t("x"))).toBeNull();
    });

    it("follows the same need when the list changes around it", () => {
        const sel: DashSel = { area: "needs", index: 1, key: "b" };
        expect(selectionAfter(sel, n("z", "a", "b"), [])).toEqual({ area: "needs", index: 2, key: "b" });
        expect(selectionAfter(sel, n("b", "c"), [])).toEqual({ area: "needs", index: 0, key: "b" });
    });

    it("follows the same node by id", () => {
        const sel: DashSel = { area: "orbit", index: 0, key: "x" };
        expect(selectionAfter(sel, [], t("y", "x"))).toEqual({ area: "orbit", index: 1, key: "x" });
    });

    it("a need that went: the row now at its index, clamped to the new list", () => {
        const sel: DashSel = { area: "needs", index: 1, key: "b" };
        expect(selectionAfter(sel, n("a", "c", "d"), [])).toEqual({ area: "needs", index: 1, key: "c" });
        expect(selectionAfter(sel, n("a"), [])).toEqual({ area: "needs", index: 0, key: "a" });
    });

    it("a selection with no key clamps by its index", () => {
        expect(selectionAfter({ area: "orbit", index: 5 }, [], t("x", "y"))).toEqual({
            area: "orbit",
            index: 1,
            key: "y",
        });
        expect(selectionAfter({ area: "needs", index: 1 }, n("a", "b"), [])).toEqual({
            area: "needs",
            index: 1,
            key: "b",
        });
    });

    it("an emptied list leaves no selection", () => {
        expect(selectionAfter({ area: "needs", index: 0, key: "a" }, [], t("x"))).toBeNull();
        expect(selectionAfter({ area: "orbit", index: 0, key: "x" }, n("a"), [])).toBeNull();
    });
});
