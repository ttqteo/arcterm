// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Report's two tables draw (councilreporttables.tsx), derived from a `Council`: Việc cần làm / To do, one row per
// ranked direction (the task, why, the files it touches, its kind), and Số liệu / Figures, one row per figure Go verified
// (the value, what it measures, the `path:line` it comes from). They are the first thing under the answer, the same two
// tables as the saved report's main `.md` (docs/superpowers/specs/2026-11-23-council-report-tables-design.md decisions 1, 3
// and 5), from the same data: the directions' task / why / kind / files that the coordinator wrote, and `Council.figures`,
// which Go checked and deduplicated. The headings, columns and kind words are the `.md`'s, in the council's language.
// Pure, no React, no Wave runtime imports, so every rule here has a test (councilreporttables.test.ts).
//
// This file is the twin of pkg/council/markdown.go's to-do and figures tables (todoPart, todoTask, todoWhy, figuresPart,
// failedFiguresPart) and of its words, pkg/council/reportwords.go: change one and change the other. The fallbacks for a
// direction with none of the new fields (a council summarized before them): Việc is `task`, else (a Brainstorm) the first
// step, else the title; Vì sao is `why`, else the first sentence of the reasoning read as one line; File and Loại are
// empty and draw "—". The # column is a row's place in the ranking, not its Direction.rank.

import { langOf, type CouncilLang } from "./councillang";
import { isBrainstorm, isVerifiedFigure } from "./councilsummarymodel";

export type TaskKind = "new" | "edit" | "decision";

export interface ReportWords {
    todo: string; // the to-do table's heading
    figures: string; // the figures table's heading
    rank: string;
    task: string;
    why: string;
    files: string;
    kind: string;
    value: string;
    measures: string;
    source: string;
    share: string; // the Share column's heading
    of: string; // "14,3% của 947"
    rest: string; // what a whole's parts leave: "812 còn lại"
    otherFigures: string; // the heading of the figures with no group, when some have one
    points: string; // a rate's change: "−8,9 điểm"
    overMax: string;
    withinMax: string;
    underMin: string;
    meetsMin: string;
    before: string; // a change's earlier figure: "trước"
    after: string; // and its later one: "sau"
    limitLabel: string; // the mark on a limit bar
    kinds: Record<TaskKind, string>;
}

// the words of pkg/council/reportwords.go's englishWords and vietnameseWords, the two tables' share of them (the memory's
// words and the Final proposal's are Go's alone: the cockpit's What it settled and Final proposal keep their own headings)
const WORDS: Record<CouncilLang, ReportWords> = {
    vi: {
        todo: "Việc cần làm",
        figures: "Số liệu",
        rank: "#",
        task: "Việc",
        why: "Vì sao",
        files: "File đụng tới",
        kind: "Loại",
        value: "Giá trị",
        measures: "Đo gì",
        source: "Nguồn",
        share: "Tỉ lệ",
        of: "của",
        rest: "còn lại",
        otherFigures: "Số khác",
        points: "điểm",
        overMax: "vượt ngưỡng tối đa",
        withinMax: "trong ngưỡng tối đa",
        underMin: "dưới mức tối thiểu",
        meetsMin: "đạt mức tối thiểu",
        before: "trước",
        after: "sau",
        limitLabel: "ngưỡng",
        kinds: { new: "việc mới", edit: "sửa chữ", decision: "quyết định" },
    },
    en: {
        todo: "To do",
        figures: "Figures",
        rank: "#",
        task: "Task",
        why: "Why",
        files: "Files",
        kind: "Kind",
        value: "Value",
        measures: "Measures",
        source: "Source",
        share: "Share",
        of: "of",
        rest: "rest",
        otherFigures: "Other figures",
        points: "pts",
        overMax: "over the max",
        withinMax: "within the max",
        underMin: "under the min",
        meetsMin: "meets the min",
        before: "before",
        after: "after",
        limitLabel: "limit",
        kinds: { new: "new work", edit: "text edit", decision: "decision" },
    },
};

/** Pure: the tables' own words in a language. */
export function reportWords(lang: CouncilLang): ReportWords {
    return WORDS[lang];
}

/** Pure: the language the tables speak: the council's own (`lang`), and for one with none (the older Brainstorms) the
 *  question's, else the feature's, as Go reads it (runner.go's `councilLang`). */
