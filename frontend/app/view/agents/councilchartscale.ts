// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The arithmetic the council figures' axes share (councilchartparts.tsx draws them): a value-to-pixel scale, linear or
// log, the "nice" ticks of a linear axis and the short number a tick is written in. Pure, so the views place a mark
// with the same scale the axis draws its ticks with, and vitest holds the numbers.

/** A value on an axis to its pixel along it. */
export type Scale = (v: number) => number;

/** A linear scale: `domain[0]` lands on `range[0]`, `domain[1]` on `range[1]` (a y axis passes its range bottom-first,
 *  so a bigger value sits higher). A zero-width domain puts everything on `range[0]`. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
    const span = domain[1] - domain[0];
    return (v) => (span === 0 ? range[0] : range[0] + ((v - domain[0]) / span) * (range[1] - range[0]));
}

/** A log scale over a positive domain. A value at or under zero has no place on it and lands on `range[0]`. */
export function logScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
    const lo = Math.log10(domain[0]);
    const span = Math.log10(domain[1]) - lo;
    return (v) =>
        span === 0 || !(v > 0) ? range[0] : range[0] + ((Math.log10(v) - lo) / span) * (range[1] - range[0]);
}

/** The ticks a token axis shows on its log scale: 0.3M, 1M, 3M, 10M, 30M. */
export const LOG_TOKEN_TICKS: readonly number[] = [300_000, 1_000_000, 3_000_000, 10_000_000, 30_000_000];

/** Round ticks for a linear axis over `[lo, hi]`: about `count` of them, on a step of 1, 2 or 5 times a power of ten,
 *  every one inside the interval. An empty or backwards interval gives none. */
export function linearTicks(lo: number, hi: number, count = 5): number[] {
    if (!(hi > lo) || count < 1) {
        return [];
    }
    const raw = (hi - lo) / count;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = raw / pow;
    const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * pow;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
        // a multiple of 0.1, 0.2, 0.5 can land a hair off; the fixed 12 places drop the float noise
        out.push(Number(v.toFixed(12)));
    }
    return out;
}

/** A short number: 1000000 -> "1M", 30000000 -> "30M", 300000 -> "300k", 2500 -> "2.5k", 40 -> "40". */
export function compactNumber(v: number): string {
    const unit = (n: number, d: number, suffix: string) => `${Number((n / d).toFixed(1))}${suffix}`;
    if (v >= 1_000_000) {
        return unit(v, 1_000_000, "M");
    }
    if (v >= 1_000) {
        return unit(v, 1_000, "k");
    }
    return String(Number(v.toFixed(1)));
}

/** A token axis's tick, in millions down to 0.1M so the ticks read as one run: 300000 -> "0.3M", 1000000 -> "1M",
 *  30000000 -> "30M". Under 100k it falls back to compactNumber. */
export function tokenTick(v: number): string {
    return v >= 100_000 ? `${Number((v / 1_000_000).toFixed(1))}M` : compactNumber(v);
}
