// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The benchmark chart (docs/superpowers/plans/2026-11-19-council-figures.md, figure F), at the top of Library's Councils
// tab: key lines found against tokens per run, one small multiple per mode (Review, Brainstorm), so the person sees at
// a glance whether a council beats one agent. It is a folded section, closed by default and remembered in localStorage
// (`council.benchOpen`): the header says "Benchmark · 52 runs in 2 modes" and the takeaway across both modes, so the
// insight reads without opening it. Inside, each small multiple has its own one-line takeaway, a log x axis (tokens per
// run) and a y axis of the share of the keys found, one point per (harness, variant) row:
//   - the variant is a shape (solo ●, council ■, team ▲, brainstorm ◆) in its identity colour (--color-chart-1..4,
//     docs/agents/council-chart-palette.md), so it never rests on colour alone, and only the newest harness's points
//     carry a direct label; an older harness's points sit at 40%;
//   - a point is hollow when its Review row has recall@5 only (not every scored run was judged whole);
//   - a 2px muted stepped line is the newest harness's frontier: the points no cheaper point of it beats on recall.
// A tooltip prints the row as `wsh council bench results` does, and the Table toggle shows those tables. Every number and
// word is the model's (councilfiguresmodel.ts `benchPoints`) or the pure helpers' (councilbenchchartmodel.ts).
//
// Markers: `data-council-figure="bench"` (ChartFigure's), `data-bench-toggle` on the fold button, `data-bench-panel={mode}`
// on each small multiple, `data-bench-point="<mode>/<variant>/<harness>"` on each point's hit target (with
// `data-bench-hollow` and `data-bench-newest`), `data-bench-label` on a direct label, `data-bench-frontier` on the line.
// Reduced motion: no fade, no transition.

import { viewFade } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    benchRowLines,
    benchTables,
    formatTokens,
    percent,
    placeLabels,
    recallDomain,
    steppedPath,
} from "./councilbenchchartmodel";
import { benchResultsAtom, loadBenchResults, readBenchOpen, writeBenchOpen } from "./councilbenchstore";
import {
    ChartFigure,
    ChartTable,
    HOVER_FADE,
    LOG_TOKEN_TICKS,
    LinearAxis,
    LogAxis,
    TipBody,
    hoverFadeStyle,
    linearScale,
    logScale,
    useChartTip,
} from "./councilchartparts";
import { benchPoints, type BenchPanel, type BenchPoint } from "./councilfiguresmodel";

// ── the variants ────────────────────────────────────────────────────────────────────────────────────────────────────

type VariantStyle = { fill: string; stroke: string; name: string };

/** The identity colour of each variant (--color-chart-1..4), literal so Tailwind sees every class. */
const VARIANT_STYLE: Record<string, VariantStyle> = {
    solo: { fill: "fill-chart-1", stroke: "stroke-chart-1", name: "solo" },
    council: { fill: "fill-chart-2", stroke: "stroke-chart-2", name: "council" },
    team: { fill: "fill-chart-3", stroke: "stroke-chart-3", name: "team" },
    brainstorm: { fill: "fill-chart-4", stroke: "stroke-chart-4", name: "brainstorm" },
};
/** A variant this build does not know: a neutral dot. */
const UNKNOWN_STYLE: VariantStyle = { fill: "fill-secondary", stroke: "stroke-secondary", name: "other" };
const VARIANT_ORDER = ["solo", "council", "team", "brainstorm"];

const styleOf = (variant: string): VariantStyle => VARIANT_STYLE[variant] ?? UNKNOWN_STYLE;

/** A variant's mark centred on (x, y), at least 10px across: solo a circle, council a square, team a triangle,
 *  brainstorm a diamond. `hollow` draws it as a 2px outline, the way a recall@5-only point reads. */
