// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the benchmark chart (councilbenchchart.tsx, figure F of docs/superpowers/plans/2026-11-19-council-figures.md)
// works out beyond the points councilfiguresmodel.ts's `benchPoints` hands it: the y axis, the row text of a tooltip and
// of the Table (the columns `wsh council bench results` prints, in its words), where the direct labels sit and the
// frontier's stepped line. Pure, so vitest holds the numbers. `BenchPoint.y` is read as a share of the keys, 0 to 1.

/** The y axis steps every 25%. */
export const RECALL_STEP = 0.25;

/** The y axis of one small multiple: from 0 to the next 25% step above the highest plotted recall, at most 100%, with a
 *  tick at every step. A chart with no point (or only zeros) spans the first step. */
export function recallDomain(ys: readonly number[]): { top: number; ticks: number[] } {
    const max = ys.reduce((m, y) => (y > m ? y : m), 0);
    const steps = Math.min(4, Math.floor(max / RECALL_STEP + 1e-9) + 1);
    const ticks: number[] = [];
    for (let i = 0; i <= steps; i++) {
        ticks.push(Number((i * RECALL_STEP).toFixed(2)));
    }
    return { top: ticks[ticks.length - 1], ticks };
}

/** A recall share as a tick or a label reads it: 0.25 -> "25%". */
export function percent(share: number): string {
    return `${Math.round(share * 100)}%`;
}

/** A token count as `wsh council bench results` writes it (Go's council.FormatTokens): 950, 38k, 1.5M. */
export function formatTokens(n: number): string {
    if (n < 1000) {
        return String(Math.max(Math.round(n), 0));
    }
    const k = Math.floor((n + 500) / 1000);
    if (k < 100) {
        return `${k}k`;
    }
    const tenths = Math.floor((n + 50_000) / 100_000);
    const whole = Math.floor(tenths / 10);
    const frac = tenths % 10;
    return frac === 0 ? `${whole}M` : `${whole}.${frac}M`;
}

// ── the rows, as the CLI prints them ────────────────────────────────────────────────────────────────────────────────

const REVIEW_COLUMNS = [
    "harness",
    "variant",
    "scored/runs",
    "recall@5",
    "recall@all",
    "wrong",
    "tokens",
    "recall@5/M tokens",
] as const;
const BRAINSTORM_COLUMNS = [
    "harness",
    "variant",
    "skill",
    "scored/runs",
    "recall@3",
    "recall@all",
    "recall@done",
    "wrong",
    "decisions",
    "questions",
    "tokens",
    "recall@all/M tokens",
] as const;

/** The note under the Review table, as `wsh council bench results` words it. */
export const REVIEW_NOTE =
    "note: a Review report is judged on its whole list; a run scored before that has recall@5 only (a dash for recall@all) until `wsh council bench rejudge` judges it again; a team keeps 5 items, so its recall@5 is its whole list";
/** The note under the Brainstorm table. */
export const BRAINSTORM_NOTE =
    "note: council and brainstorm are both judged on their whole list; rows of a harness before 2026-11-12.1 were scored the old way (a council cut at 3)";

/** One mode's rows as the table of `wsh council bench results` prints them: its columns and one string per cell. */
export type BenchTable = {
    mode: "review" | "brainstorm";
    heading: string;
    columns: readonly string[];
    numeric: number[];
    rows: string[][];
    note: string;
};

/** A row's cells in the CLI's order and words. `review` has recall@5 beside recall@all (a dash unless every scored run
 *  was judged whole: a sum over a mix of whole and cut runs is neither figure), `brainstorm` recall@3 beside recall@all
 *  and the skill, recall@done, decisions and questions only the brainstorm variant has. */
export function benchRowCells(row: CouncilBenchRow, mode: "review" | "brainstorm"): string[] {
    const harness = row.harness === "" ? "unknown" : row.harness;
    const perM = row.scored > 0 && row.tokens > 0 ? row.recallperm.toFixed(1) : "-";
    const scoredRuns = `${row.scored}/${row.runs}`;
    if (mode === "review") {
        let all = "-";
        let wrong = String(row.wrong);
        if (row.scored > 0 && (row.allscored ?? 0) === row.scored) {
            all = `${row.recall}/${row.keys}`;
            if (row.judged > 0) {
                wrong = `${row.wrong}/${row.judged}`;
            }
        }
        return [
            harness,
            row.variant,
            scoredRuns,
            `${row.recall5 ?? 0}/${row.keys}`,
            all,
            wrong,
            formatTokens(row.tokens),
            perM,
        ];
    }
    let recall3 = "-";
    let wrong = String(row.wrong);
    if (row.judged > 0) {
        recall3 = `${row.recall3}/${row.keys}`;
        wrong = `${row.wrong}/${row.judged}`;
    }
    const isBrainstorm = row.variant === "brainstorm";
    return [
        harness,
        row.variant,
        isBrainstorm && row.skill != null && row.skill !== "" ? row.skill : "-",
        scoredRuns,
        recall3,
        `${row.recall}/${row.keys}`,
        isBrainstorm ? `${row.recall_done ?? 0}/${row.keys}` : "-",
        wrong,
        isBrainstorm ? String(row.decisions ?? 0) : "-",
        isBrainstorm ? String(row.questions ?? 0) : "-",
        formatTokens(row.tokens),
        perM,
    ];
}

