// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What Setup shows of the lines the user accepted: a skill's additions (the Skills rail) and every accepted
// line, grouped (the Learned tab). Pure; the RPCs are in setupstore.ts.

// a line learned within this many days, today included, is "new"
const NEW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// One accepted line. A skill's line is addressed by `skill`, a memory's by `dir`; `id` is "<skill or cwd>#<key>".
export interface LearnedEntry {
    id: string;
    key: string;
    text: string;
    learned: string;
    count: number;
    skill?: string;
    dir?: string;
}

export interface LearnedGroup {
    key: string;
    kind: "skill" | "memory";
    title: string;
    subtitle?: string;
    lines: LearnedEntry[];
}

// the local YYYY-MM-DD, the form the backend stamps `learned` in
export function localDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayNumber(date: string): number | null {
    const m = DATE.exec(date);
    return m == null ? null : Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

// Learned in the last 7 days, today included: the "new" highlight.
export function isNewLine(learned: string, today: string): boolean {
    const then = dayNumber(learned);
    const now = dayNumber(today);
    return then != null && now != null && now - then < NEW_DAYS;
}

// "14/10 · 3×": the day it was learned and how many sessions showed it
export function lineMeta(line: Pick<LearnedEntry, "learned" | "count">): string {
    const m = DATE.exec(line.learned);
    return `${m == null ? line.learned : `${m[3]}/${m[2]}`} · ${line.count}×`;
}

// stable, so lines learned the same day keep the order the backend gave them
function newestFirst(lines: LearnedEntry[]): LearnedEntry[] {
    return lines.sort((a, b) => b.learned.localeCompare(a.learned));
}

export function skillLines(skill: string, additions: LearnAddition[]): LearnedEntry[] {
    return newestFirst(additions.map((a) => ({ ...a, id: `${skill}#${a.key}`, skill })));
}

function lastSegment(path: string): string {
    return (
        path
            .split(/[\\/]/)
            .filter((s) => s !== "")
            .pop() ?? path
    );
}

function byTitle(a: LearnedGroup, b: LearnedGroup): number {
    return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

// Skill groups by skill name, then memory groups by project folder; each group's lines newest first.
export function learnedGroups(accepted: Pick<CommandLearnAcceptedRtnData, "skills" | "memories">): LearnedGroup[] {
    const skills = new Map<string, LearnAddition[]>();
    for (const { skill, ...addition } of accepted.skills ?? []) {
        skills.set(skill, [...(skills.get(skill) ?? []), addition]);
    }
    const memories = new Map<string, LearnedEntry[]>();
    for (const { cwd, dir, ...addition } of accepted.memories ?? []) {
        memories.set(cwd, [...(memories.get(cwd) ?? []), { ...addition, id: `${cwd}#${addition.key}`, dir }]);
    }
    const skillGroups: LearnedGroup[] = [...skills].map(([skill, additions]) => ({
        key: `skill:${skill}`,
        kind: "skill",
        title: skill,
        lines: skillLines(skill, additions),
    }));
    const memoryGroups: LearnedGroup[] = [...memories].map(([cwd, lines]) => ({
        key: `memory:${cwd}`,
        kind: "memory",
        title: lastSegment(cwd),
        subtitle: cwd,
        lines: newestFirst(lines),
    }));
    return [...skillGroups.sort(byTitle), ...memoryGroups.sort(byTitle)];
}
