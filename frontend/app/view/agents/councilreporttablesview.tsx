// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report's two tables, first under the answer (docs/superpowers/specs/2026-11-23-council-report-tables-design.md
// decision 5): Việc cần làm / To do, a row per ranked direction (what to do, why, the files it touches, its kind), and
// Số liệu / Figures, the figures Go verified (the value, what it measures, the `path:line` it comes from): grouped under
// the group a seat named, a whole that counts split drawn as one bar of its parts and a rate as a bar over its
// denominator, a figure and its earlier value as a change, a figure and its limit as a bar with the limit marked, figures
// over time as a line and figures of one unit as bars side by side, the rest as rows (sectionView). Rows,
// words and the fallbacks for a council summarized before the new fields are councilreporttables.ts's (this file has a
// longer name than it: a .ts and a .tsx of one name cannot both be imported). They read as quiet
// data tables, not cards: a hairline under each row, the task in primary ink, the rest muted, no fill. Long text wraps
// (a long path breaks anywhere), so at a narrow pane the table shrinks to it; a table that still cannot fit scrolls in
// its own box and never moves the page.
//
// Markers for the CDP scenario (council-report-tables): data-council-section="todo" / "figures", a row
// data-council-todo-row={rank} / data-council-figure-row, a group data-council-figure-group={name}, a bar
// data-council-figure-bar="stack" / "rate" (a rate's share text data-council-figure-pct), a stacked bar's part
// data-council-figure-segment={value, or "rest"}; also data-council-figure-bar="change" / "limit" / "series" / "compare",
// a change's data-council-figure-delta, a limit's data-council-figure-limit (the tick) and data-council-figure-side
// ("breach" / "ok"), a line's data-council-figure-point={at} and a comparison's data-council-figure-compare={value}, and in a to-do row data-council-todo-cell={task|why|files|kind},
// a why cell that is the reasoning's first sentence (no `why` written) also data-council-todo-why-fallback.
// The failed figures list (About the council's) is FailedFiguresTable: data-council-failed-row.

import { viewFade } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import type { CouncilLang } from "./councillang";
import {
    figureSections,
    percentText,
    reportLangOf,
    reportWords,
    sectionView,
    seriesLabels,
    todoRows,
    type ChangeView,
    type CompareView,
    type FailedFigureRow,
    type FigureChart,
    type FigureRow,
    type LimitView,
    type RateBar,
    type ReportWords,
    type SeriesView,
    type StackBar,
    type StackSegment,
} from "./councilreporttables";

const H2 = "m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary";
const TH = "border-b border-edge-mid px-3 py-2 text-left text-[12px] font-medium text-muted";
const TD = "border-t border-edge-faint px-3 py-[10px] align-top [overflow-wrap:anywhere]";

// an empty cell is a dash, as the saved report's is
function Dash() {
    return <span className="text-muted">—</span>;
}

// a section of the Report with its heading and a table, fading in as it mounts like the page's other sections
function TableSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <motion.section
            variants={viewFade}
            initial="initial"
            animate="animate"
            data-council-section={id}
            aria-label={title}
            className="flex min-w-0 flex-col gap-4"
        >
            <h2 className={H2}>{title}</h2>
            <div data-council-table-scroll className="max-w-full overflow-x-auto">
                {children}
            </div>
        </motion.section>
    );
}

