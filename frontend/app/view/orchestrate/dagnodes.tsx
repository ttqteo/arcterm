// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Route DAG's rendered pieces as ReactFlow node and edge types: the task card, the final stage's card,
// the dashed lane band, and the routed edge. Ported from the design canvas (dag-visualizer/Main.dc.html).

import { Handle, Position, useInternalNode, type EdgeProps, type NodeProps } from "@xyflow/react";
import { createContext, useContext } from "react";
import type { FinalStageView, FinalTone } from "../agents/finalstage";
import { FinalStepStrip } from "../agents/finalstageviews";
import { META_TEXT } from "../jarvis/briefstyle";
import { glyphKind, kindOf, wordOf, type EdgeStyle, type GlyphKind, type NodeKind } from "./dagcanvas";
import { FINAL_NODE_ID } from "./dagfinal";
import { CARD_H, CARD_W, edgeGeo, type Point, type Rect } from "./daglayout";
import type { DagViewNode } from "./dagstore";

export type DagCardData = {
    task: TaskNode;
    view: DagViewNode;
    fact: string;
    selected: boolean;
    dimmed: boolean;
    hovered: boolean;
    onHover: (id: string | null) => void;
};

export type LaneBandData = { rect: Rect; dimmed: boolean };

export type RoutedEdgeData = { via: Point[]; style: EdgeStyle };

type Look = { bg: string; border: string; label: string; word: string };

const LOOK = new Map<NodeKind, Look>([
    ["attention", { bg: "bg-warning/10", border: "border-warning/55", label: "text-ink-hi", word: "text-warning" }],
    ["live", { bg: "bg-lane", border: "border-working/50", label: "text-ink-hi", word: "text-working" }],
    ["ready", { bg: "bg-lane", border: "border-edge-strong", label: "text-ink-hi", word: "text-accent-soft" }],
    ["done", { bg: "bg-surface", border: "border-edge-mid", label: "text-secondary", word: "text-success" }],
    ["inert", { bg: "bg-surface", border: "border-edge-mid", label: "text-muted", word: "text-muted" }],
    ["waiting", { bg: "bg-surface", border: "border-edge-mid", label: "text-ink-mid", word: "text-ink-mid" }],
]);

// the state word's tone, shared with the peek's header so the card and its node agree
export function wordTone(t: TaskNode): string {
    return (LOOK.get(kindOf(t)) ?? LOOK.get("waiting")).word;
}

const tok = (name: string) => `var(--color-${name})`;

type Glyph = { ring: string; fill: string; mark: string; markFill: string; markStroke: string };

const NO_MARK: Glyph = { ring: tok("ink-faint"), fill: "none", mark: "", markFill: "none", markStroke: "none" };
const WARN_GLYPH = { ring: tok("warning"), fill: tok("warning"), markStroke: tok("on-warning") };

const GLYPH = new Map<GlyphKind, Glyph>([
    [
        "done",
        {
            ...NO_MARK,
            ring: tok("success"),
            fill: tok("success"),
            mark: "M4.2 7.3l1.9 1.9 3.7-4.1",
            markStroke: tok("background"),
        },
    ],
    ["failed", { ...NO_MARK, ...WARN_GLYPH, mark: "M5 5l4 4M9 5l-4 4" }],
    ["stalled", { ...NO_MARK, ...WARN_GLYPH, mark: "M5.7 4.6v4.8M8.3 4.6v4.8" }],
    ["attention", { ...NO_MARK, ...WARN_GLYPH, mark: "M7 3.9v3.7M7 9.7v.5" }],
    ["running", { ...NO_MARK, ring: tok("working"), mark: "M7 4.6a2.4 2.4 0 1 0 .01 0Z", markFill: tok("working") }],
    ["live", { ...NO_MARK, ring: tok("working"), mark: "M7 1.75a5.25 5.25 0 0 1 0 10.5Z", markFill: tok("working") }],
    ["ready", { ...NO_MARK, ring: tok("accent") }],
    ["inert", { ...NO_MARK, ring: tok("muted"), mark: "M3.8 10.2l6.4-6.4", markStroke: tok("muted") }],
    ["waiting", NO_MARK],
]);

export function StateGlyph({ kind }: { kind: GlyphKind }) {
    const g = GLYPH.get(kind) ?? NO_MARK;
    return (
        <span className="relative mt-px h-[14px] w-[14px] flex-none">
            {kind === "running" ? (
                <span className="absolute -inset-[3px] rounded-full border-[1.5px] border-working pulse-soft" />
            ) : null}
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="relative block">
                <circle cx="7" cy="7" r="5.25" style={{ fill: g.fill, stroke: g.ring, strokeWidth: 1.5 }} />
                {g.mark ? (
                    <path
                        d={g.mark}
                        style={{
                            fill: g.markFill,
                            stroke: g.markStroke,
                            strokeWidth: 1.6,
                            strokeLinecap: "round",
                            strokeLinejoin: "round",
                        }}
                    />
                ) : null}
            </svg>
        </span>
    );
}

