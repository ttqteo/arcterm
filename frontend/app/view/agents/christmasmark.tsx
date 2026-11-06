// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app bar's t> mark under the Christmas decor (canvas xmas-mark, board C4), on the plain mark's grid: cells at 2px
// steps drawn 3px square. The t is a lit pine with a star in the accent on its stem and two baubles under its
// crossbar; the chevron is a string of lights in pairs of red and gold out from its tip, red at both ends and at the
// tip. Still: it never blinks. The menu bar icon draws the same mark (trayicon.rs mac_xmas_icon).
// pointer-events-none: drag.js skips SVG elements, so the press must land on the parent span.

// the chevron's nine blocks from its top end to its bottom end, each gold or red (trayicon.rs xmas_light_is_gold)
const LIGHTS: { x: number; y: number; gold: boolean }[] = [
    { x: 14, y: 0, gold: false },
    { x: 16, y: 2, gold: false },
    { x: 18, y: 4, gold: true },
    { x: 20, y: 6, gold: true },
    { x: 22, y: 8, gold: false },
    { x: 20, y: 10, gold: true },
    { x: 18, y: 12, gold: true },
    { x: 16, y: 14, gold: false },
    { x: 14, y: 16, gold: false },
];

export function ChristmasMark() {
    return (
        <svg
            width="25"
            height="19"
            viewBox="0 0 25 19"
            shapeRendering="crispEdges"
            aria-hidden="true"
            // the star stands 5px over the mark's box, into the bar's room above it
            className="pointer-events-none overflow-visible"
        >
            <g className="fill-xmas-pine-lit">
                <rect x="2" y="2" width="3" height="13" />
                <rect x="0" y="6" width="11" height="3" />
                <rect x="10" y="12" width="3" height="3" />
                <rect x="4" y="14" width="7" height="3" />
            </g>
            {/* in order, so each block's corner overlaps the one before it as the plain chevron's do */}
            {LIGHTS.map((l) => (
                <rect
                    key={l.y}
                    x={l.x}
                    y={l.y}
                    width="3"
                    height="3"
                    className={l.gold ? "fill-accent" : "fill-xmas-bulb"}
                />
            ))}
            <g className="fill-accent">
                <rect x="2" y="-3" width="3" height="3" />
                <rect x="0" y="-2" width="7" height="1" />
                <rect x="3" y="-5" width="1" height="7" />
                <rect x="7" y="10" width="2" height="2" />
            </g>
            <rect x="0" y="10" width="2" height="2" className="fill-xmas-bulb" />
        </svg>
    );
}
