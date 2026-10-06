// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    clearSpot,
    dropAt,
    FRAME_MS,
    homeFraction,
    homeX,
    HOP_LIFT_PX,
    initialWalker,
    nextTick,
    REST_MAX_MS,
    REST_MIN_MS,
    SLEEP_AFTER_MS,
    stepWalker,
    TIRED_FRAME_MS,
    type Ledge,
    type WalkerInput,
    type WalkerState,
    type WalkerStep,
} from "./petwalk";

const PX = 48;
const T0 = 1_000_000;
// travel: left edges 100..1252
const LEDGE: Ledge = { left: 100, right: 1300 };

function input(over: Partial<WalkerInput> = {}): WalkerInput {
    return {
        ledge: LEDGE,
        avoid: [],
        expression: "at-rest",
        posture: "none",
        speaking: false,
        peekOpen: false,
        dragging: false,
        reduce: false,
        lastActivityAt: T0,
        home: 0.5,
        ...over,
    };
}

function walker(over: Partial<WalkerState> = {}): WalkerState {
    return {
        name: "rest",
        x: 400,
        flip: false,
        target: null,
        frame: 0,
        due: T0,
        restPose: "stand",
        posture: "none",
        ...over,
    };
}

// mulberry32: a seeded rand, so a long walk is the same walk on every run
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const half = () => 0.5;

function overlaps(x: number, avoid: readonly [number, number][]): boolean {
    return avoid.some(([a0, a1]) => x < a1 && x + PX > a0);
}

// Step the way the renderer does: again after each delayMs, until `done` or the walker goes still.
function drive(
    state: WalkerState,
    inp: WalkerInput | ((now: number) => WalkerInput),
    now: number,
    rand: () => number,
    done: (step: WalkerStep, now: number) => boolean,
    maxSteps = 5_000
): { step: WalkerStep; now: number; steps: WalkerStep[] } {
    const at = typeof inp === "function" ? inp : () => inp;
    const steps: WalkerStep[] = [];
    let step = stepWalker(state, at(now), now, rand);
    steps.push(step);
    for (let i = 0; i < maxSteps && !done(step, now) && step.delayMs != null; i++) {
        now += step.delayMs;
        step = stepWalker(step.state, at(now), now, rand);
        steps.push(step);
    }
    return { step, now, steps };
}

describe("the ledge", () => {
    it("keeps the whole span on the ledge across a long walk, in whole px, turning both ways", () => {
        const ledge = { left: 100.5, right: 700.25 };
        const rand = seeded(7);
        // never idle, so it keeps walking and resting rather than going to sleep
        const live = (now: number) => input({ ledge, lastActivityAt: now });
        const { steps } = drive(initialWalker(live(T0), T0, rand), live, T0, rand, () => false, 20_000);
        const flips = new Set<boolean>();
        for (const step of steps) {
            expect(step.x).toBeGreaterThanOrEqual(ledge.left);
            expect(step.x + PX).toBeLessThanOrEqual(ledge.right);
            expect(Number.isInteger(step.x)).toBe(true);
            if (step.state.name === "walk") {
                flips.add(step.flip);
            }
        }
        expect(flips).toEqual(new Set([true, false]));
    });

    it("turns at the right end: every walk from there heads left, mirrored", () => {
        for (let r = 0; r < 1; r += 0.05) {
            const inp = input({ home: 1 });
            const start = initialWalker(inp, T0, () => r);
            expect(start.x).toBe(1252);
            const { step } = drive(
                start,
                inp,
                T0,
                () => r,
                (s) => s.x !== 1252
            );
            expect(step.x).toBeLessThan(1252);
            expect(step.flip).toBe(true);
        }
    });

    it("turns at the left end: every walk from there heads right, unmirrored", () => {
        for (let r = 0; r < 1; r += 0.05) {
            const inp = input({ home: 0 });
            const start = initialWalker(inp, T0, () => r);
            expect(start.x).toBe(100);
            const { step } = drive(
                start,
                inp,
                T0,
                () => r,
                (s) => s.x !== 100
            );
            expect(step.x).toBeGreaterThan(100);
            expect(step.flip).toBe(false);
        }
    });

    it("pulls it back on when the ledge narrows under it", () => {
        const narrow = { left: 100, right: 600 };
        const step = stepWalker(walker({ name: "walk", x: 1100, target: 1200 }), input({ ledge: narrow }), T0, half);
        expect(step.x + PX).toBeLessThanOrEqual(narrow.right);
        expect(step.x).toBeGreaterThanOrEqual(narrow.left);
    });

    it("boots at home, walking", () => {
        const start = initialWalker(input({ home: 0.25 }), T0, half);
        const step = stepWalker(start, input({ home: 0.25 }), T0, half);
        expect(step.state.name).toBe("walk");
        expect(step.x).toBe(homeX(0.25, LEDGE));
        expect(step.pose).toBe("walk1");
        expect(step.delayMs).toBe(FRAME_MS);
    });
});

