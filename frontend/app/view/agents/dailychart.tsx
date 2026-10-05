// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage tab's one real chart: stacked daily columns (claude + codex) over a band day-axis. On visx
// for scales/ticks/tooltip, but the bars are motion.rect so the cockpit keeps ONE animation system —
// visx supplies no animation of its own, which is why it was chosen over recharts (whose built-in
// tween re-grows from the baseline on every data change, and usagesurface refreshes silently every 60s).
//
// Split out of usagesurface.tsx: it is the largest component there and its tooltip/brush change with it.

import { MOTION, easeFluidCss } from "@/app/element/motiontokens";
import { Segmented } from "@/app/element/segmented";
import useResizeObserver from "@react-hook/resize-observer";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Brush } from "@visx/brush";
import { scaleBand, scaleLinear } from "@visx/scale";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { fmt, usd, type DailyUsage } from "./usagestats";

const CHART_H = 156;
const BRUSH_H = 28;
const MARGIN = { top: 6, right: 4, bottom: 22, left: 46 };
const BAR_MAX = 30;
// Above this many columns the per-column entrance is dropped and the bars snap in. The cascade is
// delay: ri * 0.025, which was written when the series was capped at 30 days (0.75s). Uncapped, an
// all-time range animates hundreds of SVG rects on a staggered clock: measured over CDP, a 113-day
// range had painted only 13% of its bars 3.2s after mount, so the chart read as EMPTY on arrival.
// A cascade across hundreds of columns communicates nothing anyway — it only reads as motion at small n.
const STAGGER_MAX_COLS = 40;
// Stable known-harness metadata. Existing design-system tokens, unchanged from the pre-visx chart
// (claude = accent, codex = success) plus the OpenCode/Pi runtime tokens. Unknown harnesses fall
// back to the muted "other" color below.
const HARNESS_META: Record<string, { label: string; color: string }> = {
    claude: { label: "Claude", color: "var(--color-accent)" },
    codex: { label: "Codex", color: "var(--color-success)" },
    opencode: { label: "OpenCode", color: "var(--color-rt-opencode)" },
    pi: { label: "Pi", color: "var(--color-rt-pi)" },
};
const OTHER_COLOR = "var(--color-muted)";

function harnessMeta(h: string): { label: string; color: string } {
    return HARNESS_META[h] ?? { label: h, color: OTHER_COLOR };
}

export interface Row {
    day: string; // "MM-DD"
    values: Record<string, number>;
    total: number;
}

