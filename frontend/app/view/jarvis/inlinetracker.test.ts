// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ChunkRowModel } from "./effortstore";
import {
    chunkDueChip,
    chunkRowId,
    flatPlanId,
    initiativeRows,
    localDay,
    STAGE_PREVIEW_CAP,
    stageRowId,
    stageStartsOpen,
    type DetailRow,
} from "./inlinetracker";

const OREF = "effort:7f2c";

function chunk(label: string, status: string, stage: string): ChunkRowModel {
    return { label, status, stage, tone: "pending", trail: [], workrefs: [] };
}

// two stages, and the chunk the initiative picks up next sits in the SECOND one
const CHUNKS: ChunkRowModel[] = [
    chunk("S6-P0 persist weak-signal buffer", "done", "Ticket #1"),
    chunk("S6-P2/P3 retention + D5 purge", "done", "Ticket #1"),
    chunk("S8 item #2 campaign-level narration", "active", "Ticket #2"),
    chunk("S9 chain campaigns", "deferred", "Ticket #2"),
];

const base = {
    oref: OREF,
    chunks: CHUNKS,
    noteCounts: new Map([["S8 item #2 campaign-level narration", 11]]),
    stageOverrides: {},
};

const ids = (rows: DetailRow[]) => rows.map((r) => `${r.kind}:${r.id}`);

describe("initiativeRows' plan", () => {
    it("folds the fully-done stage and opens the unfinished one", () => {
        const stages = initiativeRows(base).filter((r) => r.kind === "stage");
        expect(stages.map((s) => (s.kind === "stage" ? [s.stage, s.collapsed] : null))).toEqual([
            ["Ticket #1", true],
            ["Ticket #2", false],
        ]);
        expect(stages.map((s) => (s.kind === "stage" ? s.at : -1))).toEqual([0, 1]);
    });

    it("lays the stages and their chunks out in plan order, keyed under the effort", () => {
        expect(ids(initiativeRows(base))).toEqual([
            "facts:" + OREF + "/facts",
            "stage:" + stageRowId(OREF, "Ticket #1", 0),
            "chunk:" + chunkRowId(OREF, "S6-P0 persist weak-signal buffer"),
            "chunk:" + chunkRowId(OREF, "S6-P2/P3 retention + D5 purge"),
            "stage:" + stageRowId(OREF, "Ticket #2", 1),
            "chunk:" + chunkRowId(OREF, "S8 item #2 campaign-level narration"),
            "chunk:" + chunkRowId(OREF, "S9 chain campaigns"),
        ]);
    });

    it("lets an explicit toggle beat the default on either side", () => {
        const opened = initiativeRows({ ...base, stageOverrides: { [stageRowId(OREF, "Ticket #1", 0)]: true } });
        expect(opened.find((r) => r.kind === "stage")).toMatchObject({ collapsed: false });
        const closed = initiativeRows({ ...base, stageOverrides: { [stageRowId(OREF, "Ticket #2", 1)]: false } });
        expect(closed.filter((r) => r.kind === "stage").every((r) => r.kind === "stage" && r.collapsed)).toBe(true);
    });

    it("marks the next chunk and carries each chunk's note count", () => {
        const chunks = initiativeRows(base).filter((r) => r.kind === "chunk" && r.row.stage === "Ticket #2");
        expect(chunks.map((c) => (c.kind === "chunk" ? [c.row.label, c.next, c.notes] : null))).toEqual([
            ["S8 item #2 campaign-level narration", true, 11],
            ["S9 chain campaigns", false, 0],
        ]);
    });

    it("says the plan is loading rather than flashing an empty one", () => {
        expect(initiativeRows({ ...base, chunks: null })).toEqual([
            { kind: "pending", id: OREF + "/pending", oref: OREF, message: "Loading this initiative's plan…" },
        ]);
    });

    it("says so when the initiative genuinely has no chunks", () => {
        const rows = initiativeRows({ ...base, chunks: [] });
        expect(rows[0]).toMatchObject({ kind: "pending", message: "No chunks on this initiative yet." });
    });

    it("keys stages by position, so a stage that reappears later toggles independently", () => {
        const reappearing = [
            chunk("a", "done", "Ticket #1"),
            chunk("b", "active", "Ticket #2"),
            chunk("c", "pending", "Ticket #1"),
        ];
        const stages = initiativeRows({ ...base, chunks: reappearing })
            .filter((r) => r.kind === "stage")
            .map((r) => r.id);
        expect(new Set(stages).size).toBe(3);
    });

    it("carries the footer's chunk count and marks the first stage", () => {
        const rows = initiativeRows({
            ...base,
            chunks: [chunk("a", "done", "P1"), chunk("b", "blocked", "P2"), chunk("c", "pending", "P2")],
        });
        expect(rows.find((r) => r.kind === "facts")).toMatchObject({ count: "3 chunks · 1 done" });
        const stages = rows.filter((r) => r.kind === "stage");
        expect(stages.map((s) => (s as { first: boolean }).first)).toEqual([true, false]);
    });
});