describe("targets", () => {
    const avoid: [number, number][] = [
        [300, 500],
        [800, 1000],
    ];

    it("lie 80-400 px away and never in an avoid span", () => {
        for (let r = 0; r < 1; r += 0.01) {
            const inp = input({ avoid });
            const start = initialWalker(inp, T0, () => r);
            const target = start.target!;
            expect(Math.abs(target - start.x)).toBeGreaterThanOrEqual(80);
            expect(Math.abs(target - start.x)).toBeLessThanOrEqual(400);
            expect(overlaps(target, avoid), `target ${target} for r=${r}`).toBe(false);
            expect(target).toBeGreaterThanOrEqual(LEDGE.left);
            expect(target + PX).toBeLessThanOrEqual(LEDGE.right);
        }
    });

    it("fall back to the clear spot nearest home when none is clear 80-400 px away", () => {
        const ledge = { left: 0, right: 1200 };
        // clear left edges: 80..102 and 560..1152; home (0.3 → 346) sits on the second span, nearer its right side
        const blocks: [number, number][] = [
            [0, 80],
            [150, 560],
        ];
        const inp = input({ ledge, avoid: blocks, home: 0.3 });
        const step = stepWalker(walker({ name: "rest", x: 100, due: T0 }), inp, T0, half);
        expect(step.state.name).toBe("walk");
        expect(step.state.target).toBe(560);
        expect(step.state.target).toBe(clearSpot(homeX(0.3, ledge), ledge, blocks));
    });

    it("is replaced by the clear spot nearest it when its spot becomes blocked mid-walk", () => {
        let step = stepWalker(walker({ name: "walk", x: 400, target: 700 }), input(), T0, half);
        expect(step.x).toBe(403);
        // a surface switch puts a terminal over the target: x in 633..759 is now blocked, 760 is nearest 700
        const blockedNow = input({ avoid: [[680, 760]] });
        step = stepWalker(step.state, blockedNow, T0 + FRAME_MS, half);
        expect(step.state.name).toBe("walk");
        expect(step.state.target).toBe(760);
        expect(step.x).toBe(406);
        expect(step.delayMs).toBe(FRAME_MS);
        const { step: end } = drive(step.state, blockedNow, T0 + 2 * FRAME_MS, half, (s) => s.state.name !== "walk");
        expect(end.state.name).toBe("rest");
        expect(end.x).toBe(760);
        expect(overlaps(end.x, [[680, 760]])).toBe(false);
    });

    it("walks one cell per frame, alternating walk1 and walk2 every two frames", () => {
        let step = stepWalker(walker({ name: "walk", x: 400, target: 700, frame: 0 }), input(), T0, half);
        const poses = [step.pose];
        const xs = [step.x];
        for (let i = 1; i < 8; i++) {
            step = stepWalker(step.state, input(), T0 + i * FRAME_MS, half);
            poses.push(step.pose);
            xs.push(step.x);
        }
        expect(poses).toEqual(["walk1", "walk2", "walk2", "walk1", "walk1", "walk2", "walk2", "walk1"]);
        expect(xs).toEqual([403, 406, 409, 412, 415, 418, 421, 424]);
    });

    it("does not move on an early step, only reports the time left in the frame", () => {
        const first = stepWalker(walker({ name: "walk", x: 400, target: 700 }), input(), T0, half);
        const early = stepWalker(first.state, input(), T0 + 50, half);
        expect(early.x).toBe(first.x);
        expect(early.delayMs).toBe(FRAME_MS - 50);
    });
});

