// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure detail extractors for the transcript projection. No React, no Wave runtime imports.
// Deterministic; no LLM. v1 diffs are pragmatic: removed block then added block, no line gutters.

import type { AskQuestionDetail, EditFile, GrepMatch } from "./agentsviewmodel";

// A Claude tool_result `content` is either a string or an array of { type:"text", text }.
export function toolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .filter((b: any) => b?.type === "text" && typeof b.text === "string")
            .map((b: any) => b.text)
            .join("\n");
    }
    return "";
}

function baseCount(s: string): number {
    return s === "" ? 0 : s.split("\n").length;
}

export function buildEditDiff(path: string, oldStr: string, newStr: string): EditFile {
    const dels = baseCount(oldStr);
    const adds = baseCount(newStr);
    const lines = [
        ...(oldStr === "" ? [] : oldStr.split("\n").map((text) => ({ sign: "-" as const, text }))),
        ...(newStr === "" ? [] : newStr.split("\n").map((text) => ({ sign: "+" as const, text }))),
    ];
    return { path, badge: oldStr === "" ? "A" : "M", adds, dels, lines };
}

const GREP_PREFIX = /^(.*?:\d+):?(.*)$/;

export function parseGrep(output: string): GrepMatch[] {
    return output
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => {
            const m = GREP_PREFIX.exec(l);
            return m ? { loc: m[1], code: m[2] } : { loc: "", code: l };
        });
}

export function sliceRead(output: string, maxLines: number): { snippet: string; truncated: boolean } {
    const lines = output.split("\n");
    if (lines.length <= maxLines) return { snippet: output, truncated: false };
    return { snippet: lines.slice(0, maxLines).join("\n"), truncated: true };
}

// AskUserQuestion's input questions, unanswered. Entries without a question text are dropped.
export function askQuestions(raw: unknown[]): AskQuestionDetail[] {
    return raw
        .filter((q: any) => typeof q?.question === "string")
        .map((q: any) => ({
            question: q.question,
            ...(typeof q.header === "string" && q.header !== "" ? { header: q.header } : {}),
            options: (Array.isArray(q.options) ? q.options : [])
                .filter((o: any) => typeof o?.label === "string")
                .map((o: any) => ({
                    label: o.label,
                    ...(typeof o.description === "string" && o.description !== ""
                        ? { description: o.description }
                        : {}),
                })),
            picked: [],
        }));
}

const ASK_ANSWER_JOIN = ", ";

// claude records one string per question: the picked labels joined with ", ", or the text typed under "Other"
// ponytail: a label holding ", " matches only when picked alone; read per-option picks if claude ever records them
export function splitAskAnswer(answer: string, labels: string[]): { picked: string[]; typed?: string } {
    if (labels.includes(answer)) {
        return { picked: [answer] };
    }
    const parts = answer.split(ASK_ANSWER_JOIN);
    const picked = parts.filter((p) => labels.includes(p));
    const typed = parts.filter((p) => !labels.includes(p)).join(ASK_ANSWER_JOIN);
    return typed !== "" ? { picked, typed } : { picked };
}

const ASK_SUMMARY_MAX = 32; // the tool line's summary never shrinks, so a long answer would push the question out

// fills each question's answer from the result's question -> answer map, and returns the tool line's summary
export function answerAsk(questions: AskQuestionDetail[], answers: Record<string, unknown>): string | undefined {
    const given: string[] = [];
    for (const q of questions) {
        const answer = answers[q.question];
        if (typeof answer !== "string" || answer === "") {
            continue;
        }
        Object.assign(
            q,
            splitAskAnswer(
                answer,
                q.options.map((o) => o.label)
            )
        );
        given.push(answer);
    }
    if (given.length === 0) {
        return undefined;
    }
    if (questions.length > 1) {
        return `${given.length} answers`;
    }
    return given[0].length > ASK_SUMMARY_MAX ? given[0].slice(0, ASK_SUMMARY_MAX - 1) + "…" : given[0];
}

export function formatDuration(ms?: number): string {
    if (ms == null) return "";
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m`;
}
