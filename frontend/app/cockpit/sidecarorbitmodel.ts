// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar dashboard's page model (spec 2026-11-17-sidecar-orbit-dashboard-design.md): everything P (the full window,
// sidecarorbit.tsx) and Q (the compact window, sidecarcompact.tsx) decide, so the two views only draw. The screen's
// state and its alert frame, the core's tone and label, a node's tone and its one line, where the nodes sit on the
// orbit, a ring's dash, a lane's bars, how a Needs you row is answered, and the keys with the selection they move.

import type {
    SidecarAct,
    SidecarNeed,
    SidecarRunBox,
    SidecarSnapshot,
    SidecarSpan,
    SidecarSpanState,
    SidecarTile,
} from "./sidecartypes";
import { ageText, answerAct, canAnswer, moveSelection, wallKey } from "./sidecarwallmodel";

// ---- The screen ----

/** The five states both layouts draw; `P-live` and `Q-compact-live` play them in turn. */
export type ScreenState = "calm" | "normal" | "high" | "critical" | "failed";
/** The edge drawn round the whole window: a 4 px `error` one, a 3 px `warning` one, or none. */
export type AlertFrame = "none" | "warning" | "error";
/** A colour token's name, the way the views map it to a class: `text-<tone>`, `bg-<tone>`. */
export type Tone = "warning" | "error" | "success" | "secondary" | "muted";

/**
 * The state the screen is in: `failed` while any need failed (a run held at Final or with a failed task), else
 * `critical` at a red strain (RAM critical), else `high` at an amber one, else `calm` when nothing waits on you.
 */
export function screenState(snap: Pick<SidecarSnapshot, "needs" | "strain">): ScreenState {
    const needs = snap.needs ?? [];
    if (needs.some((n) => n.failed === true)) {
        return "failed";
    }
    if (snap.strain?.level === "red") {
        return "critical";
    }
    if (snap.strain?.level === "amber") {
        return "high";
    }
    return needs.length === 0 ? "calm" : "normal";
}

/** The alert frame of a state: RAM critical and a failed run frame the window red, RAM high amber, the rest not. */
export function frameOf(state: ScreenState): AlertFrame {
    switch (state) {
        case "failed":
        case "critical":
            return "error";
        case "high":
            return "warning";
        default:
            return "none";
    }
}

/** The core's colour: `error` when a need failed, `muted` at 0 needs, else `warning`. */
export function coreTone(snap: Pick<SidecarSnapshot, "needs">): "error" | "muted" | "warning" {
    const needs = snap.needs ?? [];
    if (needs.some((n) => n.failed === true)) {
        return "error";
    }
    return needs.length === 0 ? "muted" : "warning";
}

/**
 * The core's line for a RAM strain, null for none and for a CPU one. The strain model only turns red at RAM critical
 * (`sidecarstrainmodel.ts`), so a red level is the critical one.
 */
export function coreLabel(snap: Pick<SidecarSnapshot, "strain">): string | null {
    const s = snap.strain;
    if (s == null || s.by !== "ram") {
        return null;
    }
    return s.level === "red" ? "⚠ RAM critical" : "⚠ RAM high";
}

// ---- A node ----

/** The agents with a question row (a finished agent whose last message asks something): they wait on you as an ask does. */
export function waitingIds(needs: readonly SidecarNeed[] | undefined): Set<string> {
    const ids = new Set<string>();
    for (const n of needs ?? []) {
        if (n.kind === "question" && n.id != null) {
            ids.add(n.id);
        }
    }
    return ids;
}

/** A node's question is cut to this many characters, the ellipsis included. */
export const NODE_QUESTION_CHARS = 32;

function cutQuestion(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    const chars = Array.from(flat);
    return chars.length <= NODE_QUESTION_CHARS ? flat : `${chars.slice(0, NODE_QUESTION_CHARS - 1).join("")}…`;
}

function dot(...parts: string[]): string {
    return parts.filter((p) => p !== "").join(" · ");
}

/**
 * The one line under a node's name. A failed agent says `failed · 4m` and an asking one `asks: merge into main? ·
 * 3m` (the question cut to 32 characters), each before anything else it is; a run's lead `run · 7 of 9 · 1h 34m` (the
 * run's age); otherwise `working · 11m`, `finished · +4005 −755` (a finished agent that changed lines) or `finished ·
 * 4m`. Ages go through `ageText`, left out when the tile or the run has no `since`.
 */
