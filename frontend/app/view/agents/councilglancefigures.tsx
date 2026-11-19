// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report's "At a glance" figures (docs/superpowers/plans/2026-11-19-council-figures.md, figures A and B), drawn from
// what councilfiguresmodel.ts derives from the council:
//   - A, evidence × agreement: one point per direction on a quadrant (a Review only: the model returns null for a
//     Brainstorm), labelled D<rank>, hollow when the direction's proposals cite no evidence at all. Hover or focus a
//     point for its numbers; click or Enter opens that direction's card.
//   - B, the stance grid: a real <table>, direction × seat, with each seat's stance as its glyph and word, and an
//     agreement bar last. Click a row, or Enter on its direction, opens that direction's card.
// A beside B in one row when B's columns, sized to their content, fit in what A leaves (the pane's width, not the
// window's: B's flex basis is its min-content), B stacked under A otherwise, so B never hides a column behind a sideways
// scroll beside A. A figure the model returns null for is not drawn, and with both null nothing is. The section's heading and the
// card the click opens are the Report's (councilsummary.tsx). A stance is never a colour alone: the glyph and the word
// come with the tint, and a seat is told apart by its column and name, its avatar tone is never a series colour.
//
// Markers for the CDP scenario: data-council-figure="glance" / "stance-grid" (ChartFigure's), a point
// data-glance-point={rank}, a grid row data-stance-row={rank}.

import { cn } from "@/util/util";
import { useMemo, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import {
    ChartFigure,
    ChartTable,
    HOVER_FADE,
    LinearAxis,
    StanceGlyph,
    TipBody,
    hoverFadeStyle,
    linearScale,
    useChartTip,
    useHoverDim,
} from "./councilchartparts";
import { CouncilAvatar } from "./councilchat";
import { avatarTone, seatInitials, shortName } from "./councildiscussionmodel";
import {
    glancePoints,
    stanceGrid,
    type CellKind,
    type GlancePoint,
    type StanceCell,
    type StanceRow,
} from "./councilfiguresmodel";

const FRAME = "rounded-xl border border-edge-mid px-[18px] pb-[14px] pt-4";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// ── A: evidence × agreement ─────────────────────────────────────────────────────────────────────────────────────────

// the SVG's own units; it scales down to the figure's width and never up past 412
const W = 412;
const H = 300;
const PLOT = { left: 40, top: 16, right: 390, bottom: 266 };
const MID = { x: (PLOT.left + PLOT.right) / 2, y: (PLOT.top + PLOT.bottom) / 2 };
const xScale = linearScale([0, 1], [PLOT.left, PLOT.right]);
const yScale = linearScale([0, 1], [PLOT.bottom, PLOT.top]);

const MARK_R = 5; // a point is 10px across; the hit target around it is 28
const HIT_R = 14;
const RING_R = 10;
const LABEL_BOX = { gap: 10, width: 28, halfHeight: 12 }; // a "D12" label's box beside its point, for the collision check

const pct = (v: number) => `${Math.round(v * 100)}%`;

type QuadrantName = "Stands" | "Backed on thin evidence" | "A guess" | "Shown but contested";

/** The quadrant of a point by its raw shares (before the placement's clamping and nudging), the way the takeaway counts
 *  them: both axes at or over a half is Stands. `onLine` is a coordinate exactly on the half. */
function quadrantOf(p: GlancePoint): { name: QuadrantName; onLine: boolean } {
    const x = p.evidence > 0 ? p.held / p.evidence : 0;
    const y = p.sides > 0 ? p.backers / p.sides : 0;
    const right = x >= 0.5;
    const up = y >= 0.5;
    const name: QuadrantName = right
        ? up
            ? "Stands"
            : "Shown but contested"
        : up
          ? "Backed on thin evidence"
          : "A guess";
    return { name, onLine: x === 0.5 || y === 0.5 };
}

/** Which side of its point each label goes: right, unless another point sits where that label would be, then left. */
function labelSides(points: readonly GlancePoint[]): ("left" | "right")[] {
    return points.map((p, i) => {
        const cx = xScale(p.x);
        const cy = yScale(p.y);
        const blocked = points.some((q, j) => {
            if (j === i) {
                return false;
            }
            const dx = xScale(q.x) - cx;
            return (
                dx > 0 &&
                dx < LABEL_BOX.gap + LABEL_BOX.width + MARK_R &&
                Math.abs(yScale(q.y) - cy) < LABEL_BOX.halfHeight
            );
        });
        return blocked ? "left" : "right";
    });
}

/** The two handlers a point's hit target needs from the hover and the tooltip hooks, run together on one element. */
function joinHandlers(
    a: {
        onPointerEnter: () => void;
        onPointerLeave: () => void;
        onFocus: () => void;
        onBlur: () => void;
    },
    b: {
        onPointerEnter: (e: PointerEvent<Element>) => void;
        onPointerLeave: (e: PointerEvent<Element>) => void;
        onFocus: (e: FocusEvent<Element>) => void;
        onBlur: (e: FocusEvent<Element>) => void;
    }
) {
    return {
        onPointerEnter: (e: PointerEvent<Element>) => {
            a.onPointerEnter();
            b.onPointerEnter(e);
        },
        onPointerLeave: (e: PointerEvent<Element>) => {
            a.onPointerLeave();
            b.onPointerLeave(e);
        },
        onFocus: (e: FocusEvent<Element>) => {
            a.onFocus();
            b.onFocus(e);
        },
        onBlur: (e: FocusEvent<Element>) => {
            a.onBlur();
            b.onBlur(e);
        },
    };
}

/** Enter or Space does what a click does. */
function activateOnKey(act: () => void) {
    return (e: KeyboardEvent<Element>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            act();
        }
    };
}

