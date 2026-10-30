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
};

/** Opacity `elapsedMs` into a dot's pulse: 1 down to `low` over the first half, back up over the second. */
export function pulseOpacity(spec: PulseSpec, elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return 1;
    }
    const phase = (elapsedMs % spec.periodMs) / spec.periodMs;
    const depth = 1 - spec.low;
    return phase < 0.5 ? 1 - depth * spec.ease(phase * 2) : spec.low + depth * spec.ease((phase - 0.5) * 2);
}