describe("hold", () => {
    const holds: [string, Partial<WalkerInput>][] = [
        ["a posture", { posture: "escalation" }],
        ["speaking", { speaking: true }],
        ["the peek", { peekOpen: true }],
        ["a drag", { dragging: true }],
    ];

    it.each(holds)("%s holds it still, delayMs null", (_label, over) => {
        const walking = stepWalker(walker({ name: "walk", x: 400, target: 700 }), input(), T0, half);
        // a posture hops first; step it out
        const { step, now } = drive(walking.state, input(over), T0 + FRAME_MS, half, () => false, 10);
        expect(step.delayMs).toBeNull();
        expect(step.x).toBe(walking.x);
        expect(step.lift).toBe(0);
        const later = stepWalker(step.state, input(over), now + 60_000, half);
        expect(later.delayMs).toBeNull();
        expect(later.x).toBe(walking.x);
        expect(later.state.name).toBe(over.dragging ? "dragged" : "hold");
    });

    it("stands with the posture's mark, and speaks while a bubble shows", () => {
        const held = (over: Partial<WalkerInput>) =>
            stepWalker(walker({ name: "hold", posture: over.posture ?? "none" }), input(over), T0, half);
        expect(held({ posture: "review-gate" })).toMatchObject({ pose: "stand", marks: ["gate"] });
        expect(held({ posture: "escalation" })).toMatchObject({ pose: "stand", marks: ["escalation"] });
        expect(held({ posture: "blocked-worker" })).toMatchObject({ pose: "stand", marks: ["blocked"] });
        expect(held({ speaking: true })).toMatchObject({ pose: "speak", marks: [] });
        expect(held({ peekOpen: true })).toMatchObject({ pose: "stand", marks: [] });
        expect(held({ posture: "escalation", speaking: true })).toMatchObject({ pose: "speak", marks: ["escalation"] });
    });

    it("dangles while dragged", () => {
        const step = stepWalker(walker({ name: "walk", x: 400, target: 700 }), input({ dragging: true }), T0, half);
        expect(step).toMatchObject({ pose: "dangle", delayMs: null, x: 400 });
        expect(step.state.name).toBe("dragged");
    });

    it("rests again once nothing holds it", () => {
        const step = stepWalker(walker({ name: "hold" }), input(), T0, half);
        expect(step.state.name).toBe("rest");
        expect(step.x).toBe(400);
    });

    it("hops in place when a posture arrives over a terminal, then walks off it and holds there", () => {
        const avoid: [number, number][] = [[380, 480]];
        const gate = input({ posture: "review-gate", avoid });
        const resting = walker({ name: "rest", x: 400, due: T0 + 8_000 });
        const { step, steps } = drive(resting, gate, T0, half, () => false);
        expect(steps[0]).toMatchObject({ x: 400, lift: HOP_LIFT_PX });
        expect(steps[0].state.name).toBe("hop");
        const names = steps.map((s) => s.state.name);
        expect(names).toContain("walk");
        // no hop after the walk starts, and no walk once it holds
        expect(names.slice(names.indexOf("walk"))).not.toContain("hop");
        expect(names.slice(names.indexOf("hold"))).toEqual(["hold"]);
        expect(steps.filter((s) => s.state.name === "walk").every((s) => s.marks.includes("gate"))).toBe(true);
        expect(step.state.name).toBe("hold");
        expect(step.delayMs).toBeNull();
        expect(step.x).toBe(clearSpot(400, LEDGE, avoid));
        expect(overlaps(step.x, avoid)).toBe(false);
    });

    it.each([
        ["speaking", { speaking: true }],
        ["the peek", { peekOpen: true }],
    ] as [string, Partial<WalkerInput>][])("holds over a terminal in place while %s", (_label, over) => {
        const avoid: [number, number][] = [[380, 480]];
        const inp = input({ posture: "review-gate", avoid, ...over });
        const { step, steps } = drive(walker({ name: "rest", x: 400, due: T0 + 8_000 }), inp, T0, half, () => false);
        expect(steps.map((s) => s.state.name)).not.toContain("walk");
        expect(step.state.name).toBe("hold");
        expect(step.x).toBe(400);
    });

    it("walks off a terminal it was held over once nothing holds it", () => {
        const avoid: [number, number][] = [[380, 480]];
        const step = stepWalker(walker({ name: "hold", x: 400 }), input({ avoid }), T0, half);
        expect(step.state.name).toBe("walk");
        expect(step.state.target).toBe(clearSpot(400, LEDGE, avoid));
        expect(overlaps(step.state.target!, avoid)).toBe(false);
    });
});

