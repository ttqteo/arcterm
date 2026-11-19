// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The parts the council's figures share (docs/superpowers/plans/2026-11-19-council-figures.md "The six figures"; the
// views are councilglancefigures.tsx, councilspendfigures.tsx, councilargumentmap.tsx and councilbenchchart.tsx, and
// the numbers and takeaways they draw are councilfiguresmodel.ts's):
//   - ChartFigure: a `<figure>` with the title, the takeaway as its `<figcaption>` and a Chart | Table toggle, fading
//     in with `viewFade` when it mounts; ChartTable is the table the toggle shows.
//   - ChartTooltip, with TipBody for what it says and useChartTip to bind it to a mark: a solid `TOOLTIP_SURFACE`
//     chip at the hovered or focused mark (DESIGN.md "Overlays": tooltips stay solid chips, they are not frosted).
//   - StanceGlyph and STANCE_PILL: the stance's icon and word on its tint. A stance is never a colour alone (Accept
//     and Oppose are ΔE 2.0 apart for a deuteranope), so the glyph and the word always come with the tint.
//   - useHoverDim: the hovered or focused id, which the views read to dim everything else.
//   - LinearAxis and LogAxis: SVG ticks on `edge-faint` with 10px `muted` labels, drawn from the same scales
//     (councilchartscale.ts) the views place their marks with.
// Reduced motion: no fade, no transition. Colours are tokens, never a hex (the palette of the benchmark's variants,
// --color-chart-1..4, is in docs/agents/council-chart-palette.md).

import { MOTION, easeFluidCss, viewFade } from "@/app/element/motiontokens";
import { TOOLTIP_SURFACE } from "@/app/element/tooltip";
import { cn } from "@/util/util";
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { Check, CircleHelp, CornerDownRight, X, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
    useCallback,
    useEffect,
    useId,
    useState,
    type CSSProperties,
    type FocusEvent,
    type PointerEvent,
    type ReactNode,
} from "react";
import { LOG_TOKEN_TICKS, compactNumber, linearScale, logScale, tokenTick, type Scale } from "./councilchartscale";
import type { StanceLabel } from "./councilmodel";

export {
    LOG_TOKEN_TICKS,
    compactNumber,
    linearScale,
    linearTicks,
    logScale,
    tokenTick,
    type Scale,
} from "./councilchartscale";

// ── stances ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The tint of a stance's pill. Task 8 makes councilsummary.tsx import this and drops its own copy. */
export const STANCE_PILL: Record<StanceLabel, string> = {
    accept: "bg-success/12 text-success-soft",
    challenge: "bg-warning/12 text-warning-soft",
    oppose: "bg-error/12 text-error-soft",
    proposed: "bg-pill text-secondary",
};

/** What a stance glyph can show: the four stances, and the Brainstorm's "builds on", a flag on a reply, never a stance
 *  (`direction.stances` does not hold it). */
export type ChartStance = StanceLabel | "builds";

/** The word beside a glyph. */
export const STANCE_GLYPH_WORD: Record<ChartStance, string> = {
    accept: "Accept",
    challenge: "Challenge",
    oppose: "Oppose",
    proposed: "Proposed",
    builds: "Builds on",
};

/** The glyph: ✓ Accept, ? Challenge, ✕ Oppose, ● Proposed, ↳ Builds on. Proposed is a drawn dot (no lucide icon is that
 *  plain), so it is `null` here and StanceGlyph draws it. */
export const STANCE_ICON: Record<ChartStance, LucideIcon | null> = {
    accept: Check,
    challenge: CircleHelp,
    oppose: X,
    proposed: null,
    builds: CornerDownRight,
};

/** The stance's ink as a text class, for an SVG mark that draws in `currentColor` (an edge's glyph in the argument
 *  map): the status token, never a series colour. */
export const STANCE_TONE: Record<ChartStance, string> = {
    accept: "text-success",
    challenge: "text-warning",
    oppose: "text-error",
    proposed: "text-secondary",
    builds: "text-secondary",
};

const GLYPH_TINT: Record<ChartStance, string> = { ...STANCE_PILL, builds: STANCE_PILL.proposed };

/** A stance's glyph and word on its tint (a cell of the stance grid, a row of a tooltip). `pill` false drops the tint
 *  and rounding for a bare glyph and word, in the stance's ink. */
