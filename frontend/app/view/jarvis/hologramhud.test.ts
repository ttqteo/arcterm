// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    activityLevel,
    breathPeriodMs,
    buildHudScene,
    growCapacity,
    HUD_MOTION_START,
    HUD_PARTS,
    hudColours,
    hudFillTriangles,
    hudOrbit,
    packHudFills,
    packHudLines,
    pulseRate,
    stepHudMotion,
    STROKE,
    STROKE_WIDTHS,
    UTTERANCE_MS,
    utteranceEnvelope,
    type HudInput,
    type HudScene,
    type HudSegment,
} from "./hologramhud";

// the corner's largest size, which the form was tuned at
const SIZE = 132;

function input(over: Partial<HudInput> = {}): HudInput {
    return { size: SIZE, now: 0, yaw: 0, pitch: 0, breath: 0, utterance: 0, quiet: false, still: false, ...over };
}

/** Total light the scene puts on the canvas: under additive blending the alpha sum is the closest pure proxy. */
function light(scene: HudScene): number {
    return scene.segments.reduce((n, s) => n + s.alpha, 0) + scene.fills.reduce((n, f) => n + f.alpha, 0);
}

/** How much light falls within `r` px of the centre. */
function lightNear(scene: HudScene, r: number): number {
    const near = (x: number, y: number) => Math.hypot(x - scene.centreX, y - scene.centreY) < r;
    return (
        scene.segments.filter((s) => near((s.ax + s.bx) / 2, (s.ay + s.by) / 2)).reduce((n, s) => n + s.alpha, 0) +
        scene.fills.filter((f) => near(f.points[0][0], f.points[0][1])).reduce((n, f) => n + f.alpha, 0)
    );
}

describe("buildHudScene: the form", () => {
    it("emits both line work and fills, because neither alone carries the form", () => {
        const scene = buildHudScene(input());
        expect(scene.segments.length).toBeGreaterThan(0);
        expect(scene.fills.length).toBeGreaterThan(0);
    });

    it("draws every stroke at one of the ladder's four weights, which the renderer batches by", () => {
        const scene = buildHudScene(input({ utterance: 1, activity: 1, pulseClock: 0.3 }));
        for (const s of scene.segments) {
            expect(STROKE_WIDTHS).toContain(s.width);
        }
    });

    it("emits fills as convex quads, because a fan from vertex zero is all the renderer does with them", () => {
        for (const f of buildHudScene(input()).fills) {
            expect(f.points.length).toBe(4);
        }
    });

    it("stays under the primitive budget past which strokes fuse into a smudge at this size", () => {
        expect(buildHudScene(input({ utterance: 1, activity: 1, pulseClock: 0.3 })).segments.length).toBeLessThan(650);
    });

    it("keeps every alpha within 0..1 and every coordinate finite", () => {
        const scene = buildHudScene(
            input({ utterance: 1, activity: 1, pulseClock: 0.4, now: 3_100, yaw: 0.4, pitch: -0.2 })
        );
        for (const s of scene.segments) {
            expect(s.alpha).toBeGreaterThanOrEqual(0);
            expect(s.alpha).toBeLessThanOrEqual(1);
            expect(Number.isFinite(s.ax + s.ay + s.bx + s.by)).toBe(true);
        }
        for (const f of scene.fills) {
            expect(f.alpha).toBeGreaterThanOrEqual(0);
            expect(f.alpha).toBeLessThanOrEqual(1);
            for (const p of f.points) {
                expect(Number.isFinite(p[0] + p[1])).toBe(true);
            }
        }
    });

    it("leaves the centre dark: the core is a ring around an empty hexagon, not a lit point", () => {
        // the old HUD put a point sprite and a wireframe ball inside its core ring, which the bloom blew into a blob
        const scene = buildHudScene(input());
        // one form unit in px; the hexagon's sides sit about 0.15 units out, the lit core ring at 0.31. The core is
        // recessed and the form tilted, so its centre is where the core ring's points average, not the canvas centre.
        const unit = SIZE * 0.19;
        const ring = scene.segments.filter(
            (s) =>
                s.tone === "hot" &&
                s.width === STROKE.base &&
                Math.hypot(s.ax - scene.centreX, s.ay - scene.centreY) < unit * 0.5
        );
        expect(ring.length).toBeGreaterThan(8);
        const cx = ring.reduce((n, s) => n + s.ax, 0) / ring.length;
        const cy = ring.reduce((n, s) => n + s.ay, 0) / ring.length;
        const core = { ...scene, centreX: cx, centreY: cy };
        expect(lightNear(core, unit * 0.1)).toBe(0);
        expect(lightNear(core, unit * 0.4)).toBeGreaterThan(0);
    });

    it("holds still when reduced motion is set", () => {
        const a = buildHudScene(input({ still: true, now: 0 }));
        const b = buildHudScene(input({ still: true, now: 9_999, yaw: 2, breath: 0.7, utterance: 1, activity: 1 }));
        expect(a).toEqual(b);
    });

    it("never turns far enough to lose the form edge-on", () => {
        let narrowest = Infinity;
        for (let turn = 0; turn < 24; turn++) {
            const scene = buildHudScene(input({ yaw: (turn / 24) * Math.PI * 2 }));
            const xs = scene.segments.flatMap((s) => [s.ax, s.bx]);
            narrowest = Math.min(narrowest, Math.max(...xs) - Math.min(...xs));
        }
        expect(narrowest).toBeGreaterThan(SIZE * 0.4);
    });
});