describe("stageStartsOpen (design: fully-done stages of 2+ chunks fold)", () => {
    it("folds a finished stage", () => {
        expect(stageStartsOpen({ rows: [chunk("a", "done", "S"), chunk("b", "done", "S")] })).toBe(false);
    });
    it("keeps a one-chunk finished stage open", () => {
        expect(stageStartsOpen({ rows: [chunk("a", "done", "S")] })).toBe(true);
    });
    it("opens every unfinished stage", () => {
        expect(stageStartsOpen({ rows: [chunk("a", "done", "S"), chunk("b", "pending", "S")] })).toBe(true);
    });
});

const FLAT: ChunkRowModel[] = [
    chunk("F1 schema", "done", ""),
    chunk("F2 writer", "done", ""),
    chunk("F3 reader", "done", ""),
];

describe("initiativeRows on a flat plan", () => {
    it("draws no stage header and shows a short plan whole, even when all are done", () => {
        const rows = initiativeRows({ ...base, chunks: FLAT });
        expect(rows.some((r) => r.kind === "stage")).toBe(false);
        expect(rows.filter((r) => r.kind === "chunk").map((r) => r.id)).toEqual(
            FLAT.map((c) => chunkRowId(OREF, c.label))
        );
    });

    it("keeps the unstaged run's header once any chunk is staged", () => {
        const mixed = [chunk("S1", "active", "Ticket #1"), chunk("U1", "pending", "")];
        const rows = initiativeRows({ ...base, chunks: mixed });
        expect(rows.filter((r) => r.kind === "stage").map((r) => (r.kind === "stage" ? r.stage : ""))).toEqual([
            "Ticket #1",
            "",
        ]);
    });
});

describe("initiativeRows with proposed chunks", () => {
    const PROPOSED = [
        {
            ...chunk("P1 wire the rail", "proposed", "Ticket #3"),
            trail: [
                { ts: 1, text: "older" },
                { ts: 5, text: "after the picker" },
            ],
        },
        chunk("P2 board", "proposed", ""),
    ];
    const withProposed = [...CHUNKS, ...PROPOSED];

    it("puts a proposed group first, listing them with stage and newest note", () => {
        const rows = initiativeRows({ ...base, chunks: withProposed });
        expect(rows[0]).toEqual({
            kind: "proposed",
            id: OREF + "/proposed",
            oref: OREF,
            rows: [
                { label: "P1 wire the rail", meta: "Ticket #3 · after the picker" },
                { label: "P2 board", meta: "" },
            ],
        });
        // the group sits above the plan: the facts row and the stages follow it
        expect(rows[1]).toMatchObject({ kind: "facts" });
    });

    it("leaves them out of the stage groups, the chunk rows and every count", () => {
        const rows = initiativeRows({ ...base, chunks: withProposed });
        expect(ids(rows.filter((r) => r.kind !== "proposed"))).toEqual(ids(initiativeRows(base)));
        expect(rows.find((r) => r.kind === "facts")).toMatchObject({ count: "4 chunks · 2 done" });
        expect(rows.filter((r) => r.kind === "stage").map((s) => s.kind === "stage" && s.total)).toEqual([2, 2]);
        // no stage was made for the proposed chunk's own stage
        expect(rows.some((r) => r.kind === "stage" && r.stage === "Ticket #3")).toBe(false);
    });

    it("keeps the plan flat when only a proposed chunk carries a stage", () => {
        const flat = [...FLAT, chunk("P1", "proposed", "Ticket #3")];
        const rows = initiativeRows({ ...base, chunks: flat });
        expect(rows.some((r) => r.kind === "stage")).toBe(false);
        expect(rows.filter((r) => r.kind === "chunk")).toHaveLength(3);
    });

    it("draws the group and nothing else of a plan when every chunk is proposed", () => {
        const rows = initiativeRows({ ...base, chunks: PROPOSED });
        expect(rows.map((r) => r.kind)).toEqual(["proposed"]);
    });

    it("draws no group when none is proposed", () => {
        expect(initiativeRows(base).some((r) => r.kind === "proposed")).toBe(false);
    });

    it("never names a proposed chunk as the one picked up next", () => {
        const onlyProposedOpen = [chunk("A", "done", ""), chunk("P", "proposed", "")];
        const rows = initiativeRows({ ...base, chunks: onlyProposedOpen });
        expect(rows.filter((r) => r.kind === "chunk").map((r) => r.kind === "chunk" && r.next)).toEqual([false]);
    });
});

