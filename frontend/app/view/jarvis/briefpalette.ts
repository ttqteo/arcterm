// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief palette's pure index: the three wire lists -> one ranked, bounded row list. The Brief
// deliberately shows nothing unbounded, so records, initiatives and finished sessions are
// reachable only from here — archived ones included. Archiving takes something out of what surfaces
// at you, not out of what you can find, so archived rows stay searchable, carry the flag the row uses
// to grey itself, and can never outrank live work. Nothing else is filtered: what matched is what shows,
// and a query that matches nothing shows nothing.
//
// Matching, ranking, highlighting and the relevance floor are the cockpit palette's own (../cockpit/
// palette-match, palette-groups): this is that palette extended over more kinds, not a second one.
//
// No rpc, no atoms: the .tsx fetches and memoizes buildBriefIndex, then calls rankBriefRows per keystroke.

import { meetsNameFloor } from "@/app/cockpit/palette-groups";
import { fuzzyMatch, highlightRuns, rankPaletteItems } from "@/app/cockpit/palette-match";

// The mockup caps the list at 8 (docs/prototype/jarvis-brief-launch.dc.html).
export const BRIEF_PALETTE_CAP = 8;

// The one status value that means archived across dossiers and efforts.
const ARCHIVED_STATUS = "archived";

export function isArchivedStatus(status: string): boolean {
    return status === ARCHIVED_STATUS;
}

export type BriefKind = "record" | "effort" | "session";

// The kind column the row renders. "Initiative" is the user-facing word for an effort.
export const BRIEF_KIND_LABELS: Record<BriefKind, string> = {
    record: "Record",
    effort: "Initiative",
    session: "Session",
};

export interface BriefRow {
    key: string; // stable and unique across kinds
    kind: BriefKind;
    id: string; // the entity's own identifier as the wire gives it (an oref for efforts)
    title: string;
    meta: string;
    archived: boolean;
    ts: number; // last activity, for the no-query default order
    search: string; // matched text; rankPaletteItems reads this field by name
    titleRuns?: { text: string; hit: boolean }[] | null; // set by rankBriefRows; null when the query hit only keywords
}

export interface BriefPaletteInput {
    records?: SpaceSummary[]; // ListTaskDossiersCommand — every status, archived included
    efforts?: EffortSummary[]; // EffortListCommand with IncludeArchived
    sessions?: SessionActivity[];
}

function metaLine(parts: (string | number | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(" · ");
}

function row(kind: BriefKind, id: string, title: string, meta: string, archived: boolean, ts: number): BriefRow {
    return {
        key: `${kind}:${id}`,
        kind,
        id,
        title,
        meta,
        archived,
        ts: ts ?? 0,
        // the kind and the meta line are searchable too, so "archived" or "initiative" narrows by class
        search: `${title} ${kind} ${meta}`,
    };
}

export function buildBriefIndex(input: BriefPaletteInput): BriefRow[] {
    const records = (input.records ?? []).map((r) =>
        row(
            "record",
            r.id,
            r.objective || "(untitled record)",
            metaLine([r.status, r.ticket]),
            isArchivedStatus(r.status),
            r.updated
        )
    );
    const efforts = (input.efforts ?? []).map((e) => {
        // counted as the initiative band and the Brief's card count it: the summary's total leaves out a proposed chunk
        // but keeps a skipped one, which has left the plan
        const total = e.total - (e.chunks?.filter((c) => c.status === "skipped").length ?? 0);
        return row(
            "effort",
            e.oref,
            e.title || "(untitled initiative)",
            metaLine([e.status, total > 0 && `${e.done}/${total}`, e.project, e.ticket]),
            isArchivedStatus(e.status),
            e.updatedts
        );
    });
    // sessions are never archived — a finished session reads as done, not filed away
    const sessions = (input.sessions ?? []).map((s) =>
        row(
            "session",
            `${s.runtime}:${s.id}`,
            s.task || "(untitled session)",
            metaLine([s.status, s.projectname, s.branch]),
            false,
            s.lastactivets
        )
    );
    return [...records, ...efforts, ...sessions];
}

// Recency, because the three lists arrive kind-by-kind: without this the default set would be eight
// records and nothing else.
function byRecency(rows: BriefRow[]): BriefRow[] {
    return [...rows].sort((a, b) => b.ts - a.ts);
}

function withTitleRuns(rows: BriefRow[], query: string): BriefRow[] {
    if (query.trim() === "") {
        return rows.map((r) => ({ ...r, titleRuns: null }));
    }
    // search is not what the row displays, so re-match against the title; a keyword-only hit renders plain
    // rather than bolding the wrong characters.
    return rows.map((r) => {
        const m = fuzzyMatch(query, r.title);
        return { ...r, titleRuns: m == null ? null : highlightRuns(r.title, m.positions) };
    });
}

// The cockpit palette's own relevance floor, borrowed rather than re-thresholded: ⌘K here is that palette
// extended, so it must not be measurably looser — and this module widens `search` to cover the kind and the
// meta line, which makes a permissive subsequence matcher looser still. As in palette-groups.ts the floor
// decides precedence and emphasis, never suppression: a weak match is still a match and is still shown.
// Only the best-scoring row's `search` is read.
function namesSomething(query: string, ranked: BriefRow[]): boolean {
    if (ranked.length === 0 || query.trim() === "") {
        return false;
    }
    return meetsNameFloor(query, ranked[0].search);
}

export interface BriefRanking {
    rows: BriefRow[];
    confident: boolean; // false => matched, but not densely; the caller de-emphasizes rather than hides
}

/**
 * Ranks the index against `query` and caps it. Archived rows are ranked in their own pool and appended
 * after every live row, so an archived entry can never outrank a live one however well it matches; within
 * a pool the order is score-descending (ties keep input order). An empty query gets the recency default.
 * A query that matches nothing returns no rows, so the caller can say so rather than showing unrelated work.
 */
export function rankBriefRows(rows: BriefRow[], query: string, cap: number = BRIEF_PALETTE_CAP): BriefRanking {
    const live = rows.filter((r) => !r.archived);
    const archived = rows.filter((r) => r.archived);
    const q = query.trim();
    if (q === "") {
        // there is no query to be confident about, and nothing to highlight
        const dflt = [...byRecency(live), ...byRecency(archived)];
        return { rows: withTitleRuns(dflt.slice(0, cap), ""), confident: false };
    }
    const ranked = [...rankPaletteItems(live, q), ...rankPaletteItems(archived, q)];
    // Confidence is judged on this head, which is the best *live* match whenever any live row matched — the
    // ordering the user is actually reading. When nothing live matched it is the best archived match, so an
    // exact archived name reads as confident rather than as prose.
    return { rows: withTitleRuns(ranked.slice(0, cap), q), confident: namesSomething(q, ranked) };
}