export function StanceGlyph({
    stance,
    pill = true,
    word = true,
    className,
}: {
    stance: ChartStance;
    pill?: boolean;
    /** false draws the glyph alone; the word stays as its accessible name */
    word?: boolean;
    className?: string;
}) {
    const Icon = STANCE_ICON[stance];
    const text = STANCE_GLYPH_WORD[stance];
    return (
        <span
            data-stance-glyph={stance}
            title={word ? undefined : text}
            className={cn(
                "inline-flex flex-none items-center gap-[4px] whitespace-nowrap text-[11px] font-semibold leading-none",
                pill ? cn("rounded-full px-[7px] py-[3px]", GLYPH_TINT[stance]) : STANCE_TONE[stance],
                className
            )}
        >
            {Icon != null ? (
                <Icon size={11} strokeWidth={2.5} aria-hidden />
            ) : (
                <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden className="flex-none">
                    <circle cx={5.5} cy={5.5} r={3} fill="currentColor" />
                </svg>
            )}
            {word ? text : <span className="sr-only">{text}</span>}
        </span>
    );
}

// ── hover transitions ───────────────────────────────────────────────────────────────────────────────────────────────

/** The class of a mark whose opacity changes on hover: it eases over the fast duration, and not at all under reduced
 *  motion. Pair it with `hoverFadeStyle`, which holds only the timing, so `motion-reduce` still wins over it. */
export const HOVER_FADE = "transition-opacity motion-reduce:transition-none";
export const hoverFadeStyle: CSSProperties = {
    transitionDuration: `${MOTION.durMicro}s`,
    transitionTimingFunction: easeFluidCss,
};

/** What the rest of a figure drops to while one mark is hovered or focused (the argument map's 20%). */
export const DIM_OPACITY = "opacity-20";

/** The class of a bar whose width eases to a new value (a spend bar on a council still running: `stats` move as seats
 *  report), over the macro duration, and not at all under reduced motion. Pair it with `widthEaseStyle`. */
export const WIDTH_EASE = "transition-[width] motion-reduce:transition-none";
export const widthEaseStyle: CSSProperties = {
    transitionDuration: `${MOTION.durMacro}s`,
    transitionTimingFunction: easeFluidCss,
};

/** The hovered or focused id of a figure, for the views to dim everything else:
 *  `const hov = useHoverDim<string>()`, `{...hov.bind(id)}` on each mark and `hov.dim(id)` for its class. A mark that
 *  belongs to the active one (an idea's edges) decides that itself from `hov.active`. */
export function useHoverDim<T extends string | number = string>() {
    const [active, setActive] = useState<T | null>(null);
    const bind = useCallback(
        (id: T) => ({
            onPointerEnter: () => setActive(id),
            onPointerLeave: () => setActive((cur) => (cur === id ? null : cur)),
            onFocus: () => setActive(id),
            onBlur: () => setActive((cur) => (cur === id ? null : cur)),
        }),
        []
    );
    const clear = useCallback(() => setActive(null), []);
    /** true for every id but the active one while something is active */
    const dim = useCallback((id: T) => active != null && active !== id, [active]);
    return { active, bind, clear, dim };
}

// ── tooltip ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A tooltip at a hovered or focused mark: `anchor` is the mark's element (an SVG mark or a row; a mark smaller than a
 *  finger passes a larger invisible hit target as the anchor), and the chip sits above it, flipping and shifting to
 *  stay on screen. It takes no pointer events, so it never steals the hover it belongs to, and it opens in the fast
 *  tip duration (open only: it leaves at once, `MOTION.durTip`). The root carries `data-chart-tooltip`. */
export function ChartTooltip({
    anchor,
    children,
    className,
}: {
    anchor: Element | null;
    children: ReactNode;
    className?: string;
}) {
    const { refs, floatingStyles } = useFloating({
        elements: { reference: anchor },
        placement: "top",
        middleware: [offset(8), flip(), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(id);
    }, []);
    if (anchor == null) {
        return null;
    }
    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                role="tooltip"
                data-chart-tooltip=""
                style={{
                    ...floatingStyles,
                    opacity: shown ? 1 : 0,
                    transitionDuration: `${MOTION.durTip}s`,
                    transitionTimingFunction: easeFluidCss,
                }}
                className={cn(
                    TOOLTIP_SURFACE,
                    "pointer-events-none max-w-[320px] transition-opacity motion-reduce:transition-none",
                    className
                )}
            >
                {children}
            </div>
        </FloatingPortal>
    );
}

/** What a chart tooltip says: a title, then a line each. */
export function TipBody({ title, lines }: { title?: ReactNode; lines?: readonly ReactNode[] }) {
    return (
        <div className="flex flex-col gap-[2px]">
            {title != null && <div className="font-semibold text-primary">{title}</div>}
            {lines?.map((line, i) => (
                <div key={i} className="text-secondary">
                    {line}
                </div>
            ))}
        </div>
    );
}

