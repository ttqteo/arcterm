// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MOTION } from "./motiontokens";
import { BATCH_INSTANT_AT, batchMotion, shapeTransition } from "./springbatch";

const seen = (keys: string[], filter?: string) => ({ keys, filter });

describe("batchMotion", () => {
    it("shows the first load at once, however few the items", () => {
        expect(batchMotion(null, [])).toBe("instant");
        expect(batchMotion(null, ["a"])).toBe("instant");
        expect(batchMotion(null, ["a", "b", "c", "d"])).toBe("instant");
    });

    it("shows a filter switch at once, even when no key changed", () => {
        expect(batchMotion(seen(["a", "b"], "all"), ["a", "b"], "mine")).toBe("instant");
        expect(batchMotion(seen(["a", "b"], "all"), ["a", "b", "c"], "mine")).toBe("instant");
        expect(batchMotion(seen(["a"]), ["a"], "mine")).toBe("instant");
    });

    it("animates when the filter is the same (both unset counts as the same)", () => {
        expect(batchMotion(seen(["a"], "all"), ["a", "b"], "all")).toBe("animate");
        expect(batchMotion(seen(["a"]), ["a", "b"])).toBe("animate");
    });

    it("animates one or two arrivals", () => {
        expect(batchMotion(seen(["a", "b"]), ["a", "b", "c"])).toBe("animate");
        expect(batchMotion(seen(["a", "b"]), ["a", "b", "c", "d"])).toBe("animate");
    });

    it("animates one or two departures", () => {
        expect(batchMotion(seen(["a", "b", "c", "d"]), ["a", "b", "c"])).toBe("animate");
        expect(batchMotion(seen(["a", "b", "c", "d"]), ["a", "b"])).toBe("animate");
    });

    it("shows three arrivals at once", () => {
        expect(batchMotion(seen(["a"]), ["a", "b", "c", "d"])).toBe("instant");
    });

    it("shows three departures at once", () => {
        expect(batchMotion(seen(["a", "b", "c", "d"]), ["a"])).toBe("instant");
        expect(batchMotion(seen(["a", "b", "c"]), [])).toBe("instant");
    });

    it("counts arrivals and departures together: two in and one out is a batch", () => {
        expect(batchMotion(seen(["a", "b", "c"]), ["a", "b", "x", "y"])).toBe("instant");
        // one in and one out is not
        expect(batchMotion(seen(["a", "b", "c"]), ["a", "b", "x"])).toBe("animate");
    });

    it("animates the same keys in another order: a re-deal or a reorder adds and removes nothing", () => {
        expect(batchMotion(seen(["a", "b", "c", "d", "e"]), ["e", "d", "c", "b", "a"])).toBe("animate");
        expect(batchMotion(seen(["a", "b", "c"]), ["a", "b", "c"])).toBe("animate");
    });

    it("counts a key once however often it repeats", () => {
        expect(batchMotion(seen(["a"]), ["a", "b", "b", "b"])).toBe("animate");
    });

    it("draws the line at BATCH_INSTANT_AT", () => {
        expect(BATCH_INSTANT_AT).toBe(3);
        const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
        expect(batchMotion(seen([]), keys(BATCH_INSTANT_AT - 1))).toBe("animate");
        expect(batchMotion(seen([]), keys(BATCH_INSTANT_AT))).toBe("instant");
    });
});

describe("shapeTransition", () => {
    it("is the spring when the change animates", () => {
        expect(shapeTransition("animate")).toEqual(MOTION.spring);
        expect(shapeTransition("animate", false)).toEqual(MOTION.spring);
        expect(shapeTransition("animate", null)).toEqual(MOTION.spring);
    });

    it("is no time at all for a batch", () => {
        expect(shapeTransition("instant")).toEqual({ duration: 0 });
        expect(shapeTransition("instant", false)).toEqual({ duration: 0 });
    });

    it("is no time at all under reduced motion, an animating change included", () => {
        expect(shapeTransition("animate", true)).toEqual({ duration: 0 });
        expect(shapeTransition("instant", true)).toEqual({ duration: 0 });
    });
});