function evidenceText(p: GlancePoint): string {
    return p.hollow || p.evidence === 0 ? "no evidence cited" : `evidence held ${p.held} of ${p.evidence}`;
}

function backingText(p: GlancePoint): string {
    return `backed by ${p.backers} of ${p.sides} seats`;
}

function GlanceFigure({
    data,
    onOpenDirection,
    className,
}: {
    data: { points: GlancePoint[]; takeaway: string };
    onOpenDirection: (rank: number) => void;
    className?: string;
}) {
    const { points, takeaway } = data;
    const hov = useHoverDim<number>();
    const tip = useChartTip();
    const sides = useMemo(() => labelSides(points), [points]);

    const table = (
        <ChartTable
            columns={["Direction", "Evidence held", "Backed by", "Where"]}
            numeric={[1, 2]}
            rows={points.map((p) => {
                const q = quadrantOf(p);
                return [
                    <span key="d" className="block max-w-[300px] truncate" title={`D${p.rank} ${p.title}`}>
                        <span className="font-semibold text-primary">D{p.rank}</span>{" "}
                        <span className="text-secondary">{p.title}</span>
                    </span>,
                    p.hollow || p.evidence === 0 ? "none cited" : `${p.held} of ${p.evidence}`,
                    `${p.backers} of ${p.sides}`,
                    q.onLine ? `${q.name}, on the line` : q.name,
                ];
            })}
        />
    );

    return (
        <ChartFigure
            id="glance"
            title="Evidence and backing"
            takeaway={takeaway}
            table={table}
            className={cn(FRAME, className)}
        >
            <svg
                viewBox={`0 0 ${W} ${H}`}
                role="group"
                aria-label="Directions by evidence held and panel backing"
                className="mx-auto block h-auto w-full max-w-[412px]"
            >
                <rect
                    x={PLOT.left}
                    y={PLOT.top}
                    width={PLOT.right - PLOT.left}
                    height={PLOT.bottom - PLOT.top}
                    strokeWidth={1}
                    className="fill-none stroke-edge-mid"
                />
                <line
                    x1={MID.x}
                    y1={PLOT.top}
                    x2={MID.x}
                    y2={PLOT.bottom}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    className="stroke-edge-mid"
                />
                <line
                    x1={PLOT.left}
                    y1={MID.y}
                    x2={PLOT.right}
                    y2={MID.y}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    className="stroke-edge-mid"
                />
                <LinearAxis
                    orient="x"
                    domain={[0, 1]}
                    range={[PLOT.left, PLOT.right]}
                    at={PLOT.bottom}
                    ticks={[0, 1]}
                    format={pct}
                    lineClassName="stroke-edge-mid"
                />
                <LinearAxis
                    orient="y"
                    domain={[0, 1]}
                    range={[PLOT.bottom, PLOT.top]}
                    at={PLOT.left}
                    ticks={[0, 1]}
                    format={pct}
                    lineClassName="stroke-edge-mid"
                />
                <g aria-hidden fontSize={11} className="fill-muted">
                    <text x={PLOT.right - 6} y={PLOT.top + 14} textAnchor="end">
                        Stands
                    </text>
                    <text x={PLOT.left + 8} y={PLOT.top + 14}>
                        Backed on thin evidence
                    </text>
                    <text x={PLOT.left + 8} y={PLOT.bottom - 8}>
                        A guess
                    </text>
                    <text x={PLOT.right - 6} y={PLOT.bottom - 8} textAnchor="end">
                        Shown but contested
                    </text>
                    <text x={MID.x} y={H - 4} textAnchor="middle">
                        evidence the cite check found holding →
                    </text>
                    <text x={12} y={MID.y} textAnchor="middle" transform={`rotate(-90 12 ${MID.y})`}>
                        panel backing →
                    </text>
                </g>
                {points.map((p, i) => {
                    const cx = xScale(p.x);
                    const cy = yScale(p.y);
                    const active = hov.active === p.rank;
                    const left = sides[i] === "left";
                    const open = () => onOpenDirection(p.rank);
                    const handlers = joinHandlers(
                        hov.bind(p.rank),
                        tip.bind(
                            <TipBody
                                title={`D${p.rank} · ${p.title}`}
                                lines={[
                                    evidenceText(p),
                                    backingText(p),
                                    <span key="hint" className="text-[11px] text-muted">
                                        Click to open its card
                                    </span>,
                                ]}
                            />
                        )
                    );
                    return (
                        <g
                            key={p.rank}
                            className={cn(HOVER_FADE, hov.dim(p.rank) && "opacity-35")}
                            style={hoverFadeStyle}
                        >
                            {active && (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={RING_R}
                                    strokeWidth={2}
                                    className="pointer-events-none fill-none stroke-accent"
                                />
                            )}
                            {p.hollow ? (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={MARK_R}
                                    strokeWidth={2}
                                    className="pointer-events-none fill-background stroke-accent"
                                />
                            ) : (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={MARK_R}
                                    strokeWidth={2}
                                    className="pointer-events-none fill-accent stroke-background"
                                />
                            )}
                            <text
                                x={left ? cx - LABEL_BOX.gap : cx + LABEL_BOX.gap}
                                y={cy + 4}
                                fontSize={11}
                                fontWeight={600}
                                textAnchor={left ? "end" : "start"}
                                className="pointer-events-none fill-secondary"
                            >
                                D{p.rank}
                            </text>
                            <circle
                                cx={cx}
                                cy={cy}
                                r={HIT_R}
                                data-glance-point={p.rank}
                                role="button"
                                tabIndex={0}
                                aria-label={`D${p.rank}: ${evidenceText(p)}, ${backingText(p)}. Open its card`}
                                onClick={open}
                                onKeyDown={activateOnKey(open)}
                                {...handlers}
                                className="cursor-pointer fill-transparent outline-none"
                            />
                        </g>
                    );
                })}
            </svg>
            {tip.node}
        </ChartFigure>
    );
}