describe("rest", () => {
    it("returns the time left in it as delayMs, and walks again once that time passes", () => {
        const { step: arrived, now } = drive(
            walker({ name: "walk", x: 400, target: 430 }),
            input(),
            T0,
            half,
            (s) => s.state.name !== "walk"
        );
        expect(arrived.state.name).toBe("rest");
        expect(arrived.x).toBe(430);
        // rand 0.5: halfway through 5-15 s
        expect(arrived.delayMs).toBe(10_000);
        expect(["stand", "sit"]).toContain(arrived.pose);

        const mid = stepWalker(arrived.state, input(), now + 4_000, half);
        expect(mid.state.name).toBe("rest");
        expect(mid.delayMs).toBe(6_000);
        expect(mid.x).toBe(430);

        const end = stepWalker(mid.state, input(), now + 10_000, half);
        expect(end.state.name).toBe("walk");
        expect(end.delayMs).toBe(FRAME_MS);
    });

    it("lasts 5-15 s", () => {
        const shortest = stepWalker(walker({ name: "walk", x: 400, target: 400 }), input(), T0, () => 0);
        expect(shortest.delayMs).toBe(REST_MIN_MS);
        const longest = stepWalker(walker({ name: "walk", x: 400, target: 400 }), input(), T0, () => 0.999_999);
        expect(longest.delayMs).toBeGreaterThan(REST_MAX_MS - 1);
        expect(longest.delayMs).toBeLessThanOrEqual(REST_MAX_MS);
    });

    it("leaves a spot a terminal opened over", () => {
        const resting = walker({ name: "rest", x: 400, due: T0 + 8_000 });
        const step = stepWalker(resting, input({ avoid: [[420, 600]] }), T0 + 1_000, half);
        expect(step.state.name).toBe("walk");
        expect(overlaps(step.state.target!, [[420, 600]])).toBe(false);
    });
});

describe("hop", () => {
    it("hops once, two frames lifted two cells, when a posture arrives, and not while it stands", () => {
        const gate = input({ posture: "review-gate" });
        const resting = walker({ name: "rest", x: 400, due: T0 + 8_000 });

        const first = stepWalker(resting, gate, T0, half);
        expect(first).toMatchObject({ pose: "stand", marks: ["gate"], lift: HOP_LIFT_PX, delayMs: FRAME_MS, x: 400 });
        expect(first.state.name).toBe("hop");
        expect(HOP_LIFT_PX).toBe(6);

        const second = stepWalker(first.state, gate, T0 + FRAME_MS, half);
        expect(second).toMatchObject({ lift: HOP_LIFT_PX, delayMs: FRAME_MS, x: 400 });
        expect(second.state.name).toBe("hop");

        const landed = stepWalker(second.state, gate, T0 + 2 * FRAME_MS, half);
        expect(landed).toMatchObject({ pose: "stand", marks: ["gate"], lift: 0, delayMs: null, x: 400 });
        expect(landed.state.name).toBe("hold");

        // standing: stepped again and again, it never hops
        let step = landed;
        for (let i = 1; i <= 5; i++) {
            step = stepWalker(step.state, gate, T0 + i * 60_000, half);
            expect(step.state.name).toBe("hold");
            expect(step.lift).toBe(0);
        }

        // a different posture is a new arrival
        const escalated = stepWalker(step.state, input({ posture: "escalation" }), T0 + 400_000, half);
        expect(escalated.state.name).toBe("hop");
    });

    it("does not hop at boot for a posture already standing", () => {
        const gate = input({ posture: "review-gate" });
        const step = stepWalker(initialWalker(gate, T0, half), gate, T0, half);
        expect(step.state.name).toBe("hold");
        expect(step.lift).toBe(0);
    });
});

