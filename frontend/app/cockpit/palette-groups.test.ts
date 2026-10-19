// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    assembleAllGroups,
    assembleScopeGroups,
    capGroups,
    meetsNameFloor,
    type AllGroupsInput,
    type GroupableItem,
} from "./palette-groups";
import { fuzzyScore } from "./palette-match";

const item = (key: string, kind: GroupableItem["kind"], search: string): GroupableItem => ({ key, kind, search });

// Builds a string that contains `q` as a maximally scattered subsequence: every query character is
// followed by filler, so it matches but never contiguously. Stands in for a long session task that a
// prose goal happens to be a subsequence of.
const scattered = (q: string) => [...q].map((c) => c + "zz").join("");

describe("meetsNameFloor", () => {
    it("accepts a surface name typed against its row", () => {
        expect(meetsNameFloor("usage", "Go to Usage")).toBe(true);
        expect(meetsNameFloor("rad", "Radar")).toBe(true);
    });
    it("rejects a scattered hit that is still a subsequence", () => {
        expect(fuzzyScore("rad", "rank runs beside")).not.toBeNull(); // it really does match...
        expect(meetsNameFloor("rad", "rank runs beside")).toBe(false); // ...but not like a name
    });
    it("rejects a prose goal that only scatter-matches", () => {
        const goal = "fix the flaky projectname test";
        expect(meetsNameFloor(goal, scattered(goal))).toBe(false);
    });
    it("lets everything through on an empty query", () => {
        expect(meetsNameFloor("  ", "anything")).toBe(true);
    });
});

