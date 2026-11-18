// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The parts of Sidecar's HUD skin (spec 2026-11-18-sidecar-hud-design.md, boards A and Q), shared by the wall P, the small
// form Q, the title bar and the Resources panel. Two kinds:
//   - static decoration (HudBrackets, HudTickRing, HudDivider): `React.memo`, `aria-hidden`, `pointer-events-none`, marked
//     `data-hud-deco`, taking only props that never change with a snapshot, so a snapshot never re-renders or repaints one;
//   - the glow (GlowCircle, GlowPath): the same stroke drawn twice, a wide faint halo under a thin bright core. It is plain
//     SVG, never a `filter` or a `box-shadow` (the alert frame in sidecarorbit.tsx / sidecarcompact.tsx is the one glowing
//     shadow), and it draws a changing value, so it is not memoized: the caller's `style` (colour, dash, transition) reaches
//     both strokes.
// Colours come from the `hud-*` tokens in tailwindsetup.css; the geometry is sidecarhudmodel.ts. It runs on the slim
// Sidecar page (frontend/tauri/sidecar.tsx), which boots no cockpit store, so it imports only react, `cn` and the model.

import { cn } from "@/util/util";
import { memo, type ReactNode, type SVGProps } from "react";
import { bracketPath, HUD_GLOW_HALO, HUD_GLOW_OPACITY, tickLines, type BracketCorner } from "./sidecarhudmodel";

const BRACKET_STROKE = 1.5;
// the elbow sits this far in from the box's corner, so the stroke stays inside the box (bracketPath's default)
const BRACKET_INSET = 1;
const BRACKET_CORNERS: { corner: BracketCorner; place: string }[] = [
    { corner: "tl", place: "left-0 top-0" },
    { corner: "tr", place: "right-0 top-0" },
    { corner: "br", place: "bottom-0 right-0" },
    { corner: "bl", place: "bottom-0 left-0" },
];

/**
 * Four corner brackets pinned to the corners of the nearest `relative` parent, `size` px each (14 on P, smaller on Q).
 * Each bends round its corner: `radius` is the radius of the box they stand on (6 for `rounded-md`, 12 for `rounded-lg`;
 * 6 unless given), and the arc is that less the inset, so a bracket follows its box's corner and a radius of 0 is the
 * right angle. Four fixed-size SVGs, not one sized to the box, so nothing measures the parent. `hud-glow` by default;
 * `className` recolours them (`stroke-error` for the RAM band).
 */
export const HudBrackets = memo(function HudBrackets({
    size = 14,
    radius = 6,
    className,
}: {
    size?: number;
    radius?: number;
    className?: string;
}) {
    return (
        <div aria-hidden="true" data-hud-deco="brackets" className="pointer-events-none absolute inset-0">
            {BRACKET_CORNERS.map(({ corner, place }) => (
                <svg
                    key={corner}
                    width={size}
                    height={size}
                    viewBox={`0 0 ${size} ${size}`}
                    strokeWidth={BRACKET_STROKE}
                    className={cn("absolute fill-none stroke-hud-glow", place, className)}
                >
                    <path d={bracketPath(size, corner, BRACKET_INSET, radius - BRACKET_INSET)} />
                </svg>
            ))}
        </div>
    );
});

/** A coordinate to a tenth of a pixel: a tick ring of 120 ticks stays a short path string. */
function tenth(n: number): number {
    return Math.round(n * 10) / 10;
}

/**
 * A ring of `hud-line` ticks to draw inside the caller's `<svg>`: `count` of them round (`cx`, `cy`) at radius `r`, from 12
 * o'clock clockwise, every `majorEvery`-th one `majorLen` long and the rest `minorLen`, all pointing inward. One `<path>`
 * for the whole ring, not a `<line>` per tick.
 */
export const HudTickRing = memo(function HudTickRing(props: {
    cx: number;
    cy: number;
    r: number;
    count: number;
    majorEvery: number;
    minorLen: number;
    majorLen: number;
}) {
    const { cx, cy, r, count, majorEvery, minorLen, majorLen } = props;
    const d = tickLines(cx, cy, r, count, majorEvery, minorLen, majorLen)
        .map((t) => `M${tenth(t.x1)} ${tenth(t.y1)}L${tenth(t.x2)} ${tenth(t.y2)}`)
        .join("");
    return (
        <g aria-hidden="true" data-hud-deco="ticks" className="pointer-events-none">
            <path d={d} strokeWidth={1} className="fill-none stroke-hud-line" />
        </g>
    );
});

/**
 * A circuit-line divider: a 1 px `hud-line` rule that leaves a short 45-degree jog at its start and ends in a small node.
 * It fills its parent's width; `className` places it (margins, a self-alignment).
 */
export const HudDivider = memo(function HudDivider({ className }: { className?: string }) {
    return (
        <div
            aria-hidden="true"
            data-hud-deco="divider"
            className={cn("pointer-events-none flex h-[7px] shrink-0 items-center", className)}
        >
            <svg width={16} height={7} viewBox="0 0 16 7" className="shrink-0 fill-none stroke-hud-line">
                <path d="M0 6.5H3.5L6.5 3.5H16" />
            </svg>
            <span className="h-px min-w-0 flex-1 bg-hud-line" />
            <svg width={7} height={7} viewBox="0 0 7 7" className="shrink-0 fill-hud-glow-dim stroke-hud-line">
                <circle cx={3.5} cy={3.5} r={2} />
            </svg>
        </div>
    );
});

/** A HUD label: 10.5 px JetBrains Mono, uppercase, letter-spaced 0.14em, `hud-muted` (`className` can recolour it). */
export function HudLabel({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span className={cn("font-mono text-[10.5px] uppercase tracking-[0.14em] text-hud-muted", className)}>
            {children}
        </span>
    );
}

/**
 * A glowing circle: the same circle twice in a `<g>`, a halo (`width` x HUD_GLOW_HALO wide, `stroke-opacity`
 * HUD_GLOW_OPACITY, marked `data-hud-glow`) under a core (`width` wide). Every other prop (the stroke colour as a class,
 * `strokeDasharray`, `style` with its transition) goes to both, so the halo follows the core. `fill` defaults to none.
 */
export function GlowCircle({ width, ...rest }: SVGProps<SVGCircleElement> & { width: number }) {
    return (
        <g>
            <circle
                fill="none"
                {...rest}
                strokeWidth={width * HUD_GLOW_HALO}
                strokeOpacity={HUD_GLOW_OPACITY}
                data-hud-glow=""
            />
            <circle fill="none" {...rest} strokeWidth={width} />
        </g>
    );
}

/** A glowing path (a value arc, a chart line): `GlowCircle`'s stacked strokes on a `<path>`. */
export function GlowPath({ width, ...rest }: SVGProps<SVGPathElement> & { width: number }) {
    return (
        <g>
            <path
                fill="none"
                {...rest}
                strokeWidth={width * HUD_GLOW_HALO}
                strokeOpacity={HUD_GLOW_OPACITY}
                data-hud-glow=""
            />
            <path fill="none" {...rest} strokeWidth={width} />
        </g>
    );
}