describe("tired", () => {
    function pxIn(ms: number, inp: WalkerInput): { px: number; delays: (number | null)[] } {
        const start = walker({ name: "walk", x: 200, target: 1200 });
        const { steps } = drive(start, inp, T0, half, (_s, now) => now >= T0 + ms);
        const last = steps[steps.length - 1];
        return { px: last.x - 200, delays: steps.slice(0, -1).map((s) => s.delayMs) };
    }

    it("walks at half speed, one cell every 250 ms", () => {
        const brisk = pxIn(2_000, input());
        const tired = pxIn(2_000, input({ expression: "tired" }));
        expect(brisk.px).toBe(48 + 3);
        expect(tired.px).toBe(24 + 3);
        expect(new Set(brisk.delays)).toEqual(new Set([FRAME_MS]));
        expect(new Set(tired.delays)).toEqual(new Set([TIRED_FRAME_MS]));
    });

    it("rests twice as long, in tired with the sweat drop", () => {
        const step = stepWalker(
            walker({ name: "walk", x: 400, target: 400 }),
            input({ expression: "tired" }),
            T0,
            half
        );
        expect(step.state.name).toBe("rest");
        expect(step.delayMs).toBe(20_000);
        expect(step.pose).toBe("tired");
        expect(step.marks).toEqual(["drop"]);
    });

    it("rests the same way when the RAM is full", () => {
        const step = stepWalker(
            walker({ name: "walk", x: 400, target: 400 }),
            input({ expression: "ram-full" }),
            T0,
            half
        );
        expect(step.delayMs).toBe(20_000);
        expect(step.pose).toBe("tired");
        expect(step.marks).toEqual(["drop"]);
    });

    it("walks in walk poses, without the drop", () => {
        const step = stepWalker(
            walker({ name: "walk", x: 400, target: 700 }),
            input({ expression: "tired" }),
            T0,
            half
        );
        expect(step.pose).toBe("walk1");
        expect(step.marks).toEqual([]);
    });
});

describe("sleep", () => {
    const idleAt = T0 - SLEEP_AFTER_MS;

    it("does not sleep a moment before 10 idle minutes", () => {
        const step = stepWalker(walker({ name: "rest", due: T0 }), input({ lastActivityAt: idleAt + 1 }), T0, half);
        expect(step.state.name).toBe("walk");
    });

    it("sleeps after 10 idle minutes, where it stands when that spot is clear", () => {
        const step = stepWalker(walker({ name: "rest", x: 400, due: T0 }), input({ lastActivityAt: idleAt }), T0, half);
        expect(step).toMatchObject({ pose: "sleep", marks: ["z"], x: 400, delayMs: null });
        expect(step.state.name).toBe("sleep");
    });

    it("walks off a terminal to sleep at the clear spot nearest it", () => {
        const avoid: [number, number][] = [[380, 500]];
        const inp = input({ avoid, lastActivityAt: idleAt });
        const { step } = drive(walker({ name: "hold", x: 400 }), inp, T0, half, (s) => s.state.name === "sleep");
        expect(step.state.name).toBe("sleep");
        expect(step.x).toBe(clearSpot(400, LEDGE, avoid));
        expect(overlaps(step.x, avoid)).toBe(false);
        expect(step.delayMs).toBeNull();
    });

    it("lies down mid-walk when idleness comes over a clear spot", () => {
        const step = stepWalker(
            walker({ name: "walk", x: 400, target: 700 }),
            input({ lastActivityAt: idleAt }),
            T0,
            half
        );
        // 400 is clear, so it lies down right there
        expect(step.state.name).toBe("sleep");
        expect(step.x).toBe(400);
    });

    it("wakes for a posture, hopping into its hold", () => {
        const asleep = walker({ name: "sleep", x: 400 });
        const step = stepWalker(asleep, input({ posture: "blocked-worker", lastActivityAt: idleAt }), T0, half);
        expect(step.state.name).toBe("hop");
        expect(step.marks).toEqual(["blocked"]);
    });

    it("wakes for activity, to a rest where it slept", () => {
        const asleep = walker({ name: "sleep", x: 400 });
        const step = stepWalker(asleep, input({ lastActivityAt: T0 }), T0, half);
        expect(step.state.name).toBe("rest");
        expect(step.x).toBe(400);
    });
});

