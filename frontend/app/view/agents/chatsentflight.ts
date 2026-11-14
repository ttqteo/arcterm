// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The flight of a message the person just sent, from the box to the conversation: its bubble mounts with its text over
// the text in the box, the size the box drew it, and flies to its place at the conversation's end, so the eye sees the
// box's text become the bubble. The box and the bubble share their background, so at first only the text shows; the
// bubble's shape shows as it leaves the box. The pure arithmetic is here; the DOM side is chatpane.tsx useSentFlight,
// and the box measures where its text sat (sentFromBox) as it sends.

/** Where the message's text sat in the box as it was sent, in viewport px: `x` the left edge of its first line's text,
 *  `y` that line's vertical centre, `fontSize` the box's text size. */
export interface SentFrom {
    x: number;
    y: number;
    fontSize: number;
}

/** Where the bubble's own text starts inside the element that flies, unscaled, in px from its top-left corner: `x` the
 *  first line's left edge, `y` its vertical centre, `fontSize` the bubble's text size. */
export interface FlightAnchor {
    x: number;
    y: number;
    fontSize: number;
}

/** The transform of the flying element at one moment: a translate from where it lays out, then a scale about its
 *  top-left corner (transform-origin 0 0, so the scale never moves that corner and the translate stays exact). */
export interface Flight {
    dx: number;
    dy: number;
    scale: number;
}

/** How much sooner the flight's x arrives than its y: x runs on the progress bent by this power, so the bubble slides
 *  toward its side a little ahead of its rise and the path curves instead of cutting a straight diagonal. */
export const FLIGHT_X_LEAD = 1.35;

/** The flight's transform at progress `p` (0 at the box, 1 landed; the spring's, clamped) when the element would lay out
 *  at `target` (its top-left, viewport px). Its text's first line runs from `from` to where the target puts it, and its
 *  size from the box's to its own; at 1 it is no transform at all. */
export function flightAt(
    from: SentFrom,
    target: { left: number; top: number },
    anchor: FlightAnchor,
    p: number
): Flight {
    const q = Math.min(1, Math.max(0, p));
    const qx = 1 - (1 - q) ** FLIGHT_X_LEAD;
    const s0 = anchor.fontSize > 0 && from.fontSize > 0 ? from.fontSize / anchor.fontSize : 1;
    const scale = s0 + (1 - s0) * q;
    // where the text's first line is now: on its way from the box to its place
    const x = from.x + (target.left + anchor.x - from.x) * qx;
    const y = from.y + (target.top + anchor.y - from.y) * q;
    return { dx: x - target.left - anchor.x * scale, dy: y - target.top - anchor.y * scale, scale };
}

/** The opacity of a bubble that lands dimmed (`dim`: a Queued message, a pending command) at progress `p`: it leaves the
 *  box at full strength, as its text was there, and dims as it lands. */
export function flightOpacity(dim: number, p: number): number {
    const q = Math.min(1, Math.max(0, p));
    return 1 - (1 - dim) * q;
}

/** How long the flight's aim takes to follow its place, as a time constant (ms): about 63% of the way in this long. */
export const AIM_FOLLOW_MS = 40;

/** Where the flight aims, eased toward `measured`, the place the bubble will land as read this frame. That place steps
 *  rather than glides (the dock's padding and the scroll pin land a frame after the box or the row that moved them), so
 *  aiming straight at each read made the bubble jitter on its way and jump as it landed; the aim follows the read with
 *  a time constant instead, the same whatever the frame rate. `prev` null: the first read, taken as it is. */
export function followAim(
    prev: { left: number; top: number } | null,
    measured: { left: number; top: number },
    dtMs: number
): { left: number; top: number } {
    if (prev == null) {
        return measured;
    }
    const k = 1 - Math.exp(-Math.max(0, dtMs) / AIM_FOLLOW_MS);
    return { left: prev.left + (measured.left - prev.left) * k, top: prev.top + (measured.top - prev.top) * k };
}

/** How far the scroller still has to go to its end: the conversation is following its end (Chat jumps there on a send),
 *  so this is how much the bubble's place will still move up, by the pin that comes after the frame's layout or by the
 *  smooth scroll of a jump from higher up. The flight aims at the place it will have. */
export function scrollToGo(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
    return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
}
