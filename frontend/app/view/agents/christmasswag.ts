// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where the app bar's Christmas lights hang (canvas xmas-lights-wrap, option B2): one swag of wire in each gap between
// the bar's boxes (the search, the chips, New, the fold button), hooked to the top corners of the two boxes beside
// it, and bulbs only along the swags, so no bulb sits on a box. The first swag hangs from the bar's top edge after the
// project switcher, the last from the bar's top right corner (a Mac, where nothing follows the fold button).
// Pure geometry in the bar's own px; christmaslights.tsx measures the boxes and draws it.

/** A box in the bar, in px from the bar's top left. */
export interface Post {
    left: number;
    right: number;
    top: number;
}

/** One swag, from one hook to the next. */
export interface Swag {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** A swag drawn: its wire's path and the points on it where a bulb's socket sits. */
export interface SwagShape {
    path: string;
    sockets: { x: number; y: number }[];
}

// a hook sits this far in from a box's corner, a hair above its top edge, so the wire tucks behind the corner
const HOOK_IN = 2;
const HOOK_RISE = 0.5;
// the bar's own hooks, at either end, hang from its top edge
const EDGE_Y = 1;
// the spike's bulb spacing along a swag
const BULB_GAP = 26;
// a swag hangs only with more bulbs than this: the 10px gaps between the buttons took one bulb each, which read as a
// blob stuck between two boxes, not as lights
const MAX_BULBS_HIDDEN = 2;

const bulbCount = (span: number) => Math.max(1, Math.round(span / BULB_GAP));
// a 10px gap dips ~5px, a 160px one the most, 17px: the bulbs under it still end above the bar's bottom edge
const DIP_MIN = 4;
const DIP_PER_PX = 0.09;
const DIP_MAX = 17;

const half = (n: number) => Math.round(n * 2) / 2;

/** The swags across the bar: from `start` (an x on the top edge, or null) to the first box, between each two boxes,
 *  and from the last box to `end` (an x on the top edge, or null), keeping only those wide enough for more than two
 *  bulbs. Boxes come in any order. */
export function swagsFor(start: number | null, posts: Post[], end: number | null): Swag[] {
    const boxes = posts.filter((p) => p.right > p.left).sort((a, b) => a.left - b.left);
    const hooks: { x: number; y: number; box: boolean }[][] = [];
    if (start != null && boxes.length > 0) {
        hooks.push([
            { x: start, y: EDGE_Y, box: false },
            { x: boxes[0].left + HOOK_IN, y: boxes[0].top - HOOK_RISE, box: true },
        ]);
    }
    for (let i = 1; i < boxes.length; i++) {
        const a = boxes[i - 1];
        const b = boxes[i];
        hooks.push([
            { x: a.right - HOOK_IN, y: a.top - HOOK_RISE, box: true },
            { x: b.left + HOOK_IN, y: b.top - HOOK_RISE, box: true },
        ]);
    }
    if (end != null && boxes.length > 0) {
        const last = boxes[boxes.length - 1];
        hooks.push([
            { x: last.right - HOOK_IN, y: last.top - HOOK_RISE, box: true },
            { x: end, y: EDGE_Y, box: false },
        ]);
    }
    return hooks
        .filter(([a, b]) => b.x - a.x > 0 && bulbCount(b.x - a.x) > MAX_BULBS_HIDDEN)
        .map(([a, b]) => ({ x1: half(a.x), y1: half(a.y), x2: half(b.x), y2: half(b.y) }));
}

/** The wire of one swag, a quadratic dipping below its lower hook, and a socket every ~26px along it (one at least). */
export function swagShape(s: Swag): SwagShape {
    const span = s.x2 - s.x1;
    const dip = Math.min(DIP_MAX, DIP_MIN + span * DIP_PER_PX);
    const cx = (s.x1 + s.x2) / 2;
    const cy = Math.max(s.y1, s.y2) + dip * 2;
    const count = bulbCount(span);
    const sockets: { x: number; y: number }[] = [];
    for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const u = 1 - t;
        sockets.push({
            x: half(u * u * s.x1 + 2 * u * t * cx + t * t * s.x2),
            y: half(u * u * s.y1 + 2 * u * t * cy + t * t * s.y2),
        });
    }
    return { path: `M${s.x1} ${s.y1} Q${cx} ${cy} ${s.x2} ${s.y2}`, sockets };
}
