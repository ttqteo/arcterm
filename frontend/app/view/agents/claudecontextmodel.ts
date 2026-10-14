// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Project's list: the files ClaudeContextCommand returns for a project (pkg/claudecontext), grouped and
// ordered for the tab. Memory splits by its frontmatter type; a group with nothing in it keeps its heading and reads
// as empty, so a missing file shows as missing rather than forgotten.

export type ContextGroupKey = "instructions" | "memory" | "settings" | "skills" | "setup" | "global";

export const CONTEXT_GROUPS: { key: ContextGroupKey; label: string }[] = [
    { key: "instructions", label: "Instructions" },
    { key: "memory", label: "Memory" },
    { key: "settings", label: "Settings" },
    { key: "skills", label: "Skills & agents" },
    { key: "setup", label: "Setup" },
    { key: "global", label: "Global" },
];

// the memory types in the order the tab lists them; a file of another type, or none, goes under "other"
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

const MEMORY_INDEX = "MEMORY.md";

export interface ContextSection {
    head: string | null;
    rows: ClaudeContextFile[];
}

export interface ContextGroup {
    key: ContextGroupKey;
    label: string;
    count: number; // the files that exist
    sections: ContextSection[];
}

const byLabel = (a: ClaudeContextFile, b: ClaudeContextFile) => a.label.localeCompare(b.label);

function memorySections(rows: ClaudeContextFile[]): ContextSection[] {
    const index = rows.filter((r) => r.label === MEMORY_INDEX);
    const rest = rows.filter((r) => r.label !== MEMORY_INDEX);
    const sections: ContextSection[] = index.length > 0 ? [{ head: null, rows: index }] : [];
    for (const type of MEMORY_TYPES) {
        const typed = rest.filter((r) => r.note === type).sort(byLabel);
        if (typed.length > 0) {
            sections.push({ head: type, rows: typed });
        }
    }
    const other = rest.filter((r) => !MEMORY_TYPES.includes(r.note ?? "")).sort(byLabel);
    if (other.length > 0) {
        sections.push({ head: "other", rows: other });
    }
    return sections;
}

// Outside memory the backend's order stands: it is the order Claude looks in.
export function contextGroups(files: ClaudeContextFile[]): ContextGroup[] {
    return CONTEXT_GROUPS.map(({ key, label }) => {
        const rows = files.filter((f) => f.group === key);
        const sections = key === "memory" ? memorySections(rows) : rows.length > 0 ? [{ head: null, rows }] : [];
        return { key, label, count: rows.filter((r) => r.exists).length, sections };
    });
}

// The project the tab shows: the one chosen while it is still registered, else the app bar's filter, else the first.
export function contextProject(projects: { name: string }[], current: string | null, filter: string): string | null {
    const listed = (name: string | null) => name != null && projects.some((p) => p.name === name);
    if (listed(current)) {
        return current;
    }
    if (listed(filter)) {
        return filter;
    }
    return projects[0]?.name ?? null;
}

// The file the rail reads: the selection while it is listed and exists, else the first file that exists.
export function contextSelection(groups: ContextGroup[], selected: string | null): string | null {
    const rows = groups.flatMap((g) => g.sections.flatMap((s) => s.rows)).filter((r) => r.exists);
    if (selected != null && rows.some((r) => r.path === selected)) {
        return selected;
    }
    return rows[0]?.path ?? null;
}

export type ContextFileKind = "markdown" | "json" | "text";

export function contextFileKind(path: string): ContextFileKind {
    const p = path.toLowerCase();
    if (p.endsWith(".md")) {
        return "markdown";
    }
    if (p.endsWith(".json")) {
        return "json";
    }
    return "text";
}

// What the rail offers a file. Memory is Claude's to keep, so the app never edits it: a fix goes to Claude as a
// prompt (Correct), and any memory but the index can be moved to the trash (Delete). Other groups are read-only.
export interface ContextActions {
    correct: boolean;
    remove: boolean;
}

export function contextActions(row: ClaudeContextFile): ContextActions {
    const memory = row.group === "memory" && row.exists;
    return { correct: memory, remove: memory && row.label !== MEMORY_INDEX };
}

// The prompt Correct sends: always one line, since a terminal submits at the first newline, and naming the file by its
// full path so the agent edits that one. Blank when nothing is typed.
export function correctionLine(path: string, note: string): string {
    const what = note.replace(/\s+/g, " ").trim();
    return what === "" ? "" : `fix your memory ${path} — ${what}`;
}

// Who a correction goes to: the project's one live Claude agent, a menu of them when there are several, or the
// clipboard when there is none. Memory is Claude's, so another harness's agent is never offered.
export type CorrectTarget<A> = { kind: "agent"; agent: A } | { kind: "menu"; agents: A[] } | { kind: "copy" };

export function correctTarget<A extends { agent?: string }>(live: readonly A[]): CorrectTarget<A> {
    const claude = live.filter((a) => a.agent === "claude");
    if (claude.length === 1) {
        return { kind: "agent", agent: claude[0] };
    }
    return claude.length > 1 ? { kind: "menu", agents: claude } : { kind: "copy" };
}

// The memory the rail moves to once path goes to the trash: the next one in the group, else the one before, else
// none (the tab's first file).
export function memoryAfterRemoval(groups: ContextGroup[], path: string): string | null {
    const rows = (groups.find((g) => g.key === "memory")?.sections ?? [])
        .flatMap((s) => s.rows)
        .filter((r) => r.exists);
    const i = rows.findIndex((r) => r.path === path);
    if (i < 0) {
        return null;
    }
    return rows[i + 1]?.path ?? rows[i - 1]?.path ?? null;
}
