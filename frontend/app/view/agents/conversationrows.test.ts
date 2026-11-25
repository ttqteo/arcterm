// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    councilSources,
    flatRows,
    navIds,
    nestedRows,
    searchRows,
    type ConversationRow,
    type EntryRow,
    type SessionEntry,
} from "./conversationrows";
import { councilHistoryRows } from "./councilhistory";
import type { LiveSession, SessionStatusFilter } from "./sessionsarchivestore";

const sess = (over: Partial<LiveSession> = {}): LiveSession =>
    ({
        id: "s",
        runtime: "claude",
        projectpath: "D:\\p",
        task: "A session",
        lastactivets: 0,
        transcriptpath: "",
        status: "done",
        live: false,
        needsAttention: false,
        events: [],
        ...over,
    }) as LiveSession;

const solo = (s: LiveSession): SessionEntry => ({
    key: `${s.runtime}:${s.id}`,
    live: s.live,
    lastactivets: s.lastactivets,
    sessions: [s],
});

const runEntry = (runId: string, members: LiveSession[]): SessionEntry => ({
    key: `run:${runId}`,
    live: members.some((m) => m.live),
    lastactivets: Math.max(...members.map((m) => m.lastactivets)),
    sessions: members,
});

const side = (tab: string, name: string, session?: string): PairSide => ({
    tab,
    name,
    harness: "claude",
    ...(session != null ? { session } : {}),
});

const pair = (id: string, over: Partial<PairInfo> = {}): PairInfo => ({
    id,
    project: "D:\\p",
    worker: side("worker-tab-0001", `Worker ${id}`),
    judges: [side("4c6ba858-0000-4000-8000-000000000000", "judge")],
    state: "ended",
    stopreason: "settled",
    owed: false,
    messagecount: 3,
    lastts: 0,
    updatedts: 1000,
    ...over,
});

const council = (id: string, over: Partial<Council> = {}): Council => ({
    id,
    project: "D:\\p",
    feature: `Feature ${id}`,
    experts: [],
    state: "done",
    round: 3,
    tokens: 0,
    calls: 0,
    created: 1000,
    updated: 1000,
    ...over,
});

const sources = (list: Council[]) => councilSources(list, councilHistoryRows(list, new Map()));

// the status filter as Conversation History draws it, cut down to what a test needs
const keep = (e: SessionEntry, f: SessionStatusFilter) => f === "all" || (f === "live" ? e.live : !e.live);

const nest = (
    entries: SessionEntry[],
    councils: Council[],
    pairs: PairInfo[],
    over: { filter?: SessionStatusFilter; more?: boolean } = {}
) => nestedRows(entries, sources(councils), pairs, { filter: "all", more: false, keep, ...over });

const entryOf = (rows: ConversationRow<SessionEntry>[], key: string) =>
    rows.find((r): r is EntryRow<SessionEntry> => r.kind === "entry" && r.key === key);

const s1 = sess({ id: "s1", task: "Plan oracle", lastactivets: 5000 });
const s2 = sess({ id: "s2", task: "Fix the sidebar", lastactivets: 4000 });

