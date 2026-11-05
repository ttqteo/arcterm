import { describe, expect, test } from "vitest";
import { validateScenario } from "./validate.mjs";

describe("validateScenario", () => {
    test("accepts a minimal valid roster", () => {
        const r = validateScenario([{ id: "a", name: "alpha", state: "working" }]);
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });

    test("rejects a bad state, missing id, and duplicate id", () => {
        const r = validateScenario([
            { id: "a", name: "alpha", state: "nope" },
            { name: "no-id", state: "idle" },
            { id: "a", name: "dupe", state: "idle" },
        ]);
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThanOrEqual(3);
    });

    test("rejects an asking agent whose ask has an empty questions array", () => {
        const r = validateScenario([{ id: "a", name: "alpha", state: "asking", ask: { questions: [] } }]);
        expect(r.ok).toBe(false);
    });

    test("allows an asking agent with no ask (plain-text question)", () => {
        const r = validateScenario([{ id: "a", name: "alpha", state: "asking" }]);
        expect(r.ok).toBe(true);
    });
});

import { CHRISTMAS_ASKER, SCENARIOS } from "./scenarios.mjs";

const FIXED_NOW = 1_700_000_000_000;

describe("SCENARIOS", () => {
    test("every scenario produces a valid roster", () => {
        for (const [name, build] of Object.entries(SCENARIOS)) {
            const r = validateScenario(build(FIXED_NOW));
            expect(r.ok, `${name}: ${r.errors.join("; ")}`).toBe(true);
        }
    });

    test("mixed has all three states", () => {
        const states = new Set(SCENARIOS.mixed(FIXED_NOW).map((a) => a.state));
        expect(states.has("asking")).toBe(true);
        expect(states.has("working")).toBe(true);
        expect(states.has("idle")).toBe(true);
    });

    test("all-asking is non-empty and entirely asking", () => {
        const roster = SCENARIOS["all-asking"](FIXED_NOW);
        expect(roster.length).toBeGreaterThan(0);
        expect(roster.every((a) => a.state === "asking")).toBe(true);
    });

    test("christmas-office is valid: one room, one agent finished inside the Finished window and one asking", () => {
        const roster = SCENARIOS["christmas-office"](FIXED_NOW);
        const r = validateScenario(roster);
        expect(r.ok, r.errors.join("; ")).toBe(true);
        expect(new Set(roster.map((a) => a.project))).toEqual(new Set(["north-pole"]));
        const finished = roster.filter((a) => a.state === "idle");
        expect(finished).toHaveLength(1);
        // the Finished window is 5 minutes: idle inside it is asleep at its desk, past it the lounge
        expect(FIXED_NOW - finished[0].idleSince).toBeLessThan(5 * 60_000);
        const asking = roster.filter((a) => a.state === "asking");
        expect(asking.map((a) => a.id)).toEqual([CHRISTMAS_ASKER]);
        expect(asking[0].ask.questions.length).toBeGreaterThan(0);
    });

    test("empty is an empty array", () => {
        expect(SCENARIOS.empty(FIXED_NOW)).toEqual([]);
    });

    test("relative time fields resolve against now", () => {
        const idle = SCENARIOS.mixed(FIXED_NOW).find((a) => a.idleSince != null);
        expect(idle.idleSince).toBeLessThanOrEqual(FIXED_NOW);
    });
});