/** The row as label and value pairs, for a tooltip: the table's columns, each with its cell. */
export function benchRowLines(row: CouncilBenchRow, mode: "review" | "brainstorm"): { label: string; value: string }[] {
    const columns = mode === "review" ? REVIEW_COLUMNS : BRAINSTORM_COLUMNS;
    const cells = benchRowCells(row, mode);
    return columns.map((label, i) => ({ label, value: cells[i] }));
}

/** The tables the Table toggle shows: Review, then Brainstorm, each with the rows of its mode in the order wavesrv gave
 *  them, and a section with no row left out. A row of no known mode is not in the figure (the CLI lists it apart, under
 *  "Unknown mode"). */
export function benchTables(rows: readonly CouncilBenchRow[]): BenchTable[] {
    const out: BenchTable[] = [];
    const sections: { mode: "review" | "brainstorm"; heading: string; note: string }[] = [
        { mode: "review", heading: "Review", note: REVIEW_NOTE },
        { mode: "brainstorm", heading: "Brainstorm", note: BRAINSTORM_NOTE },
    ];
    for (const s of sections) {
        const mine = rows.filter((r) => r.mode === s.mode);
        if (mine.length === 0) {
            continue;
        }
        const columns = s.mode === "review" ? REVIEW_COLUMNS : BRAINSTORM_COLUMNS;
        // every column from the scored/runs one on is a number or a ratio, except the brainstorm table's skill
        const first = s.mode === "review" ? 2 : 3;
        out.push({
            mode: s.mode,
            heading: s.heading,
            columns,
            numeric: columns.map((_, i) => i).filter((i) => i >= first),
            rows: mine.map((r) => benchRowCells(r, s.mode)),
            note: s.note,
        });
    }
    return out;
}

// ── direct labels ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A label's width at the 10px the chart draws it in, estimated from its length (an SVG text is not measured here). */
export function labelWidth(text: string): number {
    return Math.ceil(text.length * 5.6);
}

export type LabelSpec = { id: string; x: number; y: number; text: string };
export type PlacedLabel = { id: string; x: number; y: number; anchor: "start" | "end" };

/** Where each direct label sits: beside its point (`x`, `y` in px), to the right of it, or to its left when that would
 *  run past `maxX`; then, top to bottom, a label that lands within `lineHeight` of one already placed in the same
 *  columns moves down under it, so two points that sit close do not print their names over each other. `y` is the
 *  label's baseline. */
export function placeLabels(
    specs: readonly LabelSpec[],
    maxX: number,
    opts: { gap?: number; lineHeight?: number } = {}
): PlacedLabel[] {
    const gap = opts.gap ?? 10;
    const lineHeight = opts.lineHeight ?? 12;
    const order = [...specs].sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: (PlacedLabel & { left: number; right: number })[] = [];
    for (const s of order) {
        const w = labelWidth(s.text);
        const flip = s.x + gap + w > maxX;
        const anchor: "start" | "end" = flip ? "end" : "start";
        const x = flip ? s.x - gap : s.x + gap;
        const left = flip ? x - w : x;
        const right = flip ? x : x + w;
        let y = s.y + 3.5; // the baseline that centres a 10px label on the point
        for (const p of placed) {
            if (p.left < right && left < p.right && Math.abs(y - p.y) < lineHeight) {
                y = p.y + lineHeight;
            }
        }
        placed.push({ id: s.id, x, y, anchor, left, right });
    }
    return specs.map((s) => {
        const p = placed.find((q) => q.id === s.id)!;
        return { id: p.id, x: p.x, y: p.y, anchor: p.anchor };
    });
}

// ── the frontier ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The frontier as a stepped line through its points (px), cheapest first: along to the next point's x at the current
 *  recall, then up (or down) to the next point's recall. One point draws no line. */
export function steppedPath(points: readonly { x: number; y: number }[]): string {
    if (points.length < 2) {
        return "";
    }
    const sorted = [...points].sort((a, b) => a.x - b.x);
    let d = `M${sorted[0].x} ${sorted[0].y}`;
    for (let i = 1; i < sorted.length; i++) {
        d += `H${sorted[i].x}V${sorted[i].y}`;
    }
    return d;
}
