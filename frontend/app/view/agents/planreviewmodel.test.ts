import { describe, expect, it } from "vitest";
import {
    addDecisions,
    decisionsFor,
    planEditChunks,
    planRows,
    proposedCount,
    removeDecision,
    restoreAt,
    type PlanDecision,
} from "./planreviewmodel";

const chunk = (label: string, status = "pending", stage = "") => ({ label, status, stage });
const plan = [
    chunk("Spec", "done"),
    chunk("Model", "proposed", "Build"),
    chunk("Panel", "proposed", "Build"),
    chunk("Scenario", "proposed", "Verify"),
];

describe("planRows", () => {
    it("lists the proposed chunks in plan order, each with its stage", () => {
        expect(planRows(plan, [])).toEqual([
            { label: "Model", meta: "Build", state: "proposed" },
            { label: "Panel", meta: "Build", state: "proposed" },
            { label: "Scenario", meta: "Verify", state: "proposed" },
        ]);
    });
    it("keeps a just-accepted chunk as a decided row, in its place, while it is still pending", () => {
        const after = [chunk("Spec", "done"), chunk("Model", "pending", "Build"), ...plan.slice(2)];
        const d: PlanDecision[] = [{ label: "Model", kind: "accepted", stage: "Build", before: ["Spec"] }];
        const rows = planRows(after, d);
        expect(rows.map((r) => [r.label, r.state])).toEqual([
            ["Model", "accepted"],
            ["Panel", "proposed"],
            ["Scenario", "proposed"],
        ]);
        expect(rows[0].meta).toBe("accepted · now pending");
    });
    it("drops an accepted row once its chunk moved on: Undo would put a started chunk back to proposed", () => {
        const after = [chunk("Spec", "done"), chunk("Model", "active", "Build")];
        const d: PlanDecision[] = [{ label: "Model", kind: "accepted", stage: "Build", before: ["Spec"] }];
        expect(planRows(after, d)).toEqual([]);
    });
    it("shows a dropped chunk back where it left, struck through, until it is undone", () => {
        const after = [plan[0], plan[1], plan[3]];
        const d: PlanDecision[] = [{ label: "Panel", kind: "dropped", stage: "Build", before: ["Spec", "Model"] }];
        const rows = planRows(after, d);
        expect(rows.map((r) => [r.label, r.state])).toEqual([
            ["Model", "proposed"],
            ["Panel", "dropped"],
            ["Scenario", "proposed"],
        ]);
        expect(rows[1].meta).toBe("dropped");
    });
    it("a whole plan dropped keeps its order", () => {
        const after = [plan[0]];
        const d: PlanDecision[] = [
            { label: "Model", kind: "dropped", stage: "Build", before: ["Spec"] },
            { label: "Panel", kind: "dropped", stage: "Build", before: ["Spec", "Model"] },
            { label: "Scenario", kind: "dropped", stage: "Verify", before: ["Spec", "Model", "Panel"] },
        ];
        expect(planRows(after, [...d].reverse()).map((r) => r.label)).toEqual(["Model", "Panel", "Scenario"]);
    });
    it("a decision for a chunk that is proposed again is not a second row", () => {
        const d: PlanDecision[] = [{ label: "Panel", kind: "dropped", stage: "Build", before: ["Spec", "Model"] }];
        expect(planRows(plan, d).map((r) => r.label)).toEqual(["Model", "Panel", "Scenario"]);
        expect(planRows(plan, d).find((r) => r.label === "Panel")?.state).toBe("proposed");
    });
});

describe("proposedCount", () => {
    it("counts only the rows still waiting, not the decided ones the section keeps for Undo", () => {
        const d: PlanDecision[] = [{ label: "Panel", kind: "dropped", stage: "Build", before: ["Spec", "Model"] }];
        expect(proposedCount(planRows([plan[0], plan[1], plan[3]], d))).toBe(2);
        expect(proposedCount([])).toBe(0);
    });
});

describe("restoreAt", () => {
    it("is the 1-based place after the nearest earlier chunk that is still in the plan", () => {
        expect(restoreAt(["Spec", "Model"], ["Spec", "Model", "Scenario"])).toBe(3);
        expect(restoreAt(["Spec", "Model"], ["Spec", "Scenario"])).toBe(2);
    });
    it("is the first place when nothing before it survives", () => {
        expect(restoreAt([], ["Spec"])).toBe(1);
        expect(restoreAt(["Spec", "Model"], ["Scenario"])).toBe(1);
    });
    it("never lands past the end, which the server refuses", () => {
        const current = ["Spec"];
        expect(restoreAt(["Spec", "Model", "Panel"], current)).toBeLessThanOrEqual(current.length + 1);
    });
    it("puts a whole dropped plan back in order whichever Undo comes first", () => {
        const originals = [
            { label: "A", before: [] as string[] },
            { label: "B", before: ["A"] },
            { label: "C", before: ["A", "B"] },
        ];
        for (const order of [
            ["C", "B", "A"],
            ["B", "C", "A"],
            ["A", "C", "B"],
        ]) {
            let cur: string[] = [];
            for (const l of order) {
                const o = originals.find((x) => x.label === l)!;
                cur = [...cur.slice(0, restoreAt(o.before, cur) - 1), l, ...cur.slice(restoreAt(o.before, cur) - 1)];
            }
            expect(cur).toEqual(["A", "B", "C"]);
        }
    });
});

describe("decisions", () => {
    it("snapshots a chunk's stage and the chunks before it in the whole plan", () => {
        expect(decisionsFor(plan, ["Panel"], "dropped")).toEqual([
            { label: "Panel", kind: "dropped", stage: "Build", before: ["Spec", "Model"] },
        ]);
    });
    it("a later decision for a label replaces the earlier one", () => {
        const a = decisionsFor(plan, ["Panel"], "accepted");
        const b = decisionsFor(plan, ["Panel"], "dropped");
        expect(addDecisions(a, b)).toEqual(b);
    });
    it("removes one decision by label", () => {
        const all = decisionsFor(plan, ["Model", "Panel"], "accepted");
        expect(removeDecision(all, "Model").map((d) => d.label)).toEqual(["Panel"]);
    });
});

describe("planEditChunks", () => {
    it("is the whole plan, with an empty stage for a chunk that has none", () => {
        expect(planEditChunks([{ label: "A", status: "pending" }, chunk("B", "proposed", "Build")])).toEqual([
            { label: "A", stage: "" },
            { label: "B", stage: "Build" },
        ]);
    });
});