// A rect's rx rounds ALL FOUR corners, so using it for the top segment made that segment read as a
// detached pill floating above a square bar instead of as the cap of one stack. The stack has to read as
// a single bar: rounded top, flat baseline. Hence paths with top-only corners — the lower segment goes
// fully square whenever something sits above it. (The pre-visx chart got this from `rounded-t-[3px]`.)
function barPath(x: number, y: number, w: number, h: number, r: number): string {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    if (rr === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function toRows(daily: DailyUsage[], metric: "tokens" | "spend", harnesses: string[]): Row[] {
    return daily.map((d) => {
        const values = Object.fromEntries(
            harnesses.map((h) => [h, d.byHarness[h]?.[metric === "tokens" ? "tokens" : "spendUsd"] ?? 0])
        );
        return { day: d.day.slice(5), values, total: Object.values(values).reduce((sum, value) => sum + value, 0) };
    });
}

export function DailyChart({
    daily,
    window: win,
    metric,
    onMetric,
    harnesses,
}: {
    daily: DailyUsage[];
    window: "7d" | "all";
    metric: "tokens" | "spend";
    onMetric: (m: "tokens" | "spend") => void;
    harnesses: string[];
}) {
    const reduce = useReducedMotion();
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        if (hostRef.current) setWidth(hostRef.current.clientWidth);
    }, []);
    useResizeObserver(hostRef, (e) => setWidth(e.contentRect.width));

    const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } = useTooltip<Row>();
    const { containerRef, TooltipInPortal } = useTooltipInPortal({ scroll: true, detectBounds: true });

    const rows = toRows(daily, metric, harnesses);
    const [range, setRange] = useState<[number, number] | null>(null);
    // All-time can span years; 7d never needs a brush. Reset the range when the window or the row
    // count changes so a stale slice can't outlive its data.
    const showBrush = win === "all" && rows.length > 14;
    useLayoutEffect(() => {
        setRange(null);
    }, [win, rows.length]);
    const [lo, hi] = range ?? [0, rows.length - 1];
    const view = showBrush ? rows.slice(lo, hi + 1) : rows;

    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const axisFmt = (v: number) => (metric === "tokens" ? fmt(v) : usd(v));

    const x = scaleBand<string>({ domain: view.map((r) => r.day), range: [0, innerW], padding: 0.28 });
    const y = scaleLinear<number>({
        domain: [0, Math.max(1, ...view.map((r) => r.total))],
        range: [CHART_H, 0],
        nice: true,
    });
    const bandW = Math.min(BAR_MAX, x.bandwidth());
    const cascade = view.length <= STAGGER_MAX_COLS;
    // thin day labels so they never collide: keep every nth so at most ~12 render
    const tickEvery = Math.max(1, Math.ceil(view.length / 12));
    const tickDays = view.filter((_, i) => i % tickEvery === 0).map((r) => r.day);

    // The brush runs over day INDEX on a linear scale, not the band scale: @visx/brush is unreliable
    // over scaleBand, and an index pair is exactly what the slice above needs.
    const bx = scaleBand<number>({ domain: rows.map((_, i) => i), range: [0, innerW], padding: 0.2 });
    const bxLinear = scaleLinear<number>({ domain: [0, Math.max(1, rows.length - 1)], range: [0, innerW] });
    const byLinear = scaleLinear<number>({ domain: [0, 1], range: [BRUSH_H, 0] });
    const brushMax = Math.max(1, ...rows.map((r) => r.total));

    // Cumulative y-offset from the bottom for each harness segment, plus the height of the top
    // (highest) non-zero segment — only that one gets rounded top corners.
    function segmentOffsets(r: Row): { offsets: number[]; top: { index: number; h: number } | null } {
        const offsets: number[] = [];
        let acc = 0;
        let top: { index: number; h: number } | null = null;
        harnesses.forEach((h, i) => {
            const v = r.values[h] ?? 0;
            offsets.push(acc);
            if (v > 0) {
                acc += v;
                top = { index: i, h: v };
            }
        });
        return { offsets, top };
    }

    return (
        <div className="mb-4 rounded-[14px] border border-border bg-surface-raised px-[22px] pb-5 pt-[18px]">
            <div className="mb-5 flex flex-wrap items-center gap-3">
                <h3 className="text-[15px] font-bold tracking-[-0.01em] text-primary">Daily</h3>
                <span className="text-[11px] text-muted">
                    {win === "7d"
                        ? "last 7 days"
                        : view.length === rows.length
                          ? "all time"
                          : `${view[0]?.day ?? ""} – ${view[view.length - 1]?.day ?? ""}`}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-[14px]">
                    {harnesses.map((h) => (
                        <span
                            key={h}
                            className="flex items-center gap-[5px] text-[10.5px] text-secondary"
                        >
                            <span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: harnessMeta(h).color }} />
                            {harnessMeta(h).label}
                        </span>
                    ))}
                </div>
                <Segmented
                    value={metric}
                    onChange={onMetric}
                    options={[
                        { key: "tokens" as const, label: "Tokens" },
                        { key: "spend" as const, label: "Spend" },
                    ]}
                />
            </div>

            {rows.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-muted">No activity in range.</div>
            ) : (
                <div ref={hostRef} className="relative w-full">
                    <svg ref={containerRef} width={width} height={CHART_H + MARGIN.top + MARGIN.bottom}>
                        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                            <AxisLeft
                                scale={y}
                                numTicks={3}
                                tickFormat={(v) => axisFmt(Number(v))}
                                stroke="var(--color-border)"
                                tickStroke="var(--color-border)"
                                tickLabelProps={() => ({
                                    fill: "var(--color-muted)",
                                    fontSize: 10.5,
                                    fontFamily: "var(--font-sans)",
                                    fontVariantNumeric: "tabular-nums",
                                    textAnchor: "end",
                                    dx: -4,
                                    dy: 3,
                                })}
                            />
                            <AxisBottom
                                top={CHART_H}
                                scale={x}
                                tickValues={tickDays}
                                stroke="var(--color-border)"
                                tickStroke="var(--color-border)"
                                tickLabelProps={() => ({
                                    fill: "var(--color-muted)",
                                    fontSize: 10.5,
                                    fontFamily: "var(--font-sans)",
                                    fontVariantNumeric: "tabular-nums",
                                    textAnchor: "middle",
                                    dy: 2,
                                })}
                            />
                            {view.map((r, ri) => {
                                const cx = (x(r.day) ?? 0) + (x.bandwidth() - bandW) / 2;
                                const { offsets, top } = segmentOffsets(r);
                                const grow = reduce || !cascade
                                    ? {}
                                    : {
                                          initial: { scaleY: 0 },
                                          animate: { scaleY: 1 },
                                          transition: {
                                              delay: ri * 0.025,
                                              duration: MOTION.durMacro,
                                              ease: MOTION.easeFluid,
                                          },
                                      };
                                // SVG needs transformBox:fill-box for transformOrigin:bottom to mean what
                                // it means on a DOM element
                                const originStyle = {
                                    transformBox: "fill-box" as const,
                                    transformOrigin: "bottom",
                                    transition: reduce ? undefined : `height ${MOTION.durMacro}s ${easeFluidCss}`,
                                };
                                const onEnter = () =>
                                    showTooltip({
                                        tooltipData: r,
                                        tooltipLeft: MARGIN.left + cx + bandW / 2,
                                        tooltipTop: MARGIN.top + Math.max(0, y(r.total) - 12),
                                    });
                                return (
                                    <g key={r.day} onMouseEnter={onEnter} onMouseLeave={hideTooltip}>
                                        {/* hit target spans the whole column, wider than the mark */}
                                        <rect
                                            x={x(r.day) ?? 0}
                                            y={0}
                                            width={x.bandwidth()}
                                            height={CHART_H}
                                            fill="transparent"
                                        />
                                        {tooltipOpen && tooltipData?.day === r.day ? (
                                            <rect
                                                x={x(r.day) ?? 0}
                                                y={0}
                                                width={x.bandwidth()}
                                                height={CHART_H}
                                                fill="var(--color-surface-hover)"
                                                rx={3}
                                            />
                                        ) : null}
                                        {r.total === 0 ? (
                                            <rect
                                                x={cx}
                                                y={CHART_H - 2}
                                                width={bandW}
                                                height={2}
                                                rx={1}
                                                fill="var(--color-edge-strong)"
                                            />
                                        ) : null}
                                        {harnesses.map((h, i) => {
                                            const v = r.values[h] ?? 0;
                                            if (v <= 0) {
                                                return null;
                                            }
                                            const hPx = CHART_H - y(v);
                                            const yPx = y(offsets[i] + v);
                                            const radius = top?.index === i ? 4 : 0;
                                            return (
                                                <motion.path
                                                    key={h}
                                                    {...grow}
                                                    d={barPath(cx, yPx, bandW, hPx, radius)}
                                                    fill={harnessMeta(h).color}
                                                    style={originStyle}
                                                />
                                            );
                                        })}
                                    </g>
                                );
                            })}
                        </g>
                    </svg>

                    {showBrush ? (
                        <svg width={width} height={BRUSH_H + 18} className="mt-1">
                            <g transform={`translate(${MARGIN.left},4)`}>
                                {rows.map((r, ri) => {
                                    const h = Math.round((r.total / brushMax) * BRUSH_H);
                                    return (
                                        <rect
                                            key={r.day}
                                            x={(bx(ri) ?? 0) + 0.5}
                                            y={BRUSH_H - h}
                                            width={Math.max(1, bx.bandwidth() - 1)}
                                            height={h}
                                            fill="var(--color-edge-strong)"
                                        />
                                    );
                                })}
                                <Brush
                                    xScale={bxLinear}
                                    yScale={byLinear}
                                    width={Math.max(1, innerW)}
                                    height={BRUSH_H}
                                    handleSize={8}
                                    resizeTriggerAreas={["left", "right"]}
                                    brushDirection="horizontal"
                                    onChange={(domain) => {
                                        if (!domain) {
                                            setRange(null);
                                            return;
                                        }
                                        const a = Math.max(0, Math.round(domain.x0));
                                        const b = Math.min(rows.length - 1, Math.round(domain.x1));
                                        setRange(b > a ? [a, b] : null);
                                    }}
                                    onClick={() => setRange(null)}
                                    selectedBoxStyle={{
                                        fill: "var(--color-accent)",
                                        fillOpacity: 0.14,
                                        stroke: "var(--color-accent)",
                                        strokeWidth: 1,
                                    }}
                                />
                            </g>
                        </svg>
                    ) : null}

                    {tooltipOpen && tooltipData ? (
                        <TooltipInPortal
                            left={tooltipLeft}
                            top={tooltipTop}
                            className="!rounded-[7px] !border !border-border !bg-surface-raised !px-[10px] !py-[7px] !shadow-lg"
                        >
                            <div className="mb-[5px] text-[10.5px] font-semibold text-primary">
                                {tooltipData.day}
                            </div>
                            {harnesses.map((h) => (
                                <div key={h} className="flex items-center gap-[6px] text-[10.5px] tabular-nums">
                                    <span
                                        className="h-[8px] w-[8px] flex-none rounded-[2px]"
                                        style={{ background: harnessMeta(h).color }}
                                    />
                                    <span className="text-muted">{harnessMeta(h).label}</span>
                                    <span className="ml-auto pl-3 text-secondary">{axisFmt(tooltipData.values[h] ?? 0)}</span>
                                </div>
                            ))}
                            <div className="mt-[5px] flex items-center gap-[6px] border-t border-border pt-[5px] text-[10.5px] tabular-nums">
                                <span className="text-muted">total</span>
                                <span className="ml-auto pl-3 font-semibold text-primary">
                                    {axisFmt(tooltipData.total)}
                                </span>
                            </div>
                        </TooltipInPortal>
                    ) : null}
                </div>
            )}
        </div>
    );
}
