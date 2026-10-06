// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure group assembly for the universal search, and the rule that decides what typed text *is*. In
// All, a query that names something the cockpit already has (a surface, an agent, a run…) leads with
// that and Enter opens it; a query that names nothing is a goal, so the launch block leads and Enter
// starts it. Narrowed scopes are already small, so they list every match.

import { SCORE_PER_CHAR, fuzzyScore } from "./palette-match";

export type GroupKind =
    | "recent"
    | "surface"
    | "agent"
    | "run"
    | "session"
    // the jarvis entity kinds (see palette-entities.ts), named to match briefpalette's BriefKind
    | "record"
    | "effort"
    | "channel"
    | "action" // a verb row: one of a thing's actions, "Cancel run · <run>"
    | "command"
    | "file"
    | "theme"
    | "needs" // an attention item waiting on the user
    | "answer" // an inline option under the selected Needs you ask; answered by its digit, never selected
    | "start" // New run…, New agent…, New initiative…
    | "launch" // the "Start in #project" rows
    | "as-goal" // the one quiet row that expands into the launch rows
    | "widen" // "Search everything for …" in an empty narrowed scope
    | "line"; // ":152" on Code: that line of the open file

export interface GroupableItem {
    key: string;
    kind: GroupKind;
    search: string; // matched text; "" for rows that are never ranked
}

export interface PaletteGroup<T> {
    key: string;
    label: string;
    items: T[];
    rich?: boolean; // the launch block: accent-tinted, never capped
    emptyText?: string; // a group with nothing to show says why
    asking?: boolean; // waiting on the user: the label takes the asking tone
    hidden?: number; // rows left out before capping, counted in the overflow line
    more?: string; // where the overflow can be seen in full; default "keep typing"
    note?: string; // a closing line under the rows: an action list's "Not now: …"
}

export const KIND_LABELS: Partial<Record<GroupKind, string>> = {
    surface: "Go to",
    start: "Start",
    needs: "Needs you",
    agent: "Agents",
    run: "Runs",
    session: "Sessions",
    record: "Records",
    effort: "Initiatives", // the user-facing word for an effort (briefpalette's BRIEF_KIND_LABELS)
    channel: "Projects",
    action: "Actions",
    command: "Commands",
    theme: "Themes",
};

// All's kinds, in the order they show below the lead group. Files stay out of All so thousands of
// paths never drown the cockpit's own things; they have their own scope.
export const ALL_KIND_ORDER: GroupKind[] = [
    "surface",
    "start",
    "agent",
    "run",
    "action",
    "session",
    "record",
    "effort",
    "channel",
    "command",
];

// How dense a match has to be to count as a name rather than prose: on average every typed letter
// extends a run or starts a word. fuzzyScore is a permissive subsequence match, so without a floor a
// scattered hit (r…a…d inside "rank runs beside") takes a slot, and a long goal will often match
// *something* inside a long session task. The reference is SCORE_PER_CHAR per character — "usage"
// against "Go to Usage" scores 28 of 30. It is not a hard maximum (spaces can pick up extra
// word-boundary bonuses), which is harmless for a floor.
export const MIN_MATCH_DENSITY = 0.5;

export function meetsNameFloor(query: string, search: string): boolean {
    const q = query.trim();
    if (q === "") {
        return true;
    }
    const score = fuzzyScore(q, search);
    return score != null && score >= q.length * SCORE_PER_CHAR * MIN_MATCH_DENSITY;
}

// One group per kind, in `order`, with `lead` hoisted to the front. Empty kinds are dropped.
export function groupByKind<T extends GroupableItem>(
    items: T[],
    order: GroupKind[],
    lead?: GroupKind
): PaletteGroup<T>[] {
    const kinds = lead == null ? order : [lead, ...order.filter((k) => k !== lead)];
    return kinds
        .map((kind) => ({ key: kind, label: KIND_LABELS[kind] ?? kind, items: items.filter((it) => it.kind === kind) }))
        .filter((g) => g.items.length > 0);
}

