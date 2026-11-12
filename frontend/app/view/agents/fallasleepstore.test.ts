import { describe, expect, it } from "vitest";
import {
    FALL_ASLEEP_GIVE_UP_MS,
    fallAsleepLabel,
    fallAsleepPhase,
    settledFallAsleep,
    withFallingAsleep,
    type FallingAsleep,
} from "./fallasleepstore";

const T = 1_700_000_000_000;

describe("withFallingAsleep", () => {
    it("sets a mark from now and drops it", () => {
        const m = withFallingAsleep(new Map(), "a", "sleeping", T);
        expect(m.get("a")).toEqual({ phase: "sleeping", at: T });
        const c = withFallingAsleep(m, "a", "compacting", T + 5);
        expect(c.get("a")).toEqual({ phase: "compacting", at: T + 5 });
        expect(withFallingAsleep(c, "a", null, T).has("a")).toBe(false);
    });

    it("keeps the same map when there is nothing to drop", () => {
        const m = new Map<string, FallingAsleep>();
        expect(withFallingAsleep(m, "a", null, T)).toBe(m);
    });
});

describe("fallAsleepPhase", () => {
    const mark: FallingAsleep = { phase: "compacting", at: T };
    it("reads the phase of an awake agent with a live mark", () => {
        expect(fallAsleepPhase(mark, false, T + 60_000)).toBe("compacting");
    });
    it("is none once the agent sleeps, with no mark, or after the give-up", () => {
        expect(fallAsleepPhase(mark, true, T)).toBeUndefined();
        expect(fallAsleepPhase(undefined, false, T)).toBeUndefined();
        expect(fallAsleepPhase(mark, false, T + FALL_ASLEEP_GIVE_UP_MS + 1)).toBeUndefined();
    });
});

describe("settledFallAsleep", () => {
    it("lists the marks whose agent sleeps, is gone, or lapsed", () => {
        const m = new Map<string, FallingAsleep>([
            ["asleep", { phase: "sleeping", at: T }],
            ["gone", { phase: "sleeping", at: T }],
            ["old", { phase: "compacting", at: T - FALL_ASLEEP_GIVE_UP_MS - 1 }],
            ["busy", { phase: "compacting", at: T }],
        ]);
        const agents = [{ id: "asleep", sleeping: { since: T } }, { id: "old" }, { id: "busy" }];
        expect(settledFallAsleep(m, agents, T).sort()).toEqual(["asleep", "gone", "old"]);
    });
});

describe("fallAsleepLabel", () => {
    it("words each phase", () => {
        expect(fallAsleepLabel("sleeping")).toBe("Going to sleep…");
        expect(fallAsleepLabel("compacting")).toBe("Compacting, then sleeping…");
    });
});
