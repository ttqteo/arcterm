import { describe, expect, it } from "vitest";
import {
    conditionLine,
    conditionsFor,
    EXPRESSION_RANK,
    expressionFor,
    isWindowConstrained,
    postureFor,
    postureLine,
    wearsTired,
    type PetSignals,
} from "./petcondition";

const HOT: PetSignals["rateLimit"] = { provider: "claude", pct: 94, resetAt: 1_800_000_000 };
const GIB = 1024 ** 3;
const FULL: PetSignals["memory"] = { more: 0, available: 1.3 * GIB, perWorker: 1 * GIB, heavy: 3 * GIB };

describe("expressionFor — each rank fires in isolation", () => {
    it("rank 2: a depleting window is tired, carrying whose reading it is, the reading, and its reset", () => {
        expect(expressionFor({ rateLimit: HOT })).toEqual({
            kind: "tired",
            provider: "claude",
            pct: 94,
            resetAt: 1_800_000_000,
        });
    });
});

describe("expressionFor — a full RAM", () => {
    it("is ram-full when no more worker fits, carrying the free RAM and the per-worker estimate", () => {
        expect(expressionFor({ memory: FULL })).toEqual({
            kind: "ram-full",
            available: 1.3 * GIB,
            perWorker: 1 * GIB,
            heavy: 3 * GIB,
        });
    });

    it("says nothing while another worker still fits", () => {
        expect(expressionFor({ memory: { ...FULL, more: 1 } })).toEqual({ kind: "at-rest" });
    });

    it("wears the tired look, sweat drop and all, without new pixels", () => {
        expect(wearsTired("ram-full")).toBe(true);
        expect(wearsTired("tired")).toBe(true);
        expect(wearsTired("at-rest")).toBe(false);
    });
});

describe("expressionFor — strict precedence", () => {
    it("reads a window as constrained only past the cockpit's ok band", () => {
        expect(isWindowConstrained(HOT)).toBe(true);
        expect(isWindowConstrained({ provider: "claude", pct: 60 })).toBe(false);
        expect(isWindowConstrained(undefined)).toBe(false);
    });

    it("ranks the expressions in the design's order", () => {
        expect(EXPRESSION_RANK["ram-full"]).toBeLessThan(EXPRESSION_RANK.tired);
        expect(EXPRESSION_RANK.tired).toBeLessThan(EXPRESSION_RANK["at-rest"]);
    });

    it("leads with a full RAM over a depleting window: fewer workers is a fix you can make now", () => {
        expect(expressionFor({ rateLimit: HOT, memory: FULL }).kind).toBe("ram-full");
        expect(conditionsFor({ rateLimit: HOT, memory: FULL }).map((c) => c.kind)).toEqual(["ram-full", "tired"]);
    });
});

describe("expressionFor — nothing present is at-rest", () => {
    it("yields at-rest for no signals at all", () => {
        expect(expressionFor({})).toEqual({ kind: "at-rest" });
    });

    // an absent field means "no signal", never "signal absent" — which is what lets the ranks with no
    // source yet ship inert instead of firing on undefined.
    it("yields at-rest when a signal is present but says nothing is wrong", () => {
        expect(expressionFor({ rateLimit: { provider: "claude", pct: 12 } }).kind).toBe("at-rest");
        expect(expressionFor({ attention: { reviewGates: 3, escalations: 1, blockedWorkers: 2 } }).kind).toBe(
            "at-rest"
        );
    });

    it("does not treat a zero reading as a constraint", () => {
        expect(expressionFor({ rateLimit: { provider: "claude", pct: 0 } }).kind).toBe("at-rest");
    });
});

