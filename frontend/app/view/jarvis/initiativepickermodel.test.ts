// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildEffortCard } from "./effortmodel";
import { descendantOrefs, pickerRows } from "./initiativepickermodel";

const summary = (oid: string, over: Partial<EffortSummary> & { chunks?: EffortChunkSummary[] }): EffortSummary => {
    const chunks = over.chunks ?? [{ label: "one", status: "pending" }];
    const counted = chunks.filter((c) => c.status !== "proposed");
    return {
        oref: "effort:" + oid,
        title: oid,
        project: "arcterm",
        status: "active",
        done: counted.filter((c) => c.status === "done").length,
        total: counted.length,
        updatedts: 1,
        ...over,
        chunks,
    };
};

const cards = [
    summary("Jarvis Brief", {
        chunks: [
            { label: "a", status: "done" },
            { label: "b", status: "active" },
        ],
        activechunk: "b",
    }),
    summary("Token guard", { status: "paused", chunks: [{ label: "a", status: "pending" }] }),
    summary("An idea", { chunks: [] }),
    summary("Old thing", { status: "archived", chunks: [{ label: "a", status: "done" }] }),
    summary("Paper draft", { project: "mit-thesis", chunks: [{ label: "a", status: "pending" }] }),
    summary("Mcp docs", { project: "vnstock-js", chunks: [{ label: "a", status: "blocked" }] }),
].map(buildEffortCard);

describe("pickerRows", () => {
    it("lists the project's initiatives, not ideas or archived ones, with done/total and a status word", () => {
        const r = pickerRows(cards, "arcterm", "");
        expect(r.rows.map((x) => x.title)).toEqual(["Jarvis Brief", "Token guard"]);
        expect(r.rows[0]).toMatchObject({ oref: "effort:Jarvis Brief", progress: "1/2", status: "at work" });
        expect(r.rows[1]).toMatchObject({ progress: "0/1", status: "paused" });
    });

    it("keeps the other projects behind a count", () => {
        const r = pickerRows(cards, "arcterm", "");
        expect(r.otherCount).toBe(2);
        expect(r.others.map((x) => x.title)).toEqual(["Paper draft", "Mcp docs"]);
        expect(r.others[1].status).toBe("blocked");
    });

    it("filters titles case-insensitively across every project", () => {
        const r = pickerRows(cards, "arcterm", "PA");
        expect(r.rows.map((x) => x.title)).toEqual(["Paper draft"]);
        expect(r.others).toEqual([]);
        expect(r.otherCount).toBe(0);
    });

    it("puts the project's own matches before the others", () => {
        const r = pickerRows(cards, "arcterm", "o");
        expect(r.rows.map((x) => x.title)).toEqual(["Token guard", "Mcp docs"]);
    });

    it("leaves out the excluded initiatives", () => {
        const r = pickerRows(cards, "arcterm", "", ["effort:Jarvis Brief", "effort:Paper draft"]);
        expect(r.rows.map((x) => x.title)).toEqual(["Token guard"]);
        expect(r.others.map((x) => x.title)).toEqual(["Mcp docs"]);
    });

    it("treats no project as the cards that have none", () => {
        const r = pickerRows([...cards, buildEffortCard(summary("Loose", { project: undefined }))], "", "");
        expect(r.rows.map((x) => x.title)).toEqual(["Loose"]);
    });
});

describe("descendantOrefs", () => {
    it("is the initiative itself and everything beneath it", () => {
        const tree = [
            { oref: "effort:a", parentoid: undefined },
            { oref: "effort:b", parentoid: "a" },
            { oref: "effort:c", parentoid: "b" },
            { oref: "effort:d", parentoid: "x" },
        ];
        expect(descendantOrefs(tree, "effort:a").sort()).toEqual(["effort:a", "effort:b", "effort:c"]);
        expect(descendantOrefs(tree, "effort:d")).toEqual(["effort:d"]);
    });

    it("stops on a cycle already in the data", () => {
        const tree = [
            { oref: "effort:a", parentoid: "b" },
            { oref: "effort:b", parentoid: "a" },
        ];
        expect(descendantOrefs(tree, "effort:a").sort()).toEqual(["effort:a", "effort:b"]);
    });
});