// ── B: the stance grid ──────────────────────────────────────────────────────────────────────────────────────────────

// The columns are sized to their content, as the Main board draws them: a seat's column is as wide as its widest pill
// ("? Challenge" never wraps or clips) or its header, and so is Backing. Direction is the one that gives way: it takes
// what is left, ellipses its title, and never goes under this (room for "D<rank>" and a few letters of the title).
// The table's own minimum width is then this plus the other columns' content. B sits beside A only when that fits, so
// the grid scrolls sideways in its box only in a pane narrower than that, B stacked.
const DIRECTION_MIN_PX = 96;

function SeatAvatar({ c, seat }: { c: Council; seat: CouncilExpert }) {
    return (
        <span aria-hidden className="flex flex-none">
            <CouncilAvatar tone={avatarTone(c, seat.id)} name={seat.name} initials={seatInitials(c, seat.id)} small />
        </span>
    );
}

function StanceCellView({ kind }: { kind: CellKind }) {
    if (kind === "none") {
        return (
            <span className="text-muted" title="No stance">
                <span aria-hidden>—</span>
                <span className="sr-only">No stance</span>
            </span>
        );
    }
    return <StanceGlyph stance={kind} />;
}

function AgreementCell({ row }: { row: StanceRow }) {
    const share = row.sides > 0 ? row.backers / row.sides : 0;
    return (
        <span className="inline-flex items-center gap-[7px]">
            <span className="flex h-[6px] w-[54px] flex-none overflow-hidden rounded-[3px] bg-pill">
                <span className="h-full rounded-[3px] bg-muted" style={{ width: `${share * 100}%` }} />
            </span>
            <span className="tabular-nums text-secondary">
                {row.backers} of {row.sides}
            </span>
            <span className="text-muted">{row.agreed ? "Agreed" : "Split"}</span>
        </span>
    );
}

