// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { GroupableItem } from "@/app/cockpit/palette-groups";
import { fuzzyScore } from "@/app/cockpit/palette-match";
import { describe, expect, it } from "vitest";
import {
    BRIEF_PALETTE_CAP,
    buildBriefIndex,
    isArchivedStatus,
    rankBriefRows,
    type BriefPaletteInput,
} from "./briefpalette";

const MIN = 60_000;
const T0 = 1_800_000_000_000;

const record = (over: Partial<SpaceSummary>): SpaceSummary => ({
    id: "sp-1",
    objective: "attention ledger stays append-only",
    ticket: "WAVE-11",
    status: "active",
    updated: T0 - 60 * MIN,
    ...over,
});

const effort = (over: Partial<EffortSummary>): EffortSummary => ({
    oref: "effort:e-1",
    title: "Attention reliability",
    project: "waveterm",
    status: "active",
    chunks: [],
    done: 3,
    total: 7,
    updatedts: T0 - 15 * MIN,
    ...over,
});

const session = (over: Partial<SessionActivity>): SessionActivity => ({
    id: "s-1",
    runtime: "claude",
    projectpath: "/p/waveterm",
    projectname: "waveterm",
    branch: "main",
    task: "worktree junction sharing",
    model: "opus",
    tokenstotal: 1200,
    lastactivets: T0 - 5 * MIN,
    resumecommand: "claude --resume",
    transcriptpath: "/t/s-1.jsonl",
    status: "done",
    startedts: T0 - 40 * MIN,
    durationms: 35 * MIN,
    events: [],
    ...over,
});

// one live and one archived entry of every archivable kind, plus a finished session
const FULL: BriefPaletteInput = {
    records: [
        record({}),
        record({ id: "sp-2", objective: "in-memory attention fast path", status: "archived", updated: T0 - 120 * MIN }),
    ],
    efforts: [
        effort({}),
        effort({
            oref: "effort:e-2",
            title: "Harness sync",
            status: "archived",
            done: 1,
            total: 4,
            updatedts: T0 - 240 * MIN,
        }),
    ],
    sessions: [session({})],
};

const keys = (input: BriefPaletteInput, query: string, cap?: number) =>
    rankBriefRows(buildBriefIndex(input), query, cap).rows.map((r) => r.key);

describe("brief palette index", () => {
    it("reaches a record, an initiative and a session by a query on its title", () => {
        const rows = buildBriefIndex(FULL);
        expect(rankBriefRows(rows, "append").rows[0]).toMatchObject({ kind: "record", id: "sp-1" });
        expect(rankBriefRows(rows, "reliability").rows[0]).toMatchObject({ kind: "effort", id: "effort:e-1" });
        expect(rankBriefRows(rows, "junction").rows[0]).toMatchObject({ kind: "session", id: "claude:s-1" });
    });

    it("marks archived records and initiatives, and never a finished session", () => {
        const byKey = new Map(buildBriefIndex(FULL).map((r) => [r.key, r]));
        expect(byKey.get("record:sp-2").archived).toBe(true);
        expect(byKey.get("effort:effort:e-2").archived).toBe(true);
        expect(byKey.get("record:sp-1").archived).toBe(false);
        expect(byKey.get("session:claude:s-1").archived).toBe(false);
    });

    it("carries a title and a meta line for every row", () => {
        const byKey = new Map(buildBriefIndex(FULL).map((r) => [r.key, r]));
        expect(byKey.get("record:sp-1")).toMatchObject({
            title: "attention ledger stays append-only",
            meta: "active · WAVE-11",
        });
        expect(byKey.get("effort:effort:e-1").meta).toBe("active · 3/7 · waveterm");
        expect(byKey.get("session:claude:s-1").meta).toBe("done · waveterm · main");
    });

    it("counts an initiative's progress as the band does: a skipped chunk leaves the total", () => {
        const chunks = [
            { label: "A", status: "done" },
            { label: "B", status: "done" },
            { label: "C", status: "skipped" },
            { label: "D", status: "pending" },
        ] as EffortSummary["chunks"];
        // the summary's total keeps the skipped chunk (it leaves out only a proposed one)
        const rows = buildBriefIndex({ efforts: [effort({ done: 2, total: 4, chunks })] });
        expect(rows[0].meta).toBe("active · 2/3 · waveterm");
        // every chunk skipped: nothing left to count, so no count
        const allSkipped = [{ label: "A", status: "skipped" }] as EffortSummary["chunks"];
        expect(buildBriefIndex({ efforts: [effort({ done: 0, total: 1, chunks: allSkipped })] })[0].meta).toBe(
            "active · waveterm"
        );
    });

    it("survives absent and empty input lists", () => {
        expect(buildBriefIndex({})).toEqual([]);
        expect(buildBriefIndex({ records: null, efforts: undefined, sessions: null })).toEqual([]);
        expect(rankBriefRows(buildBriefIndex({}), "anything")).toEqual({ rows: [], confident: false });
        expect(rankBriefRows([], "")).toEqual({ rows: [], confident: false });
    });
});

