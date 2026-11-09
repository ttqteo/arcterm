// the skim TL;DR bench: what a case is, and layer 1, the rules a fold must keep to pass a case. pure, so vitest runs it
// over the cases and scripts/skim-bench.mjs bundles it for node. the spec is
// docs/superpowers/specs/2026-11-09-skim-tldr-bench-design.md; the four criteria are numbered as it numbers them:
// 1 every reason has content, 2 warnings and what waits on the person stay, 3 a mark keeps its context, 4 every
// section has a line

import { canFold, endsOnQuestion, folded, lineCount } from "../skim-mod/hooks/fold-core";
import { askOf, shownMarks } from "../skim-mod/hooks/highlight-core";
import {
    FENCED,
    hasContent,
    isCommandFence,
    isTitle,
    ITEM,
    sections,
    STUB,
    stubOf,
    TABLE_ROW,
    titleKey,
    type Section,
} from "../skim-mod/hooks/sections-core";

// for scripts/skim-bench.mjs, which finds a history reply's marks by its hash
export { hashText, shownMarks } from "../skim-mod/hooks/highlight-core";

export const CRITERIA = [1, 2, 3, 4] as const;
export type Criterion = (typeof CRITERIA)[number];

// a fold this share of the reply's lines or more is not drawn: the reply draws in full
export const CEILING = 2 / 3;
// the median fold-to-reply line ratio may rise this much over the baseline's before the bench fails
export const RATIO_SLACK = 0.1;

// a unit the fold must keep, written as its first sentence as the reply has it, and the criterion it serves: 2 a warning
// or what waits on the person, 3 what a sentence ending in ":" points at
export type MustKeep = { text: string; criterion: 2 | 3 };
export type Question = { q: string; a: string };
// the person's pick on the review page between A, the fold at the baseline, and B, the fold in the working tree
export type ABLabel = { winner: "A" | "B" | "tie"; loserBroke: Criterion[]; baseline: string; at: string };
export type Labels = { reviewed?: string; ab?: ABLabel; note?: string };
export type Case = {
    reply: string;
    marks: string[];
    source: "history" | "generated";
    mustKeep: MustKeep[];
    questions: Question[];
    labels: Labels;
};

// what the case's reply draws as: its fold, or the reply in full when the fold reaches the ceiling
export type Drawn = { text: string; isFull: boolean; ratio: number };

export type Score = {
    criteria: Record<Criterion, boolean>;
    // why each failed criterion failed
    why: string[];
    ratio: number;
    kept: number;
    mustKeep: number;
};

export type Summary = {
    cases: number;
    rates: Record<Criterion | "all", number>;
    medianRatio: number;
    recall: number;
};

// the baseline layer 1 compares against: each case's fold and score when it was saved, so a case added later is
// compared on the cases both share, and the review page's A is the baseline's fold
export type Baseline = {
    commit: string;
    saved: string;
    cases: Record<string, { fold: string; criteria: Record<Criterion, boolean>; ratio: number }>;
    // layers 2 and 3 at the baseline, when it was saved with --llm
    llm?: Record<string, LlmScore>;
};

// layer 2, the share of questions answered right from the fold alone, and layer 3, the grader's 1-5 per criterion
export type LlmScore = { answered: number; grades: Record<Criterion, number> };

// the fold draws only for a reply skim folds: past the line limit, not ending on a question, its last mark no question
export function isFoldable(reply: string, marks: readonly string[]): boolean {
    return canFold(reply) && !endsOnQuestion(reply) && askOf(marks) === null;
}

export function drawn(reply: string, marks: readonly string[], fold = folded(reply, shownMarks(marks)).text): Drawn {
    const ratio = lineCount(fold) / lineCount(reply);
    return ratio >= CEILING ? { text: reply, isFull: true, ratio: 1 } : { text: fold, isFull: false, ratio };
}

