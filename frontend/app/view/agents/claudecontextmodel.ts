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
