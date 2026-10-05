// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Route DAG's rendered pieces as ReactFlow node and edge types: the task card with its hover peek, the
// dashed lane band, and the routed edge. Ported from the design canvas (dag-visualizer/Main.dc.html).

import { Tooltip } from "@/app/element/tooltip";
import { Handle, Position, useInternalNode, type EdgeProps, type NodeProps } from "@xyflow/react";
import { atom, useAtomValue, type Atom } from "jotai";
import { runAtom } from "../agents/channelsstore";
import { InlineMarkdown } from "../agents/inlinemarkdown";
import { ActivityLine } from "../agents/statusline";
import { META_TEXT } from "../jarvis/briefstyle";
import { glyphKind, kindOf, wordOf, type EdgeStyle, type GlyphKind, type NodeKind } from "./dagcanvas";
import { descriptionLead } from "./dagdescription";
import type { TaskBrief } from "./dagdigest";
import { CARD_H, CARD_W, edgeGeo, type Point, type Rect } from "./daglayout";
import { dagModalAgentsContextAtom } from "./dagmodalstate";
import { taskPeek } from "./dagpeek";
import type { DagViewNode } from "./dagstore";
import { resolveTaskWorker } from "./taskcorrelate";

// how long the pointer rests on a node before its peek appears: long enough that sweeping across the
// graph does not flash a card per node
export const PEEK_OPEN_DELAY_MS = 400;

export type DagCardData = {
    task: TaskNode;
    view: DagViewNode;
    fact: string;
    selected: boolean;
    dimmed: boolean;
    hovered: boolean;
    // undefined while the digest is missing or stale: the peek then makes no digest claim
    digestTask: DagTaskDigest | undefined;
    briefs: Map<string, TaskBrief>;
    onHover: (id: string | null) => void;
};

export type LaneBandData = { rect: Rect; dimmed: boolean };

export type RoutedEdgeData = { via: Point[]; style: EdgeStyle };

type Look = { bg: string; border: string; label: string; word: string };

const LOOK = new Map<NodeKind, Look>([
    ["attention", { bg: "bg-warning/10", border: "border-warning/55", label: "text-ink-hi", word: "text-warning" }],
    ["live", { bg: "bg-lane", border: "border-accent/50", label: "text-ink-hi", word: "text-accent-soft" }],
    ["ready", { bg: "bg-lane", border: "border-edge-strong", label: "text-ink-hi", word: "text-accent-soft" }],
    ["done", { bg: "bg-surface", border: "border-edge-mid", label: "text-secondary", word: "text-success" }],
    ["inert", { bg: "bg-surface", border: "border-edge-mid", label: "text-muted", word: "text-muted" }],
    ["waiting", { bg: "bg-surface", border: "border-edge-mid", label: "text-ink-mid", word: "text-ink-mid" }],
]);

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
    ["running", { ...NO_MARK, ring: tok("accent"), mark: "M7 4.6a2.4 2.4 0 1 0 .01 0Z", markFill: tok("accent") }],
    ["live", { ...NO_MARK, ring: tok("accent"), mark: "M7 1.75a5.25 5.25 0 0 1 0 10.5Z", markFill: tok("accent") }],
    ["ready", { ...NO_MARK, ring: tok("accent") }],
    ["inert", { ...NO_MARK, ring: tok("muted"), mark: "M3.8 10.2l6.4-6.4", markStroke: tok("muted") }],
    ["waiting", NO_MARK],
]);

function StateGlyph({ kind }: { kind: GlyphKind }) {
    const g = GLYPH.get(kind) ?? NO_MARK;
    return (
        <span className="relative mt-px h-[14px] w-[14px] flex-none">
            {kind === "running" ? (
                <span className="absolute -inset-[3px] rounded-full border-[1.5px] border-accent pulse-soft" />
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
        <Tooltip
            placement="right"
            openDelay={PEEK_OPEN_DELAY_MS}
            content={<TaskPeekCard task={task} digestTask={d.digestTask} briefs={d.briefs} />}
        >
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
        </Tooltip>
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
    ["live", tok("accent")],
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

export const dagNodeTypes = { dagTask: DagCardNode, laneBand: LaneBandNode };
export const dagEdgeTypes = { routed: RoutedEdge };

// TaskPeekCard is the hover peek: the description's lead, the rows taskPeek derives, plus the worker's live
// activity line while it is working. It mounts only while the peek is open, so only a hovered node's child
// run is loaded.
function TaskPeekCard({
    task,
    digestTask,
    briefs,
}: {
    task: TaskNode;
    digestTask: DagTaskDigest | undefined;
    briefs: Map<string, TaskBrief>;
}) {
    const childRun = useAtomValue<Run | undefined>(
        (task.runid ? runAtom(task.runid) : NO_RUN_ATOM) as Atom<Run | undefined>
    );
    const agentsCtx = useAtomValue(dagModalAgentsContextAtom);
    const worker = resolveTaskWorker({ id: task.id, runid: task.runid }, childRun, agentsCtx?.agents ?? []);
    // the shared 1s ticker drives the Verify elapsed; without the roster context there is no ticker
    const tick = useAtomValue(agentsCtx?.model.nowAtom ?? NO_TICK_ATOM);
    const peek = taskPeek(task, digestTask, briefs, tick || Date.now());
    const { lead, more } = descriptionLead(task.description);
    return (
        <div data-dag-peek={task.id} className="flex w-[290px] flex-col gap-[5px] py-0.5">
            <div className="text-[13px] font-semibold leading-[17px] text-ink-hi">{peek.title}</div>
            {lead ? (
                <div className="line-clamp-4 text-[11.5px] text-secondary">
                    <InlineMarkdown text={lead} plainLinks />
                </div>
            ) : null}
            {worker.agent && agentsCtx ? <ActivityLine agent={worker.agent} nowAtom={agentsCtx.model.nowAtom} /> : null}
            {peek.rows.map((row, i) => (
                <div
                    key={i}
                    className={`text-[10.5px] leading-[14px] tabular-nums ${
                        row.tone === "warning" ? "text-warning" : "text-muted"
                    }`}
                >
                    {row.text}
                </div>
            ))}
            {peek.verify ? (
                <div data-dag-peek-verify={task.id} className="flex flex-col gap-[3px]">
                    <div className={META_TEXT}>{peek.verify.heading}</div>
                    {peek.verify.tail ? (
                        <pre
                            className={`m-0 max-h-[110px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-edge-mid bg-surface-code px-2 py-1.5 font-mono text-[10.5px] leading-[14px] ${
                                peek.verify.tone === "warning" ? "text-warning" : "text-secondary"
                            }`}
                        >
                            {peek.verify.tail}
                        </pre>
                    ) : null}
                </div>
            ) : null}
            <div className="text-[10.5px] leading-[14px] text-muted">
                {more
                    ? "click to select and read the full description · double-click opens its worker"
                    : "click to select · double-click to open its worker"}
            </div>
        </div>
    );
}

// stable no-run atom for a task that has not been dispatched (runAtom is oref-cached, so per-run atoms keep
// identity across renders; a static Atom is needed for the no-run slot so the hook count never varies)
const NO_RUN_ATOM = atom<Run | undefined>(undefined);
const NO_TICK_ATOM = atom(0);
