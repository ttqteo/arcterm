// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resource charts: the whole machine's CPU, RAM and GPU over the last 5 minutes, as three small multiples on
// one 0-100% scale (one series each, named by its title, so no legend), like Task Manager's Performance tab. A hover
// shows a crosshair and the reading under it. Wears the HUD skin (spec 2026-11-18-sidecar-hud-design.md): the line is a
// GlowPath, the gridline and the ground `hud-*` tokens, the figures mono. Runs on the slim page: only the types, the pure
// models and React.

import { cn } from "@/util/util";
import { useState, type MouseEvent } from "react";
import { GlowPath, HudLabel } from "./sidecarhud";
import { HISTORY_MS } from "./sidecarresources";
import { formatBytes } from "./sidecarstrainmodel";
import type { SidecarResourcePoint } from "./sidecartypes";

// the plot's own coordinates: the SVG stretches them to its box (the line keeps 1.5px with non-scaling-stroke)
const W = 300;
const H = 100;

function agoText(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) {
        return s <= 1 ? "now" : `${s}s ago`;
    }
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m}m ago` : `${m}m ${r}s ago`;
}

interface Series {
    t: number;
    v: number;
}

function Chart(props: { title: string; figure: string; detail?: string; series: Series[]; end: number }) {
    const { series, end } = props;
    const [hover, setHover] = useState<number | null>(null);
    const start = end - HISTORY_MS;
    const x = (t: number) => ((t - start) / HISTORY_MS) * W;
    const y = (v: number) => H - (Math.min(100, Math.max(0, v)) / 100) * H;
    const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area =
        series.length > 1 ? `${line}L${x(series.at(-1)!.t).toFixed(1)},${H}L${x(series[0].t).toFixed(1)},${H}Z` : "";
    const shown = hover != null ? series[hover] : undefined;

    const onMove = (e: MouseEvent<SVGSVGElement>) => {
        if (series.length === 0) {
            return;
        }
        const box = e.currentTarget.getBoundingClientRect();
        const t = start + ((e.clientX - box.left) / Math.max(1, box.width)) * HISTORY_MS;
        let best = 0;
        for (let i = 1; i < series.length; i++) {
            if (Math.abs(series[i].t - t) < Math.abs(series[best].t - t)) {
                best = i;
            }
        }
        setHover(best);
    };

    return (
        <div data-sidecar-chart={props.title.toLowerCase()} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-2">
                <HudLabel>{props.title}</HudLabel>
                <span className="flex-1" />
                {shown != null ? (
                    <span className="font-mono text-[11.5px] tabular-nums text-hud-muted">
                        <b className="font-medium text-hud-text">{shown.v}%</b> · {agoText(end - shown.t)}
                    </span>
                ) : (
                    <span className="font-mono text-[11.5px] tabular-nums text-hud-muted">
                        <b className="text-[14px] font-medium text-hud-text">{props.figure}</b>
                        {props.detail != null ? ` · ${props.detail}` : ""}
                    </span>
                )}
            </div>
            <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${props.title}, the last 5 minutes: ${props.figure}`}
                className="h-[56px] w-full cursor-crosshair overflow-visible bg-hud-bg"
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
            >
                {/* the one gridline: half way, recessive */}
                <line
                    x1={0}
                    x2={W}
                    y1={H / 2}
                    y2={H / 2}
                    vectorEffect="non-scaling-stroke"
                    className="stroke-hud-line"
                    strokeWidth={1}
                    strokeDasharray="2 3"
                />
                {area !== "" && <path d={area} className="fill-hud-glow/10" />}
                {series.length > 1 && (
                    <GlowPath
                        d={line}
                        width={1.5}
                        vectorEffect="non-scaling-stroke"
                        className="stroke-hud-glow"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                )}
                {shown != null && (
                    <line
                        x1={x(shown.t)}
                        x2={x(shown.t)}
                        y1={0}
                        y2={H}
                        vectorEffect="non-scaling-stroke"
                        className="stroke-hud-muted"
                        strokeWidth={1}
                    />
                )}
            </svg>
        </div>
    );
}

/** The three charts. `memTotal` words RAM's figure in GB; a machine whose GPU is not read says so in place of a chart. */
export function SidecarResourceCharts(props: {
    history: SidecarResourcePoint[];
    memTotal?: number;
    className?: string;
}) {
    const { history, memTotal } = props;
    const last = history.at(-1);
    const end = last?.t ?? Date.now();
    const cpu = history.map((p) => ({ t: p.t, v: p.cpu }));
    const mem = history.map((p) => ({ t: p.t, v: p.mem }));
    const gpu = history.flatMap((p) => (p.gpu != null ? [{ t: p.t, v: p.gpu }] : []));
    const pct = (v: number | undefined) => (v != null ? `${v}%` : "—");
    const memDetail =
        last != null && memTotal != null
            ? `${formatBytes((last.mem / 100) * memTotal)} of ${formatBytes(memTotal)}`
            : undefined;
    return (
        <div data-sidecar-charts className={cn("flex flex-col gap-2.5", props.className)}>
            <Chart title="CPU" figure={pct(last?.cpu)} series={cpu} end={end} />
            <Chart title="RAM" figure={pct(last?.mem)} detail={memDetail} series={mem} end={end} />
            {/* the GPU counters need two readings of their own: past a few, none means this machine has none to read */}
            {history.length >= 3 && gpu.length === 0 ? (
                <div data-sidecar-chart="gpu" className="text-[11.5px] text-hud-muted">
                    GPU: this machine has no GPU counters to read.
                </div>
            ) : (
                <Chart title="GPU" figure={pct(last?.gpu)} series={gpu} end={end} />
            )}
        </div>
    );
}
