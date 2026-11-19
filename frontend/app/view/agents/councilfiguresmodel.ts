// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council's six figures draw (docs/superpowers/plans/2026-11-19-council-figures.md), derived from the `Council`
// the cockpit already holds, and from the bench's rows for the benchmark: the glance quadrant (A), the stance grid (B),
// what each seat spent (C), when each seat worked (D), the argument map (E) and the benchmark chart (F). Every number and
// every takeaway is computed; no model call words a figure. Pure, no React, no Wave runtime imports.
//
// The types below are the contract the views (councilglancefigures.tsx, councilspendfigures.tsx, councilargumentmap.tsx,
// councilbenchchart.tsx) are built against. A function returns `null` when its figure has nothing to show, and the view
// then draws no frame. The section predicates (`hasGlanceFigures`, `hasSpendFigures`) are in councilsummarymodel.ts,
// which never imports this file. The glance quadrant and the swimlane stretches follow pkg/council/charts.go
// (`directionPoint`, `glancePlaced`, `workSpans`) and are held to it by pkg/council/testdata/glance-golden.json.

import { listNames } from "./councildiscussionmodel";
import { checkLabelOf, panel, sentProposals, sentReplies } from "./councilmodel";
import { hasGlanceFigures, isBrainstorm } from "./councilsummarymodel";

/** Go's MaxTimelineSteps (pkg/council/types.go), which no generated file carries; the model's golden test holds it equal. */
export const MAX_TIMELINE_STEPS = 200;

/** The argument map's geometry, in px, shared by the model and the view so the edges are drawn in one pass from
 *  `GraphIdea.y` and a seat row's top (`index * GRAPH_ROW_PX`) without measuring the DOM. */
export const GRAPH_ROW_PX = 28; // an idea row and a seat row
export const GRAPH_HEADING_PX = 28; // a group heading row, in the right column above its ideas
export const GRAPH_SEAT_TOP_PX = 0; // the seat column's first row's top

export type FigureStance = "accept" | "challenge" | "oppose";
export type CellKind = "proposed" | FigureStance | "builds" | "none";

/** `x` and `y` are where the point is drawn, each from 0 to 1 (the quadrant's own scale): the coordinates
 *  `glancePlaced` gives in Go, kept off the edges and nudged off a point already placed. `held / evidence` is the
 *  evidence axis and `backers / sides` the agreement axis, before any clamping; `hollow` is `evidence === 0`. */
export type GlancePoint = {
    rank: number;
    title: string;
    x: number;
    y: number;
    hollow: boolean;
    held: number;
    evidence: number;
    backers: number;
    sides: number;
};
export type StanceCell = { seat: string; kind: CellKind };
export type StanceRow = {
    rank: number;
    title: string;
    cells: StanceCell[];
    backers: number;
    sides: number;
    agreed: boolean;
};

export type SpendRow = {
    id: string | null; // null: the "Memory check · outside the seats" row
    name: string;
    model: string;
    tokens: number;
    calls: number;
    perCall: number;
    ms: number;
    coordinator: boolean;
};

export type StepShape = "tick" | "dot" | "square" | "flag";
export type LaneStep = { ts: number; shape: StepShape; target: string; shared: boolean };
export type LaneSpan = { start: number; end: number; steps: number; top: string[] };
export type Lane = { seat: CouncilExpert; spans: LaneSpan[]; steps: LaneStep[]; capped: boolean };
export type RoundMark = { round: number; ts: number };
export type SharedRead = { path: string; seats: string[]; reads: number }; // `seats` holds expert ids

export type GraphSeat = { id: string; name: string; replies: number; you: boolean };
/** `label` is the idea's check label key (`ran`, `disproved`, `read`, `guess`, or `""` for none), which the view words in
 *  the council's language. `y` is the idea row's top in px from the column top: the group headings and the idea rows
 *  summed in group order (`GRAPH_HEADING_PX`, `GRAPH_ROW_PX`). */
export type GraphIdea = { id: string; title: string; label: string; merged: boolean; dim: boolean; y: number };
export type IdeaGroup = { key: string; heading: string; ideas: GraphIdea[] };
/** A seat's edge to an idea. The person's replies carry no stance, so `you`'s edges are `stance: "proposed"`, the one
 *  neutral solid style the type has: a view labels one by `seat === "you"` ("replied"), not "proposed". */
export type GraphEdge = { seat: string; idea: string; stance: FigureStance | "proposed"; count: number };

/** `x` is `log10(tokens per run)`, `y` the share of the key lines found, from 0 to 1. */
export type BenchPoint = {
    harness: string;
    variant: string;
    mode: string;
    x: number;
    y: number;
    hollow: boolean;
    newest: boolean;
    label: string;
    row: CouncilBenchRow;
};
export type BenchPanel = {
    mode: "review" | "brainstorm";
    points: BenchPoint[];
    frontier: BenchPoint[];
    takeaway: string;
};

