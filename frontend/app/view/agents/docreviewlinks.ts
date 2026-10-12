// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a review dialog's finding points at in its document: the plan tasks it names ("Task 3", "Tasks 7 and 8"),
// else the passage that shares the most of its inline-code terms and identifier-like words (`release_items`,
// FieldPolicy, /infra). Identifiers survive a spec written in another language than its decision list. Hovering
// the finding shows the place.

export interface FindingRef {
    tasks: number[];
    terms: string[];
    words: string[];
}

const TASK_REF = /\bTasks?\s+(\d+)((?:\s*(?:,|and|&|or)\s*(?:Task\s+)?\d+)*)/gi;
const NUMBER = /\d+/g;
const CODE = /`([^`\n]+)`/g;
const MIN_TERM = 3;
const MIN_WORD = 4;
const TASK_HEADING = /^\s*Task\s+(\d+)\b/i;
// snake_case, a.dotted.name, a/path, call(), camelCase or PascalCase, or letters with digits
const IDENTIFIER = /[_./(]|[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]/;
const EDGE_PUNCT = /^[\s"'([{<*]+|[\s"')\]}>*,;:!?.]+$/g;

const unique = <T>(xs: T[]) => [...new Set(xs)];

function identifierWords(text: string): string[] {
    return text
        .replace(CODE, " ")
        .split(/\s+/)
        .map((w) => w.replace(EDGE_PUNCT, ""))
        .filter((w) => w.length >= MIN_WORD && IDENTIFIER.test(w));
}

export function findingRef(item: string): FindingRef {
    const tasks: number[] = [];
    for (const m of item.matchAll(TASK_REF)) {
        tasks.push(...((m[1] + m[2]).match(NUMBER) ?? []).map(Number));
    }
    const terms = [...item.matchAll(CODE)].map((m) => m[1].trim()).filter((t) => t.length >= MIN_TERM);
    return { tasks: unique(tasks), terms: unique(terms), words: unique(identifierWords(item)) };
}

// how many of the finding's terms and words a passage contains, ignoring case
export function matchScore(text: string, ref: FindingRef): number {
    const hay = text.toLowerCase();
    return unique([...ref.terms, ...ref.words].map((t) => t.toLowerCase())).filter((t) => hay.includes(t)).length;
}

// The index of the passage a finding points at: the highest score, and of those the shortest (the list item over
// the list that holds it); -1 when none shares a term.
export function bestPassage(texts: string[], ref: FindingRef): number {
    let best = -1;
    let bestScore = 0;
    texts.forEach((text, i) => {
        const score = matchScore(text, ref);
        if (score > bestScore || (score === bestScore && score > 0 && text.length < texts[best].length)) {
            best = i;
            bestScore = score;
        }
    });
    return best;
}

// the task number a plan heading opens ("Task 3: Sync bar" → 3), or null
export function taskOfHeading(text: string): number | null {
    const m = TASK_HEADING.exec(text);
    return m ? Number(m[1]) : null;
}