describe("archived ordering", () => {
    // the premise the guarantee has to survive: both rows clear the relevance floor and the archived
    // one is the *better* match
    const input: BriefPaletteInput = {
        records: [record({ id: "sp-live", objective: "reauthorize the poller" })],
        efforts: [effort({ oref: "effort:e-arch", title: "auth", status: "archived", total: 0, project: "" })],
        // no "auth" subsequence anywhere in its search text, so its absence proves the query ranked
        // rather than fell back to the default set
        sessions: [session({ id: "s-noise", task: "unrelated shipping work" })],
    };

    it("ranks an archived entry last even when it scores higher than a live one", () => {
        const rows = buildBriefIndex(input);
        const live = rows.find((r) => r.id === "sp-live");
        const archived = rows.find((r) => r.archived);
        expect(fuzzyScore("auth", archived.search)).toBeGreaterThan(fuzzyScore("auth", live.search));
        expect(keys(input, "auth")).toEqual(["record:sp-live", "effort:effort:e-arch"]);
    });

    it("keeps live rows ahead of archived rows on an empty query, each pool most-recent first", () => {
        expect(keys(FULL, "")).toEqual([
            "session:claude:s-1",
            "effort:effort:e-1",
            "record:sp-1",
            "record:sp-2",
            "effort:effort:e-2",
        ]);
    });

    it("preserves input order among equally scored rows inside each pool", () => {
        const same = (id: string, archived: boolean) =>
            record({ id, objective: "identical title", status: archived ? "archived" : "active", updated: T0 });
        const input: BriefPaletteInput = {
            records: [same("a", false), same("b", true), same("c", false), same("d", true)],
        };
        expect(keys(input, "identical")).toEqual(["record:a", "record:c", "record:b", "record:d"]);
    });
});

describe("brief palette bounds", () => {
    const many = (n: number, archived = false) =>
        Array.from({ length: n }, (_, i) =>
            record({
                id: `sp-${i}`,
                objective: `poller drift note ${i}`,
                status: archived ? "archived" : "active",
                updated: T0 - i * MIN,
            })
        );

    it("caps at the mockup's default", () => {
        expect(BRIEF_PALETTE_CAP).toBe(8);
        expect(keys({ records: many(20) }, "").length).toBe(BRIEF_PALETTE_CAP);
        expect(keys({ records: many(20) }, "poller").length).toBe(BRIEF_PALETTE_CAP);
    });

    it("takes the cap as a parameter", () => {
        expect(keys({ records: many(20) }, "poller", 3).length).toBe(3);
        expect(keys({ records: many(20) }, "", 0)).toEqual([]);
    });

    it("drops archived rows entirely once live matches fill the cap", () => {
        const input: BriefPaletteInput = {
            records: [...many(BRIEF_PALETTE_CAP), record({ id: "sp-arch", objective: "poller", status: "archived" })],
        };
        expect(keys(input, "poller")).not.toContain("record:sp-arch");
    });
});

describe("brief palette relevance floor", () => {
    // the record is a subsequence match for "goat" (g-o-a-t inside "long goal about"), just not a dense one
    const input: BriefPaletteInput = {
        records: [record({ id: "sp-goal", objective: "a long goal about the untidy session" })],
        efforts: [effort({})],
        sessions: [session({})],
    };

    it("shows prose that matches but not densely, flagged unconfident rather than hidden", () => {
        const rows = buildBriefIndex(input);
        const weak = rows.find((r) => r.id === "sp-goal");
        expect(fuzzyScore("goat", weak.search)).not.toBeNull();
        const res = rankBriefRows(rows, "goat");
        expect(res.confident).toBe(false);
        expect(res.rows.length).toBeGreaterThan(0);
        // every row is a real match, so this is the ranked result and not the recency default
        expect(res.rows.every((r) => fuzzyScore("goat", r.search) != null)).toBe(true);
        expect(res.rows.map((r) => r.key)).not.toContain("effort:effort:e-1");
    });

    it("reports a genuine name query as confident", () => {
        const res = rankBriefRows(buildBriefIndex(input), "untidy");
        expect(res.confident).toBe(true);
        expect(res.rows[0].key).toBe("record:sp-goal");
    });

    it("returns no rows when nothing matches, which is what makes the empty state reachable", () => {
        const res = rankBriefRows(buildBriefIndex(FULL), "zzqx");
        expect(res).toEqual({ rows: [], confident: false });
    });

    it("keeps rows in the shape the shared floor reads", () => {
        const [row] = buildBriefIndex({ records: [record({})] });
        // compile-time link to palette-groups: renaming GroupableItem.search breaks this projection and the
        // floor call together, instead of silently leaving the Brief palette looser than the cockpit's.
        const projected: Pick<GroupableItem, "key" | "search"> = { key: row.key, search: row.search };
        expect(projected.key).toBe("record:sp-1");
        expect(projected.search).toContain(row.title);
        expect(projected.search).toContain(row.meta);
        expect(projected.search).toContain(row.kind);
    });
});

describe("brief palette highlighting", () => {
    it("splits the title on the matched run and leaves a keyword-only hit plain", () => {
        const rows = buildBriefIndex({ records: [record({ objective: "attention ledger" })] });
        expect(rankBriefRows(rows, "ledger").rows[0].titleRuns).toEqual([
            { text: "attention ", hit: false },
            { text: "ledger", hit: true },
        ]);
        // "WAVE-11" lives in the meta line, not the title
        expect(rankBriefRows(rows, "WAVE-11").rows[0].titleRuns).toBeNull();
        expect(rankBriefRows(rows, "").rows[0].titleRuns).toBeNull();
    });

    it("bolds an unconfident match too, because it is shown rather than replaced", () => {
        const rows = buildBriefIndex({ records: [record({ objective: "a long goal about the untidy session" })] });
        const res = rankBriefRows(rows, "goat");
        expect(res.confident).toBe(false);
        expect(res.rows[0].titleRuns.some((r) => r.hit)).toBe(true);
    });
});

describe("isArchivedStatus", () => {
    it("reads only the archived status as archived, for records and initiatives alike", () => {
        expect(isArchivedStatus("archived")).toBe(true);
        expect(isArchivedStatus("completed")).toBe(false);
        expect(isArchivedStatus("done")).toBe(false);
    });
});