describe("buildHudScene: presence", () => {
    it("dims when quiet, and does not shrink", () => {
        const loud = buildHudScene(input({ quiet: false }));
        const idle = buildHudScene(input({ quiet: true }));
        expect(idle.extent).toBeCloseTo(loud.extent);
        expect(light(idle)).toBeLessThan(light(loud));
    });

    it("fills enough of its box to be seen, and never reaches the edge where the bloom would clamp", () => {
        expect(buildHudScene(input({ quiet: true })).extent).toBeGreaterThan(SIZE * 0.28);
        for (const yaw of [0, 1.6, 3.1, 4.7]) {
            const scene = buildHudScene(input({ utterance: 1, breath: 1, yaw, pitch: -0.34, now: 7_777 }));
            expect(scene.extent).toBeLessThan(SIZE / 2);
        }
    });

    it("lights the centre and shows the sweep only while Jarvis is speaking", () => {
        const quietForm = buildHudScene(input({ utterance: 0 }));
        const speaking = buildHudScene(input({ utterance: 1 }));
        expect(light(speaking)).toBeGreaterThan(light(quietForm));
        // the one part that spins on its own clock: at rest it would be a loading spinner
        const sweep = (s: HudScene) => s.segments.filter((x) => x.tone === "hot" && x.width === STROKE.bold).length;
        expect(sweep(quietForm)).toBe(0);
        expect(sweep(speaking)).toBeGreaterThan(0);
    });
});