export function nodeLine(
    tile: SidecarTile,
    run: SidecarRunBox | undefined,
    snapNow: number,
    sinceArrivedMs: number
): string {
    const age = ageText(tile.since, snapNow, sinceArrivedMs);
    if (tile.failed === true) {
        return dot("failed", age);
    }
    if (tile.state === "asking") {
        const q = tile.ask == null ? "" : cutQuestion(tile.ask.question);
        return dot(q === "" ? "asks" : `asks: ${q}`, age);
    }
    if (run != null && run.leadId === tile.id) {
        return dot("run", `${run.done} of ${run.total}`, ageText(run.since, snapNow, sinceArrivedMs));
    }
    switch (tile.state) {
        case "working":
            return dot("working", age);
        case "review":
            if (tile.diff != null && (tile.diff.adds > 0 || tile.diff.dels > 0)) {
                return dot("finished", `+${tile.diff.adds} −${tile.diff.dels}`);
            }
            return dot("finished", age);
        case "idle":
            return dot("finished", age);
        default:
            return dot("asleep", age);
    }
}

/**
 * A node's colour: `error` when it failed, `warning` when it asks or has a question row (`waiting`: the agents with
 * one, `waitingIds`), `success` working, `secondary` finished, `muted` asleep (never drawn in the orbit).
 */
export function nodeTone(tile: SidecarTile, waiting: ReadonlySet<string>): Tone {
    if (tile.failed === true) {
        return "error";
    }
    if (tile.state === "asking" || waiting.has(tile.id)) {
        return "warning";
    }
    switch (tile.state) {
        case "working":
            return "success";
        case "review":
        case "idle":
            return "secondary";
        default:
            return "muted";
    }
}

/** Whether a node pings: while it waits on you (`warning`) or has failed (`error`). */
export function pings(tile: SidecarTile, waiting: ReadonlySet<string>): boolean {
    const tone = nodeTone(tile, waiting);
    return tone === "warning" || tone === "error";
}

// ---- Geometry ----

export interface Point {
    x: number;
    y: number;
}

/** `n` points on the ellipse centred at (`cx`, `cy`), the first at the top, evenly spaced clockwise. */
export function orbitPoints(n: number, cx: number, cy: number, rx: number, ry: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < n; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    }
    return points;
}

/** `stroke-dasharray` for a ring of radius `r` filled to `pct` (clamped to 0..100; none known: empty). */
export function ringDash(pct: number | undefined, r: number): { dash: number; gap: number } {
    const circumference = 2 * Math.PI * r;
    const share = pct == null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct));
    const dash = (circumference * share) / 100;
    return { dash, gap: circumference - dash };
}

/** The timeline's window: the last 2 hours. */
export const TIMELINE_WINDOW_MS = 2 * 60 * 60_000;
/** The narrowest bar a span draws, px. */
export const MIN_BAR_PX = 2;

export interface LaneBar {
    x: number;
    w: number;
    state: SidecarSpanState;
}

/**
 * A lane's bars: each span as `{ x, w, state }` in a lane `width` px wide that shows the 2 hours ending at `now`. A span
 * with no `to` runs to `now`; one that began before the window starts at its edge, and one that ended at or before
 * the edge is dropped (the bridge sends the spans unclipped). A bar is at least 2 px wide and stays inside the lane.
 */
export function laneBars(spans: readonly SidecarSpan[], now: number, width: number): LaneBar[] {
    if (!(width > 0)) {
        return [];
    }
    const start = now - TIMELINE_WINDOW_MS;
    const bars: LaneBar[] = [];
    for (const s of spans) {
        const to = Math.min(s.to ?? now, now);
        if (to <= start) {
            continue;
        }
        const from = Math.max(s.from, start);
        if (to < from) {
            continue;
        }
        const w = Math.max(MIN_BAR_PX, ((to - from) * width) / TIMELINE_WINDOW_MS);
        const x = Math.min(((from - start) * width) / TIMELINE_WINDOW_MS, Math.max(0, width - w));
        bars.push({ x, w, state: s.state });
    }
    return bars;
}

// ---- Needs you ----

/** The tile-shaped view of an ask row, so `canAnswer` and `answerAct` (the keys' rules) judge it as they do a tile's ask. */
function askOf(need: SidecarNeed): Pick<SidecarTile, "id" | "ask" | "sent"> | undefined {
    if (need.kind !== "ask" || need.id == null) {
        return undefined;
    }
    return {
        id: need.id,
        sent: need.sent,
        ask: {
            question: need.text,
            options: need.options ?? [],
            answerable: need.answerable === true,
            key: need.askKey,
        },
    };
}

/** How many options `needHow` lists before it leaves the rest to their keys. */
export const NEED_HOW_OPTIONS = 4;

/**
 * How a Needs you row is answered: an answerable ask lists its first four options by key (`1 Merge · 2 Keep the
 * branch`), a sent one says `Sent`, any other ask and a question are answered in the main window, a Jarvis row opens there.
 */