describe("nestedRows: nesting", () => {
    it("nests a pair under its worker's solo session, with its line", () => {
        const rows = nest([solo(s1), solo(s2)], [], [pair("p1", { worker: side("w", "Plan oracle", "s1") })]);
        expect(rows.map((r) => r.key)).toEqual(["claude:s1", "claude:s2"]);
        const nested = entryOf(rows, "claude:s1")!.nested;
        expect(nested.map((r) => r.key)).toEqual(["pair:p1"]);
        expect(nested[0].nestedLine).toBe("Pair with judge 4c6ba858 · both sides settled");
        expect(entryOf(rows, "claude:s2")!.nested).toEqual([]);
    });

    it("nests a pair under the run whose member session is its worker's", () => {
        const lead = sess({ id: "lead", runid: "r1", role: "lead", lastactivets: 3000 });
        const member = sess({ id: "m1", runid: "r1", role: "worker", taskid: "t-3", lastactivets: 6000 });
        const rows = nest(
            [runEntry("r1", [lead, member]), solo(s1)],
            [],
            [pair("p1", { worker: side("w", "Worker", "m1") })]
        );
        expect(entryOf(rows, "run:r1")!.nested.map((r) => r.key)).toEqual(["pair:p1"]);
        expect(entryOf(rows, "claude:s1")!.nested).toEqual([]);
        // the member's session is not an entry of its own
        expect(rows.map((r) => r.key)).toEqual(["run:r1", "claude:s1"]);
    });

    it("nests a council by the session id it carries, as Council: <feature>", () => {
        const rows = nest([solo(s1)], [council("c1", { feature: "Pairs in Conversations", sessionid: "s1" })], []);
        const nested = entryOf(rows, "claude:s1")!.nested;
        expect(nested.map((r) => r.key)).toEqual(["council:c1"]);
        expect(nested[0].nestedLine).toBe("Council: Pairs in Conversations");
    });

    it("lists what one session owns newest first, pairs and councils together", () => {
        const rows = nest(
            [solo(s1)],
            [council("c1", { sessionid: "s1", created: 2000 }), council("c2", { sessionid: "s1", created: 4000 })],
            [
                pair("old", { worker: side("w", "W", "s1"), updatedts: 1500 }),
                pair("new", { worker: side("w", "W", "s1"), updatedts: 3000 }),
            ]
        );
        expect(entryOf(rows, "claude:s1")!.nested.map((r) => r.key)).toEqual([
            "council:c2",
            "pair:new",
            "council:c1",
            "pair:old",
        ]);
    });

    it("stands a pair and a council that no session started top-level, placed by their own time", () => {
        const rows = nest(
            [solo(s1), solo(s2)],
            [council("c1", { created: 4500 })],
            [pair("p1", { updatedts: 5500 }), pair("p2", { worker: side("w", "W", "gone"), updatedts: 3000 })]
        );
        // a pair whose session is not loaded is as loose as one that names none
        expect(rows.map((r) => r.key)).toEqual(["pair:p1", "claude:s1", "council:c1", "claude:s2", "pair:p2"]);
    });
});

describe("nestedRows: the frontier", () => {
    // the oldest loaded session is s2, at 4000
    const loose = [pair("newer", { updatedts: 4500 }), pair("older", { updatedts: 3500 })];

    it("holds back a loose item older than the oldest loaded session while older pages are unread", () => {
        const rows = nest([solo(s1), solo(s2)], [council("c-old", { created: 3000 })], loose, { more: true });
        expect(rows.map((r) => r.key)).toEqual(["claude:s1", "pair:newer", "claude:s2"]);
    });

    it("shows it once every page is read", () => {
        const rows = nest([solo(s1), solo(s2)], [council("c-old", { created: 3000 })], loose, { more: false });
        expect(rows.map((r) => r.key)).toEqual(["claude:s1", "pair:newer", "claude:s2", "pair:older", "council:c-old"]);
    });

    it("reads the frontier off every session an entry holds, not the entry's time", () => {
        const lead = sess({ id: "lead", runid: "r1", role: "lead", lastactivets: 2000 });
        const member = sess({ id: "m1", runid: "r1", role: "worker", taskid: "t-1", lastactivets: 6000 });
        const rows = nest([runEntry("r1", [lead, member])], [], [pair("p1", { updatedts: 2500 })], { more: true });
        expect(rows.map((r) => r.key)).toEqual(["run:r1", "pair:p1"]);
    });

    it("holds nothing back when no session is loaded", () => {
        expect(nest([], [], loose, { more: true }).map((r) => r.key)).toEqual(["pair:newer", "pair:older"]);
    });

    it("lets a nested item ride with its entry whatever its time", () => {
        const rows = nest([solo(s1), solo(s2)], [], [pair("p1", { worker: side("w", "W", "s1"), updatedts: 10 })], {
            more: true,
        });
        expect(entryOf(rows, "claude:s1")!.nested.map((r) => r.key)).toEqual(["pair:p1"]);
    });
});

