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
}

/** Pure: the figures table's rows: the figures Go verified, as `Council.figures` holds them (Go deduplicated them and
 *  kept the first verified copy's reference). A figure that did not check out is `failedFigureRows`'. */
export function figureRows(c: Council): FigureRow[] {
    return (c.figures ?? [])
        .filter(isVerifiedFigure)
        .map((f) => ({ value: oneLine(f.value), measures: oneLine(f.measures), ref: oneLine(f.ref) }));
}

export interface FailedFigureRow extends FigureRow {
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
