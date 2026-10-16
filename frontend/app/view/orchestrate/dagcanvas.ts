// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Route DAG canvas as data: what a node says about its task, how an edge is drawn, where a key
// moves the selection, and how the graph opens. Ported from the design canvas (dag-visualizer/Main.dc.html).

import { firstLine, formatElapsed } from "./dagdigest";
import type { Rect } from "./daglayout";

type Point = { x: number; y: number };
type TaskState = Pick<TaskNode, "state" | "gate">;

export type NodeKind = "attention" | "live" | "ready" | "done" | "inert" | "waiting";

const KIND = new Map<string, NodeKind>([
    ["pending", "waiting"],
    ["ready", "ready"],
    ["running", "live"],
    ["verifying", "live"],
    ["reviewing", "live"],
    ["done", "done"],
    ["failed", "attention"],
    ["stalled", "attention"],
    ["blocked-merge", "attention"],
    ["verify-failed", "attention"],
    ["review-failed", "attention"],
    ["cancelled", "inert"],
    ["skipped", "inert"],
]);

const WORD = new Map<string, string>([
    ["blocked-merge", "merge blocked"],
    ["verify-failed", "verify failed"],
    ["review-failed", "review failed"],
]);

function atGate(t: TaskState): boolean {
    return !!t.gate && t.state === "done";
}

export function kindOf(t: TaskState): NodeKind {
    return atGate(t) ? "attention" : (KIND.get(t.state) ?? "waiting");
}

export function wordOf(t: TaskState): string {
    return atGate(t) ? "at gate" : (WORD.get(t.state) ?? t.state);
}

export type GlyphKind =
    | "done"
    | "failed"
    | "stalled"
    | "attention"
    | "running"
    | "live"
    | "ready"
    | "inert"
    | "waiting";

export function glyphKind(t: TaskState): GlyphKind {
    const k = kindOf(t);
    if (k === "done") return "done";
    if (t.state === "failed") return "failed";
    if (t.state === "stalled") return "stalled";
    if (k === "attention") return "attention";
    if (t.state === "running") return "running";
    if (k === "live") return "live";
    if (k === "ready") return "ready";
    if (k === "inert") return "inert";
    return "waiting";
}

// the engine lets the dependents of a skipped task start, so a skipped dependency counts as finished
function isFinished(t: Pick<TaskNode, "state">): boolean {
    return t.state === "done" || t.state === "skipped";
}

const MAX_NAMED_DEPS = 4;

export type FactCtx = {
    byId: Map<string, TaskNode>;
    digest: DagTaskDigest | undefined;
    mergeReady: ReadonlySet<string>;
    nowMs: number;
};

function waitingFact(t: TaskNode, ctx: FactCtx): string {
    if (ctx.digest?.waitreason === "ask") return "asked you";
    if (ctx.digest?.waitreason === "lead-ask") return "asked the lead";
    const open = (t.deps ?? []).filter((d) => {
        const dep = ctx.byId.get(d);
        return dep != null && !isFinished(dep);
    });
    if (open.length === 0) return "next to start";
    return open.length > MAX_NAMED_DEPS ? `waits on ${open.length} tasks` : `waits on ${open.join(", ")}`;
}

// factOf is the one fact a node card states after its id and state word (spec D2)
export function factOf(t: TaskNode, ctx: FactCtx): string {
    switch (t.state) {
        case "running": {
            const elapsed = t.firstactivity ? formatElapsed(Math.max(0, ctx.nowMs - t.firstactivity)) : "starting";
            const tool = ctx.digest?.latesttool || t.latesttool;
            const attempt = (t.attempts ?? 0) > 1 ? `attempt ${t.attempts}` : "";
            return [elapsed, tool, attempt].filter(Boolean).join(" · ");
        }
        case "verifying":
            return "Verify running";
        case "reviewing":
            // numbered as taskPeek numbers it
            return `review round ${(t.reviewround ?? 0) + 1}`;
        case "done":
            if (t.merged) return "merged";
            return ctx.mergeReady.has(t.id) ? "merge ready" : "awaiting merge";
        case "failed":
            return `attempt ${t.attempts || 1} · retry or skip`;
        case "stalled":
            return t.lastactivity
                ? `idle ${formatElapsed(Math.max(0, ctx.nowMs - t.lastactivity))} · retry or skip`
                : "idle · retry or skip";
        case "verify-failed":
            return firstLine(t.verifyerror) || "resolve after your fix";
        case "blocked-merge":
            return "conflict · resolve";
        case "review-failed":
            return "approve or send back";
        case "skipped":
            return "skipped by you";
        case "cancelled":
            return "run cancelled";
        default:
            return waitingFact(t, ctx);
    }
}

export type Relatives = { up: Set<string>; down: Set<string> };