describe("chunkDueChip", () => {
    it("reads the day, and turns asking once it has come", () => {
        expect(chunkDueChip("2026-10-20", "pending", "2026-10-19")).toEqual({ text: "due 10-20", come: false });
        expect(chunkDueChip("2026-10-20", "active", "2026-10-20")).toEqual({ text: "due 10-20", come: true });
        expect(chunkDueChip("2026-10-20", "blocked", "2026-11-02")).toEqual({ text: "due 10-20", come: true });
    });
    it("keeps the year when it is not this one", () => {
        expect(chunkDueChip("2027-01-05", "pending", "2026-12-30")).toEqual({ text: "due 2027-01-05", come: false });
    });
    it("says nothing with no date, or once the chunk is settled", () => {
        expect(chunkDueChip(undefined, "pending", "2026-10-20")).toBeNull();
        for (const status of ["done", "deferred", "skipped"]) {
            expect(chunkDueChip("2026-10-20", status, "2026-10-20")).toBeNull();
        }
    });
    it("spells today as the server compares it", () => {
        expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    });
});

// the sheet's plan (spec decision 7): a folded stage previews its first ten chunks, an unfolded one shows them all
describe("initiativeRows", () => {
    const many = (n: number, status: string, stage: string) =>
        Array.from({ length: n }, (_, i) => chunk(`${stage || "flat"} chunk ${i + 1}`, status, stage));
    // a finished stage of 14 (it starts folded), then the stage the work goes on in
    const STAGED: ChunkRowModel[] = [...many(14, "done", "Build"), ...many(3, "pending", "Ship")];
    const sheet = (over: Partial<Parameters<typeof initiativeRows>[0]> = {}) =>
        initiativeRows({ oref: OREF, chunks: STAGED, noteCounts: new Map(), stageOverrides: {}, ...over });
    const kinds = (rows: DetailRow[]) => rows.map((r) => (r.kind === "chunk" ? `chunk:${r.row.label}` : r.kind));

    it("previews a folded stage's first ten chunks and counts the rest", () => {
        const rows = sheet();
        const build = stageRowId(OREF, "Build", 0);
        expect(rows.find((r) => r.id === build)).toMatchObject({ kind: "stage", collapsed: true });
        const under = rows.slice(
            rows.findIndex((r) => r.id === build) + 1,
            rows.findIndex((r) => r.kind === "more") + 1
        );
        expect(under.filter((r) => r.kind === "chunk")).toHaveLength(STAGE_PREVIEW_CAP);
        expect(under[under.length - 1]).toEqual({
            kind: "more",
            id: build + "/more",
            oref: OREF,
            stageId: build,
            n: 4,
        });
    });

    it("shows every chunk of an unfolded stage, with no more row", () => {
        const build = stageRowId(OREF, "Build", 0);
        const rows = sheet({ stageOverrides: { [build]: true } });
        expect(rows.filter((r) => r.kind === "chunk")).toHaveLength(17);
        expect(rows.some((r) => r.kind === "more")).toBe(false);
    });

    it("draws a folded stage of ten or fewer whole, with no more row", () => {
        const ship = stageRowId(OREF, "Ship", 1);
        const rows = sheet({ stageOverrides: { [ship]: false } });
        expect(rows.find((r) => r.id === ship)).toMatchObject({ collapsed: true });
        expect(kinds(rows).filter((k) => k.startsWith("chunk:Ship"))).toHaveLength(3);
        // the Build stage's own more row is the only one
        expect(rows.filter((r) => r.kind === "more")).toHaveLength(1);
    });

    it("marks the next chunk, even under a folded stage's preview", () => {
        const rows = sheet();
        const next = rows.filter((r) => r.kind === "chunk" && r.next);
        expect(next.map((r) => (r.kind === "chunk" ? r.row.label : ""))).toEqual(["Ship chunk 1"]);
    });

    it("folds a long flat plan like the board's +16 more, and unfolds it by its own key", () => {
        const flat = many(26, "pending", "");
        const folded = sheet({ chunks: flat });
        expect(folded.filter((r) => r.kind === "chunk")).toHaveLength(STAGE_PREVIEW_CAP);
        expect(folded[folded.length - 1]).toMatchObject({ kind: "more", n: 16, stageId: flatPlanId(OREF) });
        expect(folded.some((r) => r.kind === "stage")).toBe(false);
        const open = sheet({ chunks: flat, stageOverrides: { [flatPlanId(OREF)]: true } });
        expect(open.filter((r) => r.kind === "chunk")).toHaveLength(26);
    });

    it("keys its rows under the effort, so the sheet's cursor names a chunk by its oref", () => {
        const rows = sheet();
        expect(rows.find((r) => r.kind === "chunk")?.id).toBe(chunkRowId(OREF, "Build chunk 1"));
    });
});