/** The hook a view binds its marks to: `const tip = useChartTip()`, `{...tip.bind(<TipBody …/>)}` on a mark's element
 *  (or its hit target), and `{tip.node}` once in the view. Pointer and keyboard focus both open it, so a point reached
 *  with Tab says what a hover says. */
export function useChartTip() {
    const [tip, setTip] = useState<{ anchor: Element; content: ReactNode } | null>(null);
    const bind = useCallback(
        (content: ReactNode) => ({
            onPointerEnter: (e: PointerEvent<Element>) => setTip({ anchor: e.currentTarget, content }),
            onPointerLeave: (e: PointerEvent<Element>) =>
                setTip((cur) => (cur?.anchor === e.currentTarget ? null : cur)),
            onFocus: (e: FocusEvent<Element>) => setTip({ anchor: e.currentTarget, content }),
            onBlur: (e: FocusEvent<Element>) => setTip((cur) => (cur?.anchor === e.currentTarget ? null : cur)),
        }),
        []
    );
    const node = tip != null ? <ChartTooltip anchor={tip.anchor}>{tip.content}</ChartTooltip> : null;
    return { bind, node };
}

// ── the figure ──────────────────────────────────────────────────────────────────────────────────────────────────────

const TOGGLE_BUTTON =
    "h-[22px] cursor-pointer rounded-[4px] px-2 text-[11px] font-medium motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** One figure: its title and a Chart | Table toggle on a row, the takeaway under them as the `<figcaption>`, then the
 *  chart. The caption sits last in the markup, where a `<figcaption>` belongs, and `order` puts it under the title, so
 *  the insight reads before the picture. With no `table` there is no toggle (a figure that is a table already). A
 *  figure with nothing to show is not rendered at all by its view: this draws no empty frame.
 *
 *  Markers: `data-council-figure={id}` on the root, `data-figure-view` there ("chart" or "table"), and on the buttons
 *  `data-figure-chart-toggle` and `data-figure-table-toggle`. The toggle is local state: the Table shows the same
 *  numbers as the chart, in `table`. */
export function ChartFigure({
    id,
    title,
    takeaway,
    table,
    children,
    headerExtra,
    className,
}: {
    /** the `data-council-figure` value: "glance", "stance-grid", "spend", "lanes", "graph" or "bench" */
    id: string;
    title: string;
    /** the computed one-line takeaway; the figure's `<figcaption>` */
    takeaway: string;
    /** the Table view; usually a ChartTable */
    table?: ReactNode;
    children: ReactNode;
    /** beside the toggle, on the title row (a legend, a count) */
    headerExtra?: ReactNode;
    className?: string;
}) {
    const reduce = useReducedMotion() === true;
    const titleId = useId();
    const [view, setView] = useState<"chart" | "table">("chart");
    const showTable = view === "table" && table != null;
    const segment = (active: boolean) =>
        cn(TOGGLE_BUTTON, active ? "bg-surface-hover text-primary" : "text-muted hover:text-secondary");
    return (
        <motion.figure
            variants={viewFade}
            initial={reduce ? false : "initial"}
            animate="animate"
            aria-labelledby={titleId}
            data-council-figure={id}
            data-figure-view={showTable ? "table" : "chart"}
            className={cn("m-0 flex min-w-0 flex-col gap-2", className)}
        >
            <div className="order-1 flex min-w-0 items-center gap-2">
                <div id={titleId} className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary">
                    {title}
                </div>
                {headerExtra}
                {table != null && (
                    <div
                        role="group"
                        aria-label={`${title}: view`}
                        className="flex flex-none gap-[2px] rounded-md border border-edge-mid bg-surface p-[2px]"
                    >
                        <button
                            type="button"
                            aria-pressed={!showTable}
                            data-figure-chart-toggle=""
                            onClick={() => setView("chart")}
                            className={segment(!showTable)}
                        >
                            Chart
                        </button>
                        <button
                            type="button"
                            aria-pressed={showTable}
                            data-figure-table-toggle=""
                            onClick={() => setView("table")}
                            className={segment(showTable)}
                        >
                            Table
                        </button>
                    </div>
                )}
            </div>
            <div className="order-3 min-w-0">{showTable ? table : children}</div>
            <figcaption className="order-2 text-[12.5px] leading-[1.45] text-secondary">{takeaway}</figcaption>
        </motion.figure>
    );
}

/** The table a figure's Table toggle shows: a header row and the rows, the first column in `primary` ink, the columns
 *  in `numeric` (by index) right-aligned in tabular figures. Wide tables scroll sideways inside their box. */
