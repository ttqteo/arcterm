import { describe, expect, it } from "vitest";
import { cubicBezier, pulseOpacity, PULSES, pulseStart, pulseValue, type PulseSpec } from "./pulse";

describe("cubicBezier", () => {
    it("pins the endpoints", () => {
        const ease = cubicBezier(0.25, 0.1, 0.25, 1);
        expect(ease(0)).toBeCloseTo(0, 5);
        expect(ease(1)).toBeCloseTo(1, 5);
    });

    it("matches CSS ease at the midpoint", () => {
        // the browser's own value for cubic-bezier(0.25, 0.1, 0.25, 1) at x=0.5
        expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
    });

    it("is symmetric for a symmetric curve", () => {
        const inOut = cubicBezier(0.42, 0, 0.58, 1);
        expect(inOut(0.5)).toBeCloseTo(0.5, 5);
        expect(inOut(0.2) + inOut(0.8)).toBeCloseTo(1, 5);
    });
});

describe("pulseOpacity", () => {
    const linear: PulseSpec = { periodMs: 1000, low: 0.2, ease: (t) => t };

    it("starts and ends each cycle fully opaque and bottoms out halfway", () => {
        expect(pulseOpacity(linear, 0)).toBeCloseTo(1);
        expect(pulseOpacity(linear, 500)).toBeCloseTo(0.2);
        expect(pulseOpacity(linear, 1000)).toBeCloseTo(1);
    });

    it("fades down through the first half and back up through the second", () => {
        expect(pulseOpacity(linear, 250)).toBeCloseTo(0.6);
        expect(pulseOpacity(linear, 750)).toBeCloseTo(0.6);
    });

    it("repeats every period however long the dot has been pulsing", () => {
        expect(pulseOpacity(linear, 250 + 1000 * 3600)).toBeCloseTo(pulseOpacity(linear, 250));
    });

    it("reads a negative or non-finite elapsed time as the start of a cycle", () => {
        expect(pulseOpacity(linear, -50)).toBe(1);
        expect(pulseOpacity(linear, Number.NaN)).toBe(1);
    });
});

describe("PULSES", () => {
    it("keeps the CSS animations' periods and depths", () => {
        // pulseDot was 1 -> 0.32 -> 1; tailwind's animate-pulse is 1 -> 0.5 -> 1 over 2s
        expect(PULSES["pulse-dot"]).toMatchObject({ periodMs: 1600, low: 0.32 });
        expect(PULSES["pulse-dot-slow"]).toMatchObject({ periodMs: 1800, low: 0.32 });
        expect(PULSES["pulse-soft"]).toMatchObject({ periodMs: 2000, low: 0.5 });
    });

    it("drives the asking glow's strength, not its opacity, over breatheGlow's 2.4s", () => {
        // .pulse-glow reads --pulse as 1 at rest and 0 at the peak: the curve must reach both ends
        const glow = PULSES["pulse-glow"];
        expect(glow).toMatchObject({ periodMs: 2400, low: 0, prop: "--pulse" });
        expect(pulseOpacity(glow, 0)).toBeCloseTo(1, 5);
        expect(pulseOpacity(glow, 1200)).toBeCloseTo(0, 5);
        expect(PULSES["pulse-dot"].prop).toBeUndefined();
    });
});

describe("pulse-blink", () => {
    const blink = PULSES["pulse-blink"];

    it("dips to its low mid-cycle and is back at full at the cycle's end", () => {
        expect(blink.prop).toBeUndefined();
        expect(blink.low).toBeLessThan(0.5);
        expect(pulseOpacity(blink, 0)).toBeCloseTo(1, 5);
        expect(pulseOpacity(blink, blink.periodMs / 2)).toBeCloseTo(blink.low, 5);
        expect(pulseOpacity(blink, blink.periodMs)).toBeCloseTo(1, 5);
    });

    it("starts a bulb lagged half a period at the bottom, so every other bulb is dark while its neighbours are lit", () => {
        const half = String(blink.periodMs / 2);
        const start = pulseStart(5_000, blink, half);
        expect(pulseOpacity(blink, 5_000 - start)).toBeCloseTo(blink.low, 5);
        expect(pulseOpacity(blink, 5_000 + blink.periodMs / 2 - start)).toBeCloseTo(1, 5);
    });
});

describe("pulseValue", () => {
    const shimmer = PULSES["shimmer-jarvis"];

    it("sweeps the working line's shimmer 0 to 1 at an even pace, then starts again from 0", () => {
        expect(shimmer).toMatchObject({ periodMs: 2000, prop: "--sweep", sweep: true });
        expect(pulseValue(shimmer, 0)).toBeCloseTo(0, 5);
        expect(pulseValue(shimmer, 500)).toBeCloseTo(0.25, 5);
        expect(pulseValue(shimmer, 1500)).toBeCloseTo(0.75, 5);
        expect(pulseValue(shimmer, 1999)).toBeLessThan(1);
        expect(pulseValue(shimmer, 2000)).toBeCloseTo(0, 5);
        expect(pulseValue(shimmer, 500 + 2000 * 3600)).toBeCloseTo(0.25, 5);
    });

    it("reads a negative or non-finite elapsed time as the start of a sweep", () => {
        expect(pulseValue(shimmer, -50)).toBe(0);
        expect(pulseValue(shimmer, Number.NaN)).toBe(0);
    });

    it("is the breath's opacity for every pulse that is not a sweep", () => {
        for (const [cls, spec] of Object.entries(PULSES)) {
            if (cls === "shimmer-jarvis") {
                continue;
            }
            expect(spec.sweep).toBeFalsy();
            expect(pulseValue(spec, 300)).toBe(pulseOpacity(spec, 300));
        }
    });
});

describe("pulseStart", () => {
    const spec = PULSES["pulse-typing"];

    it("starts at once with no lag, or one it cannot read", () => {
        expect(pulseStart(5_000, spec, undefined)).toBe(5_000);
        expect(pulseStart(5_000, spec, "")).toBe(5_000);
        expect(pulseStart(5_000, spec, "soon")).toBe(5_000);
        expect(pulseStart(5_000, spec, "-200")).toBe(5_000);
    });

    it("puts a lagging dot that far behind in its cycle, never before the top", () => {
        const lead = pulseOpacity(spec, 300);
        // 200 ms behind: at the leader's 300 ms it is where the leader was at 100 ms
        const start = pulseStart(5_000, spec, "200");
        expect(5_000 - start).toBeGreaterThanOrEqual(0);
        expect(pulseOpacity(spec, 5_000 + 300 - start)).toBeCloseTo(pulseOpacity(spec, 100), 6);
        expect(pulseOpacity(spec, 5_000 + 300 - start)).not.toBeCloseTo(lead, 3);
        // a whole period behind is no lag at all
        expect(pulseStart(5_000, spec, String(spec.periodMs))).toBe(5_000 - spec.periodMs);
    });
});