describe("reduced motion", () => {
    const avoid: [number, number][] = [[650, 720]];

    it("never walks or hops, standing at the clear spot nearest home", () => {
        const inp = input({ reduce: true, avoid, home: 0.5 });
        const home = homeX(0.5, LEDGE);
        expect(overlaps(home, avoid)).toBe(true);
        const spot = clearSpot(home, LEDGE, avoid);
        expect(overlaps(spot, avoid)).toBe(false);

        let step = stepWalker(initialWalker(inp, T0, half), inp, T0, half);
        expect(step.x).toBe(spot);
        const scenes: Partial<WalkerInput>[] = [
            {},
            { expression: "tired" },
            { posture: "escalation" },
            { posture: "review-gate", speaking: true },
            { peekOpen: true },
            { lastActivityAt: T0 - SLEEP_AFTER_MS },
            {},
        ];
        let now = T0;
        for (const over of scenes) {
            for (let i = 0; i < 4; i++) {
                now += 30_000;
                step = stepWalker(step.state, { ...inp, ...over }, now, half);
                expect(["walk", "hop"]).not.toContain(step.state.name);
                expect(step.x).toBe(spot);
                expect(step.delayMs).toBeNull();
                expect(step.lift).toBe(0);
            }
        }
    });

    it("still changes pose and marks", () => {
        const inp = input({ reduce: true });
        const start = initialWalker(inp, T0, half);
        expect(stepWalker(start, inp, T0, half)).toMatchObject({ pose: "stand", marks: [] });
        expect(stepWalker(start, { ...inp, expression: "tired" }, T0, half)).toMatchObject({
            pose: "tired",
            marks: ["drop"],
        });
        expect(stepWalker(start, { ...inp, posture: "escalation" }, T0, half)).toMatchObject({
            pose: "stand",
            marks: ["escalation"],
        });
        expect(stepWalker(start, { ...inp, speaking: true }, T0, half)).toMatchObject({ pose: "speak" });
        expect(stepWalker(start, { ...inp, lastActivityAt: T0 - SLEEP_AFTER_MS }, T0, half)).toMatchObject({
            pose: "sleep",
            marks: ["z"],
        });
    });

    it("stands on a span, at home, only when every spot is blocked", () => {
        const inp = input({ reduce: true, avoid: [[0, 2000]], home: 0.5 });
        const step = stepWalker(initialWalker(inp, T0, half), inp, T0, half);
        expect(step.x).toBe(homeX(0.5, LEDGE));
    });

    it("places a drop at the clear spot nearest it, without walking", () => {
        const inp = input({ reduce: true, avoid, home: homeFraction(660, LEDGE) });
        const step = stepWalker(walker({ name: "dragged", x: 300 }), inp, T0, half);
        expect(step.x).toBe(clearSpot(660, LEDGE, avoid));
        expect(step.state.name).toBe("rest");
        expect(step.delayMs).toBeNull();
    });
});

