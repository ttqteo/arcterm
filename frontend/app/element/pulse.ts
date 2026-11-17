// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The status-dot pulse, as numbers. It used to be CSS keyframe animations, but any infinite CSS animation
// keeps the page producing frames at display rate for as long as it is on screen (measured: ~7% of a core
// in the GPU process, one dot or twelve). pulsedriver.tsx draws these same curves at a low rate instead;
// this module is the curves, pure so they can be checked against what the CSS did.

export interface PulseSpec {
    periodMs: number;
    /** opacity at the bottom of the cycle; the top is always 1 */
    low: number;
    /** timing function, applied to each half of the cycle as CSS applies it to each keyframe interval */
    ease: (t: number) => number;
    /** the style property the driver writes the curve to; opacity unless set */
    prop?: string;
    /** a sweep instead of a breath: the value climbs 0 to 1 at an even pace each period, then starts again from 0
     *  (low and ease unused) */
    sweep?: boolean;
    /** a jitter instead: a new random-looking value in [0, 1) every `noise` ms, held between (low, ease and sweep
     *  unused). The same step always gives the same value, so it stays pure and testable */
    noise?: number;
}

/** A value in [0, 1) for step `i`, scattered so neighbouring steps look unrelated (a 32-bit integer hash). `seed`
 *  picks one of many such sequences: the driver gives each element its own, so two bolts, or the dot and its words,
 *  never jitter in step. */
export function noiseAt(i: number, seed = 0): number {
    let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((seed | 0) + 0x165667b1, 0x27d4eb2d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 2 ** 32;
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress, solved by bisection on x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
    const at = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
    return (t) => {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (at(x1, x2, mid) < t) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return at(y1, y2, (lo + hi) / 2);
    };
}

// Keyed by the class a call site puts on its dot. Each keeps the CSS animation it replaces exactly:
// pulseDot 1.6s (default `ease`), pulseDot 1.8s ease-in-out, tailwind's animate-pulse, and breatheGlow.
export const PULSES: Record<string, PulseSpec> = {
    "pulse-dot": { periodMs: 1_600, low: 0.32, ease: cubicBezier(0.25, 0.1, 0.25, 1) },
    "pulse-dot-slow": { periodMs: 1_800, low: 0.32, ease: cubicBezier(0.42, 0, 0.58, 1) },
    "pulse-soft": { periodMs: 2_000, low: 0.5, ease: cubicBezier(0.4, 0, 0.6, 1) },
    // breatheGlow 2.4s ease-in-out: tailwindsetup.css's .pulse-glow reads the curve as the glow's strength
    "pulse-glow": { periodMs: 2_400, low: 0, ease: cubicBezier(0.42, 0, 0.58, 1), prop: "--pulse" },
    // the same breath on an asking agent's row in the Agent tree: tailwindsetup.css's .asking-tint reads it as the
    // opacity of the amber wash and edge on the row's ::after, which never fades out entirely
    "asking-tint": { periodMs: 2_400, low: 0.3, ease: cubicBezier(0.42, 0, 0.58, 1), prop: "--tint" },
    // a council seat's typing bubble (councilchat.tsx TypingDots): three dots, each a step behind the one before it
    // (data-pulse-lag); tailwindsetup.css's .pulse-typing reads the curve as each dot's lift and brightness
    "pulse-typing": { periodMs: 1_200, low: 0.35, ease: cubicBezier(0.42, 0, 0.58, 1), prop: "--typing" },
    // the Christmas lights under the app bar while an agent asks (christmaslights.tsx): every other bulb lags half a
    // period (data-pulse-lag), so the string chases; lit and still otherwise, with no class and no frames
    "pulse-blink": { periodMs: 1_200, low: 0.25, ease: cubicBezier(0.42, 0, 0.58, 1) },
    // Chat's working line (chatpane.tsx), as Claude Code's spinner verb shimmers: tailwindsetup.css's .shimmer-jarvis
    // reads --sweep as where a band of Jarvis's hot core crosses text drawn in its blue, left to right, every 2s
    "shimmer-jarvis": { periodMs: 2_000, low: 0, ease: (t) => t, prop: "--sweep", sweep: true },
    // the hologram dot at the head of that line (workingglyph.tsx): tailwindsetup.css's .holo-ring-out / -in read
    // --spin as one turn of the outer ring and two the other way of the inner, every 4s
    "holo-spin": { periodMs: 4_000, low: 0, ease: (t) => t, prop: "--spin", sweep: true },
    // and its sparks: .holo-spark reads --spark as a flash at the top of each period that dies within a fifth of it;
    // two periods, so the sparks flash out of step
    "holo-spark": { periodMs: 1_100, low: 0, ease: (t) => t, prop: "--spark", sweep: true },
    "holo-spark-slow": { periodMs: 1_700, low: 0, ease: (t) => t, prop: "--spark", sweep: true },
    // where each spark strikes: a new --arc as each flash starts (the step is the spark's period, and the group around
    // it starts with it), which .holo-arc reads as a turn and .holo-spark as the bolt's length and zigzag, so no two
    // flashes look alike
    "holo-arc": { periodMs: 1_100, low: 0, ease: (t) => t, prop: "--arc", noise: 1_100 },
    "holo-arc-slow": { periodMs: 1_700, low: 0, ease: (t) => t, prop: "--arc", noise: 1_700 },
    // the electric crackle: the whole dot jolts a pixel and flares now and then (.holo-jolt, --jolt), and its core
    // flickers (.holo-core, --flick)
    "holo-jolt": { periodMs: 120, low: 0, ease: (t) => t, prop: "--jolt", noise: 120 },
    "holo-core": { periodMs: 90, low: 0, ease: (t) => t, prop: "--flick", noise: 90 },
    // the working line's words catch the jolt now and then: a flare and a sub-pixel kick (.volt-text, --volt)
    "volt-text": { periodMs: 140, low: 0, ease: (t) => t, prop: "--volt", noise: 140 },
};

/** When a pulse that runs `lag` ms (an element's data-pulse-lag) behind one seen at `now` started: already that far
 *  behind in its cycle, so it never waits at the top the way a CSS animation-delay does. `now` for no lag. */
export function pulseStart(now: number, spec: PulseSpec, lag: string | undefined): number {
    const ms = Number(lag);
    if (!Number.isFinite(ms) || ms <= 0) {
        return now;
    }
    return now - (spec.periodMs - (ms % spec.periodMs));
}

/** Opacity `elapsedMs` into a dot's pulse: 1 down to `low` over the first half, back up over the second. */
export function pulseOpacity(spec: PulseSpec, elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return 1;
    }
    const phase = (elapsedMs % spec.periodMs) / spec.periodMs;
    const depth = 1 - spec.low;
    return phase < 0.5 ? 1 - depth * spec.ease(phase * 2) : spec.low + depth * spec.ease((phase - 0.5) * 2);
}

/** What the driver writes `elapsedMs` into a pulse: a jitter's value for its step (noiseAt), a sweep's place in its
 *  period (0 to just under 1), or a breath's opacity (pulseOpacity). `seed` is the element's own, for a jitter. */
export function pulseValue(spec: PulseSpec, elapsedMs: number, seed = 0): number {
    if (spec.noise != null) {
        const step = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.floor(elapsedMs / spec.noise) : 0;
        return noiseAt(step, seed);
    }
    if (!spec.sweep) {
        return pulseOpacity(spec, elapsedMs);
    }
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return 0;
    }
    return (elapsedMs % spec.periodMs) / spec.periodMs;
}
