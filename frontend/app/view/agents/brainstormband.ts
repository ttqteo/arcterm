// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Chat band's brainstorm part reads (docs/superpowers/specs/2026-11-14-chat-brainstorm-status-design.md): how
// many boards the brainstorm has, which are new since the user last looked at the Brainstorm tab, and the decisions that
// are the user's. Pure: the store, the poller, the band and the header's tab dot all read "which boards are new" from
// here, so it is defined once. The names the user has seen are kept per brainstorm.json path (brainstormstore.ts).

import type { BrainstormFile } from "./brainstormmodel";
import { MAX_ANSWER_AGENTS, yoursGists, type Gist } from "./chatbrainstorm";

/** One board of the brainstorm: its file name, the title of the part that lists it first, and whether the user has not
 *  seen its name yet. */
export type BandBoard = { name: string; part: string; isNew: boolean };

export type BrainstormBandModel = {
    title: string;
    boards: BandBoard[];
    newCount: number;
    /** the decisions that are yours so far, in the design's order */
    decided: Gist[];
};

type ListedBoard = { name: string; part: string };

// every part's boards, notes included, in part order then board order, each name once and under the first part that lists
// it. A file with no `canvas` has none: a board with no canvas to serve it cannot be opened (`questionCard`'s `boards`
// count reads the same).
function listedBoards(f: BrainstormFile): ListedBoard[] {
    if (f.canvas == null) {
        return [];
    }
    const seen = new Set<string>();
    const out: ListedBoard[] = [];
    for (const p of f.parts) {
        for (const name of p.boards ?? []) {
            if (name !== "" && !seen.has(name)) {
                seen.add(name);
                out.push({ name, part: p.title });
            }
        }
    }
    return out;
}

/** The board names of the brainstorm, in part order without repeats; none while the file names no canvas. */
export function boardNames(f: BrainstormFile): string[] {
    return listedBoards(f).map((b) => b.name);
}

/** The brainstorm part of the band. `seen` is the names the user last saw, or null when there is no entry for this file
 *  (a brainstorm never looked at: every board is new). */
export function brainstormBandModel(f: BrainstormFile, seen: readonly string[] | null): BrainstormBandModel {
    const known = seen != null ? new Set(seen) : null;
    const boards = listedBoards(f).map((b) => ({ ...b, isNew: known == null || !known.has(b.name) }));
    return {
        title: f.title,
        boards,
        newCount: boards.filter((b) => b.isNew).length,
        decided: yoursGists(f),
    };
}

/** The dot on the header's Brainstorm tab: `asking` (amber) whenever the agent asks, whatever else is new; `new` (the
 *  accent) when it does not ask, the tab is not the one shown and a board is new; otherwise none. */
export function brainstormTabDot(newCount: number, asking: boolean, shown: boolean): "asking" | "new" | null {
    if (asking) {
        return "asking";
    }
    return !shown && newCount > 0 ? "new" : null;
}

/** brainstorm.json path -> the board names the user saw, and when */
export type SeenBoards = Record<string, { names: string[]; at: number }>;

const own = (map: object, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

/** The names seen for `path`, or null when there is no entry (the lookup reads own keys only). */
export function seenNamesOf(map: SeenBoards, path: string): readonly string[] | null {
    return own(map, path) ? map[path].names : null;
}

// the newest `MAX_ANSWER_AGENTS` paths by time (the cap `chat.brainstorm.sent` uses), `keep` always among them: a closed
// brainstorm's path would otherwise stay in storage for good
function pruneSeenBoards(map: SeenBoards, keep: string | null = null): SeenBoards {
    const paths = Object.keys(map);
    if (paths.length <= MAX_ANSWER_AGENTS) {
        return map;
    }
    const others = paths.filter((p) => p !== keep).sort((a, b) => map[b].at - map[a].at);
    const kept = (keep != null && own(map, keep) ? [keep] : []).concat(others).slice(0, MAX_ANSWER_AGENTS);
    return Object.fromEntries(kept.map((p) => [p, map[p]]));
}

/** What localStorage held: the entries that are well formed (a list of names and a finite time), anything else dropped
 *  entry by entry, never thrown. */
export function parseSeenBoards(raw: string | null | undefined): SeenBoards {
    if (!raw) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const out: SeenBoards = {};
    for (const [path, entry] of Object.entries(parsed as Record<string, unknown>)) {
        // assigning out["__proto__"] would swap the map's prototype instead of adding a path
        if (path === "__proto__" || entry == null || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const { names, at } = entry as Record<string, unknown>;
        if (!Array.isArray(names) || typeof at !== "number" || !Number.isFinite(at)) {
            continue;
        }
        out[path] = { names: names.filter((n): n is string => typeof n === "string"), at };
    }
    return pruneSeenBoards(out);
}

/** `map` with `names` as what the user saw of the brainstorm at `path`, at `now`, and the map cut to the newest 40 paths.
 *  The same object back when those are the names already stored, so nothing is written for no change. */
export function withSeenBoards(map: SeenBoards, path: string, names: readonly string[], now: number): SeenBoards {
    if (own(map, path)) {
        const stored = new Set(map[path].names);
        const next = new Set(names);
        if (stored.size === next.size && [...next].every((n) => stored.has(n))) {
            return map;
        }
    }
    return pruneSeenBoards({ ...map, [path]: { names: [...names], at: now } }, path);
}