export function reportLangOf(c: Pick<Council, "lang" | "question" | "feature">): CouncilLang {
    if (c.lang === "vi" || c.lang === "en") {
        return c.lang;
    }
    const question = c.question ?? "";
    return langOf(question.trim() !== "" ? question : (c.feature ?? ""));
}

export interface TodoRow {
    rank: number; // the row's place in the ranking, from 1: the # column
    task: string;
    why: string;
    // the why is the reasoning's first sentence (a direction summarized before `why`): it may name proposal ids (P2),
    // which a why written for the table never does
    whyFallback: boolean;
    files: string[]; // empty draws "—"
    kindId: TaskKind | null; // null draws "—"
    kind: string; // the kind in the council's language, or empty
}

// a cell is one line: the model's line breaks and runs of spaces fold to a single space
const oneLine = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

const BRIEF_MAX = 160;

// The first sentence of a line of text: up to the first . ? or ! followed by a space or the end, and no longer than 160
// characters: a longer one is cut to 159 and ends with "…" (the twin of firstSentence in pkg/council/prompts.go, which
// markdown.go's todoWhy calls on the reasoning read as one line).
function firstSentence(line: string): string {
    let chars = [...line.trim()];
    for (let i = 0; i < chars.length; i++) {
        if (
            (chars[i] === "." || chars[i] === "?" || chars[i] === "!") &&
            (i + 1 === chars.length || chars[i + 1] === " ")
        ) {
            chars = chars.slice(0, i + 1);
            break;
        }
    }
    if (chars.length > BRIEF_MAX) {
        chars = [...chars.slice(0, BRIEF_MAX - 1), "…"];
    }
    return chars.join("");
}

function kindOf(kind: string | undefined): TaskKind | null {
    return kind === "new" || kind === "edit" || kind === "decision" ? kind : null;
}

/** Pure: the to-do table's rows: one per ranked direction, in rank order (the ideas kept aside are not tasks), each with
 *  the fallbacks the file's header names. */
export function todoRows(c: Council): TodoRow[] {
    const words = reportWords(reportLangOf(c));
    const brainstorm = isBrainstorm(c);
    return [...(c.summary?.directions ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((d, i) => {
            const kindId = kindOf(d.kind);
            const why = oneLine(d.why);
            return {
                rank: i + 1,
                task: oneLine(d.task) || (brainstorm ? oneLine(d.firststep) : "") || oneLine(d.title),
                why: why || firstSentence(oneLine(d.reasoning)),
                whyFallback: why === "",
                files: (d.files ?? []).map(oneLine).filter((f) => f !== ""),
                kindId,
                kind: kindId == null ? "" : words.kinds[kindId],
            };
        });
}

export interface FigureRow {
    value: string;
    measures: string;
    ref: string; // `path:line`
    refs: string[]; // the other places that hold the same figure (a copy of the file, a nearby line)
    group: string; // "" for a figure that stands alone
    of: string; // the whole it is part of, as Go kept it (the whole figure's value); "" for none
    share: number | null; // its part of that whole, 0..1; null with no whole
    rate: boolean; // a %, a fraction or a decimal between 0 and 1, rather than a count
    amount: number; // the count, for one that is a count; 0 otherwise
    level: number | null; // the figure as one number: the count, or the rate as 0..1; null when it reads as none
    was: string; // the earlier figure's value, as Go kept it; "" for none
    limit: string; // the limit figure's value, as Go kept it; "" for none
    bound: "max" | "min"; // which side of the limit is good
    breach: boolean; // on the wrong side of its limit
    unit: string; // what it counts in, as the seat wrote it
    at: string; // when it holds, as the seat wrote it
}

const toRow = (f: CouncilFigure): FigureRow => {
    const of = oneLine(f.of);
    return {
        value: oneLine(f.value),
        measures: oneLine(f.measures),
        ref: oneLine(f.ref),
        refs: (f.refs ?? []).map(oneLine).filter((r) => r !== ""),
        group: oneLine(f.group),
        of,
        share: of !== "" && typeof f.share === "number" ? f.share : null,
        rate: f.rate === true,
        amount: typeof f.amount === "number" ? f.amount : 0,
        level: typeof f.level === "number" ? f.level : null,
        was: oneLine(f.was),
        limit: oneLine(f.limit),
        bound: f.bound === "min" ? "min" : "max",
        breach: f.breach === true,
        unit: oneLine(f.unit),
        at: oneLine(f.at),
    };
};

/** Pure: the figures table's rows: the figures Go verified, as `Council.figures` holds them (Go merged the copies of one
 *  figure, kept its other places in `refs`, and checked each relation). A figure that did not check out is
 *  `failedFigureRows`'. */
export function figureRows(c: Council): FigureRow[] {
    return (c.figures ?? []).filter(isVerifiedFigure).map(toRow);
}

export interface FigureSection {
    name: string; // the group's name; "" for the figures with no group
    rows: FigureRow[]; // each whole before its parts
}

// a row's whole in its section: the first other count whose value is the row's `of`, or -1
function parentsOf(rows: FigureRow[]): number[] {
    return rows.map((r, i) => (r.of === "" ? -1 : rows.findIndex((w, j) => j !== i && !w.rate && w.value === r.of)));
}

/** Pure: the verified figures split by group, the groups in the order each was first named and the figures with no group
 *  last; inside a group each figure whose whole is not there comes in order, followed by its parts, depth first. The
 *  twin of pkg/council/markdown.go's figureSections and wholesFirst: change one and change the other. */
export function figureSections(c: Council): FigureSection[] {
    const byName = new Map<string, FigureRow[]>();
    for (const r of figureRows(c)) {
        byName.set(r.group, [...(byName.get(r.group) ?? []), r]);
    }
    const names = [...byName.keys()].filter((n) => n !== "");
    if (byName.has("")) {
        names.push("");
    }
    return names.map((name) => {
        const rows = byName.get(name)!;
        const parent = parentsOf(rows);
        const seen = new Set<number>();
        const out: FigureRow[] = [];
        const visit = (i: number) => {
            if (seen.has(i)) {
                return;
            }
            seen.add(i);
            out.push(rows[i]);
            parent.forEach((p, k) => p === i && visit(k));
        };
        parent.forEach((p, i) => p < 0 && visit(i));
        rows.forEach((_, i) => visit(i)); // a loop Go let through would leave rows unvisited: keep them, in order
        return { name, rows: out };
    });
}

/** Pure: a share as a percentage with one decimal and no trailing ".0", with a decimal comma in Vietnamese: "79,5%",
 *  "70%". The twin of pkg/council/figurerel.go's percentText and markdown.go's localNumber. */
export function percentText(share: number, lang: CouncilLang): string {
    const text = (Math.round(share * 1000) / 10).toFixed(1).replace(/\.0$/, "") + "%";
    return lang === "vi" ? text.replace(".", ",") : text;
}

/** Pure: a count as the council's language writes it: "812", "1.248" in Vietnamese, "1,248" in English. */
export function countText(n: number, lang: CouncilLang): string {
    return new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: 2 }).format(n);
}