describe("buildHudScene: activity", () => {
    it("adds nothing at no load beyond the resting form", () => {
        const rest = buildHudScene(input({ now: 2_000 }));
        const idle = buildHudScene(input({ now: 2_000, activity: 0, pulseClock: 0.3 }));
        expect(idle.pulses).toBe(0);
        expect(idle).toEqual(rest);
    });

    it("varies how many pulses are lit, so load never reads as a steady, countable ring", () => {
        const counts = new Set<number>();
        for (let step = 0; step < 160; step++) {
            const scene = buildHudScene(input({ activity: 1, pulseClock: step * 0.01 }));
            const hotHeavy = scene.segments.filter((s) => s.tone === "hot" && s.width === STROKE.heavy).length;
            expect(hotHeavy).toBe(scene.pulses);
            counts.add(scene.pulses);
        }
        expect(counts.size).toBeGreaterThan(2);
    });

    it("never goes all dark while agents work, because a gap reads as a stall", () => {
        for (let step = 0; step < 1600; step++) {
            expect(buildHudScene(input({ activity: 1, pulseClock: step * 0.001 })).pulses).toBeGreaterThan(0);
        }
    });

    it("turns nothing on load alone, because a constant rotation is a loading spinner", () => {
        const blades = (activity: number) =>
            buildHudScene(input({ activity, now: 3_300, yaw: 1.2, pulseClock: 0.7 }))
                .segments.filter((s) => s.tone === "body" && s.width === STROKE.heavy)
                .map((s) => [s.ax, s.ay, s.bx, s.by]);
        expect(blades(1)).toEqual(blades(0));
    });

    it("deepens the breath under load", () => {
        const swing = (activity: number) => {
            const at = (breath: number) => buildHudScene(input({ activity, breath })).segments[0].alpha;
            return Math.abs(at(1) - at(0));
        };
        expect(swing(1)).toBeGreaterThan(swing(0));
    });
});

describe("buildHudScene: assembling", () => {
    it("shows nothing before any layer enters, and the whole form once every layer is in place", () => {
        const none = Object.fromEntries(HUD_PARTS.map((p) => [p, 0]));
        const all = Object.fromEntries(HUD_PARTS.map((p) => [p, 1]));
        expect(light(buildHudScene(input({ reveal: none })))).toBe(0);
        expect(buildHudScene(input({ reveal: all }))).toEqual(buildHudScene(input()));
    });

    it("lights the core first, its light at the centre while the outer layers are still dark", () => {
        const coreOnly = buildHudScene(input({ reveal: { core: 1, front: 0, mid: 0, struts: 0, outer: 0 } }));
        expect(light(coreOnly)).toBeGreaterThan(0);
        expect(lightNear(coreOnly, SIZE * 0.19 * 0.6)).toBeCloseTo(light(coreOnly));
    });

    it("grows a layer in from smaller as it enters", () => {
        const half = buildHudScene(input({ reveal: { outer: 0.5 } }));
        const whole = buildHudScene(input());
        expect(half.extent).toBeLessThan(whole.extent);
    });
});

describe("motion", () => {
    it("sways inside a bounded pitch and never quantises the yaw on a long clock", () => {
        for (const now of [0, 5_000, 17_000, 1e12]) {
            const o = hudOrbit(now);
            expect(Math.abs(o.pitch)).toBeLessThanOrEqual(0.18);
            expect(o.yaw).toBeGreaterThanOrEqual(0);
            expect(o.yaw).toBeLessThan(Math.PI * 2);
        }
        expect(hudOrbit(NaN)).toEqual({ yaw: 0, pitch: 0 });
    });

    it("surges at the utterance and decays to silence; a future or missing one is silence", () => {
        expect(utteranceEnvelope(1_000, 1_000)).toBe(1);
        expect(utteranceEnvelope(1_000 + UTTERANCE_MS / 2, 1_000)).toBeCloseTo(0.5);
        expect(utteranceEnvelope(1_000 + UTTERANCE_MS, 1_000)).toBe(0);
        expect(utteranceEnvelope(500, 1_000)).toBe(0);
        expect(utteranceEnvelope(500, null)).toBe(0);
    });

    it("reads load from the working count, the first agents felt most", () => {
        expect(activityLevel(0)).toBe(0);
        expect(activityLevel(2)).toBeGreaterThan(0.4);
        expect(activityLevel(6)).toBe(1);
        expect(activityLevel(20)).toBe(1);
        expect(breathPeriodMs(1)).toBeLessThan(breathPeriodMs(0));
        expect(pulseRate(0)).toBe(0);
        expect(pulseRate(1)).toBeGreaterThan(pulseRate(0.2));
    });

    it("starts an utterance when the bubble comes up, not for as long as it stays", () => {
        let m = stepHudMotion(HUD_MOTION_START, 1_000, 33, 0, true);
        expect(m.spokeAt).toBe(1_000);
        m = stepHudMotion(m, 2_000, 33, 0, true);
        expect(m.spokeAt).toBe(1_000);
        m = stepHudMotion(m, 3_000, 33, 0, false);
        m = stepHudMotion(m, 4_000, 33, 0, true);
        expect(m.spokeAt).toBe(4_000);
    });

    it("advances the breath and pulses by the step, clamping a step a hidden window hands back", () => {
        const idle = stepHudMotion(HUD_MOTION_START, 100, 100, 0, false);
        expect(idle.breathPhase).toBeGreaterThan(0);
        expect(idle.pulseClock).toBe(0);
        const busy = stepHudMotion(HUD_MOTION_START, 100, 100, 1, false);
        expect(busy.pulseClock).toBeGreaterThan(0);
        const late = stepHudMotion(HUD_MOTION_START, 60_000, 60_000, 1, false);
        expect(late.pulseClock).toBeCloseTo(pulseRate(1));
    });
});