function VariantMark({
    variant,
    x,
    y,
    hollow = false,
    className,
}: {
    variant: string;
    x: number;
    y: number;
    hollow?: boolean;
    className?: string;
}) {
    const s = styleOf(variant);
    const cls = cn(hollow ? cn("fill-transparent", s.stroke) : s.fill, className);
    const stroke = hollow ? 2 : 0;
    switch (variant) {
        case "council":
            return <rect x={x - 5} y={y - 5} width={10} height={10} rx={2} strokeWidth={stroke} className={cls} />;
        case "team":
            return (
                <path
                    d={`M${x} ${y - 6}L${x + 6} ${y + 5}L${x - 6} ${y + 5}Z`}
                    strokeWidth={stroke}
                    strokeLinejoin="round"
                    className={cls}
                />
            );
        case "brainstorm":
            return (
                <path
                    d={`M${x} ${y - 6.5}L${x + 6.5} ${y}L${x} ${y + 6.5}L${x - 6.5} ${y}Z`}
                    strokeWidth={stroke}
                    strokeLinejoin="round"
                    className={cls}
                />
            );
        default:
            return <circle cx={x} cy={y} r={5} strokeWidth={stroke} className={cls} />;
    }
}

// ── one small multiple ──────────────────────────────────────────────────────────────────────────────────────────────

const PLOT_H = 170;
const MARGIN = { left: 46, right: 16, top: 14, bottom: 40 };
const PANEL_MIN = 280;
const PANEL_MAX = 560;
const PANEL_GAP = 24;
const SIDE_BY_SIDE_MIN = 640; // the host width from which the two small multiples sit beside each other

/** The x domain of a small multiple, in tokens: the axis's 0.3M to 30M with room either side, wider when a point
 *  falls outside it. */
function tokenDomain(points: readonly BenchPoint[]): [number, number] {
    const tokens = points.map((p) => Math.pow(10, p.x)).filter((t) => Number.isFinite(t) && t > 0);
    return [Math.min(200_000, ...tokens.map((t) => t / 1.3)), Math.max(45_000_000, ...tokens.map((t) => t * 1.3))];
}

function pointId(mode: string, p: BenchPoint): string {
    return `${mode}/${p.variant}/${p.harness}`;
}

function PointTip({ panel, p }: { panel: BenchPanel; p: BenchPoint }) {
    const tokensARun = formatTokens(Math.pow(10, p.x));
    const lines: ReactNode[] = [
        <span key="run" className="tabular-nums">
            {percent(p.y)} of the keys at {tokensARun} tokens a run
        </span>,
        ...benchRowLines(p.row, panel.mode).map((l) => (
            <span key={l.label} className="tabular-nums">
                <span className="text-muted">{l.label}</span> {l.value}
            </span>
        )),
    ];
    if (p.hollow) {
        lines.push(<span key="hollow">recall@5 only: `wsh council bench rejudge` scores it whole</span>);
    }
    if (!p.newest) {
        lines.push(
            <span key="older" className="text-muted">
                an older harness: its prompts differ, so it is off the frontier
            </span>
        );
    }
    return <TipBody title={`${p.variant} · ${p.harness}`} lines={lines} />;
}