/** Pure: a change with its sign, "+20" or "−8,9 điểm": a count's in its own units, a rate's in percentage points with one
 *  decimal. The twin of markdown.go's changeText. */
export function changeText(delta: number, rate: boolean, lang: CouncilLang): string {
    const sign = delta < 0 ? "−" : "+";
    const d = Math.abs(delta);
    if (rate) {
        const pts = (Math.round(d * 1000) / 10).toString();
        return `${sign}${lang === "vi" ? pts.replace(".", ",") : pts} ${reportWords(lang).points}`;
    }
    return sign + countText(Math.round(d * 100) / 100, lang);
}

/** Pure: a figure's side of its limit in words: "vượt ngưỡng tối đa 1000", "đạt mức tối thiểu 0.8". The twin of the limit
 *  part of markdown.go's relationCell. */
export function limitText(row: FigureRow, lang: CouncilLang): string {
    const w = reportWords(lang);
    const side = row.bound === "min" ? (row.breach ? w.underMin : w.meetsMin) : row.breach ? w.overMax : w.withinMax;
    return `${side} ${row.limit}`;
}

export interface StackSegment {
    row: FigureRow | null; // null for what is left of a whole its parts do not cover
    label: string; // the value, or "812 còn lại"
    share: number; // its part of the bar's whole, 0..1
    depth: number; // 0 for a part of the bar's whole, 1 for a part of a part, …: the fill steps lighter with it
}

/** One whole that counts split: its parts side by side in one bar, each part that is split itself drawn as its parts. */
export interface StackBar {
    kind: "stack";
    whole: FigureRow;
    segments: StackSegment[];
    subtotals: string[]; // "135 = 94 + 41" for each part drawn as its own parts
    rows: FigureRow[]; // every figure the bar draws, the whole first: what its sources line names
}

/** One rate over its denominator: "0.7059" of "170". */
export interface RateBar {
    kind: "rate";
    row: FigureRow;
    share: number;
    pct: string; // "70,6% của 170"
}