// relatives walks ancestors and descendants; deps naming an unknown task are ignored, and the visited
// sets keep a hand-edited cycle from recursing forever
export function relatives(tasks: { id: string; deps?: string[] }[], id: string): Relatives {
    const known = new Set(tasks.map((t) => t.id));
    const depsOf = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    for (const t of tasks) {
        const deps = (t.deps ?? []).filter((d) => known.has(d));
        depsOf.set(t.id, deps);
        for (const d of deps) dependents.set(d, [...(dependents.get(d) ?? []), t.id]);
    }
    const walk = (from: string, next: Map<string, string[]>, seen: Set<string>) => {
        for (const n of next.get(from) ?? []) {
            if (seen.has(n)) continue;
            seen.add(n);
            walk(n, next, seen);
        }
    };
    const up = new Set<string>();
    const down = new Set<string>();
    walk(id, depsOf, up);
    walk(id, dependents, down);
    return { up, down };
}

export type EdgeFocus = { id: string; rel: Relatives; selected: boolean };
export type EdgeKind = "path" | "needs-you" | "waiting" | "live" | "satisfied";
export type EdgeStyle = { kind: EdgeKind; dashed: boolean; faded: boolean };

function baseEdge(src: TaskNode, dst: TaskNode): EdgeStyle {
    const dk = kindOf(dst);
    if (dk === "attention") return { kind: "needs-you", dashed: true, faded: false };
    if (!isFinished(src)) return { kind: "waiting", dashed: true, faded: false };
    if (dk === "live") return { kind: "live", dashed: false, faded: false };
    return { kind: "satisfied", dashed: false, faded: false };
}

export function edgeStyle(src: TaskNode, dst: TaskNode, focus: EdgeFocus | null): EdgeStyle {
    const base = baseEdge(src, dst);
    if (focus == null) return base;
    const { up, down } = focus.rel;
    const upstream = (dst.id === focus.id || up.has(dst.id)) && up.has(src.id);
    const downstream = (src.id === focus.id || down.has(src.id)) && down.has(dst.id);
    if (upstream || downstream) return { ...base, kind: "path" };
    return { ...base, faded: focus.selected };
}

export const ZOOM_FLOOR = 0.85;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 1.2;
export const FIT_PAD = 20;

export type GraphKeyCtx = {
    tasks: { id: string; deps?: string[] }[];
    selected: string | null;
    layer: Map<string, number>;
    pos: Map<string, Point>;
};
export type GraphKeyResult =
    | { kind: "select"; id: string }
    | { kind: "fit" }
    | { kind: "zoom"; factor: number }
    | { kind: "none" };

const NONE: GraphKeyResult = { kind: "none" };

// graphKey is where a key moves the selection. Enter and Escape are not here: they act on the modal.
export function graphKey(key: string, ctx: GraphKeyCtx): GraphKeyResult {
    switch (key) {
        case "f":
            return { kind: "fit" };
        case "+":
        case "=":
            return { kind: "zoom", factor: ZOOM_STEP };
        case "-":
            return { kind: "zoom", factor: 1 / ZOOM_STEP };
        case "j":
        case "k":
        case "ArrowRight":
        case "ArrowLeft":
        case "ArrowDown":
        case "ArrowUp":
            return moveTo(key, ctx);
        default:
            return NONE;
    }
}

function moveTo(key: string, ctx: GraphKeyCtx): GraphKeyResult {
    const { tasks, layer, pos } = ctx;
    const ids = tasks.map((t) => t.id);
    const cur = ctx.selected != null && ids.includes(ctx.selected) ? ctx.selected : null;
    const pick = (id: string | undefined): GraphKeyResult => (id == null || id === cur ? NONE : { kind: "select", id });
    if (cur == null) return pick(ids[0]);
    const yOf = (id: string) => pos.get(id)?.y ?? 0;
    const curY = yOf(cur);
    // candidates arrive in plan order and the sort is stable, so a tie in y goes to the earlier task
    const nearest = (cands: string[]) => cands.sort((a, b) => Math.abs(yOf(a) - curY) - Math.abs(yOf(b) - curY))[0];
    const i = ids.indexOf(cur);
    switch (key) {
        case "j":
            return pick(ids[Math.min(i + 1, ids.length - 1)]);
        case "k":
            return pick(ids[Math.max(i - 1, 0)]);
        case "ArrowRight":
            return pick(nearest(tasks.filter((t) => t.deps?.includes(cur)).map((t) => t.id)));
        case "ArrowLeft": {
            const deps = new Set(tasks[i].deps ?? []);
            return pick(nearest(ids.filter((id) => deps.has(id))));
        }
        default: {
            const col = ids.filter((id) => layer.get(id) === layer.get(cur)).sort((a, b) => yOf(a) - yOf(b));
            const j = col.indexOf(cur);
            return pick(col[key === "ArrowDown" ? Math.min(j + 1, col.length - 1) : Math.max(j - 1, 0)]);
        }
    }
}

