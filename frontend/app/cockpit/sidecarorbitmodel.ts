// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar dashboard's page model (spec 2026-11-17-sidecar-orbit-dashboard-design.md): everything P (the full window,
// sidecarorbit.tsx) and Q (the compact window, sidecarcompact.tsx) decide, so the two views only draw. The screen's
// state and its alert frame, the core's tone and label, a node's tone and its one line, where the nodes sit on the
// orbit, a ring's dash, a lane's bars, how a Needs you row is answered, and the keys with the selection they move.

import { ageText, answerAct, canAnswer, moveSelection, sidecarKey } from "./sidecarkeys";
import type { SidecarAct, SidecarNeed, SidecarRunBox, SidecarSnapshot, SidecarTile } from "./sidecartypes";

// ---- The screen ----

/** The five states both layouts draw; `P-live` and `Q-compact-live` play them in turn. */
export type ScreenState = "calm" | "normal" | "high" | "critical" | "failed";
/** The edge drawn round the whole window: a 4 px `error` one, a 3 px `warning` one, or none. */
export type AlertFrame = "none" | "warning" | "error";
/** A colour token's name, the way the views map it to a class: `text-<tone>`, `bg-<tone>`. */
export type Tone = "warning" | "error" | "success" | "secondary" | "muted";

/**
 * The state the screen is in: `failed` while any need failed (a task that failed and can be retried), else
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

/** The alert frame of a state: RAM critical and a failed task frame the window red, RAM high amber, the rest not. */
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

/**
 * Why the alert frame is up, in one line, for a view that covers what shows the cause (the small form's Resources
 * view): a failed task first, as the frame ranks it, then the strain. Null while the frame is down.
 */
export function frameReason(snap: Pick<SidecarSnapshot, "needs" | "strain">): string | null {
    const failed = (snap.needs ?? []).filter((n) => n.failed === true);
    if (failed.length > 0) {
        const more = failed.length > 1 ? ` (+${failed.length - 1} more)` : "";
        return `Task failed${more}: ${failed[0].text}`;
    }
    const s = snap.strain;
    if (s == null) {
        return null;
    }
    const what = `${s.by === "ram" ? "RAM" : "CPU"} ${s.level === "red" ? "critical" : "high"}`;
    return s.level === "red"
        ? `${what}: the machine is about to run out of memory`
        : `${what}: the machine is strained`;
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
    runs: readonly SidecarRunBox[] | undefined,
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
    const run = runs?.find((r) => r.leadId === tile.id);
    if (run != null) {
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

/**
 * Whether a node pings: while it waits on you (`warning`) or has failed (`error`). An ask whose answer went out
 * (`sent`) no longer waits, so it stops; a failed one keeps pinging.
 */
export function pings(tile: SidecarTile, waiting: ReadonlySet<string>): boolean {
    const tone = nodeTone(tile, waiting);
    return tone === "error" || (tone === "warning" && tile.sent !== true);
}

/** Whether a Needs you row's dot pings: the same rule as a node's, so a sent ask stops and a failed row keeps on. */
export function needPings(need: SidecarNeed): boolean {
    return need.failed === true || need.sent !== true;
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

/** A row's age in words: how late a chunk past its due day is, how long anything else has waited. */
export function needAge(need: Pick<SidecarNeed, "late">, age: string): string {
    if (age === "") {
        return "";
    }
    return need.late === true ? `${age} late` : `${age} ago`;
}

/** One button of a Needs you row: what it says and the act it sends. */
export interface NeedButton {
    key: string;
    label: string;
    act: SidecarAct;
    strong: boolean; // the act that settles the row, drawn filled
}

/**
 * A Needs you row's buttons. An answerable, unsent ask: its first NEED_HOW_OPTIONS options, which 1-9 also send. A
 * Jarvis row: the acts the bridge gave it (Accept, Approve, Retry, Work on, a rule's Accept and Dismiss, Open). Any
 * other ask and a question: Open, as Enter does. A sent ask has none.
 */
export function needButtons(need: SidecarNeed): NeedButton[] {
    if (need.kind === "jarvis") {
        return (need.acts ?? []).map((a) => ({
            key: a.id,
            label: a.label,
            act: { kind: "needact", key: need.key, act: a.id },
            strong: a.strong === true,
        }));
    }
    if (need.id == null || (need.kind === "ask" && need.sent === true)) {
        return [];
    }
    const ask = askOf(need);
    if (ask != null && canAnswer(ask, 0)) {
        const buttons: NeedButton[] = [];
        (need.options ?? []).slice(0, NEED_HOW_OPTIONS).forEach((o, i) => {
            const act = answerAct(ask, i);
            if (act != null) {
                buttons.push({ key: `answer:${i}`, label: `${i + 1} ${o}`, act, strong: false });
            }
        });
        return buttons;
    }
    return [{ key: "open", label: "Open", act: { kind: "open", id: need.id }, strong: false }];
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
    const action = sidecarKey(key);
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

/** The Runs box shows at most this many rows; the rest are one summary line. */
export const RUNS_SHOWN = 3;

/** What the summary line under the rows counts: the runs left out, how many of them failed and how many still work. */
export interface RunsMore {
    count: number;
    failed: number;
    working: number;
}

/**
 * The Runs box's rows and its summary line: the first `cap` runs (the snapshot puts the failed first, so a failed run
 * is cut only when more than `cap` failed), and the rest counted, never dropped without a word. No summary when every
 * run is shown.
 */
export function runsShown(
    runs: readonly SidecarRunBox[] | undefined,
    cap: number = RUNS_SHOWN
): { rows: SidecarRunBox[]; more: RunsMore | null } {
    const all = runs ?? [];
    const rows = all.slice(0, cap);
    const rest = all.slice(cap);
    if (rest.length === 0) {
        return { rows, more: null };
    }
    const failed = rest.filter((r) => r.failed).length;
    return { rows, more: { count: rest.length, failed, working: rest.length - failed } };
}

/**
 * The small form's one run line: one run reads `Run 7 of 9 · 1h 34m` (a failed one `failed` where its age would be,
 * the age left out when it has no `since`); several read `Runs 3`, with `· 1 failed` when any failed.
 */
export function runsLine(runs: readonly SidecarRunBox[], firstAge: string): string {
    if (runs.length === 1) {
        const run = runs[0];
        const tail = run.failed ? "failed" : firstAge;
        return `Run ${run.done} of ${run.total}${tail === "" ? "" : ` · ${tail}`}`;
    }
    const failed = runs.filter((r) => r.failed).length;
    return dot(`Runs ${runs.length}`, failed > 0 ? `${failed} failed` : "");
}