/** A figure and the value it had before: "60 → 80", "+20". */
export interface ChangeView {
    kind: "change";
    from: FigureRow;
    to: FigureRow;
    delta: string; // "+20", "−8,9 điểm"
    dir: "up" | "down" | "same";
    scale: number; // what both bars are drawn against: 1 (100%) for two rates, else the larger of the two levels
    fromText: string; // the earlier figure as the chart says it: "79,5%" for a rate, its value for a count
    toText: string;
}

/** A figure held to a limit: a bar to its level with the limit marked on it. */
export interface LimitView {
    kind: "limit";
    row: FigureRow;
    limit: FigureRow;
    text: string; // "vượt ngưỡng tối đa 1000"
    scale: number; // the bar's full width: a little past the larger of the figure and its limit
}

/** Figures of one unit, side by side, largest first. */
export interface CompareView {
    kind: "compare";
    unit: string;
    rows: FigureRow[];
    max: number;
}

/** Figures of one unit over time, in the order of when each holds. */
export interface SeriesView {
    kind: "series";
    unit: string;
    rows: FigureRow[];
    min: number;
    max: number;
}

export type FigureChart = StackBar | RateBar | ChangeView | LimitView | CompareView | SeriesView;

export interface FigureSectionView {
    name: string; // "" for the figures with no group
    bars: FigureChart[];
    loose: FigureRow[]; // the figures no chart draws, as table rows
}

// below this, what is left of a whole is rounding, not a part
const EPS = 1e-6;
// how far past the larger of a figure and its limit the limit bar runs, so the limit's mark is never on the edge
const LIMIT_HEADROOM = 1.15;

/** Pure: the order of figures over time: by date when every `at` starts with one (2026-11-20), by the first number in it
 *  when every one has one (v1, vòng 3), else as declared. */
export function byTime(rows: FigureRow[]): FigureRow[] {
    const date = /^\d{4}-\d{2}(-\d{2})?/;
    if (rows.every((r) => date.test(r.at))) {
        return [...rows].sort((a, b) => a.at.localeCompare(b.at));
    }
    const num = (s: string) => Number(/\d+(\.\d+)?/.exec(s)?.[0]);
    if (rows.every((r) => Number.isFinite(num(r.at)))) {
        return [...rows].sort((a, b) => num(a.at) - num(b.at));
    }
    return rows;
}

/** Pure: which of a line's n points keep their labels: all of up to `max`; past it the first, the last and every
 *  `ceil((n - 1) / (max - 1))`-th between, so at most about `max` labels share the width. */
export function seriesLabels(n: number, max = 6): boolean[] {
    if (n <= max) {
        return Array.from({ length: n }, () => true);
    }
    const step = Math.ceil((n - 1) / (max - 1));
    return Array.from({ length: n }, (_, i) => i === n - 1 || (i % step === 0 && n - 1 - i >= step / 2));
}

/** Pure: what one section draws, each figure at most once, in this order of claim: a stacked bar for each count whose
 *  parts are counts and that is no part itself (parts split further drawn as their own parts, what a whole's parts leave
 *  as "rest"); a bar for each rate over its denominator; a change for each figure with an earlier value (both figures);
 *  a limit bar for each figure with a limit (both); then, of the figures left, a line over time for each unit with two or
 *  more that say when they hold, and bars side by side for each unit with two or more; and a table of the rest. Charts
 *  come in the section's order, the lines and comparisons last. */
