// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat box's `@` picker lists the live agents, the project's runs and its councils beside its files: a pick puts
// `agent:<id>`, `run:<id>` or `council:<id>` in the text, a reference for the agent to read with `wsh read` (the arc
// mod's prompt hook tells it so, claude/arc-mod/hooks/refs-core.ts), never an `@` mention, which a prompt starting with
// `@<tab id>` would send to that agent instead. Pure: the rows, the matching and the insert; filemention.tsx draws them.

import type { AgentVM } from "./agentsviewmodel";

export type RefKind = "agent" | "run" | "council";

export interface RefItem {
    kind: RefKind;
    id: string;
    // the row's text: an agent's task title or name, a run's goal, a council's feature
    label: string;
    // the line beside it: project, harness and state; status; state
    detail: string;
    // newest first within a kind
    ts: number;
}

// the characters of an id a reference keeps: what `wsh agents list` and `wsh runs list` print, and what wsh read takes
export const REF_ID_LEN = 8;
// the rows the picker shows at most, so the files under them stay in reach
export const REF_MAX_ROWS = 6;
// the runs and councils a project lists at most before a query narrows them
const PER_KIND = 20;

const KIND_WORDS: Record<RefKind, readonly string[]> = {
    agent: ["agent", "agents", "chat", "tab"],
    run: ["run", "runs"],
    council: ["council", "councils", "hội đồng"],
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The live agents a chat can refer to: every agent but the chat's own and plain terminals. */
export function agentRefs(agents: readonly AgentVM[], selfId: string): RefItem[] {
    return agents
        .filter((a) => a.id !== selfId && (a.kind == null || a.kind === "agent" || a.kind === "background"))
        .map((a, i) => ({
            kind: "agent" as const,
            id: a.id,
            label: clip(oneLine(a.task) || a.name, 80),
            detail: [a.project, a.agent, a.state].filter(Boolean).join(" · "),
            // the roster's order (asking, working, idle) is kept
            ts: -i,
        }));
}

/** A project's runs a chat can refer to: the top-level ones (a task's run is read through its parent), newest first. */
export function runRefs(runs: readonly Run[] | null | undefined): RefItem[] {
    return (runs ?? [])
        .filter((r) => !r.parentleadoref && !r.taskid)
        .map((r) => ({
            kind: "run" as const,
            id: r.oid,
            label: clip(oneLine(r.goal) || r.oid, 80),
            detail: [r.status, r.mode].filter(Boolean).join(" · "),
            ts: r.createdts ?? 0,
        }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, PER_KIND);
}

/** A project's councils a chat can refer to, newest save first, as the list holds them. */
export function councilRefs(councils: readonly Council[] | null | undefined): RefItem[] {
    return (councils ?? []).slice(0, PER_KIND).map((c, i) => ({
        kind: "council" as const,
        id: c.id,
        label: clip(oneLine(c.feature) || c.id, 80),
        detail: c.state ?? "",
        // the list is newest first already; its order is kept
        ts: -i,
    }));
}

const kindOrder: Record<RefKind, number> = { agent: 0, run: 1, council: 2 };

/** The kind a query asks for by name: "@run", "@coun", "@agent" (two letters at least), else null. */
export function queryKind(query: string): RefKind | null {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
        return null;
    }
    for (const kind of Object.keys(KIND_WORDS) as RefKind[]) {
        if (KIND_WORDS[kind].some((w) => w.startsWith(q))) {
            return kind;
        }
    }
    return null;
}

/**
 * The rows the `@` query lists, at most REF_MAX_ROWS: with no query none (a bare `@` lists files, as it always has); a
 * query that names a kind lists that kind's items; any other lists the items whose id starts with it or whose label or
 * detail holds every word of it. A query that holds a `/` or a `.` is a path, and lists none. Agents first, then runs,
 * then councils, each newest first.
 */
export function refMatches(query: string, items: readonly RefItem[]): RefItem[] {
    const q = query.trim().toLowerCase();
    if (q === "" || /[/.\\]/.test(q)) {
        return [];
    }
    const kind = queryKind(q);
    const words = q.split(/\s+/);
    const hit = (it: RefItem) => {
        if (kind != null) {
            return it.kind === kind;
        }
        if (it.id.toLowerCase().startsWith(q)) {
            return true;
        }
        const hay = `${it.label} ${it.detail}`.toLowerCase();
        return words.every((w) => hay.includes(w));
    };
    return items
        .filter(hit)
        .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.ts - a.ts)
        .slice(0, REF_MAX_ROWS);
}

/** What a pick writes: `kind:` and the id's first REF_ID_LEN characters. */
export function refToken(item: Pick<RefItem, "kind" | "id">): string {
    return `${item.kind}:${item.id.slice(0, REF_ID_LEN)}`;
}

/** The text with the `@query` from `start` to `caret` replaced by the item's reference and one space, and the caret
 *  after that space (a space already after the caret is not doubled). */
export function insertRef(
    text: string,
    start: number,
    caret: number,
    item: Pick<RefItem, "kind" | "id">
): { text: string; caret: number } {
    const token = refToken(item);
    const rest = text.slice(caret);
    const next = text.slice(0, start) + token + (rest.startsWith(" ") ? "" : " ") + rest;
    return { text: next, caret: start + token.length + 1 };
}