describe("home", () => {
    it("keeps its relative position across ledges of different widths", () => {
        const wide = { left: 0, right: 1048 }; // travel 0..1000
        const narrow = { left: 200, right: 748 }; // travel 200..700
        expect(homeX(homeFraction(250, wide), narrow)).toBe(325);
        expect(homeX(homeFraction(1000, wide), narrow)).toBe(700);
        expect(homeX(homeFraction(0, wide), narrow)).toBe(200);
        expect(homeFraction(250, wide)).toBeCloseTo(homeFraction(325, narrow), 10);
    });

    it("round-trips every whole-px left edge on one ledge", () => {
        const ledge = { left: 56.5, right: 1373.25 };
        for (let x = 57; x <= 1325; x++) {
            expect(homeX(homeFraction(x, ledge), ledge)).toBe(x);
        }
    });

    it("keeps an out-of-range fraction on the ledge", () => {
        expect(homeX(-1, LEDGE)).toBe(100);
        expect(homeX(2, LEDGE)).toBe(1252);
        expect(homeFraction(-500, LEDGE)).toBe(0);
        expect(homeFraction(5_000, LEDGE)).toBe(1);
    });

    it("lands a released drag at the drop it persisted as home", () => {
        const dropX = dropAt(800, LEDGE);
        const inp = input({ home: homeFraction(dropX, LEDGE) });
        const step = stepWalker(walker({ name: "dragged", x: 300 }), inp, T0, half);
        expect(step.x).toBe(dropX);
        expect(step.x + PX / 2).toBe(800);
        expect(step.state.name).toBe("rest");
        expect(step.pose).not.toBe("dangle");
    });

    it("walks off a drop onto a terminal, but shows the landing first", () => {
        const avoid: [number, number][] = [[700, 900]];
        const dropX = dropAt(800, LEDGE);
        const inp = input({ avoid, home: homeFraction(dropX, LEDGE) });
        const step = stepWalker(walker({ name: "dragged", x: 300 }), inp, T0, half);
        expect(step.x).toBe(dropX);
        expect(step.state.name).toBe("walk");
        expect(step.state.target).toBe(clearSpot(dropX, LEDGE, avoid));
    });
});

describe("dropAt", () => {
    it("centres the sprite on the pointer", () => {
        expect(dropAt(500, LEDGE)).toBe(476);
        expect(dropAt(500.4, LEDGE) + PX / 2).toBeCloseTo(500.4, 0);
    });

    it("clamps to the ledge", () => {
        expect(dropAt(0, LEDGE)).toBe(100);
        expect(dropAt(110, LEDGE)).toBe(100);
        expect(dropAt(5_000, LEDGE)).toBe(1252);
        expect(dropAt(1290, LEDGE)).toBe(1252);
    });
});

describe("clearSpot", () => {
    const avoid: [number, number][] = [[400, 500]]; // blocks left edges 353..499

    it("is the target when the target is clear", () => {
        expect(clearSpot(200, LEDGE, avoid)).toBe(200);
        // flush against the span on either side is clear
        expect(clearSpot(352, LEDGE, avoid)).toBe(352);
        expect(clearSpot(500, LEDGE, avoid)).toBe(500);
    });

    it("is the nearest clear left edge when the target is blocked", () => {
        expect(clearSpot(380, LEDGE, avoid)).toBe(352);
        expect(clearSpot(470, LEDGE, avoid)).toBe(500);
    });

    it("is the target when nothing is clear", () => {
        expect(clearSpot(600, LEDGE, [[0, 5_000]])).toBe(600);
    });

    it("stays on the ledge", () => {
        expect(clearSpot(-50, LEDGE, [])).toBe(100);
        expect(clearSpot(110, LEDGE, [[90, 160]])).toBe(160);
    });
});

describe("nextTick", () => {
    it("is null while hidden, else the delay", () => {
        expect(nextTick(FRAME_MS, true)).toBeNull();
        expect(nextTick(10_000, true)).toBeNull();
        expect(nextTick(FRAME_MS, false)).toBe(FRAME_MS);
        expect(nextTick(null, false)).toBeNull();
    });
});