export function sectionView(section: FigureSection, lang: CouncilLang): FigureSectionView {
    const words = reportWords(lang);
    const rows = section.rows;
    const parent = parentsOf(rows);
    const countKids = (i: number) => rows.flatMap((r, k) => (parent[k] === i && !r.rate && r.share != null ? [k] : []));
    const drawn = new Set<number>();
    const bars: FigureChart[] = [];
    const indexOf = (value: string, not: number) => rows.findIndex((r, j) => j !== not && r.value === value);
    // the earlier figure a figure names with was, when both read as a level: the pair is drawn as one change
    const wasOf = (i: number) => {
        const r = rows[i];
        const j = r.was !== "" && r.level != null ? indexOf(r.was, i) : -1;
        return j >= 0 && rows[j].level != null ? j : -1;
    };
    // a rate on either side of a change is drawn by the change ("79,5% → 70,6%"), not as a bar over its denominator:
    // claimed as two bars first, the pair stood as two unrelated meters and the drop it is about was never drawn
    const inChange = new Set(rows.flatMap((_, i) => (wasOf(i) >= 0 ? [i, wasOf(i)] : [])));
    rows.forEach((r, i) => {
        if (r.rate && r.share != null && !inChange.has(i)) {
            drawn.add(i);
            bars.push({
                kind: "rate",
                row: r,
                share: r.share,
                pct: `${percentText(r.share, lang)} ${words.of} ${r.of}`,
            });
            return;
        }
        const isCountPart = !r.rate && r.share != null && parent[i] >= 0;
        if (r.rate || isCountPart || countKids(i).length === 0) {
            return;
        }
        const segments: StackSegment[] = [];
        const subtotals: string[] = [];
        const barRows: FigureRow[] = [r];
        drawn.add(i);
        const split = (node: number, frac: number, depth: number) => {
            const kids = countKids(node);
            let covered = 0;
            for (const k of kids) {
                const part = frac * rows[k].share!;
                covered += rows[k].share!;
                drawn.add(k);
                barRows.push(rows[k]);
                if (countKids(k).length > 0) {
                    split(k, part, depth + 1);
                } else {
                    segments.push({ row: rows[k], label: rows[k].value, share: part, depth });
                }
            }
            const left = 1 - covered;
            const restAmount = rows[node].amount - kids.reduce((sum, k) => sum + rows[k].amount, 0);
            if (node !== i && kids.length > 0) {
                const parts = kids.map((k) => rows[k].value);
                if (left > EPS) {
                    parts.push(`${countText(restAmount, lang)} ${words.rest}`);
                }
                subtotals.push(`${rows[node].value} = ${parts.join(" + ")}`);
            }
            if (left > EPS) {
                segments.push({
                    row: null,
                    label: `${countText(restAmount, lang)} ${words.rest}`,
                    share: frac * left,
                    depth: -1,
                });
            }
        };
        split(i, 1, 0);
        bars.push({ kind: "stack", whole: r, segments, subtotals, rows: barRows });
    });
    rows.forEach((r, i) => {
        const j = drawn.has(i) ? -1 : wasOf(i);
        if (j >= 0) {
            const from = rows[j];
            drawn.add(i).add(j);
            const d = r.level! - from.level!;
            const rates = r.rate && from.rate;
            const text = (row: FigureRow) => (rates ? percentText(row.level!, lang) : row.value);
            bars.push({
                kind: "change",
                from,
                to: r,
                delta: changeText(d, r.rate, lang),
                dir: Math.abs(d) < 1e-12 ? "same" : d > 0 ? "up" : "down",
                scale: rates ? 1 : Math.max(Math.abs(r.level!), Math.abs(from.level!)) || 1,
                fromText: text(from),
                toText: text(r),
            });
        }
        if (r.limit !== "" && r.level != null) {
            const j = indexOf(r.limit, i);
            const limit = rows[j];
            if (j >= 0 && limit.level != null) {
                drawn.add(i).add(j);
                bars.push({
                    kind: "limit",
                    row: r,
                    limit,
                    text: limitText(r, lang),
                    scale: Math.max(r.level, limit.level) * LIMIT_HEADROOM || 1,
                });
            }
        }
    });
    const byUnit = (keep: (r: FigureRow) => boolean) => {
        const m = new Map<string, number[]>();
        rows.forEach((r, i) => {
            if (!drawn.has(i) && r.level != null && keep(r)) {
                const key = `${r.unit}|${r.rate}`;
                m.set(key, [...(m.get(key) ?? []), i]);
            }
        });
        return [...m.values()].filter((ix) => ix.length >= 2);
    };
    for (const ix of byUnit((r) => r.at !== "")) {
        ix.forEach((i) => drawn.add(i));
        const levels = ix.map((i) => rows[i].level!);
        bars.push({
            kind: "series",
            unit: rows[ix[0]].unit,
            rows: byTime(ix.map((i) => rows[i])),
            min: Math.min(...levels),
            max: Math.max(...levels),
        });
    }
    for (const ix of byUnit((r) => r.unit !== "")) {
        ix.forEach((i) => drawn.add(i));
        const sorted = ix.map((i) => rows[i]).sort((a, b) => b.level! - a.level!);
        bars.push({
            kind: "compare",
            unit: sorted[0].unit,
            rows: sorted,
            max: Math.max(...sorted.map((r) => r.level!)) || 1,
        });
    }
    return { name: section.name, bars, loose: rows.filter((_, i) => !drawn.has(i)) };
}