describe("assembleAllGroups", () => {
    const radar = item("surface:radar", "surface", "Radar");
    const cockpit = item("surface:cockpit", "surface", "Cockpit (home)");
    const juno = item("agent:juno", "agent", "juno Palette: rank runs beside sessions");
    const launch = [item("launch:quick", "launch", ""), item("launch:orchestrate", "launch", "")];
    const asGoalItem = item("as-goal", "as-goal", "");
    const input = (over: Partial<AllGroupsInput<GroupableItem>>): AllGroupsInput<GroupableItem> => ({
        query: "",
        ranked: [],
        recent: [],
        goto: [],
        launch: [],
        asGoalItem: null,
        asGoal: false,
        projectLabel: "#waveterm",
        needs: [],
        start: [],
        ...over,
    });

    it("shows Recent then Go to on an empty query, without repeating a recent surface", () => {
        const groups = assembleAllGroups(input({ recent: [radar], goto: [cockpit, radar] }));
        expect(groups.map((g) => g.label)).toEqual(["Recent", "Go to"]);
        expect(groups[1].items.map((i) => i.key)).toEqual(["surface:cockpit"]);
    });

    it("treats a whitespace-only query as empty", () => {
        const groups = assembleAllGroups(input({ query: "   ", recent: [radar], goto: [cockpit], launch, asGoalItem }));
        expect(groups.map((g) => g.label)).toEqual(["Recent", "Go to"]);
    });

    it("returns nothing when the text names nothing and there is nowhere to start it", () => {
        expect(assembleAllGroups(input({ query: "add a runs group to the palette", ranked: [juno] }))).toStrictEqual([]);
    });

    it("groups a note row under Notes", () => {
        const note = item("note:2026-10-08-radar", "note", "Radar ideas");
        const groups = assembleAllGroups(input({ query: "radar", ranked: [note] }));
        expect(groups.map((g) => g.label)).toEqual(["Notes"]);
    });

    it("drops scattered matches from All, so they take no slot", () => {
        const groups = assembleAllGroups(input({ query: "rad", ranked: [radar, juno], launch, asGoalItem }));
        expect(groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(["surface:radar", "as-goal"]);
    });

    it("leads with names and trails one quiet 'as a goal' row when the text names something", () => {
        const groups = assembleAllGroups(input({ query: "rad", ranked: [radar], launch, asGoalItem }));
        expect(groups.map((g) => g.key)).toEqual(["surface", "as-goal"]);
        expect(groups[0].items[0].key).toBe("surface:radar"); // Enter navigates
        expect(groups[1].label).toBe("Or as a goal");
    });

    it("leads with the launch block when nothing names the text", () => {
        const goal = "add a runs group to the palette";
        const groups = assembleAllGroups(input({ query: goal, ranked: [juno], launch, asGoalItem }));
        expect(groups.map((g) => g.key)).toEqual(["launch"]);
        expect(groups[0]).toMatchObject({ rich: true, label: "Start in #waveterm" });
        expect(groups[0].items[0].key).toBe("launch:quick"); // Enter starts
    });

    it("expands the 'as a goal' row into the launch block, names following", () => {
        const groups = assembleAllGroups(input({ query: "rad", ranked: [radar], launch, asGoalItem, asGoal: true }));
        expect(groups.map((g) => g.key)).toEqual(["launch", "surface"]);
    });

    it("offers no goal row when there is no project to start in", () => {
        const groups = assembleAllGroups(input({ query: "rad", ranked: [radar] }));
        expect(groups.map((g) => g.key)).toEqual(["surface"]);
    });

    it("leads an empty query with at most three Needs you rows, then Start, Recent, Go to", () => {
        const needs = ["a", "b", "c", "d"].map((k) => item(`needs:${k}`, "needs", ""));
        const newRun = item("start:new-run", "start", "New run…");
        const groups = assembleAllGroups(input({ needs, start: [newRun], recent: [radar], goto: [cockpit] }));
        expect(groups.map((g) => g.key)).toEqual(["needs", "start", "recent", "goto"]);
        expect(groups[0].items.map((i) => i.key)).toEqual(["needs:a", "needs:b", "needs:c"]);
        expect(groups[0]).toMatchObject({ label: "Needs you · 4", hidden: 1, asking: true });
    });

    it("does not repeat a Start row already under Recent", () => {
        const newRun = item("start:new-run", "start", "New run…");
        const groups = assembleAllGroups(input({ start: [newRun], recent: [newRun] }));
        expect(groups.map((g) => g.key)).toEqual(["recent"]);
    });

    it("ranks a start row by name, above the goal block", () => {
        const newRun = item("start:new-run", "start", "New run…");
        const groups = assembleAllGroups(input({ query: "new run", ranked: [newRun], launch, asGoalItem }));
        expect(groups.map((g) => g.key)).toEqual(["start", "as-goal"]);
        expect(groups[0].items[0].key).toBe("start:new-run"); // Enter opens the window, not a Quick run
    });

    it("keeps a start row that is not the best match", () => {
        const newRun = item("start:new-run", "start", "New run…");
        const runner = item("agent:runner", "agent", "new runner");
        const groups = assembleAllGroups(input({ query: "new run", ranked: [runner, newRun] }));
        expect(groups.map((g) => g.key)).toEqual(["agent", "start"]);
    });

    it("ranks a verb row by name, so 'cancel' lists runs to cancel above the goal block", () => {
        const cancel = item("action:run:cancel:run:1", "action", "Cancel run fix flaky verify");
        const groups = assembleAllGroups(input({ query: "cancel", ranked: [cancel], launch, asGoalItem }));
        expect(groups.map((g) => g.key)).toEqual(["action", "as-goal"]);
        expect(groups[0].label).toBe("Actions");
        expect(groups[0].items[0].key).toBe("action:run:cancel:run:1"); // Enter cancels, not a Quick run
    });

    it("leads 'cancel' with the goal block when nothing can be cancelled", () => {
        const groups = assembleAllGroups(input({ query: "cancel", ranked: [], launch, asGoalItem }));
        expect(groups.map((g) => g.key)).toEqual(["launch"]);
    });

    it("leads with the kind holding the best match", () => {
        const cmd = item("c1", "command", "Usage stats");
        const surface = item("surface:usage", "surface", "Usage");
        const groups = assembleAllGroups(input({ query: "usage", ranked: [cmd, surface] }));
        expect(groups.map((g) => g.key)).toEqual(["command", "surface"]);
    });
});

describe("assembleScopeGroups", () => {
    const widen = item("widen", "widen", "");
    const base = { order: ["run" as const], label: "Runs", noun: "runs", widenItem: widen };

    it("groups what matched", () => {
        const groups = assembleScopeGroups({ ...base, rows: [item("r1", "run", "Diff repo")], query: "diff" });
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe("Runs");
    });
    it("says nothing matched and offers to widen the same text", () => {
        const [g] = assembleScopeGroups({ ...base, rows: [], query: " vault " });
        expect(g.emptyText).toBe("No runs match “vault”.");
        expect(g.items.map((i) => i.key)).toEqual(["widen"]);
    });
    it("offers no widen row when nothing is typed", () => {
        const [g] = assembleScopeGroups({ ...base, rows: [], query: "" });
        expect(g.emptyText).toBe("No runs yet.");
        expect(g.items).toEqual([]);
    });
});

describe("capGroups", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(`s${i}`, "session", `session ${i}`));

    it("caps a long group and reports what it dropped", () => {
        const [g] = capGroups([{ key: "session", label: "Sessions", items: many(12) }], 5);
        expect(g.items).toHaveLength(5);
        expect(g.overflow).toBe(7);
    });
    it("counts rows left out before capping as overflow", () => {
        const [g] = capGroups([{ key: "needs", label: "Needs you", items: many(3), hidden: 2 }], 5);
        expect(g.overflow).toBe(2);
    });
    it("never caps the launch block", () => {
        const [g] = capGroups([{ key: "launch", label: "Start", rich: true, items: many(8) }], 5);
        expect(g.items).toHaveLength(8);
        expect(g.overflow).toBe(0);
    });
});