export function ChartTable({
    columns,
    rows,
    numeric = [],
}: {
    columns: readonly string[];
    rows: readonly (readonly ReactNode[])[];
    numeric?: readonly number[];
}) {
    const align = (i: number) => (numeric.includes(i) ? "text-right tabular-nums" : "text-left");
    return (
        <div className="max-w-full overflow-x-auto">
            <table data-figure-table="" className="w-full border-collapse text-[12px]">
                <thead>
                    <tr>
                        {columns.map((col, i) => (
                            <th
                                key={i}
                                scope="col"
                                className={cn("px-2 py-1 text-[11px] font-medium text-muted", align(i))}
                            >
                                {col}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, r) => (
                        <tr key={r} className="border-t border-edge-mid">
                            {row.map((cell, i) => (
                                <td
                                    key={i}
                                    className={cn("px-2 py-1", i === 0 ? "text-primary" : "text-secondary", align(i))}
                                >
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── axes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface AxisProps {
    /** `x` is a horizontal axis along the bottom of the plot, `y` a vertical one on its left */
    orient: "x" | "y";
    /** the values the axis spans */
    domain: readonly [number, number];
    /** the pixels they span: an x axis left to right, a y axis bottom to top, so a bigger value sits higher */
    range: readonly [number, number];
    /** where the axis line sits across the plot: its y for an x axis, its x for a y axis */
    at: number;
    ticks: readonly number[];
    format?: (v: number) => string;
    /** the length of a faint gridline from each tick across the plot; 0 or left out draws none */
    grid?: number;
    /** the ink of the line, ticks and gridlines: `edge-faint` by default, a class like `stroke-edge-mid` for a figure
     *  whose ground is so near that colour a faint axis would vanish (`edge-faint` is #1a1a1a over a #171717 card) */
    lineClassName?: string;
}

function ChartAxis({
    scale,
    orient,
    range,
    at,
    ticks,
    format,
    grid = 0,
    lineClassName = "stroke-edge-faint",
}: Omit<AxisProps, "domain"> & { scale: Scale }) {
    const label = format ?? compactNumber;
    const [from, to] = range;
    return (
        <g data-chart-axis={orient} aria-hidden>
            {orient === "x" ? (
                <>
                    <line x1={from} y1={at} x2={to} y2={at} strokeWidth={2} className={lineClassName} />
                    {ticks.map((v) => {
                        const px = scale(v);
                        return (
                            <g key={v}>
                                {grid > 0 && (
                                    <line
                                        x1={px}
                                        y1={at}
                                        x2={px}
                                        y2={at - grid}
                                        strokeWidth={1}
                                        className={lineClassName}
                                    />
                                )}
                                <line x1={px} y1={at} x2={px} y2={at + 4} strokeWidth={2} className={lineClassName} />
                                <text x={px} y={at + 16} textAnchor="middle" fontSize={10} className="fill-muted">
                                    {label(v)}
                                </text>
                            </g>
                        );
                    })}
                </>
            ) : (
                <>
                    <line x1={at} y1={from} x2={at} y2={to} strokeWidth={2} className={lineClassName} />
                    {ticks.map((v) => {
                        const py = scale(v);
                        return (
                            <g key={v}>
                                {grid > 0 && (
                                    <line
                                        x1={at}
                                        y1={py}
                                        x2={at + grid}
                                        y2={py}
                                        strokeWidth={1}
                                        className={lineClassName}
                                    />
                                )}
                                <line x1={at} y1={py} x2={at - 4} y2={py} strokeWidth={2} className={lineClassName} />
                                <text x={at - 8} y={py + 3.5} textAnchor="end" fontSize={10} className="fill-muted">
                                    {label(v)}
                                </text>
                            </g>
                        );
                    })}
                </>
            )}
        </g>
    );
}

/** A linear axis, drawn inside an `<svg>`: ticks every `ticks` value (councilchartscale's `linearTicks` picks round
 *  ones), labelled with `format` (the short number by default). Place marks with `linearScale(domain, range)`. */
export function LinearAxis({ domain, ...rest }: AxisProps) {
    return <ChartAxis scale={linearScale(domain, rest.range)} {...rest} />;
}

/** A log axis, drawn inside an `<svg>`: `domain` is positive. Its ticks default to the token axis's 0.3M … 30M and are
 *  written in millions (`tokenTick`). Place marks with `logScale(domain, range)`. */
export function LogAxis({
    domain,
    ticks = LOG_TOKEN_TICKS,
    format = tokenTick,
    ...rest
}: Omit<AxisProps, "ticks" | "format"> & Partial<Pick<AxisProps, "ticks" | "format">>) {
    return <ChartAxis scale={logScale(domain, rest.range)} ticks={ticks} format={format} {...rest} />;
}