export type ChipGroup = {
    key: "attention" | "live" | "done" | "waiting" | "inert";
    label: string;
    kinds: NodeKind[];
    count: number;
};

const CHIP_GROUPS: Omit<ChipGroup, "count">[] = [
    { key: "attention", label: "need you", kinds: ["attention"] },
    { key: "live", label: "working", kinds: ["live"] },
    { key: "done", label: "done", kinds: ["done"] },
    { key: "waiting", label: "waiting", kinds: ["waiting", "ready"] },
    { key: "inert", label: "skipped", kinds: ["inert"] },
];

export function chipGroups(tasks: TaskState[]): ChipGroup[] {
    const kinds = tasks.map(kindOf);
    return CHIP_GROUPS.map((g) => ({ ...g, count: kinds.filter((k) => g.kinds.includes(k)).length })).filter(
        (g) => g.count > 0
    );
}

// pickNext cycles the selection through the tasks of a chip's group, in plan order
export function pickNext(tasks: TaskNode[], kinds: NodeKind[], selected: string | null): string | null {
    const ids = tasks.filter((t) => kinds.includes(kindOf(t))).map((t) => t.id);
    if (ids.length === 0) return null;
    return ids[(ids.indexOf(selected) + 1) % ids.length];
}

// match CARD_W / CARD_H in daglayout.ts
const CARD_W = 196;
const CARD_H = 64;
// room above the top row for a lane band's label
const LANE_LABEL_H = 24;
// the pane's bottom strip that fitting keeps clear
const FIT_BOTTOM = 24;

export type Pane = { w: number; h: number };

export function fitScale(pos: Map<string, Point>, pane: Pane, hasLanes: boolean): number {
    if (pos.size === 0) return 1;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pos.values()) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x + CARD_W);
        y1 = Math.max(y1, p.y + CARD_H);
    }
    if (hasLanes) y0 -= LANE_LABEL_H;
    return Math.min(1, (pane.w - 2 * FIT_PAD) / (x1 - x0), (pane.h - 2 * FIT_PAD - FIT_BOTTOM) / (y1 - y0));
}

// openView fits the whole graph unless that would shrink it below the floor; then it opens on the tasks
// that need you, else the live ones, else the ready ones, at the floor (spec D9)
export function openView(
    tasks: TaskNode[],
    pos: Map<string, Point>,
    pane: Pane,
    hasLanes: boolean
): { fitIds: string[] | null; minZoom: number } {
    if (fitScale(pos, pane, hasLanes) >= ZOOM_FLOOR) return { fitIds: null, minZoom: ZOOM_MIN };
    for (const kind of ["attention", "live", "ready"] as NodeKind[]) {
        const ids = tasks.filter((t) => kindOf(t) === kind).map((t) => t.id);
        if (ids.length > 0) return { fitIds: ids, minZoom: ZOOM_FLOOR };
    }
    return { fitIds: null, minZoom: ZOOM_FLOOR };
}

// margins that keep a node clear of the pane's header chips and bottom controls
const VIEW_MARGIN_X = 16;
const VIEW_MARGIN_TOP = 48;
const VIEW_MARGIN_BOTTOM = 36;

// nodeInView says whether a node sits comfortably on screen, so a pane that shrank only pans when it hid it
export function nodeInView(viewport: { x: number; y: number; zoom: number }, p: Point, pane: Pane): boolean {
    const sx = viewport.x + p.x * viewport.zoom;
    const sy = viewport.y + p.y * viewport.zoom;
    return (
        sx >= VIEW_MARGIN_X &&
        sx + CARD_W * viewport.zoom <= pane.w - VIEW_MARGIN_X &&
        sy >= VIEW_MARGIN_TOP &&
        sy + CARD_H * viewport.zoom <= pane.h - VIEW_MARGIN_BOTTOM
    );
}

// selectionNeedsPan says whether opening a node's peek should pan to it: only when the node is off screen or
// the card, in pane pixels, landed over it because the pane had no room on either side
export function selectionNeedsPan(
    viewport: { x: number; y: number; zoom: number },
    p: Point,
    pane: Pane,
    card: Rect | null
): boolean {
    if (!nodeInView(viewport, p, pane)) return true;
    if (card == null) return false;
    const sx = viewport.x + p.x * viewport.zoom;
    const sy = viewport.y + p.y * viewport.zoom;
    return (
        sx < card.x + card.w &&
        card.x < sx + CARD_W * viewport.zoom &&
        sy < card.y + card.h &&
        card.y < sy + CARD_H * viewport.zoom
    );
}