export function needHow(need: SidecarNeed): string {
    if (need.kind === "jarvis") {
        return "Enter: open in the main window";
    }
    if (need.kind === "ask") {
        if (need.sent === true) {
            return "Sent";
        }
        if (canAnswer(askOf(need), 0)) {
            return (need.options ?? [])
                .slice(0, NEED_HOW_OPTIONS)
                .map((o, i) => `${i + 1} ${o}`)
                .join(" · ");
        }
    }
    return "Enter: reply in the main window";
}

// ---- Keys and the selection ----

/** Which window the keys act in: P (`orbit`, the full one) or Q (`compact`). Left and right are P's alone. */
export type DashLayout = "orbit" | "compact";

/**
 * The selection: a row of Needs you or a node of the orbit, by its place in the list. `key` is the need's key or the
 * node's id: it lets the selection stay on the same row when the list changes (`selectionAfter`); one without it
 * (a fresh `{ area, index }`) is held by its index.
 */
export interface DashSel {
    area: "needs" | "orbit";
    index: number;
    key?: string;
}

export type DashKeyAction =
    | { kind: "select"; sel: DashSel }
    | Extract<SidecarAct, { kind: "open" }>
    | Extract<SidecarAct, { kind: "need" }>
    | Extract<SidecarAct, { kind: "answer" }>;

function selectNeed(needs: readonly SidecarNeed[], index: number): DashKeyAction {
    return { kind: "select", sel: { area: "needs", index, key: needs[index].key } };
}

function selectNode(nodes: readonly SidecarTile[], index: number): DashKeyAction {
    return { kind: "select", sel: { area: "orbit", index, key: nodes[index].id } };
}

/**
 * What a key does, with `sel` selected (null: none). Up and down move through Needs you and stop at the ends; from
 * none, or from a node, they go to the first row. On P left and right move through the orbit's nodes, wrapping, and
 * from none go to the first; on Q they are not its own. Enter opens the selected ask's or question's agent or node's
 * agent (`open`), or a Jarvis row's target (`need`). 1-9 answers the selected row when it is an answerable, unsent
 * ask with that option (`option` 0-based: key 2 sends 1), by `answerAct`'s rules. Anything else is null.
 */
export function dashKey(
    key: string,
    layout: DashLayout,
    sel: DashSel | null,
    needs: readonly SidecarNeed[],
    nodes: readonly SidecarTile[]
): DashKeyAction | null {
    const action = wallKey(key);
    if (action == null) {
        return null;
    }
    if (action.kind === "move") {
        if (action.key === "ArrowUp" || action.key === "ArrowDown") {
            if (needs.length === 0) {
                return null;
            }
            const index = sel?.area === "needs" ? moveSelection(sel.index, action.key, 1, needs.length) : 0;
            return selectNeed(needs, index);
        }
        if (layout !== "orbit" || nodes.length === 0) {
            return null;
        }
        if (sel?.area !== "orbit") {
            return selectNode(nodes, 0);
        }
        const at = Math.min(nodes.length - 1, Math.max(0, sel.index));
        const step = action.key === "ArrowRight" ? 1 : -1;
        return selectNode(nodes, (at + step + nodes.length) % nodes.length);
    }
    if (sel == null) {
        return null;
    }
    if (action.kind === "open") {
        if (sel.area === "orbit") {
            const node = nodes[sel.index];
            return node == null ? null : { kind: "open", id: node.id };
        }
        const need = needs[sel.index];
        if (need == null) {
            return null;
        }
        if (need.kind === "jarvis") {
            return { kind: "need", key: need.key };
        }
        return need.id == null ? null : { kind: "open", id: need.id };
    }
    if (sel.area !== "needs") {
        return null;
    }
    const need = needs[sel.index];
    return need == null ? null : answerAct(askOf(need), action.option);
}

/**
 * The selection after the lists changed: on the same need (by key) or node (by id) when it is still there, else on
 * the row now at its index, clamped to the new list; null with no selection or an emptied list.
 */
export function selectionAfter(
    sel: DashSel | null,
    needs: readonly SidecarNeed[],
    nodes: readonly SidecarTile[]
): DashSel | null {
    if (sel == null) {
        return null;
    }
    const keys = sel.area === "needs" ? needs.map((n) => n.key) : nodes.map((n) => n.id);
    if (keys.length === 0) {
        return null;
    }
    const at = sel.key == null ? -1 : keys.indexOf(sel.key);
    const index = at >= 0 ? at : Math.min(keys.length - 1, Math.max(0, sel.index));
    return { area: sel.area, index, key: keys[index] };
}