// a text compared as it reads: bold markers out, whitespace collapsed
export function plain(text: string): string {
    return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

// a must-keep unit is kept when the fold shows its sentence whole
export function isKept(unit: string, fold: string): boolean {
    return plain(fold).includes(plain(unit));
}

const BARE_LABEL = /^\*\*[^*]+\*\*:?$/;
const MORE = /^…\s*\d+\s+more$/;

// a line of the fold read as content: its list marker and bold lead off, what is left of each piece around a "…"
function pieces(line: string): string[] {
    const item = line.match(ITEM)?.[1] ?? line;
    const lead = item.match(/^\*\*[^*]+\*\*:?\s+(.+)$/)?.[1] ?? item;
    return plain(lead)
        .split("…")
        .map((piece) => piece.trim())
        .filter((piece) => piece !== "");
}

// whether a fold's line is the section's own content: a stub for a section that is only a table or code, or text the
// section holds (each piece's first words, as a marked line joins the marks of one line and may cut a sentence)
function isFrom(line: string, section: Section): boolean {
    if (STUB.test(line.trim())) {
        return stubOf(section) !== null;
    }
    const body = plain(section.lines.join("\n"));
    return pieces(line).some((piece) => body.includes(piece.slice(0, 24)));
}

const FENCE_LINE = /^\s*(```|~~~)/;

// the first line of the block a sentence ending in ":" points at in the reply: the next line holding text, or the
// first line inside a fence. null when the reply does not hold the sentence's line, or nothing follows it
function pointedAt(line: string, reply: string): string | null {
    const tail = plain(line).slice(-40);
    const lines = reply.split("\n");
    const at = lines.findIndex((l) => plain(l).includes(tail));
    const rest = at < 0 ? [] : lines.slice(at + 1).filter((l) => l.trim() !== "");
    const first = rest[0];
    if (first === undefined) {
        return null;
    }
    return FENCE_LINE.test(first) ? (rest[1] ?? null) : first;
}

// whether the fold shows a reply's line: its text's first words, or a stub when the line is a table row
function isShown(line: string, fold: string): boolean {
    if (TABLE_ROW.test(line)) {
        return fold.split("\n").some((l) => STUB.test(l.trim()));
    }
    const text = plain(fold);
    return pieces(line).some((piece) => text.includes(piece.slice(0, 24)));
}

// the lines of a fold outside its fences
function proseLines(text: string): string[] {
    const out: string[] = [];
    let fence = false;
    for (const line of text.split("\n")) {
        if (FENCE_LINE.test(line)) {
            fence = !fence;
            continue;
        }
        if (!fence) {
            out.push(line);
        }
    }
    return out;
}

// layer 1 on one case: the four criteria on what the reply draws. a reply drawn in full passes them all
export function score(c: Pick<Case, "reply" | "marks" | "mustKeep">, shown: Drawn): Score {
    const why: string[] = [];
    const units = c.mustKeep.map((unit) => ({ ...unit, isKept: shown.isFull || isKept(unit.text, shown.text) }));
    const kept = units.filter((unit) => unit.isKept).length;
    if (shown.isFull) {
        return { criteria: { 1: true, 2: true, 3: true, 4: true }, why, ratio: 1, kept, mustKeep: units.length };
    }
    const fold = shown.text;
    const lines = proseLines(fold);

    // 1: a kept item is never only its bold label
    const bare = lines.filter((line) => BARE_LABEL.test(line.match(ITEM)?.[1]?.trim() ?? ""));
    bare.forEach((line) => why.push(`1: bare label ${line.trim()}`));

    // 2: the warnings and what waits on the person
    const lost = (criterion: 2 | 3) => units.filter((unit) => unit.criterion === criterion && !unit.isKept);
    lost(2).forEach((unit) => why.push(`2: lost "${unit.text}"`));

    // 3: a kept sentence ending in ":" brings what it points at, a heading shows only with content under it
    // a heading is a title, or a reply's title the marked fold shows as a plain line because the mark was the heading
    const titles = new Set(sections(c.reply).flatMap((s) => (s.title === null ? [] : [titleKey(s.title)])));
    const isHeading = (line: string) => isTitle(line) || (line.trim() !== "" && titles.has(titleKey(line)));
    const all = fold.split("\n");
    const open: string[] = [];
    const empty: string[] = [];
    let isFence = false;
    all.forEach((line, i) => {
        if (FENCE_LINE.test(line)) {
            isFence = !isFence;
            return;
        }
        // a bare label ending in ":" is criterion 1's, not a sentence pointing at something
        const isBare = BARE_LABEL.test(line.match(ITEM)?.[1]?.trim() ?? "");
        const isOpen = !isHeading(line) && !isBare && /:$/.test(line.replace(/[\s*_]+$/, ""));
        if (isFence || !(isOpen || isHeading(line))) {
            return;
        }
        const next = all.slice(i + 1).find((l) => l.trim() !== "");
        const target = isOpen ? pointedAt(line, c.reply) : null;
        const isLost = target !== null ? !isShown(target, fold) : next === undefined || isHeading(next);
        if (isLost) {
            (isOpen ? open : empty).push(line.trim());
        }
    });
    open.forEach((line) => why.push(`3: what "${line}" points at is not in the fold`));
    empty.forEach((line) => why.push(`3: empty heading ${line}`));
    const folds = sections(fold);
    lost(3).forEach((unit) => why.push(`3: lost "${unit.text}"`));

    // 4: every section of the reply has a line of its own content in the fold, under its title; a table or code
    // section by its stub, never raw rows or code
    const missing = sections(c.reply).filter((section) => {
        if (!hasContent(section)) {
            return false;
        }
        const key = section.title === null ? null : titleKey(section.title);
        const match = folds.find((f) => (f.title === null ? null : titleKey(f.title)) === key);
        return !match?.lines.some((line) => line.trim() !== "" && !MORE.test(line.trim()) && isFrom(line, section));
    });
    missing.forEach((section) => why.push(`4: no line for ${section.title ?? "the opening"}`));
    const raw =
        lines.some((line) => TABLE_ROW.test(line)) || (fold.match(FENCED) ?? []).some((f) => !isCommandFence(f));
    if (raw) {
        why.push("4: raw table rows or code in the fold");
    }

    return {
        criteria: {
            1: bare.length === 0,
            2: lost(2).length === 0,
            3: open.length === 0 && empty.length === 0 && lost(3).length === 0,
            4: missing.length === 0 && !raw,
        },
        why,
        ratio: shown.ratio,
        kept,
        mustKeep: units.length,
    };
}

// layer 1 over every case, by id: what each draws and its score
export function scoreAll(cases: Readonly<Record<string, Case>>): Record<string, { shown: Drawn; score: Score }> {
    return Object.fromEntries(
        Object.entries(cases).map(([id, c]) => {
            const shown = drawn(c.reply, c.marks);
            return [id, { shown, score: score(c, shown) }];
        })
    );
}

export function median(values: readonly number[]): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

type Scored = Pick<Score, "criteria" | "ratio"> & Partial<Pick<Score, "kept" | "mustKeep">>;

export function summarize(scores: readonly Scored[]): Summary {
    const share = (pass: (s: Scored) => boolean) =>
        scores.length === 0 ? 0 : scores.filter(pass).length / scores.length;
    const units = scores.reduce((n, s) => n + (s.mustKeep ?? 0), 0);
    return {
        cases: scores.length,
        rates: {
            1: share((s) => s.criteria[1]),
            2: share((s) => s.criteria[2]),
            3: share((s) => s.criteria[3]),
            4: share((s) => s.criteria[4]),
            all: share((s) => CRITERIA.every((c) => s.criteria[c])),
        },
        medianRatio: median(scores.map((s) => s.ratio)),
        recall: units === 0 ? 1 : scores.reduce((n, s) => n + (s.kept ?? 0), 0) / units,
    };
}

// what fell below the baseline, over the cases both hold: a criterion's pass rate lower, or the median line ratio
// more than RATIO_SLACK above it. empty when nothing did
export function regressions(now: Readonly<Record<string, Scored>>, baseline: Baseline): string[] {
    const ids = Object.keys(now).filter((id) => baseline.cases[id] !== undefined);
    const was = summarize(ids.map((id) => baseline.cases[id] as Scored));
    const is = summarize(ids.map((id) => now[id] as Scored));
    const out: string[] = [];
    for (const c of CRITERIA) {
        if (is.rates[c] < was.rates[c] - 1e-9) {
            out.push(
                `criterion ${c}: ${pct(is.rates[c])} of ${ids.length} cases pass, the baseline ${pct(was.rates[c])}`
            );
        }
    }
    if (is.medianRatio > was.medianRatio + RATIO_SLACK + 1e-9) {
        out.push(
            `median line ratio ${pct(is.medianRatio)}, more than 10 points over the baseline's ${pct(was.medianRatio)}`
        );
    }
    return out;
}