export interface FailedFigureRow {
    value: string;
    measures: string;
    ref: string;
    note: string; // Go's reason: "value not in the quote", "line 900 is past the end (412 lines)"; "not checked" with none
}

/** Pure: the figures the seats declared that Go did not verify, each with its note: what "About the council" lists under
 *  "Figures that did not check out", as the saved report's side file does (failedFiguresPart). One Go found wrong carries
 *  its reason; one it has not checked, or one with no reason, reads "not checked". */
export function failedFigureRows(c: Council): FailedFigureRow[] {
    return (c.figures ?? [])
        .filter((f) => !isVerifiedFigure(f))
        .map((f) => ({
            value: oneLine(f.value),
            measures: oneLine(f.measures),
            ref: oneLine(f.ref),
            note: oneLine(f.citenote) || "not checked",
        }));
}

/** Pure: the verified figures one of whose relations (of, was, limit) Go dropped, each with why (`relnote`): what "About
 *  the council" lists under "Figure relations that did not hold", as the side file does. */
export function droppedRelationRows(c: Council): FailedFigureRow[] {
    return (c.figures ?? [])
        .filter((f) => isVerifiedFigure(f) && oneLine(f.relnote) !== "")
        .map((f) => ({
            value: oneLine(f.value),
            measures: oneLine(f.measures),
            ref: oneLine(f.ref),
            note: oneLine(f.relnote),
        }));
}

export interface CiteGroup {
    path: string; // the file, as the refs wrote it
    dir: string; // its folder with the trailing slash ("obsidian_harness/"), drawn fainter; "" for none
    name: string; // the file's own name
    lines: string[]; // its lines, each once, in order ("713", "714", "720-724"); empty for a ref with no line
}

const REF_LINE = /^(.*?):(\d+(?:-\d+)?)$/;

/** Pure: a chart's `path:line` refs as one entry per file, each line once and in order, so three refs into one long
 *  file read as "file.html:713, 714, 715" and not the path three times. Files come in the order first cited. */
export function citeGroups(refs: string[]): CiteGroup[] {
    const byPath = new Map<string, Set<string>>();
    for (const ref of refs) {
        const r = ref.trim();
        if (r === "") {
            continue;
        }
        const m = REF_LINE.exec(r);
        const path = m ? m[1] : r;
        const lines = byPath.get(path) ?? new Set<string>();
        if (m) {
            lines.add(m[2]);
        }
        byPath.set(path, lines);
    }
    const start = (l: string) => Number(l.split("-")[0]);
    return [...byPath].map(([path, lines]) => ({
        path,
        dir: path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1),
        name: path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1),
        lines: [...lines].sort((a, b) => start(a) - start(b) || a.localeCompare(b)),
    }));
}

export interface SharedWording {
    prefix: string; // the words every label opens with; "" for none
    suffix: string; // the words every label ends with; "" for none
    rest: string[]; // each label without them, never empty
}

// fewer shared characters than this is not worth a line of its own ("ca " alone)
const SHARED_MIN = 12;

/** Pure: the words a comparison's labels all share at their start and their end, so the chart says them once over the
 *  bars and each bar keeps the words that tell it apart: "submit secbench đậu tier-1 trên ca blocked_clean" and "… ca
 *  crash_before_sink" become the prefix "submit secbench đậu tier-1 trên ca" over "blocked_clean" and "crash_before_sink".
 *  Each label keeps at least one word; under 12 shared characters, or with fewer than two labels, nothing is split off. */
export function sharedWording(labels: string[]): SharedWording {
    const none = { prefix: "", suffix: "", rest: labels };
    if (labels.length < 2) {
        return none;
    }
    const words = labels.map((l) => l.split(" ").filter((w) => w !== ""));
    const shortest = Math.min(...words.map((w) => w.length));
    let p = 0;
    while (p < shortest - 1 && words.every((w) => w[p] === words[0][p])) {
        p++;
    }
    let s = 0;
    const atEnd = (w: string[], k: number) => w[w.length - 1 - k];
    while (p + s < shortest - 1 && words.every((w) => atEnd(w, s) === atEnd(words[0], s))) {
        s++;
    }
    const prefix = words[0].slice(0, p).join(" ");
    const suffix = s > 0 ? words[0].slice(-s).join(" ") : "";
    if (prefix.length + suffix.length < SHARED_MIN) {
        return none;
    }
    return { prefix, suffix, rest: words.map((w) => w.slice(p, w.length - s).join(" ")) };
}
