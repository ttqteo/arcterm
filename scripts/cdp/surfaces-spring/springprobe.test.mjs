import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { atOnce, between, readSampler, singleCopy, startSampler } from "./springprobe.mjs";

// a sample as the page records it: the time, how many elements matched, and the first match's box
const at = (t, n, top, height = 40) => ({ t, n, rect: n === 0 ? null : { top, left: 8, width: 300, height } });

describe("between", () => {
    it("is true when a sample sits strictly between the first and the last", () => {
        const samples = [at(0, 1, 100), at(16, 1, 130), at(32, 1, 180), at(48, 1, 200)];
        expect(between(samples, "top")).toBe(true);
    });

    it("works downward as well as upward", () => {
        const samples = [at(0, 1, 200), at(16, 1, 150), at(32, 1, 100)];
        expect(between(samples, "top")).toBe(true);
    });

    it("is false for a jump: only the first and the last values ever appear", () => {
        const samples = [at(0, 1, 100), at(16, 1, 100), at(32, 1, 200), at(48, 1, 200)];
        expect(between(samples, "top")).toBe(false);
    });

    it("is false when the value never moved", () => {
        const samples = [at(0, 1, 100), at(16, 1, 100), at(32, 1, 100)];
        expect(between(samples, "top")).toBe(false);
    });

    it("is false for an overshoot that leaves the range and never passes inside it", () => {
        const samples = [at(0, 1, 100), at(16, 1, 260), at(32, 1, 200)];
        expect(between(samples, "top")).toBe(false);
    });

    it("reads the key it is given", () => {
        const samples = [at(0, 1, 100, 0), at(16, 1, 100, 20), at(32, 1, 100, 40)];
        expect(between(samples, "height")).toBe(true);
        expect(between(samples, "top")).toBe(false);
    });

    it("skips a sample with no element, and is false when the first or the last has none", () => {
        expect(between([at(0, 1, 100), at(16, 0), at(32, 1, 150), at(48, 1, 200)], "top")).toBe(true);
        expect(between([at(0, 0), at(16, 1, 150), at(32, 1, 200)], "top")).toBe(false);
        expect(between([at(0, 1, 100), at(16, 1, 150), at(32, 0)], "top")).toBe(false);
    });

    it("is false for no samples", () => {
        expect(between([], "top")).toBe(false);
    });
});

describe("atOnce", () => {
    it("is true when the value changes in one frame and stays", () => {
        const samples = [at(0, 1, 100), at(16, 1, 100), at(32, 1, 200), at(48, 1, 200), at(64, 1, 200)];
        expect(atOnce(samples, "top")).toBe(true);
    });

    it("is true when the very first sample already differs from the one after it", () => {
        expect(atOnce([at(0, 1, 100), at(16, 1, 200), at(32, 1, 200)], "top")).toBe(true);
    });

    it("is false for a slide: a value in between shows after the first change", () => {
        const samples = [at(0, 1, 100), at(16, 1, 100), at(32, 1, 140), at(48, 1, 190), at(64, 1, 200)];
        expect(atOnce(samples, "top")).toBe(false);
    });

    it("is false when the value never changed: nothing landed", () => {
        expect(atOnce([at(0, 1, 100), at(16, 1, 100), at(32, 1, 100)], "top")).toBe(false);
    });

    it("is false for no samples", () => {
        expect(atOnce([], "top")).toBe(false);
    });

    it("counts an element appearing as a change that lands in one frame", () => {
        expect(atOnce([at(0, 0), at(16, 0), at(32, 1, 100), at(48, 1, 100)], "top")).toBe(true);
    });

    it("reads the key it is given", () => {
        const samples = [at(0, 1, 100, 0), at(16, 1, 100, 0), at(32, 1, 100, 40), at(48, 1, 100, 40)];
        expect(atOnce(samples, "height")).toBe(true);
        expect(atOnce(samples, "top")).toBe(false);
    });
});

describe("singleCopy", () => {
    it("is true when no sample ever sees more than one match", () => {
        expect(singleCopy([at(0, 1, 100), at(16, 0), at(32, 1, 120)])).toBe(true);
    });

    it("is false when one sample sees two: a ghost beside the card", () => {
        expect(singleCopy([at(0, 1, 100), at(16, 2, 100), at(32, 1, 120)])).toBe(false);
    });

    it("is true for no samples", () => {
        expect(singleCopy([])).toBe(true);
    });
});

describe("the page expressions", () => {
    it("are valid scripts", () => {
        expect(() => new Script(startSampler(".card"))).not.toThrow();
        expect(() => new Script(readSampler())).not.toThrow();
    });

    // a page whose clock the test steps by hand: one frame per call to the stored callback
    function fakePage(boxes) {
        let now = 0;
        let frame = null;
        const document = {
            querySelectorAll: (selector) => boxes(selector, now),
        };
        const window = {};
        const context = {
            window,
            document,
            performance: { now: () => now },
            requestAnimationFrame: (cb) => {
                frame = cb;
            },
        };
        return {
            context,
            step: (ms) => {
                now += ms;
                const cb = frame;
                frame = null;
                cb?.();
            },
        };
    }

    it("record n and the first match's box on every frame until the window is over", async () => {
        const page = fakePage((selector, now) => {
            expect(selector).toBe(".card");
            return now < 32 ? [] : [{ getBoundingClientRect: () => ({ top: now, left: 8, width: 300, height: 40, x: 8 }) }];
        });
        expect(runInNewContext(startSampler(".card", { ms: 64 }), page.context)).toBe(true);
        for (let i = 0; i < 6; i++) page.step(16);
        const samples = await runInNewContext(readSampler(), page.context);
        expect(samples.map((s) => s.t)).toEqual([0, 16, 32, 48, 64]);
        expect(samples.map((s) => s.n)).toEqual([0, 0, 1, 1, 1]);
        expect(samples[0].rect).toBeNull();
        // only the four numbers the verdicts read
        expect(samples[2].rect).toEqual({ top: 32, left: 8, width: 300, height: 40 });
    });

    it("read refuses when no sampler was started", async () => {
        await expect(runInNewContext(readSampler(), { window: {} })).rejects.toThrow(/startSampler/);
    });
});
