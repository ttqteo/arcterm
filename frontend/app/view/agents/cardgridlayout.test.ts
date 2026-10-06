// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    askerAt,
    buildGridCards,
    CARD_MIN_PX,
    cardMatchesChip,
    cardShare,
    columnJump,
    columnNavIds,
    GRID_THREE_COL_MIN_PX,
    gridColumnCount,
    isBackgroundedRun,
    resolveCursor,
    splitGridColumns,
    toggleChip,
    withActiveRunLeads,
} from "./cardgridlayout";
import type { Lineage, RunInfo } from "./runlineage";

const isRun = (s: string) => s.startsWith("L");

describe("splitGridColumns", () => {
    it("puts runs in column 1 and agents in column 2 when both kinds are present", () => {
        expect(splitGridColumns(["a1", "L1", "a2", "L2", "a3"], isRun)).toEqual([
            ["L1", "L2"],
            ["a1", "a2", "a3"],
        ]);
    });
    it("alternates one kind across both columns, as the old grid did", () => {
        expect(splitGridColumns(["a1", "a2", "a3"], isRun)).toEqual([["a1", "a3"], ["a2"]]);
        expect(splitGridColumns(["L1", "L2"], isRun)).toEqual([["L1"], ["L2"]]);
    });
    it("spreads one kind across three columns once the grid is wide enough", () => {
        const four = ["a1", "a2", "a3", "a4"];
        expect(splitGridColumns(four, isRun, gridColumnCount(GRID_THREE_COL_MIN_PX))).toEqual([
            ["a1", "a4"],
            ["a2"],
            ["a3"],
        ]);
        expect(splitGridColumns(four, isRun, gridColumnCount(GRID_THREE_COL_MIN_PX - 1))).toEqual([
            ["a1", "a3"],
            ["a2", "a4"],
        ]);
        // never more columns than cards
        expect(splitGridColumns(["a1", "a2"], isRun, 3)).toEqual([["a1"], ["a2"]]);
    });
    it("keeps runs and agents to one column each however wide the grid", () => {
        expect(splitGridColumns(["a1", "L1", "a2"], isRun, 3)).toEqual([["L1"], ["a1", "a2"]]);
    });
    it("reads an unmeasured grid as two columns", () => {
        expect(gridColumnCount(0)).toBe(2);
    });
    it("gives a lone card one full-width column", () => {
        expect(splitGridColumns(["L1"], isRun)).toEqual([["L1"]]);
    });
    it("returns no columns for no cards", () => {
        expect(splitGridColumns([], isRun)).toEqual([]);
    });
});

describe("cardShare", () => {
    it("doubles the share of a card that needs you and raises its floor", () => {
        expect(cardShare(false, false)).toEqual({ grow: 1, minPx: CARD_MIN_PX.agent });
        expect(cardShare(false, true)).toEqual({ grow: 2, minPx: CARD_MIN_PX.agentAsk });
        expect(cardShare(true, false)).toEqual({ grow: 1, minPx: CARD_MIN_PX.run });
        expect(cardShare(true, true)).toEqual({ grow: 2, minPx: CARD_MIN_PX.runAsk });
    });
});

const vm = (id: string, state: AgentVM["state"] = "working") => ({ id, name: id, task: "", state }) as AgentVM;
const R: RunInfo = { runId: "R", channelId: "C", title: "t", project: "p" };

describe("buildGridCards", () => {
    const lineage: Lineage = {
        roles: {
            L: { kind: "lead", runId: "R" },
            w1: { kind: "worker", leadRunId: "R", taskId: "t1" },
            w2: { kind: "worker", leadRunId: "R", taskId: "t2" },
        },
        runs: { R },
    };

    it("folds a run's workers into its lead's card", () => {
        const shown = [vm("a"), vm("w1"), vm("L"), vm("w2")];
        expect(buildGridCards(shown, lineage, shown).map((c) => `${c.kind}:${c.id}`)).toEqual(["agent:a", "run:L"]);
    });
    it("leadless run: one card at its first worker's place", () => {
        const shown = [vm("a"), vm("w1"), vm("w2")];
        const cards = buildGridCards(shown, lineage, shown);
        expect(cards.map((c) => `${c.kind}:${c.id}`)).toEqual(["agent:a", "run:run:R"]);
        expect(cards[1]).toMatchObject({ kind: "run", lead: undefined });
    });
    it("a lead parked or filtered out of view keeps its run's card while a worker is shown", () => {
        const roster = [vm("a"), vm("w1"), vm("L", "idle")];
        const cards = buildGridCards([vm("a"), vm("w1")], lineage, roster);
        expect(cards.map((c) => `${c.kind}:${c.id}`)).toEqual(["agent:a", "run:L"]);
        expect(cards[1]).toMatchObject({ kind: "run", lead: { id: "L" } });
    });
    it("no card for a run when neither its lead nor a worker is shown", () => {
        expect(buildGridCards([vm("a")], lineage, [vm("a"), vm("w1"), vm("L")]).map((c) => c.id)).toEqual(["a"]);
    });
});