function BenchPlot({ panel, width, tip }: { panel: BenchPanel; width: number; tip: ReturnType<typeof useChartTip> }) {
    const plotW = width - MARGIN.left - MARGIN.right;
    const [lo, hi] = tokenDomain(panel.points);
    const ticks = LOG_TOKEN_TICKS.filter((t) => t >= lo && t <= hi);
    const { top, ticks: yTicks } = recallDomain(panel.points.map((p) => p.y));
    const xOf = logScale([lo, hi], [0, plotW]);
    const yOf = linearScale([0, top], [PLOT_H, 0]);
    const at = (p: BenchPoint) => ({ x: xOf(Math.pow(10, p.x)), y: yOf(p.y) });

    // an older harness first, so the newest harness's points sit on top
    const ordered = [...panel.points].sort((a, b) => Number(a.newest) - Number(b.newest) || a.x - b.x);
    const labelled = ordered.filter((p) => p.newest);
    const labels = placeLabels(
        labelled.map((p) => ({ id: pointId(panel.mode, p), ...at(p), text: p.label })),
        plotW
    );
    const frontier = steppedPath(panel.frontier.map(at));
    const height = MARGIN.top + PLOT_H + MARGIN.bottom;
    const name = panel.mode === "review" ? "Review" : "Brainstorm";

    return (
        <svg
            width={width}
            height={height}
            role="group"
            aria-label={`${name}: key lines found against tokens per run`}
            className="block flex-none overflow-visible"
        >
            <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
                <LinearAxis
                    orient="y"
                    domain={[0, top]}
                    range={[PLOT_H, 0]}
                    at={0}
                    ticks={yTicks}
                    format={percent}
                    grid={plotW}
                    lineClassName="stroke-edge-mid"
                />
                <LogAxis
                    orient="x"
                    domain={[lo, hi]}
                    range={[0, plotW]}
                    at={PLOT_H}
                    ticks={ticks}
                    lineClassName="stroke-edge-mid"
                />
                <text x={plotW / 2} y={PLOT_H + 34} textAnchor="middle" fontSize={10} className="fill-muted">
                    tokens per run
                </text>
                {frontier !== "" && (
                    <path
                        data-bench-frontier=""
                        d={frontier}
                        fill="none"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        className="stroke-muted"
                    />
                )}
                {ordered.map((p) => {
                    const id = pointId(panel.mode, p);
                    const { x, y } = at(p);
                    return (
                        <g key={id} className="group">
                            <circle
                                cx={x}
                                cy={y}
                                r={9}
                                fill="none"
                                strokeWidth={2}
                                style={hoverFadeStyle}
                                className={cn(
                                    "pointer-events-none stroke-accent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                                    HOVER_FADE
                                )}
                            />
                            <VariantMark
                                variant={p.variant}
                                x={x}
                                y={y}
                                hollow={p.hollow}
                                className={p.newest ? undefined : "opacity-40"}
                            />
                            {/* the hit target, larger than the mark, which is what hover and Tab reach */}
                            <circle
                                data-bench-point={id}
                                data-bench-hollow={p.hollow ? "" : undefined}
                                data-bench-newest={p.newest ? "" : undefined}
                                tabIndex={0}
                                role="img"
                                aria-label={`${p.variant}, harness ${p.harness}: ${percent(p.y)} of the keys at ${formatTokens(Math.pow(10, p.x))} tokens a run${p.hollow ? ", recall@5 only" : ""}`}
                                cx={x}
                                cy={y}
                                r={12}
                                fill="transparent"
                                className="cursor-default outline-none"
                                {...tip.bind(<PointTip panel={panel} p={p} />)}
                            />
                        </g>
                    );
                })}
                {labels.map((l) => {
                    const p = labelled.find((q) => pointId(panel.mode, q) === l.id)!;
                    return (
                        <text
                            key={l.id}
                            data-bench-label={l.id}
                            x={l.x}
                            y={l.y}
                            textAnchor={l.anchor}
                            fontSize={10}
                            className="pointer-events-none fill-secondary"
                        >
                            {p.label}
                        </text>
                    );
                })}
            </g>
        </svg>
    );
}

function Panel({ panel, width, tip }: { panel: BenchPanel; width: number; tip: ReturnType<typeof useChartTip> }) {
    return (
        <div data-bench-panel={panel.mode} className="flex min-w-0 flex-none flex-col gap-1" style={{ width }}>
            <div className="flex items-baseline gap-2">
                <h4 className="m-0 text-[12px] font-semibold text-primary">
                    {panel.mode === "review" ? "Review" : "Brainstorm"}
                </h4>
                <span className="text-[11px] text-muted">key lines found</span>
            </div>
            <p data-bench-takeaway={panel.mode} className="m-0 text-[12px] leading-[1.45] text-secondary">
                {panel.takeaway}
            </p>
            <BenchPlot panel={panel} width={width} tip={tip} />
        </div>
    );
}

// ── the legend and the open body ────────────────────────────────────────────────────────────────────────────────────

function Legend({ panels }: { panels: BenchPanel[] }) {
    const points = panels.flatMap((p) => p.points);
    const variants = VARIANT_ORDER.filter((v) => points.some((p) => p.variant === v));
    const anyOlder = points.some((p) => !p.newest);
    const anyHollow = points.some((p) => p.hollow);
    const anyFrontier = panels.some((p) => p.frontier.length >= 2);
    return (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11px] text-muted">
            {variants.map((v) => (
                <li key={v} className="m-0 flex items-center gap-[6px] p-0">
                    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="flex-none">
                        <VariantMark variant={v} x={7} y={7} />
                    </svg>
                    {styleOf(v).name}
                </li>
            ))}
            {anyOlder && (
                <li className="m-0 flex items-center gap-[6px] p-0">
                    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="flex-none">
                        <circle cx={7} cy={7} r={5} className="fill-secondary opacity-40" />
                    </svg>
                    older harness
                </li>
            )}
            {anyHollow && (
                <li className="m-0 flex items-center gap-[6px] p-0">
                    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="flex-none">
                        <circle cx={7} cy={7} r={4} strokeWidth={2} className="fill-transparent stroke-secondary" />
                    </svg>
                    hollow: recall@5 only
                </li>
            )}
            {anyFrontier && (
                <li className="m-0 flex items-center gap-[6px] p-0">
                    <svg width={22} height={14} viewBox="0 0 22 14" aria-hidden className="flex-none">
                        <path d="M1 11H11V4H21" fill="none" strokeWidth={2} className="stroke-muted" />
                    </svg>
                    frontier of the newest harness
                </li>
            )}
        </ul>
    );
}