describe("nestedRows: the status filter", () => {
    const live = sess({ id: "live1", live: true, lastactivets: 9000 });
    const entries = [solo(live), solo(s1)];
    const items = {
        councils: [council("loose-c", { created: 9500 }), council("c-live", { sessionid: "live1", created: 8000 })],
        pairs: [pair("loose-p", { updatedts: 9600 }), pair("p-live", { worker: side("w", "W", "live1") })],
    };

    it("keeps nested items with their entry and shows the loose ones under All", () => {
        const rows = nest(entries, items.councils, items.pairs, { filter: "all" });
        expect(rows.map((r) => r.key)).toEqual(["pair:loose-p", "council:loose-c", "claude:live1", "claude:s1"]);
        expect(entryOf(rows, "claude:live1")!.nested.map((r) => r.key)).toEqual(["council:c-live", "pair:p-live"]);
    });

    it("drops an entry the filter rejects, with what is nested under it, and every loose item", () => {
        const rows = nest(entries, items.councils, items.pairs, { filter: "live" });
        expect(rows.map((r) => r.key)).toEqual(["claude:live1"]);
        expect(entryOf(rows, "claude:live1")!.nested.map((r) => r.key)).toEqual(["council:c-live", "pair:p-live"]);
        const done = nest(entries, items.councils, items.pairs, { filter: "done" });
        expect(done.map((r) => r.key)).toEqual(["claude:s1"]);
    });
});

describe("pair and council rows", () => {
    it("names a standing pair by its worker, the judge and why it stopped under it", () => {
        const [row] = nest([], [], [pair("p1", { worker: side("w", "Plan oracle") })]);
        expect(row).toMatchObject({ kind: "pair", key: "pair:p1", title: "Plan oracle" });
        expect(row).toMatchObject({ line: "Judge 4c6ba858 · both sides settled" });
    });

    it("says a relaying pair is still relaying, in both lines", () => {
        const [row] = nest([], [], [pair("p1", { state: "relaying", stopreason: "" })]);
        expect(row).toMatchObject({
            line: "Judge 4c6ba858 · still relaying",
            nestedLine: "Pair with judge 4c6ba858 · still relaying",
        });
    });

    it("counts the judges of a pair that has several, and marks a synced one", () => {
        const [row] = nest(
            [],
            [],
            [
                pair("p1", {
                    judges: [side("4c6ba858-x", "j1"), side("aaaaaaaa-x", "j2")],
                    synced: true,
                    stopreason: "token-cap",
                }),
            ]
        );
        expect(row).toMatchObject({
            line: "2 judges · token cap reached · as of the last sync",
            nestedLine: "Pair with 2 judges · token cap reached · as of the last sync",
        });
    });

    it("gives a pair whose worker has no name a title anyway", () => {
        const [row] = nest([], [], [pair("p1", { worker: side("w", "") })]);
        expect(row).toMatchObject({ title: "Working agent" });
    });

    it("times a pair by its last save and a council by its newest message", () => {
        const rows = nest([], [council("c1", { created: 777 })], [pair("p1", { updatedts: 888 })]);
        expect(rows.map((r) => [r.key, r.lastactivets, r.live])).toEqual([
            ["pair:p1", 888, false],
            ["council:c1", 777, false],
        ]);
    });
});

