// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The arcterm "t>" mark (public/logos/arcterm.png) as vector pixel art on whole CSS pixels, so it stays
// sharp where the downscaled PNG blurred. The source is a 12x9 cell grid; each cell sits at 2px steps
// but is drawn 3px square, so neighbours overlap by 1px as the source's blocks do: the chevron reads
// as one stroke and the strokes stand bold. Drawn in currentColor. Its own file, so a slim page (Sidecar)
// takes it without the app bar's stores.
// pointer-events-none: drag.js skips SVG elements, so the press must land on the parent.
export function ArctermMark({
    width = 25,
    height = 19,
    className,
}: {
    width?: number;
    height?: number;
    className?: string;
}) {
    // crispEdges holds only at the grid's own size: scaled down (Sidecar's 15x11 row mark) each cell snaps to a
    // different whole pixel, so the "t" reads bold and the chevron thin and jagged; smoothed, the cells scale alike
    const crisp = width === 25 && height === 19;
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 25 19"
            fill="currentColor"
            shapeRendering={crisp ? "crispEdges" : "geometricPrecision"}
            aria-hidden="true"
            className={className ?? "pointer-events-none"}
        >
            <rect x="2" y="2" width="3" height="13" />
            <rect x="0" y="6" width="11" height="3" />
            <rect x="10" y="12" width="3" height="3" />
            <rect x="4" y="14" width="7" height="3" />
            <path d="M14 0h3v3h-3zM16 2h3v3h-3zM18 4h3v3h-3zM20 6h3v3h-3zM22 8h3v3h-3zM20 10h3v3h-3zM18 12h3v3h-3zM16 14h3v3h-3zM14 16h3v3h-3z" />
        </svg>
    );
}