// ---- small helpers ----

const YOU = "you";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

function asStance(s: string | undefined): FigureStance | undefined {
    return s === "accept" || s === "challenge" || s === "oppose" ? s : undefined;
}

const directionTag = (rank: number) => `D${rank}`;
const directionList = (ranks: number[]) => listNames(ranks.map(directionTag));

/** Tokens as the spend figure reads them: 3.0M from a million up, 190k, 84. */
function spendTokens(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

/** Tokens a run as the benchmark reads them: 0.3M, 1.5M, 3M, 12M; thousands below 50k. */
function benchTokens(n: number): string {
    if (n >= 10_000_000) {
        return `${Math.round(n / 1_000_000)}M`;
    }
    return n >= 50_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`;
}

// ---- A and B: the directions on evidence and agreement ----

type DirectionCounts = { held: number; evidence: number; backers: number; sides: number };

/** The counts behind `directionPoint` (pkg/council/charts.go): among the evidence of the direction's proposals, how
 *  many pieces hold (a cite Go found ok, not weak); and of the seats that took a side, how many back it: the authors of
 *  its proposals, and the other seats whose stance is accept. */
function directionCounts(c: Council, d: CouncilDirection): DirectionCounts {
    const authors = new Set<string>();
    let held = 0;
    let evidence = 0;
    for (const id of d.from) {
        const p = (c.proposals ?? []).find((x) => x.id === id);
        if (p == null) {
            continue;
        }
        authors.add(p.author);
        for (const ev of p.evidence ?? []) {
            evidence++;
            if (!ev.weak && ev.cite === "ok") {
                held++;
            }
        }
    }
    let backers = authors.size;
    let sides = authors.size;
    for (const [seat, stance] of Object.entries(d.stances ?? {})) {
        if (authors.has(seat)) {
            continue;
        }
        sides++;
        if (stance === "accept") {
            backers++;
        }
    }
    return { held, evidence, backers, sides };
}

// Go's ChartUnit and nudge
const chartUnit = (v: number) => Math.min(Math.max(v, 0.08), 0.9);
const nudge = (v: number) => (v > 0.5 ? v - 0.05 : v + 0.05);

/** Figure A, At a glance: evidence × agreement, one point per direction (a Review's Report only). */
export function glancePoints(c: Council): { points: GlancePoint[]; takeaway: string } | null {
    if (isBrainstorm(c) || !hasGlanceFigures(c)) {
        return null;
    }
    const points: GlancePoint[] = [];
    const placed: [number, number][] = [];
    const raw: [number, number][] = [];
    // in the order the summary lists them, as Go places them: a point is nudged off the ones before it
    for (const d of c.summary!.directions) {
        const n = directionCounts(c, d);
        const rx = n.evidence > 0 ? n.held / n.evidence : 0;
        const ry = n.sides > 0 ? n.backers / n.sides : 0;
        let x = chartUnit(rx);
        let y = chartUnit(ry);
        for (let i = 0; i < 4 && placed.some((p) => Math.abs(p[0] - x) < 0.04 && Math.abs(p[1] - y) < 0.04); i++) {
            x = nudge(x);
            y = nudge(y);
        }
        placed.push([x, y]);
        raw.push([rx, ry]);
        points.push({ rank: d.rank, title: d.title, x, y, hollow: n.evidence === 0, ...n });
    }
    const stands = points.filter((_, i) => raw[i][0] >= 0.5 && raw[i][1] >= 0.5);
    const guesses = points.filter((_, i) => raw[i][0] < 0.5 && raw[i][1] < 0.5);
    let takeaway: string;
    if (stands.length === 0) {
        takeaway = "No direction stands on both checked evidence and the panel's backing";
    } else if (stands.length === points.length && points.length > 1) {
        const thinnest = Math.min(...points.map((_, i) => raw[i][1]));
        const thin = points.filter((_, i) => raw[i][1] === thinnest);
        takeaway = `All ${countWord(points.length)} directions stand on checked evidence`;
        if (thin.length < points.length) {
            const verb = thin.length === 1 ? "has" : "have";
            takeaway += `; ${directionList(thin.map((p) => p.rank))} ${verb} the thinnest backing (${thin[0].backers} of ${thin[0].sides} seats)`;
        } else {
            takeaway += " and the panel's backing";
        }
    } else {
        const verb = stands.length === 1 ? "stands" : "stand";
        takeaway = `${directionList(stands.map((p) => p.rank))} ${verb} on checked evidence and the panel's backing`;
    }
    if (guesses.length > 0) {
        takeaway += `; ${directionList(guesses.map((p) => p.rank))} ${guesses.length === 1 ? "is a guess" : "are guesses"}`;
    }
    return { points, takeaway: `${takeaway}.` };
}