describe("packing", () => {
    const colours = hudColours([0.33, 0.71, 0.92]);
    const seg = (over: Partial<HudSegment> = {}): HudSegment => ({
        ax: 0,
        ay: 0,
        bx: 10,
        by: 10,
        depth: 0,
        tone: "body",
        alpha: 1,
        width: STROKE.base,
        ...over,
    });
    const pack = (segments: HudSegment[]) => {
        const positions = new Float32Array(segments.length * 6);
        const colors = new Float32Array(segments.length * 6);
        const count = packHudLines(segments, SIZE, colours, positions, colors);
        return { positions, colors, count };
    };

    it("lightens the body toward white for the hot tone, staying in its hue", () => {
        for (let c = 0; c < 3; c++) {
            expect(colours.hot[c]).toBeGreaterThan(colours.body[c]);
            expect(colours.hot[c]).toBeLessThan(1);
        }
        expect(colours.hot[2]).toBeGreaterThan(colours.hot[0]);
    });

    it("maps screen coordinates into a [-1,1] box with y up", () => {
        const { positions } = pack([seg({ ax: 0, ay: 0, bx: SIZE, by: SIZE })]);
        expect(positions[0]).toBeCloseTo(-1);
        expect(positions[1]).toBeCloseTo(1);
        expect(positions[3]).toBeCloseTo(1);
        expect(positions[4]).toBeCloseTo(-1);
    });

    it("folds alpha into the colour in linear light, so a stroke shows its colour x alpha once encoded", () => {
        const full = pack([seg({ alpha: 1 })]).colors;
        const dim = pack([seg({ alpha: 0.5 })]).colors;
        const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
        for (let c = 0; c < 3; c++) {
            expect(encode(full[c])).toBeCloseTo(colours.body[c], 4);
            expect(encode(dim[c])).toBeCloseTo(colours.body[c] * 0.5, 4);
        }
        expect(Array.from(pack([seg({ alpha: 0 })]).colors)).toEqual(new Array(6).fill(0));
    });

    it("puts every segment in exactly one weight's batch", () => {
        const scene = buildHudScene(input({ utterance: 1, activity: 1, pulseClock: 0.3 }));
        const total = STROKE_WIDTHS.reduce((n, w) => n + scene.segments.filter((s) => s.width === w).length, 0);
        expect(total).toBe(scene.segments.length);
    });

    it("fans each quad into two triangles", () => {
        const scene = buildHudScene(input());
        const triangles = hudFillTriangles(scene.fills);
        expect(triangles).toBe(scene.fills.length * 2);
        const positions = new Float32Array(triangles * 9);
        const colors = new Float32Array(triangles * 9);
        expect(packHudFills(scene.fills, SIZE, colours, positions, colors)).toBe(triangles);
    });

    it("grows a buffer with headroom and keeps one that still fits", () => {
        expect(growCapacity(0, 0)).toBe(64);
        expect(growCapacity(50, 64)).toBe(64);
        expect(growCapacity(100, 64)).toBe(200);
    });
});