function StanceGridFigure({
    c,
    data,
    onOpenDirection,
    className,
}: {
    c: Council;
    data: { seats: CouncilExpert[]; rows: StanceRow[]; takeaway: string };
    onOpenDirection: (rank: number) => void;
    className?: string;
}) {
    const { seats, rows, takeaway } = data;
    const builds = rows.some((r) => r.cells.some((cell) => cell.kind === "builds"));
    return (
        <ChartFigure
            id="stance-grid"
            title="Who backed each direction"
            takeaway={takeaway}
            className={cn(FRAME, className)}
        >
            {/* a pane too narrow for the columns' content scrolls the grid sideways in its own box */}
            <div data-stance-scroll="" className="max-w-full overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-[12px]">
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                data-stance-head="direction"
                                style={{ minWidth: DIRECTION_MIN_PX }}
                                className="py-[6px] pb-2 pr-2 text-left font-medium text-muted"
                            >
                                Direction
                            </th>
                            {seats.map((seat) => (
                                <th
                                    key={seat.id}
                                    scope="col"
                                    title={seat.name}
                                    data-stance-head={seat.id}
                                    className="whitespace-nowrap px-1 py-[6px] pb-2 font-medium text-secondary"
                                >
                                    <span className="inline-flex items-center gap-[5px]">
                                        <SeatAvatar c={c} seat={seat} />
                                        {shortName(c, seat.id)}
                                    </span>
                                </th>
                            ))}
                            <th
                                scope="col"
                                data-stance-head="backing"
                                className="whitespace-nowrap py-[6px] pb-2 pl-2 text-left font-medium text-muted"
                            >
                                Backing
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const bySeat = new Map<string, StanceCell>(row.cells.map((cell) => [cell.seat, cell]));
                            return (
                                <tr
                                    key={row.rank}
                                    data-stance-row={row.rank}
                                    onClick={() => onOpenDirection(row.rank)}
                                    style={hoverFadeStyle}
                                    className="cursor-pointer transition-colors hover:bg-surface-hover focus-within:bg-surface-hover motion-reduce:transition-none"
                                >
                                    {/* width 100% with max-width 0 is what lets a table cell ellipse: it takes what the
                                        other columns leave, and the title is cut to it */}
                                    <th
                                        scope="row"
                                        style={{ minWidth: DIRECTION_MIN_PX, maxWidth: 0 }}
                                        className="w-full rounded-l-md border-t border-edge-mid py-[7px] pl-[6px] pr-2 text-left font-normal"
                                    >
                                        <button
                                            type="button"
                                            title={`D${row.rank} ${row.title}`}
                                            className={cn(
                                                "flex w-full min-w-0 cursor-pointer items-baseline gap-[6px] rounded-sm text-left",
                                                FOCUS
                                            )}
                                        >
                                            <span className="flex-none font-semibold text-primary">D{row.rank}</span>
                                            <span className="min-w-0 truncate text-secondary">{row.title}</span>
                                        </button>
                                    </th>
                                    {seats.map((seat) => (
                                        <td
                                            key={seat.id}
                                            className="border-t border-edge-mid px-1 py-[7px] text-center"
                                        >
                                            <StanceCellView kind={bySeat.get(seat.id)?.kind ?? "none"} />
                                        </td>
                                    ))}
                                    <td className="whitespace-nowrap rounded-r-md border-t border-edge-mid py-[7px] pl-2 pr-[6px]">
                                        <AgreementCell row={row} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="text-[11px] text-muted">
                ● Proposed it · ✓ Accept · ? Challenge · ✕ Oppose{builds ? " · ↳ Builds on" : ""} · — no stance
            </div>
        </ChartFigure>
    );
}

// ── the pair ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Report's "At a glance" figures: A beside B when B's columns fit beside it, B under A otherwise. `onOpenDirection(rank)`
 *  is what a click or Enter on a point or a row calls. A figure the model has nothing for is left out, and with neither the
 *  component draws nothing. */
export function GlanceFigures({ c, onOpenDirection }: { c: Council; onOpenDirection: (rank: number) => void }) {
    const glance = useMemo(() => glancePoints(c), [c]);
    const grid = useMemo(() => stanceGrid(c), [c]);
    if (glance == null && grid == null) {
        return null;
    }
    // A wrapping row. A's basis is its width (452px). B's is its own min-content: the widest its columns need with
    // Direction at its minimum, so B only joins A's line when every column fits beside it, and drops under A at full
    // width otherwise. B's huge grow keeps A at its 452px (it gets a thousandth of any free space, under a pixel) while
    // a lone A, or a lone B, fills its line. B may shrink to a pane narrower than its columns (min-w-0): then its own
    // box scrolls sideways, and the page never does.
    return (
        <div data-glance-figures="" className="min-w-0">
            <div className="flex min-w-0 flex-wrap gap-5">
                {glance != null && (
                    <GlanceFigure
                        data={glance}
                        onOpenDirection={onOpenDirection}
                        className="min-w-0 shrink grow basis-[452px]"
                    />
                )}
                {grid != null && (
                    <StanceGridFigure
                        c={c}
                        data={grid}
                        onOpenDirection={onOpenDirection}
                        className="min-w-0 shrink grow-[1000] basis-[min-content]"
                    />
                )}
            </div>
        </div>
    );
}
