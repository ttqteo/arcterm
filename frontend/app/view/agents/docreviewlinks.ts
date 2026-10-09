// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a review dialog's finding points at in its document: the plan tasks it names ("Task 3", "Tasks 7 and 8")
// and its inline-code terms, the fallback for a finding that names no task. Hovering the finding shows the place.

export interface FindingRef {
    tasks: number[];
    terms: string[];
}

const TASK_REF = /\bTasks?\s+(\d+)((?:\s*(?:,|and|&|or)\s*(?:Task\s+)?\d+)*)/gi;
const NUMBER = /\d+/g;
const CODE = /`([^`\n]+)`/g;
const MIN_TERM = 3;
const TASK_HEADING = /^\s*Task\s+(\d+)\b/i;

const unique = <T>(xs: T[]) => [...new Set(xs)];

export function findingRef(item: string): FindingRef {
    const tasks: number[] = [];
    for (const m of item.matchAll(TASK_REF)) {
        tasks.push(...((m[1] + m[2]).match(NUMBER) ?? []).map(Number));
    }
    const terms = [...item.matchAll(CODE)].map((m) => m[1].trim()).filter((t) => t.length >= MIN_TERM);
    return { tasks: unique(tasks), terms: unique(terms) };
}

// the task number a plan heading opens ("Task 3: Sync bar" → 3), or null
export function taskOfHeading(text: string): number | null {
    const m = TASK_HEADING.exec(text);
    return m ? Number(m[1]) : null;
}