export function pct(share: number): string {
    return `${Math.round(share * 100)}%`;
}

// layer 1 as a table the bench prints
export function report(summary: Summary): string {
    const rows = [
        ["1 every reason has content", summary.rates[1]],
        ["2 warnings and what waits stay", summary.rates[2]],
        ["3 a mark keeps its context", summary.rates[3]],
        ["4 every section has a line", summary.rates[4]],
        ["all four", summary.rates.all],
    ] as const;
    return [
        `skim bench, layer 1: ${summary.cases} cases`,
        ...rows.map(([label, rate]) => `  ${label.padEnd(32)} ${pct(rate).padStart(4)}`),
        `  must-keep recall                 ${pct(summary.recall).padStart(4)}`,
        `  median fold/reply lines          ${pct(summary.medianRatio).padStart(4)}`,
    ].join("\n");
}

// the reasons a case file cannot be scored; empty when it can
export function problems(c: Case): string[] {
    const out: string[] = [];
    if (typeof c.reply !== "string" || !Array.isArray(c.marks) || !Array.isArray(c.mustKeep)) {
        return ["reply, marks and mustKeep are required"];
    }
    if (c.source !== "history" && c.source !== "generated") {
        out.push(`source is ${String(c.source)}, not history or generated`);
    }
    if (!isFoldable(c.reply, c.marks)) {
        out.push("the reply does not fold: too short, or it ends on a question");
    }
    for (const mark of c.marks) {
        if (!c.reply.includes(mark)) {
            out.push(`mark not in the reply: "${mark}"`);
        }
    }
    for (const unit of c.mustKeep) {
        if (unit.criterion !== 2 && unit.criterion !== 3) {
            out.push(`must-keep criterion ${String(unit.criterion)} is not 2 or 3: "${unit.text}"`);
        }
        if (!isKept(unit.text, c.reply)) {
            out.push(`must-keep not in the reply: "${unit.text}"`);
        }
    }
    if (!Array.isArray(c.questions) || c.questions.some((q) => !q.q?.trim() || !q.a?.trim())) {
        out.push("each question needs q and a");
    }
    return out;
}

