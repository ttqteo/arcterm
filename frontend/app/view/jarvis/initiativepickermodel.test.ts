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

describe("pickerRows with recent", () => {
    const at = (oid: string, updatedts: number, over: Partial<EffortSummary> = {}) =>
        buildEffortCard(summary(oid, { updatedts, ...over }));
    const dated = [
        at("A", 50),
        at("B", 10),
        at("C", 40),
        at("D", 60, { project: "mit-thesis" }),
        at("E", 20, { project: "vnstock-js" }),
        at("Idea", 99, { chunks: [] }),
        at("Old", 98, { status: "archived" }),
    ];

    it("leaves recent empty unless asked", () => {
        expect(pickerRows(dated, "arcterm", "").recent).toEqual([]);
        expect(pickerRows(dated, "arcterm", "", [], {}).recent).toEqual([]);
        expect(pickerRows(dated, "arcterm", "", [], { recent: false }).rows.map((x) => x.title)).toEqual([
            "A",
            "B",
            "C",
        ]);
    });

    it("takes the 3 newest picker-eligible initiatives of every project, newest first, never an idea or an archived one", () => {
        const r = pickerRows(dated, "arcterm", "", [], { recent: true });
        expect(r.recent.map((x) => x.title)).toEqual(["D", "A", "C"]);
        expect(r.recent[0]).toMatchObject({ oref: "effort:D", project: "mit-thesis", progress: "0/1" });
    });

    it("takes the recent ones out of the project's rows and of the other projects", () => {
        const r = pickerRows(dated, "arcterm", "", [], { recent: true });
        expect(r.rows.map((x) => x.title)).toEqual(["B"]);
        expect(r.others.map((x) => x.title)).toEqual(["E"]);
        expect(r.otherCount).toBe(1);
    });

    it("hides the Other projects count when the recent ones were all of them", () => {
        const two = [at("A", 5), at("D", 9, { project: "mit-thesis" })];
        const r = pickerRows(two, "arcterm", "", [], { recent: true });
        expect(r.recent.map((x) => x.title)).toEqual(["D", "A"]);
        expect(r.rows).toEqual([]);
        expect(r.others).toEqual([]);
        expect(r.otherCount).toBe(0);
    });

    it("hides recent while a query is typed", () => {
        const r = pickerRows(dated, "arcterm", "a", [], { recent: true });
        expect(r.recent).toEqual([]);
        expect(r.rows.map((x) => x.title)).toEqual(["A"]);
    });

    it("leaves an excluded initiative out of recent too", () => {
        const r = pickerRows(dated, "arcterm", "", ["effort:D"], { recent: true });
        expect(r.recent.map((x) => x.title)).toEqual(["A", "C", "E"]);
        expect(r.rows.map((x) => x.title)).toEqual(["B"]);
        expect(r.others).toEqual([]);
    });

    it("keeps the list's order between initiatives updated at the same time", () => {
        const same = [at("X", 7), at("Y", 7), at("Z", 7), at("W", 7)];
        const r = pickerRows(same, "arcterm", "", [], { recent: true });
        expect(r.recent.map((x) => x.title)).toEqual(["X", "Y", "Z"]);
        expect(r.rows.map((x) => x.title)).toEqual(["W"]);
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