export interface AllGroupsInput<T extends GroupableItem> {
    query: string;
    ranked: T[]; // every All kind, already ranked best-first; the floor is applied here
    recent: T[]; // most-recently-used rows, resolved against the current pool
    goto: T[]; // the surfaces, shown under Recent on an empty query
    launch: T[]; // the launch rows; [] when there is no goal or no project to start it in
    asGoalItem: T | null; // the quiet row that expands into `launch`; null when launch is empty
    asGoal: boolean; // that row was chosen
    projectLabel: string; // "#waveterm"
    needs: T[]; // everything waiting on the user, in Needs you order; the empty screen leads with a few
    start: T[]; // New run… and its siblings, always offered on the empty screen
}

// the empty screen previews Needs you; the scope lists the rest
export const NEEDS_IN_ALL = 3;

export function assembleAllGroups<T extends GroupableItem>(input: AllGroupsInput<T>): PaletteGroup<T>[] {
    const { query, ranked, recent, goto, launch, asGoalItem, asGoal, projectLabel, needs, start } = input;
    if (query.trim() === "") {
        // a row shown under Recent is not repeated under Start or Go to
        const recentKeys = new Set(recent.map((it) => it.key));
        const notRecent = (items: T[]) => items.filter((it) => !recentKeys.has(it.key));
        const lead = needs.slice(0, NEEDS_IN_ALL);
        const groups: PaletteGroup<T>[] = [
            {
                key: "needs",
                label: `Needs you · ${needs.length}`,
                items: lead,
                asking: true,
                hidden: needs.length - lead.length,
                more: "Needs you scope",
            },
            { key: "start", label: "Start", items: notRecent(start) },
            { key: "recent", label: "Recent", items: recent },
            { key: "goto", label: "Go to", items: notRecent(goto) },
        ];
        return groups.filter((g) => g.items.length > 0);
    }
    const names = ranked.filter((it) => meetsNameFloor(query, it.search));
    // The kind holding the best match leads, since Enter runs the first row. ranked is best-first.
    const nameGroups = groupByKind(names, ALL_KIND_ORDER, names[0]?.kind);
    const startBlock: PaletteGroup<T>[] =
        launch.length > 0 ? [{ key: "launch", label: `Start in ${projectLabel}`, rich: true, items: launch }] : [];
    if (names.length > 0 && !asGoal) {
        const orGoal = asGoalItem != null ? [{ key: "as-goal", label: "Or as a goal", items: [asGoalItem] }] : [];
        return [...nameGroups, ...orGoal];
    }
    return [...startBlock, ...nameGroups];
}

// A narrowed scope: every match, grouped by kind. Nothing to show says so, and with text typed it
// offers one row that widens the same text to All.
export function assembleScopeGroups<T extends GroupableItem>(input: {
    rows: T[];
    order: GroupKind[];
    label: string;
    noun: string;
    query: string;
    widenItem: T | null;
}): PaletteGroup<T>[] {
    const { rows, order, label, noun, query, widenItem } = input;
    if (rows.length > 0) {
        return groupByKind(rows, order);
    }
    const q = query.trim();
    if (q === "") {
        return [{ key: "empty", label, items: [], emptyText: `No ${noun} yet.` }];
    }
    return [{ key: "empty", label, items: widenItem ? [widenItem] : [], emptyText: `No ${noun} match “${q}”.` }];
}

// All caps its mixed groups so one kind cannot bury the rest; a narrowed scope caps only to keep a
// long list (hundreds of sessions, thousands of files) cheap to render.
export const MAX_IN_ALL = 5;
export const MAX_IN_SCOPE = 50;

export interface CappedGroup<T> extends PaletteGroup<T> {
    overflow: number;
}

// A silently truncated list reads as a complete one, so a capped group reports its overflow.
export function capGroups<T>(groups: PaletteGroup<T>[], max: number): CappedGroup<T>[] {
    return groups.map((g) => {
        const items = g.rich ? g.items : g.items.slice(0, max);
        return { ...g, items, overflow: (g.hidden ?? 0) + g.items.length - items.length };
    });
}