/** Figure B, the stance grid: direction × seat (both modes). */
export function stanceGrid(c: Council): { seats: CouncilExpert[]; rows: StanceRow[]; takeaway: string } | null {
    if (!hasGlanceFigures(c)) {
        return null;
    }
    const seats = panel(c);
    const brainstorm = isBrainstorm(c);
    const proposals = c.proposals ?? [];
    const replies = sentReplies(c);
    const rows = [...c.summary!.directions]
        .sort((a, b) => a.rank - b.rank)
        .map((d): StanceRow => {
            const from = new Set(d.from);
            const authors = new Set(proposals.filter((p) => from.has(p.id)).map((p) => p.author));
            const cells = seats.map((seat): StanceCell => {
                const stance = asStance(d.stances?.[seat.id]);
                if (authors.has(seat.id)) {
                    return { seat: seat.id, kind: "proposed" };
                }
                if (stance != null) {
                    return { seat: seat.id, kind: stance };
                }
                const builds =
                    brainstorm &&
                    replies.some((r) => r.builds === true && r.author === seat.id && from.has(r.proposalid));
                return { seat: seat.id, kind: builds ? "builds" : "none" };
            });
            const { backers, sides } = directionCounts(c, d);
            return { rank: d.rank, title: d.title, cells, backers, sides, agreed: d.agreed !== false };
        });

    const split = rows.filter((r) => !r.agreed || r.cells.some((cell) => cell.kind === "oppose"));
    const tally = seats.map((seat) => {
        const kinds = rows.map((r) => r.cells.find((cell) => cell.seat === seat.id)?.kind);
        return {
            name: seat.name,
            oppose: kinds.filter((k) => k === "oppose").length,
            challenge: kinds.filter((k) => k === "challenge").length,
        };
    });
    // the seat with the most of a stance, the first on the panel among equals
    const most = (key: "oppose" | "challenge") =>
        tally.reduce(
            (best, t) => (t[key] > (best?.[key] ?? 0) ? t : best),
            undefined as (typeof tally)[number] | undefined
        );
    const opposer = most("oppose");
    const challenger = most("challenge");
    let takeaway =
        split.length > 0
            ? `The panel split on ${directionList(split.map((r) => r.rank))}`
            : "Every direction kept the panel's backing";
    if (opposer != null) {
        takeaway += `; ${opposer.name} opposed most (${opposer.oppose})`;
    } else if (challenger != null) {
        takeaway += `; ${challenger.name} challenged most (${challenger.challenge})`;
    }
    takeaway += ".";
    if (opposer == null) {
        takeaway += " No seat opposed a direction.";
    }
    return { seats, rows, takeaway };
}

// ---- C: what each seat spent ----

// the share of the tokens a seat spent, as a person would say it
function shareWord(share: number): string {
    if (Math.abs(share - 1 / 2) <= 0.04) {
        return "half";
    }
    if (Math.abs(share - 1 / 3) <= 0.04) {
        return "a third";
    }
    if (Math.abs(share - 1 / 4) <= 0.03) {
        return "a quarter";
    }
    return `${Math.round(share * 100)}%`;
}

/** Figure C, what each seat spent. */
export function seatSpend(
    c: Council
): { rows: SpendRow[]; total: number; calls: number; ms: number; takeaway: string } | null {
    const stats = c.stats ?? {};
    if (!Object.values(stats).some((s) => s.tokens > 0)) {
        return null;
    }
    // panel order, the coordinator last: a seat keeps its position whatever its size
    const seats = [...panel(c), ...c.experts.filter((e) => e.coordinator)].filter((e) => stats[e.id] != null);
    const rows: SpendRow[] = seats.map((e) => {
        const s = stats[e.id];
        return {
            id: e.id,
            name: e.name,
            model: e.model,
            tokens: s.tokens,
            calls: s.calls,
            perCall: s.calls > 0 ? s.tokens / s.calls : 0,
            ms: s.ms,
            coordinator: e.coordinator === true,
        };
    });
    const seatTokens = rows.reduce((n, r) => n + r.tokens, 0);
    const seatCalls = rows.reduce((n, r) => n + r.calls, 0);
    const ms = rows.reduce((n, r) => n + r.ms, 0);
    // the council counts what its memory check spent too, which no seat's stats hold: the rows always add up to the header
    const total = Math.max(c.tokens, seatTokens);
    const calls = Math.max(c.calls, seatCalls);
    if (total > seatTokens || calls > seatCalls) {
        const tokens = total - seatTokens;
        const outside = calls - seatCalls;
        rows.push({
            id: null,
            name: "Memory check · outside the seats",
            model: "",
            tokens,
            calls: outside,
            perCall: outside > 0 ? tokens / outside : 0,
            ms: 0,
            coordinator: false,
        });
    }

    const seatRows = rows.filter((r) => r.id !== null);
    if (seatRows.length === 0) {
        return null; // the tokens are in stats of ids that are no seat of this council
    }
    const biggest = seatRows.reduce((best, r) => (r.tokens > best.tokens ? r : best), seatRows[0]);
    const share = biggest.tokens / total;
    let takeaway = "The seats spent alike.";
    if (share >= 0.25) {
        takeaway = `${biggest.name} spent ${shareWord(share)} of the tokens (${spendTokens(biggest.tokens)} of ${spendTokens(total)})`;
        const nextPerCall = Math.max(0, ...seatRows.filter((r) => r !== biggest).map((r) => r.perCall));
        if (nextPerCall > 0 && biggest.perCall >= 2 * nextPerCall) {
            takeaway += `, at ${spendTokens(biggest.perCall)} a call: over twice any other seat`;
        }
        takeaway += ".";
    }
    return { rows, total, calls, ms, takeaway };
}