/** Việc cần làm / To do: a row per ranked direction. Draws nothing when the summary ranked none. */
export function TodoTable({ c }: { c: Council }) {
    const rows = useMemo(() => todoRows(c), [c]);
    const words = reportWords(reportLangOf(c));
    if (rows.length === 0) {
        return null;
    }
    return (
        <TableSection id="todo" title={words.todo}>
            <table className="w-full border-collapse text-[13.5px] leading-[1.5]">
                <thead>
                    <tr>
                        <th scope="col" className={cn(TH, "w-px pl-0")}>
                            {words.rank}
                        </th>
                        <th scope="col" className={TH}>
                            {words.task}
                        </th>
                        <th scope="col" className={TH}>
                            {words.why}
                        </th>
                        <th scope="col" className={TH}>
                            {words.files}
                        </th>
                        <th scope="col" className={cn(TH, "pr-0")}>
                            {words.kind}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.rank} data-council-todo-row={r.rank}>
                            <td data-council-todo-cell="rank" className={cn(TD, "pl-0 tabular-nums text-muted")}>
                                {r.rank}
                            </td>
                            <td data-council-todo-cell="task" className={cn(TD, "font-semibold text-primary")}>
                                {r.task !== "" ? r.task : <Dash />}
                            </td>
                            <td
                                data-council-todo-cell="why"
                                data-council-todo-why-fallback={r.whyFallback ? "" : undefined}
                                className={cn(TD, "text-secondary")}
                            >
                                {r.why !== "" ? r.why : <Dash />}
                            </td>
                            <td data-council-todo-cell="files" className={cn(TD, "text-[12.5px] text-secondary")}>
                                {r.files.length > 0 ? (
                                    <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
                                        {r.files.map((f) => (
                                            <li key={f}>{f}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <Dash />
                                )}
                            </td>
                            <td data-council-todo-cell="kind" className={cn(TD, "pr-0 text-[12.5px] text-secondary")}>
                                {r.kind !== "" ? r.kind : <Dash />}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableSection>
    );
}

/** Số liệu / Figures: the figures Go verified. Grouped figures sit under their group's name; inside a group a whole that
 *  counts split is one bar of its parts, a rate over its denominator a bar of its own, and the rest rows of a table. With
 *  no group and no relation it is the one table it always was. Draws nothing when there is no verified figure. */
export function FiguresTable({ c }: { c: Council }) {
    const lang = reportLangOf(c);
    const views = useMemo(() => figureSections(c).map((s) => sectionView(s, lang)), [c, lang]);
    const words = reportWords(lang);
    if (views.length === 0) {
        return null;
    }
    const grouped = views[0].name !== "";
    return (
        <TableSection id="figures" title={words.figures}>
            <div className="flex min-w-0 flex-col gap-7">
                {views.map((v) => (
                    <div key={v.name} data-council-figure-group={v.name} className="flex min-w-0 flex-col gap-4">
                        {grouped ? (
                            <h3 className="m-0 text-[14.5px] font-semibold text-primary">
                                {v.name !== "" ? v.name : words.otherFigures}
                            </h3>
                        ) : null}
                        {v.bars.map((b, i) => (
                            <FigureChartView key={chartKey(b, i)} chart={b} lang={lang} />
                        ))}
                        {v.loose.length > 0 ? <FigureRowsTable rows={v.loose} words={words} /> : null}
                    </div>
                ))}
            </div>
        </TableSection>
    );
}

// a figure's places as one mono line: its ref, then the other places that hold it
const placesOf = (r: FigureRow) => [r.ref, ...r.refs].filter((p) => p !== "");

// the fills of a bar's parts in order: one hue, each part a step lighter than the one before, so two neighbours never
// share a fill; a bar of more parts than steps repeats from the strongest. What is left of the whole is the bare track.
const PART_FILLS = ["bg-accent", "bg-accent/60", "bg-accent/35", "bg-accent/20"];

function segmentFill(s: StackSegment, index: number): string {
    return s.row == null ? "bg-pill" : PART_FILLS[index % PART_FILLS.length];
}

// below this share a part's label does not fit inside it: the legend under the bar names it
const LABEL_MIN_SHARE = 0.09;

/** A whole that counts split: its value and what it measures, one bar of its parts side by side (2px apart, each as wide
 *  as its share), a legend naming each part, the parts split further as "135 = 94 + 41", and the lines it comes from. */
function StackBarView({ bar, lang }: { bar: StackBar; lang: CouncilLang }) {
    // a part's place among the parts (the rest is none), which picks its fill in the bar and the legend alike
    const fills = new Map(bar.segments.filter((s) => s.row != null).map((s, i) => [s, segmentFill(s, i)]));
    const parts = [...fills.keys()];
    return (
        <div data-council-figure-bar="stack" className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-semibold tabular-nums text-primary">{bar.whole.value}</span>
                <span className="text-[13.5px] text-secondary">{bar.whole.measures}</span>
            </div>
            <div className="flex h-[22px] min-w-0 gap-[2px]" role="img" aria-label={barLabel(bar)}>
                {bar.segments.map((s, i) => (
                    <div
                        key={i}
                        data-council-figure-segment={s.row == null ? "rest" : s.row.value}
                        title={`${s.label}${s.row?.measures ? ` · ${s.row.measures}` : ""} · ${percentText(s.share, lang)}`}
                        style={{ flexGrow: s.share, flexBasis: 0 }}
                        className={cn(
                            "flex min-w-[3px] items-center overflow-hidden rounded-[4px] px-2 text-[11.5px] tabular-nums",
                            fills.get(s) ?? segmentFill(s, 0),
                            s.row == null ? "text-muted" : "text-primary"
                        )}
                    >
                        {s.share >= LABEL_MIN_SHARE ? <span className="truncate">{s.label}</span> : null}
                    </div>
                ))}
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-secondary">
                {parts.map((s, i) => (
                    <li key={i} className="flex items-baseline gap-[6px]">
                        <span
                            aria-hidden
                            className={cn("h-[9px] w-[9px] flex-none self-center rounded-[2px]", fills.get(s))}
                        />
                        <span className="font-semibold tabular-nums text-primary">{s.row!.value}</span>
                        <span>{s.row!.measures}</span>
                    </li>
                ))}
                {bar.subtotals.map((t) => (
                    <li key={t} className="tabular-nums text-muted">
                        {t}
                    </li>
                ))}
            </ul>
            <p className="m-0 font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">
                {bar.rows.flatMap(placesOf).join(" · ")}
            </p>
        </div>
    );
}

// what a screen reader hears for a stacked bar: "947: 94, 41, 812 còn lại"
const barLabel = (bar: StackBar) => `${bar.whole.value}: ${bar.segments.map((s) => s.label).join(", ")}`;

/** A rate over its denominator: its value, a bar filled to its share, "70,6% của 170", then what it measures and the
 *  lines it comes from. Two rates of one numerator over different denominators sit one under the other, so the gap shows. */
function RateBarView({ bar }: { bar: RateBar }) {
    return (
        <div data-council-figure-bar="rate" className="flex min-w-0 flex-col gap-[6px]">
            <div className="grid min-w-0 grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3">
                <span className="truncate font-semibold tabular-nums text-primary" title={bar.row.value}>
                    {bar.row.value}
                </span>
                <div
                    className="h-[14px] min-w-0 rounded-[4px] bg-pill"
                    role="img"
                    aria-label={bar.pct}
                    title={`${bar.row.value} · ${bar.pct}`}
                >
                    <div
                        className="h-full rounded-[4px] bg-accent"
                        style={{ width: `${Math.min(1, bar.share) * 100}%` }}
                    />
                </div>
                <span data-council-figure-pct className="whitespace-nowrap text-[12.5px] tabular-nums text-secondary">
                    {bar.pct}
                </span>
            </div>
            <p className="m-0 text-[12.5px] text-secondary">
                {bar.row.measures}
                <span className="ml-2 font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">
                    {placesOf(bar.row).join(" · ")}
                </span>
            </p>
        </div>
    );
}

// one chart of a group, by its kind
function FigureChartView({ chart, lang }: { chart: FigureChart; lang: CouncilLang }) {
    switch (chart.kind) {
        case "stack":
            return <StackBarView bar={chart} lang={lang} />;
        case "rate":
            return <RateBarView bar={chart} />;
        case "change":
            return <ChangeChart chart={chart} lang={lang} />;
        case "limit":
            return <LimitChart chart={chart} lang={lang} />;
        case "series":
            return <SeriesChart chart={chart} />;
        case "compare":
            return <CompareChart chart={chart} />;
    }
}

// a stable key for a chart: its kind and the first figure it draws
function chartKey(chart: FigureChart, i: number): string {
    const first =
        chart.kind === "stack"
            ? chart.whole
            : chart.kind === "rate" || chart.kind === "limit"
              ? chart.row
              : chart.kind === "change"
                ? chart.to
                : chart.rows[0];
    return `${chart.kind}:${first?.ref ?? ""}:${first?.value ?? ""}:${i}`;
}

// a figure's value and what it measures, the line every chart opens with
function ChartHead({ value, measures }: { value: string; measures: string }) {
    return (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="font-semibold tabular-nums text-primary">{value}</span>
            <span className="text-[13.5px] text-secondary">{measures}</span>
        </div>
    );
}

// the lines a chart's figures come from, as one mono line
function ChartSources({ rows }: { rows: FigureRow[] }) {
    return (
        <p className="m-0 font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">
            {rows.flatMap(placesOf).join(" · ")}
        </p>
    );
}

// a bar's width as a share of a scale, never below a sliver so a small value still shows
const widthOf = (level: number, scale: number) => `${Math.max(0.6, Math.min(1, Math.abs(level) / scale) * 100)}%`;

/** A figure and the value it had before: two bars on one scale, the earlier one muted, the later in accent, then
 *  "79,5% → 70,6%" with the change and an arrow. Whether up is good is not known, so neither is coloured as a verdict. */
function ChangeChart({ chart, lang }: { chart: ChangeView; lang: CouncilLang }) {
    const words = reportWords(lang);
    const Arrow = chart.dir === "up" ? ArrowUpRight : chart.dir === "down" ? ArrowDownRight : ArrowRight;
    const bar = (row: FigureRow, label: string, fill: string, mark: string) => (
        <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3">
            <span className="text-[12px] text-muted">{label}</span>
            <div className="h-[12px] min-w-0">
                <div
                    data-council-figure-change={mark}
                    className={cn("h-full rounded-[4px]", fill)}
                    style={{ width: widthOf(row.level ?? 0, chart.scale) }}
                />
            </div>
            <span className="whitespace-nowrap text-[12.5px] tabular-nums text-secondary">{row.value}</span>
        </div>
    );
    return (
        <div data-council-figure-bar="change" className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-semibold tabular-nums text-primary">
                    {chart.from.value} → {chart.to.value}
                </span>
                <span
                    data-council-figure-delta
                    className="inline-flex items-center gap-[3px] text-[12.5px] tabular-nums text-secondary"
                >
                    <Arrow size={13} aria-hidden className="self-center text-muted" />
                    {chart.delta}
                </span>
                <span className="text-[13.5px] text-secondary">{chart.to.measures}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-[6px]">
                {bar(chart.from, words.before, "bg-ink-faint", "from")}
                {bar(chart.to, words.after, "bg-accent", "to")}
            </div>
            <ChartSources rows={[chart.from, chart.to]} />
        </div>
    );
}

/** A figure held to a limit: a bar to its level with the limit drawn as a tick across it, labelled. On the wrong side of
 *  it the bar and the words take the warning tone with an icon, so the state is never colour alone. */
function LimitChart({ chart, lang }: { chart: LimitView; lang: CouncilLang }) {
    const words = reportWords(lang);
    const at = Math.min(1, (chart.limit.level ?? 0) / chart.scale) * 100;
    const breach = chart.row.breach;
    return (
        <div data-council-figure-bar="limit" className="flex min-w-0 flex-col gap-2">
            <ChartHead value={chart.row.value} measures={chart.row.measures} />
            <div className="relative h-[30px] min-w-0">
                <div className="absolute inset-x-0 top-[12px] h-[14px] rounded-[4px] bg-pill" />
                <div
                    className={cn(
                        "absolute left-0 top-[12px] h-[14px] rounded-[4px]",
                        breach ? "bg-warning" : "bg-accent"
                    )}
                    style={{ width: widthOf(chart.row.level ?? 0, chart.scale) }}
                />
                <div
                    data-council-figure-limit
                    aria-hidden
                    className="absolute top-[8px] h-[22px] w-[2px] -translate-x-1/2 rounded-[1px] bg-primary"
                    style={{ left: `${at}%` }}
                />
                <span
                    className="absolute top-[-4px] -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-muted"
                    style={{ left: `${Math.min(92, Math.max(8, at))}%` }}
                >
                    {words.limitLabel} {chart.limit.value}
                </span>
            </div>
            <p
                data-council-figure-side={breach ? "breach" : "ok"}
                className={cn(
                    "m-0 flex items-center gap-[5px] text-[12.5px]",
                    breach ? "text-warning" : "text-secondary"
                )}
            >
                {breach ? (
                    <TriangleAlert size={13} aria-hidden />
                ) : (
                    <Check size={13} aria-hidden className="text-muted" />
                )}
                {chart.text}
            </p>
            <ChartSources rows={[chart.row, chart.limit]} />
        </div>
    );
}

// the plot box of a line over time, in the SVG's own units: the line is stretched to the box's width, so its stroke keeps
// its width with non-scaling-stroke, and the points and labels are HTML placed by percent
const PLOT_H = 72;

/** Figures over time: a 2px line through a point per figure (8px), each point's value above it and its time under the
 *  plot, the axis from the lowest to the highest value. A point names its figure on hover. */
function SeriesChart({ chart }: { chart: SeriesView }) {
    const n = chart.rows.length;
    const span = chart.max - chart.min || 1;
    const x = (i: number) => (n === 1 ? 50 : 4 + (92 * i) / (n - 1));
    const y = (level: number) => 10 + (1 - (level - chart.min) / span) * 80;
    const points = chart.rows.map((r, i) => ({ r, x: x(i), y: y(r.level ?? chart.min) }));
    // past six points the labels would run into each other: the first, the last and evenly spaced ones between keep theirs
    const labelled = seriesLabels(n);
    return (
        <div data-council-figure-bar="series" className="flex min-w-0 flex-col gap-2">
            <ChartHead value={chart.rows[n - 1].value} measures={chart.rows[n - 1].measures} />
            <div className="relative min-w-0" style={{ height: PLOT_H }}>
                <svg
                    aria-hidden
                    className="absolute inset-0 h-full w-full overflow-visible"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                >
                    <line
                        x1="0"
                        x2="100"
                        y1="90"
                        y2="90"
                        className="stroke-edge-faint"
                        vectorEffect="non-scaling-stroke"
                        strokeWidth={1}
                    />
                    <polyline
                        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="none"
                        className="stroke-accent"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                    />
                </svg>
                {points.map((p, i) => (
                    <div
                        key={i}
                        data-council-figure-point={p.r.at}
                        title={`${p.r.at} · ${p.r.value} · ${p.r.measures}`}
                        className="absolute h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
                        style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    >
                        {labelled[i] ? (
                            <span className="absolute bottom-[10px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] tabular-nums text-secondary">
                                {p.r.value}
                            </span>
                        ) : null}
                    </div>
                ))}
            </div>
            <div className="relative h-[16px] min-w-0">
                {points.map((p, i) =>
                    labelled[i] ? (
                        <span
                            key={i}
                            data-council-figure-at
                            title={p.r.at}
                            className="absolute max-w-[7rem] -translate-x-1/2 truncate whitespace-nowrap text-[11.5px] text-muted"
                            style={{ left: `${p.x}%` }}
                        >
                            {p.r.at}
                        </span>
                    ) : null
                )}
            </div>
            <ChartSources rows={chart.rows} />
        </div>
    );
}

/** Figures of one unit side by side, largest first: a row each with what it measures, a bar to its share of the largest,
 *  and its value. */
function CompareChart({ chart }: { chart: CompareView }) {
    return (
        <div data-council-figure-bar="compare" className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-[7px]">
                {chart.rows.map((r, i) => (
                    <div
                        key={`${r.ref}:${r.value}:${i}`}
                        data-council-figure-compare={r.value}
                        title={`${r.value} · ${r.measures}`}
                        className="grid min-w-0 grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-3"
                    >
                        <span className="truncate text-[12.5px] text-secondary" title={r.measures}>
                            {r.measures !== "" ? r.measures : r.value}
                        </span>
                        <div className="h-[12px] min-w-0">
                            <div
                                className="h-full rounded-[4px] bg-accent"
                                style={{ width: widthOf(r.level ?? 0, chart.max) }}
                            />
                        </div>
                        <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-primary">
                            {r.value}
                        </span>
                    </div>
                ))}
            </div>
            <ChartSources rows={chart.rows} />
        </div>
    );
}

/** The figures no bar draws, as rows: the value, what it measures, the lines it comes from. */
function FigureRowsTable({ rows, words }: { rows: FigureRow[]; words: ReportWords }) {
    return (
        <table className="w-full border-collapse text-[13.5px] leading-[1.5]">
            <thead>
                <tr>
                    <th scope="col" className={cn(TH, "pl-0")}>
                        {words.value}
                    </th>
                    <th scope="col" className={TH}>
                        {words.measures}
                    </th>
                    <th scope="col" className={cn(TH, "pr-0")}>
                        {words.source}
                    </th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r, i) => (
                    <tr key={`${r.ref}:${r.value}:${i}`} data-council-figure-row>
                        <td
                            data-council-figure-cell="value"
                            className={cn(TD, "whitespace-nowrap pl-0 font-semibold tabular-nums text-primary")}
                        >
                            {r.value !== "" ? r.value : <Dash />}
                        </td>
                        <td data-council-figure-cell="measures" className={cn(TD, "text-secondary")}>
                            {r.measures !== "" ? r.measures : <Dash />}
                        </td>
                        {/* a cite is a code reference to read character by character: the one mono cell */}
                        <td
                            data-council-figure-cell="source"
                            className={cn(TD, "pr-0 font-mono text-[12px] text-muted")}
                        >
                            {r.ref !== "" ? placesOf(r).join(", ") : <Dash />}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** A list of figures with Go's note, for About the council: the side file's four columns (Value, Measures, Source, Why)
 *  under a line that says what the list is (by default, the figures that did not check out). It is about how the council
 *  worked, so its words are English like the rest of that fold, as the side file's are. */
export function FailedFiguresTable({
    rows,
    intro = "The seats declared these numbers; Go could not confirm them against the files, so the Figures table leaves them out.",
}: {
    rows: FailedFigureRow[];
    intro?: string;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <p className="m-0 text-[13px] leading-[1.5] text-muted">{intro}</p>
            <div data-council-table-scroll className="max-w-full overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px] leading-[1.5]">
                    <thead>
                        <tr>
                            <th scope="col" className={cn(TH, "pl-0")}>
                                Value
                            </th>
                            <th scope="col" className={TH}>
                                Measures
                            </th>
                            <th scope="col" className={TH}>
                                Source
                            </th>
                            <th scope="col" className={cn(TH, "pr-0")}>
                                Why
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={`${r.ref}:${r.value}:${i}`} data-council-failed-row>
                                <td
                                    className={cn(TD, "whitespace-nowrap pl-0 font-semibold tabular-nums text-primary")}
                                >
                                    {r.value !== "" ? r.value : <Dash />}
                                </td>
                                <td className={cn(TD, "text-secondary")}>
                                    {r.measures !== "" ? r.measures : <Dash />}
                                </td>
                                <td className={cn(TD, "font-mono text-[12px] text-muted")}>
                                    {r.ref !== "" ? r.ref : <Dash />}
                                </td>
                                <td data-council-failed-note className={cn(TD, "pr-0 text-secondary")}>
                                    {r.note}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
