// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rows of Library's Conversations list, as data: the run and solo entries Conversation History builds, with the
// pairs and councils nested under the session that started them; the loose ones as rows of their own, placed by their own
// time; the flat lists the Judge and Council chips show; what a search finds; and the `j`/`k` order. The placing rule is
// the Overview's (historyplace.ts); the words of a pair are pairreadmodel.ts's. No view: conversationhistory.tsx draws it.

import { shortTabId } from "./agentrowmodel";
import { searchCouncilHistory, type CouncilHistoryRow } from "./councilhistory";
import { placeUnderSessions, type PlaceInput } from "./historyplace";
import { pairHistoryMatches, pairStateWords } from "./pairreadmodel";
import type { LiveSession, SessionStatusFilter } from "./sessionsarchivestore";
import { sessionKey, sessionLabel } from "./sessionsruns";

/** What the list needs of one entry it draws: an orchestrator run (its member sessions) or a session on its own. The
 *  view's own row extends it, and gets itself back in `EntryRow.entry`. */
export interface SessionEntry {
    key: string;
    live: boolean;
    lastactivets: number;
    /** the sessions the entry holds: a solo's own, a run's every member */
    sessions: readonly LiveSession[];
}

/** A council as the list takes it: the row the Councils tab drew, and the session that started it ("" when none did:
 *  `councilHistoryRows` leaves the id out). */
export interface CouncilSource {
    row: CouncilHistoryRow;
    sessionId: string;
}

// `live` and `lastactivets` make an item a `Recent`, so groupByRecency places it by its own time; Live now is for agents
interface ItemBase {
    key: string;
    id: string;
    live: false;
    /** its own time: a pair's last save, a council's newest message */
    lastactivets: number;
    /** the id of the session that started it: a pair's working agent's, a council's own; "" when none did */
    session: string;
    /** the tree line under its session's card: "Pair with judge 4c6ba858 · both sides settled", "Council: <feature>" */
    nestedLine: string;
}

export interface PairRow extends ItemBase {
    kind: "pair";
    info: PairInfo;
    /** the card's title when the pair stands alone: its working agent's name */
    title: string;
    /** under the title when it stands alone: "Judge 4c6ba858 · both sides settled" */
    line: string;
}

export interface CouncilRow extends ItemBase {
    kind: "council";
    /** what the Councils tab's row draws (CouncilHistoryRowView), and its Pin and Resume act on */
    row: CouncilHistoryRow;
}

export type ItemRow = PairRow | CouncilRow;

/** A row of the flat list, naming the session that started it. */
export type FlatRow = ItemRow & { startedFrom: string };

export interface EntryRow<E extends SessionEntry> {
    kind: "entry";
    key: string;
    live: boolean;
    lastactivets: number;
    entry: E;
    /** the pairs and councils its sessions started, newest first */
    nested: ItemRow[];
}

/** A top-level row of the nested list, newest first: an entry with what is nested under it, or a pair or council no
 *  listed session started. */
export type ConversationRow<E extends SessionEntry> = EntryRow<E> | ItemRow;

const FROM_COCKPIT = "Started from the cockpit, not a session";
const SHORT_SESSION = 8;

const newestFirst = (a: Pick<ItemBase, "key" | "lastactivets">, b: Pick<ItemBase, "key" | "lastactivets">) =>
    b.lastactivets - a.lastactivets || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** "judge 4c6ba858", or "2 judges" when the pair has none or several. */
function judgeWords(judges: readonly PairSide[]): string {
    return judges.length === 1 ? `judge ${shortTabId(judges[0].tab)}` : `${judges.length} judges`;
}

function pairRow(info: PairInfo): PairRow {
    const judges = judgeWords(info.judges ?? []);
    const words = pairStateWords(info);
    return {
        kind: "pair",
        key: `pair:${info.id}`,
        id: info.id,
        info,
        live: false,
        lastactivets: info.updatedts,
        session: info.worker.session ?? "",
        title: info.worker.name || "Working agent",
        line: `${judges.charAt(0).toUpperCase()}${judges.slice(1)} · ${words}`,
        nestedLine: `Pair with ${judges} · ${words}`,
    };
}

function councilRow({ row, sessionId }: CouncilSource): CouncilRow {
    return {
        kind: "council",
        key: `council:${row.id}`,
        id: row.id,
        live: false,
        row,
        lastactivets: row.lastAt,
        session: sessionId,
        nestedLine: `Council: ${row.feature}`,
    };
}