// no title attribute anywhere inside the node (spec D7): a native tooltip would open over the peek
export function DagCardNode({ data }: NodeProps) {
    const d = data as unknown as DagCardData;
    const { task, view, fact, selected, dimmed, hovered } = d;
    const kind = kindOf(task);
    const look = LOOK.get(kind) ?? LOOK.get("waiting");
    const word = wordOf(task);
    const bg = hovered && !selected && kind !== "attention" ? "bg-surface-hover" : look.bg;
    const border = selected ? "border-accent ring-1 ring-accent" : hovered ? "border-edge-strong" : look.border;
    return (
        <div
            data-dag-node={task.id}
            data-dag-node-route={`${view.route.source}:${view.route.runtime}:${view.route.model}`}
            role="button"
            aria-pressed={selected}
            aria-label={`${task.id} ${view.label}, ${word}, ${fact}`}
            onPointerEnter={() => d.onHover(task.id)}
            onPointerLeave={() => d.onHover(null)}
            style={{ width: CARD_W, height: CARD_H }}
            className={`flex cursor-grab select-none flex-col justify-between rounded-[11px] border px-2.5 py-[7px] shadow-popover-line ${bg} ${border} ${
                dimmed ? "opacity-40" : ""
            }`}
        >
            <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
            <div className="flex w-full items-start gap-2">
                <StateGlyph kind={glyphKind(task)} />
                <span className={`line-clamp-2 min-w-0 text-[12.5px] font-semibold leading-[17px] ${look.label}`}>
                    {view.label}
                </span>
            </div>
            <div className={`flex items-center gap-1.5 leading-[14px] ${META_TEXT}`}>
                <span className="min-w-0 flex-1 truncate">
                    {task.id} · <span className={look.word}>{word}</span> · {fact}
                </span>
                {view.tag ? (
                    <span className="flex-none rounded-[5px] border border-edge-mid bg-surface-raised px-[5px] text-[10px] text-accent-soft">
                        {view.tag}
                    </span>
                ) : null}
            </div>
            <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
        </div>
    );
}

export type DagFinalData = { selected: boolean };

// the stage's view reaches its card through context, not node data: the view is derived anew each render, and
// as node data it would rebuild the graph's nodes every time
export const FinalStageViewContext = createContext<FinalStageView | null>(null);

// a failed stage is amber as the graph's attention cards are: the graph has no error-toned card
const FINAL_GLYPH: Record<FinalTone, GlyphKind> = {
    wait: "waiting",
    run: "running",
    pass: "done",
    fail: "failed",
    warn: "attention",
};

export function finalGlyph(tone: FinalTone): GlyphKind {
    return FINAL_GLYPH[tone];
}

const FINAL_BORDER: Record<FinalTone, string> = {
    wait: "border-edge-strong",
    run: "border-accent/50",
    pass: "border-edge-mid",
    fail: "border-warning/55",
    warn: "border-warning/55",
};

// the final stage as the graph's last node. It is not a task: nothing drags it.
export function DagFinalNode({ data }: NodeProps) {
    const { selected } = data as unknown as DagFinalData;
    const view = useContext(FinalStageViewContext);
    if (view == null) return null;
    return (
        <div className="relative">
            <div
                data-dag-node={FINAL_NODE_ID}
                role="button"
                aria-pressed={selected}
                aria-label={`Final verification, ${view.headline}`}
                style={{ width: CARD_W, height: CARD_H }}
                className={`flex cursor-pointer select-none flex-col justify-between rounded-[11px] border bg-lane px-2.5 py-[7px] shadow-popover-line ${
                    selected ? "border-accent ring-1 ring-accent" : FINAL_BORDER[view.tone]
                }`}
            >
                <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
                <div className="flex w-full items-start gap-2">
                    <StateGlyph kind={finalGlyph(view.tone)} />
                    <span className="min-w-0 truncate text-[12.5px] font-semibold leading-[17px] text-ink-hi">
                        Final verification
                    </span>
                </div>
                <span className={`truncate leading-[14px] ${META_TEXT}`}>{view.nodeMeta}</span>
                <FinalStepStrip view={view} />
            </div>
            <span className="absolute left-0 top-full mt-[7px] whitespace-nowrap text-[10.5px] text-muted">
                on the merged result
            </span>
        </div>
    );
}

export function LaneBandNode({ data }: NodeProps) {
    const { rect, dimmed } = data as unknown as LaneBandData;
    return (
        <div
            style={{ width: rect.w, height: rect.h }}
            className={`pointer-events-none rounded-2xl border border-dashed border-edge-mid ${dimmed ? "opacity-40" : ""}`}
        >
            <div className="px-2.5 py-[5px] text-[10.5px] text-muted">lane · one merge</div>
        </div>
    );
}

const EDGE_STROKE = new Map<EdgeStyle["kind"], string>([
    ["satisfied", tok("ink-faint")],
    ["waiting", tok("ink-faint")],
    ["live", tok("working")],
    ["needs-you", `color-mix(in srgb, ${tok("warning")} 70%, transparent)`],
    ["path", tok("accent-soft")],
]);

function edgeDash(style: EdgeStyle): string {
    if (style.kind === "waiting") return "4 4";
    if (style.kind === "needs-you" || (style.kind === "path" && style.dashed)) return "5 4";
    return "none";
}

// the endpoints are read live rather than from the layout, so a dragged node's edges follow it
export function RoutedEdge({ source, target, data }: EdgeProps) {
    const { via, style } = data as unknown as RoutedEdgeData;
    const src = useInternalNode(source);
    const dst = useInternalNode(target);
    if (src == null || dst == null) return null;
    const geo = edgeGeo(src.internals.positionAbsolute, dst.internals.positionAbsolute, via);
    const stroke = EDGE_STROKE.get(style.kind) ?? tok("ink-faint");
    return (
        <g style={{ opacity: style.faded ? 0.2 : 1 }}>
            <path
                d={geo.d}
                style={{
                    fill: "none",
                    stroke,
                    strokeWidth: style.kind === "path" ? 2 : 1.5,
                    strokeDasharray: edgeDash(style),
                }}
            />
            <path d={geo.head} style={{ fill: stroke, stroke: "none" }} />
        </g>
    );
}

export const dagNodeTypes = { dagTask: DagCardNode, dagFinal: DagFinalNode, laneBand: LaneBandNode };
export const dagEdgeTypes = { routed: RoutedEdge };