describe("flatRows", () => {
    const sessions = [
        sess({ id: "s1", task: "Plan oracle", lastactivets: 5000 }),
        sess({ id: "m1", runid: "r1", role: "worker", taskid: "t-3", lastactivets: 4000 }),
    ];
    const councils = sources([
        council("c1", { sessionid: "s1", created: 2000 }),
        council("c2", { created: 3000 }),
        council("c3", { sessionid: "deadbeef-0000-4000-8000-000000000000", created: 2500 }),
    ]);
    const pairs = [
        pair("p1", { worker: side("w", "Plan oracle", "s1"), updatedts: 6000 }),
        pair("p2", { worker: side("w", "Worker", "m1"), updatedts: 1000 }),
    ];
    const titles = { r1: "Port the header" };
    const flat = (kinds: { judge: boolean; council: boolean }) => flatRows(kinds, sessions, councils, pairs, titles);

    it("lists only pairs under the Judge chip, newest first, each naming the session that started it", () => {
        const rows = flat({ judge: true, council: false });
        expect(rows.map((r) => [r.key, r.startedFrom])).toEqual([
            ["pair:p1", "Plan oracle"],
            ["pair:p2", "Port the header · task 3"],
        ]);
    });

    it("lists only councils under the Council chip", () => {
        const rows = flat({ judge: false, council: true });
        expect(rows.map((r) => r.key)).toEqual(["council:c2", "council:c3", "council:c1"]);
    });

    it("says where a council that no session started came from, and shortens a session not loaded yet", () => {
        const rows = flat({ judge: false, council: true });
        expect(rows.map((r) => r.startedFrom)).toEqual([
            "Started from the cockpit, not a session",
            "deadbeef",
            "Plan oracle",
        ]);
    });

    it("lists both kinds together, nothing nested, under both chips", () => {
        const rows = flat({ judge: true, council: true });
        expect(rows.map((r) => r.key)).toEqual(["pair:p1", "council:c2", "council:c3", "council:c1", "pair:p2"]);
    });

    it("lists nothing with no chip on: the nested list is the one for that", () => {
        expect(flat({ judge: false, council: false })).toEqual([]);
    });
});

describe("searchRows", () => {
    const councils = sources([
        council("c1", { feature: "Judge pairs in Library", created: 2000 }),
        council("c2", { feature: "Sidebar polish", created: 3000 }),
    ]);
    const pairs = [
        pair("p1", { worker: side("w", "Plan oracle"), updatedts: 2500 }),
        pair("p2", { worker: side("w", "Fix sidebar"), updatedts: 1000 }),
    ];

    it("finds a council by its feature", () => {
        expect(searchRows("polish", councils, pairs).map((r) => r.key)).toEqual(["council:c2"]);
    });

    it("finds a pair by its worker's name", () => {
        expect(searchRows("ORACLE", councils, pairs).map((r) => r.key)).toEqual(["pair:p1"]);
    });

    it("lists councils and pairs a query matches together, newest first", () => {
        expect(searchRows("sidebar", councils, pairs).map((r) => r.key)).toEqual(["council:c2", "pair:p2"]);
    });

    it("finds nothing for a query nothing holds", () => {
        expect(searchRows("zzz", councils, pairs)).toEqual([]);
    });
});

describe("navIds", () => {
    it("holds an entry and the pairs nested under it, never a council", () => {
        const rows = nest(
            [solo(s1), solo(s2)],
            [council("c-nested", { sessionid: "s1", created: 4900 }), council("c-loose", { created: 9000 })],
            [pair("p-nested", { worker: side("w", "W", "s1"), updatedts: 4800 }), pair("p-loose", { updatedts: 4500 })]
        );
        expect(navIds(rows)).toEqual(["claude:s1", "pair:p-nested", "pair:p-loose", "claude:s2"]);
    });

    it("holds the pairs of a flat list and none of its councils", () => {
        const rows = flatRows(
            { judge: true, council: true },
            [],
            sources([council("c1", { created: 3000 })]),
            [pair("p1", { updatedts: 2000 })],
            {}
        );
        expect(navIds(rows)).toEqual(["pair:p1"]);
    });
});

describe("councilSources", () => {
    it("carries the session id of each council beside its row, none for a council no session started", () => {
        const list = [council("c1", { sessionid: "s1" }), council("c2")];
        const out = councilSources(list, councilHistoryRows(list, new Map()));
        expect(out.map((c) => [c.row.id, c.sessionId]).sort()).toEqual([
            ["c1", "s1"],
            ["c2", ""],
        ]);
    });

    it("has none for a list not loaded yet", () => {
        expect(councilSources(null, [])).toEqual([]);
    });
});