/** Pure: each council beside the session id it carries, from the list the rows were made of. */
export function councilSources(
    councils: readonly Council[] | null | undefined,
    rows: readonly CouncilHistoryRow[]
): CouncilSource[] {
    const sessionOf = new Map((councils ?? []).map((c) => [c.id, c.sessionid ?? ""]));
    return rows.map((row) => ({ row, sessionId: sessionOf.get(row.id) ?? "" }));
}

const place = (sessions: readonly LiveSession[], items: readonly ItemRow[]) =>
    placeUnderSessions(
        sessions,
        items.map((item): PlaceInput<ItemRow> => ({ item, sessionId: item.session }))
    );

export interface NestedOptions<E extends SessionEntry> {
    filter: SessionStatusFilter;
    /** whether an entry stays under `filter`. It decides the entry alone: what is nested under it rides along. */
    keep: (entry: E, filter: SessionStatusFilter) => boolean;
    /** older pages of sessions are unread (the archive's cursor is not "") */
    more: boolean;
}

/** Pure: the nested list, newest first (the view groups it by recency). Each entry that stays under the status filter
 *  carries the pairs and councils its sessions started, so a run's entry carries those of every member. A pair or council
 *  no loaded session started is a row of its own, but only under All; while older pages are unread, one older than the
 *  oldest loaded session waits for the page that may hold its session, and stands by its own time once the pages reach
 *  it. */
export function nestedRows<E extends SessionEntry>(
    entries: readonly E[],
    councils: readonly CouncilSource[],
    pairs: readonly PairInfo[],
    opts: NestedOptions<E>
): ConversationRow<E>[] {
    const sessions = entries.flatMap((e) => e.sessions);
    const { owned, loose } = place(sessions, [...councils.map(councilRow), ...pairs.map(pairRow)]);
    const rows: ConversationRow<E>[] = [];
    for (const entry of entries) {
        if (opts.keep(entry, opts.filter)) {
            const nested = entry.sessions.flatMap((s) => owned.get(sessionKey(s))?.items ?? []).sort(newestFirst);
            rows.push({
                kind: "entry",
                key: entry.key,
                live: entry.live,
                lastactivets: entry.lastactivets,
                entry,
                nested,
            });
        }
    }
    if (opts.filter === "all") {
        const frontier =
            opts.more && sessions.length > 0
                ? sessions.reduce((oldest, s) => Math.min(oldest, s.lastactivets), Infinity)
                : null;
        for (const { item } of loose) {
            if (frontier == null || item.lastactivets >= frontier) {
                rows.push(item);
            }
        }
    }
    return rows.sort(newestFirst);
}

/** Pure: what a chip on shows: only pairs (Judge), only councils (Council) or both, newest first, none nested, each
 *  naming the session that started it (its label, "Started from the cockpit, not a session", or the short id of one not
 *  loaded yet). `runTitles` are the run titles `sessionLabel` reads. With no chip on it has no rows: the nested list is
 *  the one then. */
export function flatRows(
    kinds: { judge: boolean; council: boolean },
    sessions: readonly LiveSession[],
    councils: readonly CouncilSource[],
    pairs: readonly PairInfo[],
    runTitles: Record<string, string>
): FlatRow[] {
    const items = [...(kinds.council ? councils.map(councilRow) : []), ...(kinds.judge ? pairs.map(pairRow) : [])];
    const { owned, loose } = place(sessions, items);
    const rows: FlatRow[] = [];
    for (const { owner, items: mine } of owned.values()) {
        for (const item of mine) {
            rows.push({ ...item, startedFrom: sessionLabel(owner, runTitles) });
        }
    }
    for (const { item, named } of loose) {
        rows.push({ ...item, startedFrom: named ? item.session.slice(0, SHORT_SESSION) : FROM_COCKPIT });
    }
    return rows.sort(newestFirst);
}

/** Pure: the councils and pairs a search query matches, newest first. */
export function searchRows(q: string, councils: readonly CouncilSource[], pairs: readonly PairInfo[]): ItemRow[] {
    const found = new Set(
        searchCouncilHistory(
            councils.map((c) => c.row),
            q
        )
    );
    return [
        ...councils.filter((c) => found.has(c.row)).map(councilRow),
        ...pairs.filter((p) => pairHistoryMatches(p, q)).map(pairRow),
    ].sort(newestFirst);
}

/** Pure: the `j`/`k` order of rows in the order they are drawn: each entry's key, then the pairs nested under it, and
 *  every standing pair. A council is not in it: selecting one leaves the list. */
export function navIds<E extends SessionEntry>(rows: readonly ConversationRow<E>[]): string[] {
    return rows.flatMap((r) => {
        if (r.kind === "entry") {
            return [r.key, ...r.nested.filter((n) => n.kind === "pair").map((n) => n.key)];
        }
        return r.kind === "pair" ? [r.key] : [];
    });
}