describe("withActiveRunLeads", () => {
    const lin = (status: string): Lineage => ({
        roles: { L: { kind: "lead", runId: "R" } },
        runs: { R: { ...R, dag: { status } as RunInfo["dag"] } },
    });
    it("appends an in-scope lead whose run is still going, though the lead is parked", () => {
        const out = withActiveRunLeads([vm("a")], [vm("a"), vm("L", "idle")], lin("running"));
        expect(out.map((a) => a.id)).toEqual(["a", "L"]);
    });
    it("leaves a finished run's lead parked, and never duplicates a shown lead", () => {
        expect(withActiveRunLeads([vm("a")], [vm("a"), vm("L", "idle")], lin("done")).map((a) => a.id)).toEqual(["a"]);
        expect(withActiveRunLeads([vm("L")], [vm("L")], lin("running")).map((a) => a.id)).toEqual(["L"]);
    });
});

describe("isBackgroundedRun", () => {
    const run = { kind: "run", id: "L", run: R, lead: vm("L") } as const;
    it("hides a run whose lead was backgrounded, until something in it needs you", () => {
        expect(isBackgroundedRun(run, new Set(["L"]), false)).toBe(true);
        expect(isBackgroundedRun(run, new Set(["L"]), true)).toBe(false);
        expect(isBackgroundedRun(run, new Set(), false)).toBe(false);
        expect(isBackgroundedRun({ kind: "agent", id: "L", agent: vm("L") }, new Set(["L"]), false)).toBe(false);
    });
});

describe("askerAt", () => {
    const roster = [vm("a", "asking"), vm("w1", "asking")];
    const rows = { "row:L:t1": { askAgentId: "w1", actions: [] }, "row:L:t2": { actions: [] } };
    it("is the card's agent on a card, and the row's asking worker on a task row", () => {
        expect(askerAt("a", roster, rows)?.id).toBe("a");
        expect(askerAt("row:L:t1", roster, rows)?.id).toBe("w1");
        expect(askerAt("row:L:t2", roster, rows)).toBeUndefined();
        expect(askerAt(undefined, roster, rows)).toBeUndefined();
    });
});

describe("cardMatchesChip", () => {
    it("matches a run card on what its run needs, a plain card on state", () => {
        const run = { kind: "run", id: "L", run: R, lead: vm("L", "working") } as const;
        expect(cardMatchesChip(run, "asking", true)).toBe(true);
        expect(cardMatchesChip(run, "asking", false)).toBe(false);
        expect(cardMatchesChip(run, "working", false)).toBe(true);
        expect(cardMatchesChip({ kind: "agent", id: "a", agent: vm("a", "idle") }, "idle", false)).toBe(true);
        expect(cardMatchesChip({ kind: "agent", id: "a", agent: vm("a", "idle") }, "all", false)).toBe(true);
    });
    it("puts a run up for review once it has finished, not while its lead stands by", () => {
        const run = (status: string) =>
            ({
                kind: "run",
                id: "L",
                run: { ...R, dag: { status } as RunInfo["dag"] },
                lead: vm("L", "idle"),
            }) as const;
        expect(cardMatchesChip(run("running"), "idle", false)).toBe(false);
        expect(cardMatchesChip(run("done"), "idle", false)).toBe(true);
        expect(cardMatchesChip(run("cancelled"), "idle", false)).toBe(true);
    });
});

describe("columnNavIds", () => {
    it("lists each card then its rows, column by column", () => {
        const cols = [
            [{ kind: "run", id: "L", run: R } as const],
            [{ kind: "agent", id: "a", agent: vm("a") } as const],
        ];
        expect(columnNavIds(cols, (c) => (c.id === "L" ? ["row:L:t1", "row:L:t2"] : []))).toEqual([
            ["L", "row:L:t1", "row:L:t2"],
            ["a"],
        ]);
    });
});

describe("columnJump", () => {
    const cols = [
        ["L", "row:L:t1", "M"],
        ["a", "b"],
    ];
    const cardOf = (id: string) => (id.startsWith("row:") ? id.split(":")[1] : id);
    it("moves to the same card index in the other column", () => {
        expect(columnJump(cols, cardOf, "M", 1)).toBe("b");
        expect(columnJump(cols, cardOf, "b", -1)).toBe("M");
    });
    it("moves from a task row by its card's index", () => {
        expect(columnJump(cols, cardOf, "row:L:t1", 1)).toBe("a");
    });
    it("stays put at the edge or with one column", () => {
        expect(columnJump(cols, cardOf, "L", -1)).toBeUndefined();
        expect(columnJump([["a"]], cardOf, "a", 1)).toBeUndefined();
    });
    it("steps one column at a time across three", () => {
        const three = [["a", "d"], ["b", "e"], ["c"]];
        expect(columnJump(three, cardOf, "d", 1)).toBe("e");
        expect(columnJump(three, cardOf, "e", 1)).toBe("c");
        expect(columnJump(three, cardOf, "c", -1)).toBe("b");
        expect(columnJump(three, cardOf, "c", 1)).toBeUndefined();
    });
});

describe("resolveCursor", () => {
    it("keeps a valid cursor, else follows the alias, else takes the first", () => {
        expect(resolveCursor("b", ["a", "b"], {})).toBe("b");
        expect(resolveCursor("w1", ["L", "row:L:t1"], { w1: "row:L:t1" })).toBe("row:L:t1");
        expect(resolveCursor("gone", ["a"], {})).toBe("a");
        expect(resolveCursor("a", [], {})).toBeUndefined();
    });
});

describe("toggleChip", () => {
    it("selects a tab, and a second press on it returns to everything", () => {
        expect(toggleChip("all", "asking")).toBe("asking");
        expect(toggleChip("asking", "asking")).toBe("all");
        expect(toggleChip("asking", "working")).toBe("working");
        expect(toggleChip("all", "all")).toBe("all");
    });
});
