// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// When a surface's list moves on the spring and when it shows at once (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md,
// Design §3). One item arriving, leaving or changing size is a thing the eye should follow, so it animates on
// MOTION.spring. A first load, a filter switch, or three or more items arriving or leaving together is a whole new
// picture, not a change to follow: running the spring on every row of it is a pile of motion, so it shows at once.
//
// `batchMotion` is the decision, a pure function of the last committed picture and this one. `useSpringBatch` feeds it
// from a ref written in a layout effect, so it compares against the last render that reached the screen: a double render
// or a re-render with the same keys never re-decides. A re-render with the same keys is "animate", so a card that only
// changes size still animates; order changes and re-deals add and remove nothing, so they animate too.

import type { Transition, Variants } from "motion/react";
import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { MOTION } from "./motiontokens";

export type BatchMotion = "animate" | "instant";

// this many items arriving plus leaving at once is a batch
export const BATCH_INSTANT_AT = 3;

// the picture of the last committed render: the item keys, and the filter that chose them (a change of filter is a batch)
export interface BatchSeen {
    keys: readonly string[];
    filter?: string;
}

// prev null is the first load. Otherwise: a changed filter, or keys added plus keys removed reaching BATCH_INSTANT_AT, is
// "instant"; anything else, a reorder and a same-keys re-render included, is "animate".
export function batchMotion(prev: BatchSeen | null, keys: readonly string[], filter?: string): BatchMotion {
    if (prev == null || prev.filter !== filter) {
        return "instant";
    }
    const before = new Set(prev.keys);
    const after = new Set(keys);
    let changed = 0;
    for (const key of after) {
        if (!before.has(key)) {
            changed++;
        }
    }
    for (const key of before) {
        if (!after.has(key)) {
            changed++;
        }
    }
    return changed >= BATCH_INSTANT_AT ? "instant" : "animate";
}

// The decision for this render. The ref holds the last committed render, written in a layout effect: a render React throws
// away, or runs twice, never moves it.
export function useSpringBatch(keys: readonly string[], filter?: string): BatchMotion {
    const seen = useRef<BatchSeen | null>(null);
    const motion = batchMotion(seen.current, keys, filter);
    useLayoutEffect(() => {
        seen.current = { keys, filter };
    });
    return motion;
}

// The transition for a layout, height or position a surface animates by hand: the spring for a change worth following, no
// time for a batch or under reduced motion (reduced motion drops transform and layout animations, and a spring is both).
export function shapeTransition(motion: BatchMotion, reduce?: boolean | null): Transition {
    return motion === "animate" && !reduce ? MOTION.spring : { duration: 0 };
}

// The Framer props of one part entering or leaving. Reduced motion snaps it: opacity and height animations still play
// under MotionConfig's "user" setting (it drops only transform and layout), so the part skips its variants instead (no
// initial, no exit). Every springReveal, springPop and springSheet site spreads this rather than relying on MotionConfig.
export function usePartMotion(variants: Variants) {
    const reduce = useReducedMotion();
    return reduce
        ? ({ variants, initial: false, animate: "animate" } as const)
        : ({ variants, initial: "initial", animate: "animate", exit: "exit" } as const);
}
