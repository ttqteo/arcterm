// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { detailOps, effortChunkRows, effortDetailIsFresh } from "./effortstore";

const effort = {
    oid: "abc",
    version: 3,
    title: "Scenario gate clearance",
    chunks: [
        { label: "P1", status: "done", notes: [{ ts: 1, text: "marked done" }] },
        {
            label: "P3",
            status: "active",
            notes: [
                { ts: 3, text: "resolver seeded" },
                { ts: 2, text: "dry-run pending" },
            ],
        },
        { label: "P5", status: "blocked", notes: [{ ts: 1, text: "blocked on substrate" }] },
    ],
} as unknown as Effort;

describe("effortChunkRows", () => {
    it("derives latest note per chunk and full trails", () => {
        const rows = effortChunkRows(effort);
        expect(rows[0].latestNote).toBe("marked done");
        expect(rows[1].latestNote).toBe("resolver seeded");
        expect(rows[1].trail).toHaveLength(2);
        expect(rows[2].tone).toBe("blocked");
    });

    it("carries a chunk's stage and work refs, empty when it has none", () => {
        const rows = effortChunkRows({
            chunks: [
                { label: "A", status: "active", stage: "S1", workrefs: [{ oref: "run:r1" }] },
                { label: "B", status: "pending" },
            ],
        } as unknown as Effort);
        expect(rows.map((r) => [r.stage, r.workrefs])).toStrictEqual([
            ["S1", [{ oref: "run:r1" }]],
            ["", []],
        ]);
    });

    it("has no latest note for a chunk with no notes", () => {
        const [row] = effortChunkRows({ chunks: [{ label: "A", status: "pending" }] } as unknown as Effort);
        expect([row.latestNote, row.trail]).toStrictEqual([undefined, []]);
    });

    // an effort created with no chunks serializes its nil Go slice as null, and expanding it in the Brief
    // threw during render, which took the whole cockpit down
    it("reads an effort whose chunks came over the wire as null as having none", () => {
        expect(effortChunkRows({ ...effort, chunks: null } as unknown as Effort)).toEqual([]);
    });
});

// The cache used to be fetch-once, so an effort ticked by `wsh effort` or by an agent left the rendered
// rows behind the header count that the briefing keeps fresh. The briefing's updatedts is the tie-break.
describe("effortDetailIsFresh", () => {
    const cached = { updatedts: 100 } as Effort;

    it("is stale when the briefing reports the effort newer than the cached copy", () => {
        expect(effortDetailIsFresh(cached, 101)).toBe(false);
    });

    it("is fresh at or ahead of the reported timestamp, so a steady briefing costs no refetch", () => {
        expect(effortDetailIsFresh(cached, 100)).toBe(true);
        expect(effortDetailIsFresh(cached, 99)).toBe(true);
    });

    it("is never fresh with nothing cached, whatever the caller knows", () => {
        expect(effortDetailIsFresh(undefined, 100)).toBe(false);
        expect(effortDetailIsFresh(undefined, undefined)).toBe(false);
    });

    // callers with no summary to hand (the expand path) keep the old fetch-once behaviour rather than
    // refetching on every render
    it("trusts any cached copy when no timestamp is offered", () => {
        expect(effortDetailIsFresh(cached, undefined)).toBe(true);
    });
});

describe("detailOps", () => {
    const cur = { title: "T", project: "p", ticket: "", parent: "" };
    it("sends only what changed", () => {
        expect(detailOps(cur, { ...cur, title: " New " })).toEqual([{ op: "rename", title: "New" }]);
        expect(detailOps(cur, cur)).toEqual([]);
    });
    it("trims what it sends for every text field", () => {
        expect(detailOps(cur, { ...cur, project: " q ", ticket: " K-1 " })).toEqual([
            { op: "setProject", project: "q" },
            { op: "setTicket", ticket: "K-1" },
        ]);
    });
    it("reads a field that differs only by surrounding whitespace as unchanged, on either side", () => {
        const padded = { title: " T ", project: " p ", ticket: " k ", parent: "" };
        const trimmed = { title: "T", project: "p", ticket: "k", parent: "" };
        expect(detailOps(padded, trimmed)).toEqual([]);
        expect(detailOps(trimmed, padded)).toEqual([]);
    });
    it("clears with empty strings and strips the effort: prefix from a parent", () => {
        expect(detailOps(cur, { ...cur, project: "", parent: "effort:abc" })).toEqual([
            { op: "setProject", project: "" },
            { op: "link", parentoid: "abc" },
        ]);
    });
});
