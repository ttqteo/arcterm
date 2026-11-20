// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent panel's Initiative tab reads and decides (railinitiativepane.tsx draws it; docs/superpowers/specs/
// 2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md): which of its four states it is in, what its cursor moves
// over, the tag at the end of a chunk row, where Pick a chunk… puts the cursor, and the heading of the latest-note
// section. The rows themselves are initiativeband.ts's (bandRows), which the Chat band used before the tab took its
// place. Pure: no jotai, no RPC.

import { formatAgo } from "./agentsviewmodel";
import { firstWorkOn, holderTag, type BandRow } from "./initiativeband";

/** The tab's state: the initiative is not read yet (`loading`) or could not be (`error`, Retry), it is read and the agent
 *  is on no chunk (`no-chunk`, the head asks to pick one), or it is read and the agent is on one (`ready`). A read that
 *  fails over an initiative already on screen leaves it there, so `failed` matters only while nothing is loaded. */
export type InitiativePaneState = "loading" | "error" | "no-chunk" | "ready";

export function initiativePaneState(i: { loaded: boolean; failed: boolean; onChunk: boolean }): InitiativePaneState {
    if (!i.loaded) {
        return i.failed ? "error" : "loading";
    }
    return i.onChunk ? "ready" : "no-chunk";
}

export type PaneList = "window" | "all";

/** What the cursor moves over: the window's rows, the All chunks row, then the full list's rows while it is open. */
export type PaneNav = { kind: "row"; row: BandRow; list: PaneList } | { kind: "all" };

export function paneNav(rows: { window: readonly BandRow[]; all: readonly BandRow[] }, allOpen: boolean): PaneNav[] {
    return [
        ...rows.window.map((row): PaneNav => ({ kind: "row", row, list: "window" })),
        { kind: "all" },
        ...(allOpen ? rows.all.map((row): PaneNav => ({ kind: "row", row, list: "all" })) : []),
    ];
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** The tag at the end of a chunk row: `this agent` for the agent's own, `next`, `done` / `skipped` for a settled one,
 *  else who else holds it (a roster name, `an agent` for one not in the roster, `a run`), else its status when it is not
 *  plain pending, else nothing. `nameOf` reads a holder's roster name from its tab id. */
export function rowTag(row: BandRow, agentId: string, nameOf: (tabId: string) => string | undefined): string {
    if (row.kind === "mine") {
        return "this agent";
    }
    if (row.kind === "next") {
        return "next";
    }
    if (row.status === "done" || row.status === "skipped") {
        return row.status;
    }
    const others = unique(
        row.holders.filter((h) => !(h.kind === "agent" && h.id === agentId)).map((h) => holderTag(h, agentId, nameOf))
    );
    if (others.length > 0) {
        return others.join(", ");
    }
    return row.status === "pending" ? "" : row.status;
}

/** Where Pick a chunk… puts the cursor: the first row that offers Work on this in the window, else the first in the full
 *  list, which opens for it (its rows come after the window's and the All chunks row). Null when no chunk offers it. */
export function pickTarget(rows: {
    window: readonly { workOn: boolean }[];
    all: readonly { workOn: boolean }[];
}): { allOpen: boolean; cursor: number } | null {
    const inWindow = firstWorkOn(rows.window);
    if (inWindow >= 0) {
        return { allOpen: false, cursor: inWindow };
    }
    const inAll = firstWorkOn(rows.all);
    return inAll >= 0 ? { allOpen: true, cursor: rows.window.length + 1 + inAll } : null;
}

/** The heading of the latest-note section: the number of the chunk the agent is on (null: none) and, when it has a note,
 *  how long ago that was (ms; null: no note). */
export function noteHeading(chunkNumber: number | null, ageMs: number | null): string {
    if (chunkNumber == null) {
        return "Latest note";
    }
    return ageMs == null ? `Latest note on ${chunkNumber}` : `Latest note on ${chunkNumber} · ${formatAgo(ageMs)}`;
}