// ---- D: when each seat worked ----

const STEP_SHAPE: Record<string, StepShape> = {
    read: "tick",
    search: "dot",
    run: "square",
    propose: "flag",
    reply: "flag",
};

// Go's chartGap and chartMinSpan: a pause over a minute ends a stretch, and a stretch of one step is drawn 5 s wide
const CHART_GAP_MS = 60_000;
const CHART_MIN_SPAN_MS = 5_000;
const SHARED_ROWS = 8;
const TOP_TARGETS = 3;

const toSlash = (target: string) => target.trim().replace(/\\/g, "/");
// a read as seats are compared on it: a slash path, case folded (Go's readKey)
const readKey = (target: string) => toSlash(target).toLowerCase();
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

type Stretch = { start: number; end: number; steps: number; reads: Map<string, { target: string; n: number }> };

// Go's workSpans: a seat's steps, oldest first, cut into stretches with no pause over a minute; a step with no time is
// no part of one. Each stretch keeps its reads, to name the files it read most.
function stretchesOf(steps: CouncilStep[]): Stretch[] {
    const out: Stretch[] = [];
    for (const s of steps) {
        if (!(s.ts > 0)) {
            continue;
        }
        let cur = out[out.length - 1];
        if (cur != null && s.ts - cur.end <= CHART_GAP_MS) {
            cur.end = Math.max(cur.end, s.ts);
            cur.steps++;
        } else {
            cur = { start: s.ts, end: s.ts, steps: 1, reads: new Map() };
            out.push(cur);
        }
        if (s.kind === "read") {
            const key = readKey(s.target);
            const seen = cur.reads.get(key);
            if (seen != null) {
                seen.n++;
            } else {
                cur.reads.set(key, { target: toSlash(s.target), n: 1 });
            }
        }
    }
    for (const sp of out) {
        sp.end = Math.max(sp.end, sp.start + CHART_MIN_SPAN_MS);
    }
    return out;
}

type SharedEntry = SharedRead & { key: string };

