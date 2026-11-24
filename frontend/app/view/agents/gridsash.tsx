// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The sashes of the split: a thin line between its columns and one between its rows that the person drags to give one
// cell more room, as VS Code's editor groups have. Each is a grid item of the stack itself, placed on the edge of the
// second track and pulled back over the gap by half its width, so the grid's own track math puts it in the gap with
// no measuring. While a sash moves, the stack's template is written straight onto the element each frame, so the
// surface never re-renders mid-drag; the share is stored once, on release. The panes refit through their own
// ResizeObserver, debounced, so the PTYs resize when the hand stops, not every frame.

import { cn } from "@/util/util";
import { atom, useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useRef, useState } from "react";
import { agentDragAtom } from "./agentdragstore";
import type { CellPlacement } from "./agentgrid";
import { clampShare, EVEN_SIZES, parseGridSizes, sashSpans, shareAt, tracks, type GridSizes } from "./gridsplit";

// the getOnInit cast of gridstore.ts storedGridsAtom: the stored shares are there on the first render
const storedSizesAtom = atomWithStorage<unknown>("agent.gridSizes", {}, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<unknown>;

export const gridSizesAtom = atom(
    (get) => parseGridSizes(get(storedSizesAtom)),
    (get, set, project: string, next: GridSizes) =>
        set(storedSizesAtom, { ...parseGridSizes(get(storedSizesAtom)), [project]: next })
);

export function sizesOf(all: Readonly<Record<string, GridSizes>>, project: string): GridSizes {
    return all[project] ?? EVEN_SIZES;
}

// the hit area: wide enough to find without aiming, narrow enough to leave the cells' edges to the drop zones
const HIT_PX = 8;

type Axis = "col" | "row";

interface SashesProps {
    gridRef: React.RefObject<HTMLDivElement | null>;
    project: string;
    places: readonly CellPlacement[];
    sizes: GridSizes;
    rowsAfter: string; // what follows the two row tracks in the template (the dock row), "" without one
}

export function GridSashes({ gridRef, project, places, sizes, rowsAfter }: SashesProps) {
    const spans = sashSpans(places);
    // an agent being dragged owns the cells' edges: a sash over them would eat the dragover of the drop zone under it
    const dragging = useAtomValue(agentDragAtom) != null;
    return (
        <>
            {spans.col != null ? (
                <Sash
                    axis="col"
                    gridRef={gridRef}
                    project={project}
                    sizes={sizes}
                    rowsAfter={rowsAfter}
                    inert={dragging}
                    style={{
                        gridColumn: "2 / span 1",
                        gridRow: `${spans.col.row} / span ${spans.col.rowSpan}`,
                        justifySelf: "start",
                        width: HIT_PX,
                        marginLeft: `calc(-1 * (var(--sash-gap) / 2 + ${HIT_PX / 2}px))`,
                    }}
                />
            ) : null}
            {spans.row != null ? (
                <Sash
                    axis="row"
                    gridRef={gridRef}
                    project={project}
                    sizes={sizes}
                    rowsAfter={rowsAfter}
                    inert={dragging}
                    style={{
                        gridRow: "2 / span 1",
                        gridColumn: `${spans.row.col} / span ${spans.row.colSpan}`,
                        alignSelf: "start",
                        height: HIT_PX,
                        marginTop: `calc(-1 * (var(--sash-gap) / 2 + ${HIT_PX / 2}px))`,
                    }}
                />
            ) : null}
        </>
    );
}

// the template the stack takes for an axis at a share
function template(axis: Axis, share: number, rowsAfter: string): string {
    return axis === "col" ? tracks(share) : `${tracks(share)}${rowsAfter ? ` ${rowsAfter}` : ""}`;
}

function px(value: string): number {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

interface SashProps {
    axis: Axis;
    gridRef: React.RefObject<HTMLDivElement | null>;
    project: string;
    sizes: GridSizes;
    rowsAfter: string;
    inert: boolean;
    style: React.CSSProperties;
}

function Sash({ axis, gridRef, project, sizes, rowsAfter, inert, style }: SashProps) {
    const setSizes = useSetAtom(gridSizesAtom);
    const [active, setActive] = useState(false);
    const drag = useRef<{ start: number; first: number; second: number; gap: number; share: number } | null>(null);
    const frame = useRef(0);
    const share = sizes[axis];
    const prop = axis === "col" ? "gridTemplateColumns" : "gridTemplateRows";

    const commit = (next: number) => setSizes(project, { ...sizes, [axis]: next });

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        const grid = gridRef.current;
        if (e.button !== 0 || grid == null) {
            return;
        }
        // no focus moves to the sash: typing stays in the cell it was in
        e.preventDefault();
        const cs = getComputedStyle(grid);
        // the tracks as laid out (the computed template resolves to px), so the share follows the pointer exactly
        const [first, second] = (axis === "col" ? cs.gridTemplateColumns : cs.gridTemplateRows).split(" ").map(px);
        const rect = grid.getBoundingClientRect();
        drag.current = {
            start: axis === "col" ? rect.left + px(cs.paddingLeft) : rect.top + px(cs.paddingTop),
            first,
            second,
            gap: px(axis === "col" ? cs.columnGap : cs.rowGap),
            share,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        const grid = gridRef.current;
        if (d == null || grid == null) {
            return;
        }
        d.share = shareAt(axis === "col" ? e.clientX : e.clientY, d.start, d.first, d.second, d.gap);
        if (frame.current === 0) {
            frame.current = requestAnimationFrame(() => {
                frame.current = 0;
                const live = drag.current;
                if (live != null) {
                    grid.style[prop] = template(axis, live.share, rowsAfter);
                }
            });
        }
    };
    const end = (keep: boolean) => {
        const d = drag.current;
        drag.current = null;
        if (frame.current !== 0) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        }
        setActive(false);
        if (d == null) {
            return;
        }
        const grid = gridRef.current;
        if (keep && d.share !== share) {
            if (grid != null) {
                grid.style[prop] = template(axis, d.share, rowsAfter);
            }
            commit(d.share);
        } else if (grid != null) {
            // cancelled: back to what the surface last drew
            grid.style[prop] = template(axis, share, rowsAfter);
        }
    };

    return (
        <div
            role="separator"
            aria-orientation={axis === "col" ? "vertical" : "horizontal"}
            aria-valuenow={Math.round(share * 100)}
            aria-label={axis === "col" ? "Resize the columns" : "Resize the rows"}
            title="Drag to resize · double-click to even"
            data-grid-sash={axis}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => end(true)}
            onPointerCancel={() => end(false)}
            onLostPointerCapture={() => end(true)}
            onDoubleClick={() => {
                const grid = gridRef.current;
                const span = grid?.getBoundingClientRect()[axis === "col" ? "width" : "height"] ?? 0;
                commit(clampShare(0.5, span));
            }}
            style={style}
            className={cn(
                "group relative z-10 flex items-center justify-center",
                axis === "col" ? "cursor-col-resize" : "cursor-row-resize",
                inert && "pointer-events-none"
            )}
        >
            {/* the line shows on a held hover, as VS Code's does, so a pointer passing over the gap does not flash it */}
            <div
                aria-hidden
                className={cn(
                    "pointer-events-none rounded-full bg-accent transition-opacity duration-150 ease-out",
                    axis === "col" ? "h-full w-[2px]" : "h-[2px] w-full",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-hover:delay-300"
                )}
            />
            {/* while dragging, a sheet over the whole window keeps the cursor and stops a page or canvas in a cell
                from taking the pointer */}
            {active ? (
                <div
                    aria-hidden
                    className={cn("fixed inset-0 z-50", axis === "col" ? "cursor-col-resize" : "cursor-row-resize")}
                />
            ) : null}
        </div>
    );
}

export { template as sashTemplate };