// the failure kinds today's fold shows on a reply, as the spec's scan named them: 1 a reason left as its bold label,
// 2 only the first list survives, 3 a marked reply loses a mark's context, 4 a marked reply folds too hard. used to
// pick history cases that cover all four
export function failureKinds(s: Score, isMarked: boolean): number[] {
    const kinds: number[] = [];
    if (!s.criteria[1]) kinds.push(1);
    if (!isMarked && !s.criteria[4]) kinds.push(2);
    if (isMarked && !s.criteria[3]) kinds.push(3);
    if (isMarked && !s.criteria[4]) kinds.push(4);
    return kinds;
}

// a history reply made safe to commit: machine paths, the account's name, email addresses and tokens replaced. names
// of people and private figures are left to the person on the review page
export function scrub(text: string, who: { home: string; user: string }): string {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const homes = [who.home, who.home.replace(/\\/g, "/")].filter((h) => h.length > 3);
    let out = text;
    for (const home of homes) {
        out = out.replace(new RegExp(escape(home), "gi"), "~");
    }
    return (
        out
            // a drive path keeps its last two parts: D:\work\repo\pkg\x.go → …\pkg\x.go
            .replace(/\b[A-Za-z]:[\\/][^\s`'"<>|*?(),;]*/g, (path) => {
                const parts = path.split(/[\\/]/).filter((part) => part !== "");
                const sep = path.includes("\\") ? "\\" : "/";
                return parts.length <= 3 ? path : `…${sep}${parts.slice(-2).join(sep)}`;
            })
            .replace(/\/(?:Users|home)\/[^/\s`'"]+/g, "~")
            .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "someone@example.com")
            .replace(
                /\b(?:sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16})\b/g,
                "<token>"
            )
            .replace(
                /\b(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}\b/g,
                "<token>"
            )
            .replace(new RegExp(`\\b${escape(who.user)}\\b`, "gi"), "me")
    );
}
