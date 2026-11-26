// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { planMixLine, planModelRows, workersModelName } from "./newrunplan";

const tasks: DagPlanPreviewTask[] = [
    { id: "t-1", title: "Wire fields", lane: 1 },
    { id: "t-2", title: "Migrate pins", lane: 1, deps: ["t-1"], model: "claude-sonnet-5-5" },
    { id: "t-3", title: "Docs", lane: 2, deps: ["t-1", "t-2"], model: "sonnet" },
];
const noLines: DagPlanPreviewTask[] = [
    { id: "t-1", title: "One", lane: 1 },
    { id: "t-2", title: "Two", lane: 2, deps: [] },
];

describe("planModelRows", () => {
    it("on Reviewer picks, a Model line is live and a task without one is picked at review", () => {
        const rows = planModelRows(tasks, { picks: true, model: "opus-5-5" });
        expect(rows.map((r) => [r.model, r.tone])).toEqual([
            ["at review", "at-review"],
            ["sonnet-5-5 · plan", "plan-live"],
            ["sonnet · plan", "plan-live"],
        ]);
    });

    it("off Reviewer picks, a Model line is ignored and the rest run on the workers model", () => {
        const rows = planModelRows(tasks, { picks: false, model: "opus-5-5" });
        expect(rows.map((r) => [r.model, r.tone])).toEqual([
            ["opus-5-5", "workers"],
            ["sonnet-5-5 · plan", "plan-ignored"],
            ["sonnet · plan", "plan-ignored"],
        ]);
    });

    it("a plan with no Model lines runs every task on the workers model", () => {
        const rows = planModelRows(noLines, { picks: false, model: "lead" });
        expect(rows.every((r) => r.model === "lead" && r.tone === "workers")).toBe(true);
    });

    it("joins deps with a comma, and shows a dash for none", () => {
        const rows = planModelRows([...tasks, ...noLines], { picks: false, model: "lead" });
        expect(rows.map((r) => r.needs)).toEqual(["–", "t-1", "t-1, t-2", "–", "–"]);
    });

    it("carries id, title and lane through", () => {
        const [row] = planModelRows(tasks.slice(1, 2), { picks: false, model: "lead" });
        expect(row).toMatchObject({ id: "t-2", title: "Migrate pins", lane: "1" });
    });
});

describe("planMixLine", () => {
    it("on Reviewer picks counts plan lines and review picks, in accent", () => {
        expect(planMixLine(tasks, { picks: true, model: "opus-5-5" })).toEqual({
            text: "2 set by the plan · 1 picked at review",
            accent: true,
        });
    });

    it("off picks with Model lines says they are ignored", () => {
        expect(planMixLine(tasks, { picks: false, model: "opus-5-5" })).toEqual({
            text: "all on opus-5-5 · plan lines ignored",
            accent: false,
        });
    });

    it("off picks with no Model lines names only the workers model", () => {
        expect(planMixLine(noLines, { picks: false, model: "sonnet" })).toEqual({
            text: "all on sonnet",
            accent: false,
        });
    });
});

describe("workersModelName", () => {
    const opus: RoutePin = { runtime: "claude", model: "claude-opus-5-5" };
    const sonnet: RoutePin = { runtime: "claude", model: "sonnet" };

    it("names the workers route when there is one", () => {
        expect(workersModelName(sonnet, opus)).toBe("sonnet");
    });

    it("falls back to the lead's model", () => {
        expect(workersModelName(null, opus)).toBe("opus-5-5");
    });

    it("says lead when neither is known", () => {
        expect(workersModelName(null, null)).toBe("lead");
    });

    // a harness's default model has no id: the route reads as its harness, as cards and chips do (routeFace)
    it("names the harness of a route with no model, never 'default'", () => {
        expect(workersModelName({ runtime: "codex" } as RoutePin, opus)).toBe("codex");
    });
});