describe("postureFor", () => {
    it("prefers a gate, then an escalation, then a blocked worker", () => {
        expect(postureFor({ attention: { reviewGates: 1, escalations: 1, blockedWorkers: 1 } })).toBe("review-gate");
        expect(postureFor({ attention: { reviewGates: 0, escalations: 1, blockedWorkers: 1 } })).toBe("escalation");
        expect(postureFor({ attention: { reviewGates: 0, escalations: 0, blockedWorkers: 1 } })).toBe("blocked-worker");
    });

    it("is none with nothing waiting, and none with no attention signal at all", () => {
        expect(postureFor({ attention: { reviewGates: 0, escalations: 0, blockedWorkers: 0 } })).toBe("none");
        expect(postureFor({})).toBe("none");
    });

    // posture is independent of condition: the two registers answer different questions, and the
    // precedence in expressionFor must not silence what is waiting.
    it("is unaffected by the condition signals", () => {
        const signals: PetSignals = {
            rateLimit: HOT,
            attention: { reviewGates: 0, escalations: 2, blockedWorkers: 0 },
        };
        expect(expressionFor(signals).kind).toBe("tired");
        expect(postureFor(signals)).toBe("escalation");
    });
});

describe("wording", () => {
    const now = 1_800_000_000 * 1000; // the reset moment itself

    it("carries the reading, and the reset only when there is one", () => {
        expect(conditionLine({ kind: "tired", provider: "claude", pct: 94, resetAt: 1_800_003_600 }, now)).toBe(
            "Running low on Claude — 94% of the window used, back in 1h 0m."
        );
        expect(conditionLine({ kind: "tired", provider: "claude", pct: 94 }, now)).toBe(
            "Running low on Claude — 94% of the window used."
        );
    });

    // rate limits are per-provider, and the highest reading wins across providers. Without the name, a
    // codex window at 94% is indistinguishable from a claude one, and the countdown belongs to whichever
    // provider won — which is how a codex reading got read as the claude window it was not.
    it("names the provider the reading belongs to", () => {
        expect(conditionLine({ kind: "tired", provider: "codex", pct: 94, resetAt: 1_800_003_600 }, now)).toBe(
            "Running low on Codex — 94% of the window used, back in 1h 0m."
        );
    });

    // "running low" wording the same at 86% and at 100% understates a window that is simply gone.
    it("says a spent window is spent rather than running low", () => {
        expect(conditionLine({ kind: "tired", provider: "claude", pct: 100, resetAt: 1_800_003_600 }, now)).toBe(
            "Claude's window is spent — back in 1h 0m."
        );
        expect(conditionLine({ kind: "tired", provider: "claude", pct: 100 }, now)).toBe("Claude's window is spent.");
    });

    it("words a full RAM with the free RAM, the estimate and what another worker would do", () => {
        expect(conditionLine({ kind: "ram-full", available: 1.3 * GIB, perWorker: 1 * GIB, heavy: 3 * GIB }, now)).toBe(
            "RAM is full — 1.3 GB free; a worker needs ~1 GB, a heavy job like tsc ~3 GB."
        );
    });

    it("gives every expression and every posture a line", () => {
        expect(conditionLine({ kind: "at-rest" }, now)).not.toBe("");
        expect(postureLine("review-gate")).not.toBe("");
        expect(postureLine("escalation")).not.toBe("");
        expect(postureLine("blocked-worker")).not.toBe("");
        expect(postureLine("none")).toBe("");
    });
});

// The peek lists every standing condition, where the creature wears only one. Precedence decides which
// LEADS rather than capping the list at one — recall off AND a depleting window is a real pair, and the
// old panel stated such a pair twice: once as a banner, once as a tile.
describe("conditionsFor — every standing condition, in rank order", () => {
    it("returns nothing to say when no signal is degraded", () => {
        expect(conditionsFor({})).toEqual([]);
    });

    it("carries each condition whole, so conditionLine can word it without re-deriving", () => {
        expect(conditionsFor({ rateLimit: HOT })).toEqual([
            { kind: "tired", provider: "claude", pct: 94, resetAt: 1_800_000_000 },
        ]);
    });

    it("never lists at-rest: an empty list is how quiet is spelled", () => {
        expect(conditionsFor({}).some((c) => c.kind === "at-rest")).toBe(false);
    });

    // the crossing rule: the creature wears one face, and the peek's lead line must be that same face.
    // Two derivations of the same precedence would let the corner and the panel disagree.
    it("leads with exactly the expression the creature is wearing", () => {
        for (const signals of [{ rateLimit: HOT }]) {
            expect(conditionsFor(signals)[0]).toEqual(expressionFor(signals));
        }
    });
});