function BenchBody({ panels }: { panels: BenchPanel[] }) {
    const reduce = useReducedMotion() === true;
    const tip = useChartTip();
    const hostRef = useRef<HTMLDivElement>(null);
    const [measured, setMeasured] = useState(0);
    useLayoutEffect(() => {
        if (hostRef.current) {
            setMeasured(hostRef.current.clientWidth);
        }
    }, []);
    useResizeObserver(hostRef, (e) => setMeasured(e.contentRect.width));
    const host = measured > 0 ? measured : 720;
    const beside = panels.length > 1 && host >= SIDE_BY_SIDE_MIN;
    const width = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.floor(beside ? (host - PANEL_GAP) / 2 : host)));
    return (
        <motion.div
            variants={viewFade}
            initial={reduce ? false : "initial"}
            animate="animate"
            className="flex flex-col gap-3"
        >
            <div ref={hostRef} className="flex flex-wrap gap-x-6 gap-y-4">
                {panels.map((panel) => (
                    <Panel key={panel.mode} panel={panel} width={width} tip={tip} />
                ))}
            </div>
            <Legend panels={panels} />
            {tip.node}
        </motion.div>
    );
}

// ── the section ─────────────────────────────────────────────────────────────────────────────────────────────────────

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Library → Councils' benchmark section: loads the bench results each time it mounts, and draws nothing until there is a
 *  scored row to plot. */
export function CouncilBenchChart() {
    const results = useAtomValue(benchResultsAtom);
    const [open, setOpen] = useState(readBenchOpen);
    useEffect(() => {
        void loadBenchResults();
    }, []);
    const rows = results?.runs;
    const figures = useMemo(() => (rows == null ? null : benchPoints(rows)), [rows]);
    const tables = useMemo(() => (rows == null ? [] : benchTables(rows)), [rows]);
    if (figures == null || (figures.review == null && figures.brainstorm == null)) {
        return null;
    }
    const panels = [figures.review, figures.brainstorm].filter((p): p is BenchPanel => p != null);
    const toggle = () => {
        const next = !open;
        setOpen(next);
        writeBenchOpen(next);
    };
    const Chevron = open ? ChevronDown : ChevronRight;
    const table = (
        <div className="flex flex-col gap-4">
            {tables.map((t) => (
                <div key={t.mode} className="flex flex-col gap-1">
                    <div className="text-[12px] font-semibold text-primary">{t.heading}</div>
                    <ChartTable columns={t.columns} rows={t.rows} numeric={t.numeric} />
                    <p className="m-0 text-[11px] leading-[1.45] text-muted">{t.note}</p>
                </div>
            ))}
        </div>
    );
    return (
        <ChartFigure
            id="bench"
            title={`Benchmark · ${plural(figures.runs, "run")} in ${plural(figures.modes, "mode")}`}
            takeaway={figures.takeaway}
            table={open ? table : undefined}
            className="rounded-xl border border-edge-mid bg-surface p-4 [&>div:empty]:hidden"
            headerExtra={
                <button
                    type="button"
                    data-bench-toggle=""
                    aria-expanded={open}
                    onClick={toggle}
                    className="flex h-[22px] flex-none cursor-pointer items-center gap-[2px] rounded-[4px] border-0 bg-transparent pl-2 pr-1 text-[11px] font-medium text-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {open ? "Hide chart" : "Show chart"}
                    <Chevron size={13} aria-hidden />
                </button>
            }
        >
            {open ? <BenchBody panels={panels} /> : null}
        </ChartFigure>
    );
}
