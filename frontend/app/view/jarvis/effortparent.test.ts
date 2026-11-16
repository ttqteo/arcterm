import { describe, expect, it } from "vitest";
import { parentLabel, parentOptions } from "./effortparent";

const e = (oid: string, over: Partial<EffortSummary> = {}): EffortSummary => ({
    oref: `effort:${oid}`,
    title: `T ${oid}`,
    status: "active",
    done: 0,
    total: 0,
    updatedts: 0,
    ...over,
});

describe("parentOptions", () => {
    it("leaves out the initiative itself, everything under it, and archived ones", () => {
        const efforts = [
            e("a"),
            e("b", { parentoid: "a" }),
            e("c", { parentoid: "b" }),
            e("d"),
            e("x", { status: "archived" }),
        ];
        expect(parentOptions(efforts, "effort:a", "", "").map((o) => o.oref)).toEqual(["effort:d"]);
        expect(parentOptions(efforts, "effort:b", "", "").map((o) => o.oref)).toEqual(["effort:a", "effort:d"]);
    });

    it("lists every live initiative for a new one", () => {
        expect(parentOptions([e("a"), e("b")], null, "", "")).toHaveLength(2);
    });

    it("puts the form's project first, then the most recently updated", () => {
        const efforts = [
            e("old", { project: "arcterm", updatedts: 1 }),
            e("other", { project: "lingua", updatedts: 9 }),
            e("new", { project: "arcterm", updatedts: 5 }),
        ];
        expect(parentOptions(efforts, null, "arcterm", "").map((o) => o.oref)).toEqual([
            "effort:new",
            "effort:old",
            "effort:other",
        ]);
        expect(parentOptions(efforts, null, "", "").map((o) => o.oref)).toEqual([
            "effort:other",
            "effort:new",
            "effort:old",
        ]);
    });

    it("matches the query against title, project, ticket and id, ignoring case", () => {
        const efforts = [
            e("c360c984", { title: "E.D.I.T.H." }),
            e("b", { title: "Office", project: "Lingua" }),
            e("c", { title: "Gate", ticket: "ARC-12" }),
        ];
        expect(parentOptions(efforts, null, "", "edith").length).toBe(0);
        expect(parentOptions(efforts, null, "", "e.d.i").map((o) => o.oref)).toEqual(["effort:c360c984"]);
        expect(parentOptions(efforts, null, "", "lingua").map((o) => o.oref)).toEqual(["effort:b"]);
        expect(parentOptions(efforts, null, "", "arc-12").map((o) => o.oref)).toEqual(["effort:c"]);
        expect(parentOptions(efforts, null, "", "C360").map((o) => o.oref)).toEqual(["effort:c360c984"]);
    });
});

describe("parentLabel", () => {
    it("reads the parent's title, its short id when unknown, null when none", () => {
        const efforts = [e("c360c984-96a8", { title: "E.D.I.T.H." })];
        expect(parentLabel(efforts, "c360c984-96a8")).toBe("E.D.I.T.H.");
        expect(parentLabel(efforts, "effort:c360c984-96a8")).toBe("E.D.I.T.H.");
        expect(parentLabel(efforts, "deadbeef-1234")).toBe("deadbeef");
        expect(parentLabel(efforts, "")).toBeNull();
    });
});