/** Figure D, when each seat worked and what it read twice. */
export function seatLanes(c: Council): {
    lanes: Lane[];
    rounds: RoundMark[];
    shared: SharedRead[];
    more: SharedRead | null;
    moreCount: number;
    t0: number;
    t1: number;
    takeaway: string;
} | null {
    const timeline = c.timeline ?? {};
    // panel order, the coordinator (which has steps only if it read something) last, as the spend rows are
    const seatsInOrder = [...panel(c), ...c.experts.filter((e) => e.coordinator)];
    const laneSeats = seatsInOrder.filter((e) => (timeline[e.id] ?? []).some((s) => s.ts > 0));
    if (laneSeats.length === 0) {
        return null;
    }

    // who read which file, over every seat that kept a timeline (the same way Go's chartSeats finds a shared read),
    // each file shown as the first seat in panel order spelled it
    const known = new Set(c.experts.map((e) => e.id));
    const seatOrder = [
        ...seatsInOrder.map((e) => e.id).filter((id) => timeline[id] != null),
        ...Object.keys(timeline)
            .filter((id) => !known.has(id))
            .sort(),
    ];
    const readers = new Map<string, SharedEntry>();
    for (const id of seatOrder) {
        for (const s of timeline[id]) {
            if (s.kind !== "read") {
                continue;
            }
            const key = readKey(s.target);
            let entry = readers.get(key);
            if (entry == null) {
                entry = { key, path: toSlash(s.target), seats: [], reads: 0 };
                readers.set(key, entry);
            }
            entry.reads++;
            if (!entry.seats.includes(id)) {
                entry.seats.push(id);
            }
        }
    }
    const sharedAll = [...readers.values()]
        .filter((e) => e.seats.length > 1)
        .sort(
            (a, b) =>
                b.seats.length - a.seats.length || b.reads - a.reads || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
    const strip = (e: SharedEntry): SharedRead => ({ path: e.path, seats: e.seats, reads: e.reads });
    const shared = sharedAll.slice(0, SHARED_ROWS).map(strip);
    const rest = sharedAll.slice(SHARED_ROWS);

    const lanes = laneSeats.map((seat): Lane => {
        const steps = timeline[seat.id];
        const spans = stretchesOf(steps).map(
            (sp): LaneSpan => ({
                start: sp.start,
                end: sp.end,
                steps: sp.steps,
                // the most-read files, a tie by which was read first
                top: [...sp.reads.values()]
                    .map((r, i) => ({ ...r, i }))
                    .sort((a, b) => b.n - a.n || a.i - b.i)
                    .slice(0, TOP_TARGETS)
                    .map((r) => r.target),
            })
        );
        const marks: LaneStep[] = [];
        for (const s of steps) {
            const shape = STEP_SHAPE[s.kind];
            if (!(s.ts > 0) || shape == null) {
                continue;
            }
            const sharedRead = shape === "tick" && (readers.get(readKey(s.target))?.seats.length ?? 0) > 1;
            marks.push({ ts: s.ts, shape, target: s.target, shared: sharedRead });
        }
        return { seat, spans, steps: marks, capped: steps.length >= MAX_TIMELINE_STEPS };
    });
    const t0 = Math.min(...lanes.flatMap((l) => l.spans.map((s) => s.start)));
    const t1 = Math.max(...lanes.flatMap((l) => l.spans.map((s) => s.end)));

    // a round opens at its first post: round 1 at the earliest idea, a later round at the earliest reply a seat sent
    // in it (the person's replies open none)
    const seats = new Set(panel(c).map((e) => e.id));
    const opens = new Map<number, number>();
    const earliest = sentProposals(c)
        .map((p) => p.ts)
        .filter((ts) => ts > 0);
    if (earliest.length > 0) {
        opens.set(1, Math.min(...earliest));
    }
    for (const r of sentReplies(c)) {
        if (r.round >= 2 && r.ts > 0 && seats.has(r.author)) {
            opens.set(r.round, Math.min(r.ts, opens.get(r.round) ?? r.ts));
        }
    }
    const rounds = [...opens.entries()]
        .map(([round, ts]): RoundMark => ({ round, ts }))
        .filter((m) => m.ts >= t0 && m.ts <= t1)
        .sort((a, b) => a.round - b.round);

    const totalReads = sharedAll.reduce((n, e) => n + e.reads, 0);
    let first = "No seat read a file another one read";
    if (sharedAll.length > 0) {
        const files = sharedAll.length === 1 ? "1 file was" : `${sharedAll.length} files were`;
        first = `${files} read by two or more seats (${plural(totalReads, "read", "reads")})`;
        if (sharedAll[0].seats.length >= 3) {
            first += `; ${baseName(sharedAll[0].path)} by ${countWord(sharedAll[0].seats.length)}`;
        }
    }
    const inFirst = lanes.reduce((n, l) => n + l.spans[0].steps, 0);
    const all = lanes.reduce((n, l) => n + l.spans.reduce((m, s) => m + s.steps, 0), 0);
    // a seat at the cap lost its oldest steps, so what is left of it starts later than it did
    const stretch = lanes.some((l) => l.capped) ? "first kept stretch" : "first stretch";
    const takeaway = `${first}. ${inFirst} of ${all} steps came in each seat's ${stretch}, before it posted.`;

    return {
        lanes,
        rounds,
        shared,
        more: rest.length > 0 ? strip(rest[0]) : null,
        moreCount: rest.length,
        t0,
        t1,
        takeaway,
    };
}

// ---- E: the argument map ----

const MAX_IDEA_TITLE = 48;
const STANCE_NOUN: Record<FigureStance, string> = { accept: "accepts", challenge: "challenges", oppose: "opposes" };

function cutTitle(title: string): string {
    const flat = title.replace(/\s+/g, " ").trim();
    return flat.length > MAX_IDEA_TITLE ? `${flat.slice(0, MAX_IDEA_TITLE - 1).trimEnd()}…` : flat;
}

/** Figure E, the argument map. */
export function argumentGraph(
    c: Council
): { seats: GraphSeat[]; groups: IdeaGroup[]; edges: GraphEdge[]; takeaway: string } | null {
    const sent = sentProposals(c);
    if (sent.length === 0) {
        return null;
    }
    const byId = new Map(sent.map((p) => [p.id, p]));
    const panelSeats = panel(c);
    const seatIds = new Set(panelSeats.map((e) => e.id));

    // every reply goes to the idea it is on, a reply to a reply to the one its parent is on
    const all = c.replies ?? [];
    const replyById = new Map(all.map((r) => [r.id, r]));
    const ideaOf = (r: CouncilReply): string => {
        const seen = new Set<string>();
        let cur: CouncilReply | undefined = r;
        while (cur != null && !seen.has(cur.id)) {
            if (cur.proposalid) {
                return cur.proposalid;
            }
            seen.add(cur.id);
            cur = cur.parentid ? replyById.get(cur.parentid) : undefined;
        }
        return "";
    };

    // a seat's edge to an idea: its latest stance and how many replies it made there; the author's own replies make none
    type Acc = { seat: string; idea: string; stance: FigureStance | "proposed"; count: number };
    const stanced = new Map<string, Acc>();
    const touched = new Set<string>();
    const ordered = sentReplies(c)
        .map((r, i) => ({ r, i }))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
        .map((x) => x.r);
    for (const r of ordered) {
        const idea = byId.get(ideaOf(r));
        if (idea == null || r.author === idea.author || (r.author !== YOU && !seatIds.has(r.author))) {
            continue;
        }
        touched.add(idea.id);
        const stance = r.author === YOU ? "proposed" : asStance(r.stance);
        if (stance == null) {
            continue;
        }
        const key = `${r.author}|${idea.id}`;
        const edge = stanced.get(key) ?? { seat: r.author, idea: idea.id, stance, count: 0 };
        edge.stance = stance;
        edge.count++;
        stanced.set(key, edge);
    }

    // which group each idea sits in: the first direction that takes it (the rest of a direction's ideas are merged into
    // it), else Also raised, Withdrawn, or Cut
    const directions = [...(c.summary?.directions ?? [])].sort((a, b) => a.rank - b.rank);
    const claimed = new Map<string, { direction: CouncilDirection; merged: boolean }>();
    for (const d of directions) {
        let lead = true;
        for (const id of d.from) {
            const p = byId.get(id);
            if (p == null || p.cut || p.withdrawn || claimed.has(id)) {
                continue;
            }
            claimed.set(id, { direction: d, merged: !lead });
            lead = false;
        }
    }
    let top = 0;
    const group = (key: string, heading: string, ideas: { id: string; merged: boolean }[]): IdeaGroup | null => {
        if (ideas.length === 0) {
            return null;
        }
        const rows = ideas.map((x, i): GraphIdea => {
            const p = byId.get(x.id)!;
            return {
                id: p.id,
                title: cutTitle(`${x.merged ? "merged · " : ""}${p.title}`),
                label: checkLabelOf(p),
                merged: x.merged,
                dim: p.withdrawn === true || p.cut === true,
                y: top + GRAPH_HEADING_PX + i * GRAPH_ROW_PX,
            };
        });
        top += GRAPH_HEADING_PX + rows.length * GRAPH_ROW_PX;
        return { key, heading, ideas: rows };
    };
    const plain = (p: CouncilProposal) => ({ id: p.id, merged: false });
    const groups = [
        ...directions.map((d) =>
            group(
                `direction:${d.rank}`,
                `${directionTag(d.rank)} · ${d.title}`,
                d.from.flatMap((id) => {
                    const own = claimed.get(id);
                    return own?.direction === d ? [{ id, merged: own.merged }] : [];
                })
            )
        ),
        group(
            "also-raised",
            "Also raised",
            sent.filter((p) => !claimed.has(p.id) && !p.withdrawn && !p.cut).map(plain)
        ),
        group("withdrawn", "Withdrawn", sent.filter((p) => p.withdrawn && !p.cut).map(plain)),
        group("cut", "Cut", sent.filter((p) => p.cut).map(plain)),
    ].filter((g): g is IdeaGroup => g != null);
    const ideaIds = groups.flatMap((g) => g.ideas.map((i) => i.id));

    const hasYou = [...stanced.values()].some((e) => e.seat === YOU);
    const seatRows = [
        ...panelSeats.map((e) => ({ id: e.id, name: e.name, you: false })),
        ...(hasYou ? [{ id: YOU, name: "You", you: true }] : []),
    ];
    const edges: GraphEdge[] = [];
    for (const seat of seatRows) {
        for (const id of ideaIds) {
            if (byId.get(id)!.author === seat.id) {
                edges.push({ seat: seat.id, idea: id, stance: "proposed", count: 1 });
                continue;
            }
            const edge = stanced.get(`${seat.id}|${id}`);
            if (edge != null) {
                edges.push({ seat: edge.seat, idea: edge.idea, stance: edge.stance, count: edge.count });
            }
        }
    }
    const seats = seatRows.map(
        (s): GraphSeat => ({
            ...s,
            replies: edges
                .filter((e) => e.seat === s.id && !(e.stance === "proposed" && !s.you))
                .reduce((n, e) => n + e.count, 0),
        })
    );

    // the takeaway reads the stances: a seat's latest on an idea, the person's and the authors' left out
    const stances = edges.filter((e) => e.seat !== YOU && e.stance !== "proposed");
    const count = (stance: FigureStance) => stances.filter((e) => e.stance === stance).length;
    const majority = (["accept", "challenge", "oppose"] as const).find((s) => count(s) * 2 > stances.length);
    const untouched = sent.filter((p) => !touched.has(p.id)).map((p) => p.id);
    let tally = "";
    if (majority != null) {
        const n = count(majority);
        tally = `${n === stances.length ? "all" : `${n} of`} ${n === stances.length ? n : stances.length} stances were ${STANCE_NOUN[majority]}`;
        if (majority === "challenge" && count("oppose") === 0) {
            tally += " and no seat opposed";
        }
    }
    // the idea with the most opposes, then the most challenges; the first of equals
    let contested: { id: string; oppose: number; challenge: number } | null = null;
    for (const p of sent) {
        const on = stances.filter((e) => e.idea === p.id);
        const oppose = on.filter((e) => e.stance === "oppose").length;
        const challenge = on.filter((e) => e.stance === "challenge").length;
        if (
            oppose + challenge > 0 &&
            (contested == null ||
                oppose > contested.oppose ||
                (oppose === contested.oppose && challenge > contested.challenge))
        ) {
            contested = { id: p.id, oppose, challenge };
        }
    }
    const drewAll = untouched.length === 0;
    const sentences: string[] = [];
    if (tally !== "") {
        sentences.push(
            drewAll
                ? `Every idea drew a reply, ${majority === "accept" ? "and" : "but"} ${tally}.`
                : `${capital(tally)}.`
        );
    } else if (drewAll) {
        sentences.push("Every idea drew a reply.");
    }
    const tail =
        untouched.length > 0
            ? `untouched: ${untouched.slice(0, 3).join(", ")}${untouched.length > 3 ? ` and ${untouched.length - 3} more` : ""}`
            : "";
    if (contested != null) {
        const parts = [
            contested.oppose > 0 ? plural(contested.oppose, "oppose", "opposes") : "",
            contested.challenge > 0 ? plural(contested.challenge, "challenge", "challenges") : "",
        ].filter((part) => part !== "");
        sentences.push(`Most contested: ${contested.id} (${parts.join(", ")})${tail !== "" ? `; ${tail}` : ""}.`);
    } else if (tail !== "") {
        sentences.push(`${capital(tail)}.`);
    }

    return { seats, groups, edges, takeaway: sentences.join(" ") };
}

// ---- F: the benchmark ----

// a harness version is `<YYYY-MM-DD>.<n>`: by date, then by the counter as a number (.10 follows .9); none is oldest
function compareHarness(a: string, b: string): number {
    const [ad, an = "0"] = a.split(".");
    const [bd, bn = "0"] = b.split(".");
    if (ad !== bd) {
        return ad < bd ? -1 : 1;
    }
    return (Number(an) || 0) - (Number(bn) || 0) || (a < b ? -1 : a > b ? 1 : 0);
}

// a harness as a point's label shows it: the month and day (`11-12`), or `unknown` for a row from before versions
function harnessDay(harness: string): string {
    if (harness === "") {
        return "unknown";
    }
    const m = /^\d{4}-(\d{2}-\d{2})/.exec(harness);
    return m != null ? m[1] : harness;
}

const VARIANT_PHRASE: Record<string, string> = {
    solo: "solo",
    council: "the council",
    team: "the team",
    brainstorm: "the brainstorm skill",
};
const phraseOf = (variant: string) => VARIANT_PHRASE[variant] ?? variant;
const possessive = (variant: string) => `${phraseOf(variant)}'s`;

const perRun = (p: BenchPoint) => p.row.tokens / p.row.runs;
const pct = (p: BenchPoint) => `${Math.round(p.y * 100)}%`;

function benchPanel(mode: "review" | "brainstorm", rows: CouncilBenchRow[]): BenchPanel | null {
    const points = rows
        .filter((r) => r.mode === mode)
        .map((row): BenchPoint => {
            // a Review row's recall@all counts only when every scored run was judged whole; else its head recall
            // (recall@5), which every run has, drawn hollow
            const whole = mode === "brainstorm" || row.allscored === row.scored;
            const recall = whole ? row.recall : (row.recall5 ?? 0);
            return {
                harness: row.harness,
                variant: row.variant,
                mode,
                x: Math.log10(row.tokens / row.runs),
                y: recall / row.keys,
                hollow: !whole,
                newest: false,
                label: `${row.variant} · ${harnessDay(row.harness)}`,
                row,
            };
        });
    if (points.length === 0) {
        return null;
    }
    const newestHarness = points.reduce(
        (best, p) => (compareHarness(p.harness, best) > 0 ? p.harness : best),
        points[0].harness
    );
    for (const p of points) {
        p.newest = p.harness === newestHarness;
    }

    // the newest harness's points that no cheaper point of it beats on recall: older harnesses' prompts differ
    const current = points.filter((p) => p.newest).sort((a, b) => a.x - b.x || b.y - a.y);
    const frontier: BenchPoint[] = [];
    for (const p of current) {
        if (frontier.length === 0 || p.y > frontier[frontier.length - 1].y) {
            frontier.push(p);
        }
    }

    const best = [...frontier].reverse();
    const sentences = [
        `Newest harness: ${best
            .map((p, i) =>
                i === 0
                    ? `${phraseOf(p.variant)} finds ${pct(p)} at ${benchTokens(perRun(p))} a run`
                    : `${phraseOf(p.variant)} ${pct(p)} at ${benchTokens(perRun(p))}`
            )
            .join(", ")}`,
    ];
    // a variant with no row on the newest harness whose last result the newest harness's points do not beat
    const rerun = new Set(current.map((p) => p.variant));
    const last = new Map<string, BenchPoint>();
    for (const p of points) {
        const seen = last.get(p.variant);
        if (!rerun.has(p.variant) && (seen == null || compareHarness(p.harness, seen.harness) > 0)) {
            last.set(p.variant, p);
        }
    }
    for (const p of last.values()) {
        if (!current.some((q) => q.x <= p.x && q.y >= p.y)) {
            sentences.push(
                `${capital(phraseOf(p.variant))} last ran on ${harnessDay(p.harness)}: ${pct(p)} at ${benchTokens(perRun(p))}`
            );
        }
    }
    let takeaway = sentences.join(". ");
    const cut = current.filter((p) => p.hollow);
    if (cut.length === 1) {
        takeaway += `; ${possessive(cut[0].variant)} ${harnessDay(cut[0].harness)} score counts its first 5 items only`;
    } else if (cut.length > 1) {
        takeaway += `; ${listNames(cut.map((p) => possessive(p.variant)))} ${harnessDay(cut[0].harness)} scores count their first 5 items only`;
    }
    return { mode, points, frontier, takeaway: `${takeaway}.` };
}

/** Figure F, the benchmark: key lines found against tokens per run, one small multiple per mode. */
export function benchPoints(rows: CouncilBenchRow[]): {
    review: BenchPanel | null;
    brainstorm: BenchPanel | null;
    runs: number;
    modes: number;
    takeaway: string;
} {
    const runs = rows.reduce((n, r) => n + r.runs, 0);
    const modes = new Set(rows.map((r) => r.mode).filter((m) => m !== "")).size;
    // a row with no scored run, no key lines or no tokens has nothing to place
    const scored = rows.filter((r) => r.scored > 0 && r.keys > 0 && r.runs > 0 && r.tokens > 0);
    const review = benchPanel("review", scored);
    const brainstorm = benchPanel("brainstorm", scored);

    // across both modes: the variant that found the most key lines per million tokens when it last ran
    let takeaway = "";
    let top: { point: BenchPoint; newest: boolean; perM: number } | null = null;
    for (const panelOf of [review, brainstorm]) {
        const lastOf = new Map<string, BenchPoint>();
        for (const p of panelOf?.points ?? []) {
            const seen = lastOf.get(p.variant);
            if (seen == null || compareHarness(p.harness, seen.harness) > 0) {
                lastOf.set(p.variant, p);
            }
        }
        for (const p of lastOf.values()) {
            const perM = p.y / (perRun(p) / 1_000_000);
            if (top == null || perM > top.perM) {
                top = { point: p, newest: panelOf!.points.some((q) => q.newest && q.harness === p.harness), perM };
            }
        }
    }
    if (top != null && top.perM > 0) {
        const name = capital(phraseOf(top.point.variant));
        takeaway = top.newest
            ? `${name} finds the most key lines per token.`
            : `${name} found the most key lines per token when it last ran (${harnessDay(top.point.harness)}); run it on the newest harness.`;
    }
    return { review, brainstorm, runs, modes, takeaway };
}
