import { describe, expect, it } from "vitest";
import { relatives } from "./dagcanvas";
import { FINAL_NODE_ID, finalEdgeStyle, selectedTaskOf, withFinalNode } from "./dagfinal";

const finalDeps = (tasks: { id: string; deps?: string[] }[]) =>
    withFinalNode(tasks).find((t) => t.id === FINAL_NODE_ID)?.deps;
const task = (id: string, state: string): TaskNode => ({ id, state });

describe("withFinalNode", () => {
    it("adds the final node last, leaving the tasks as they were", () => {
        const tasks = [{ id: "a" }, { id: "b", deps: ["a"] }];
        const out = withFinalNode(tasks);
        expect(out.slice(0, 2)).toEqual(tasks);
        expect(out[2].id).toBe(FINAL_NODE_ID);
    });
    it("gives a chain one edge, from its last task", () => {
        expect(finalDeps([{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c", deps: ["b"] }])).toEqual(["c"]);
    });
    it("gives a fan one edge per leaf", () => {
        expect(finalDeps([{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c", deps: ["a"] }])).toEqual(["b", "c"]);
    });
    it("depends on exactly the tasks nothing depends on", () => {
        // a -> b, a -> c, b -> d: c and d are the sinks, a and b are not
        const tasks = [{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c", deps: ["a"] }, { id: "d", deps: ["b"] }];
        expect(finalDeps(tasks)).toEqual(["c", "d"]);
    });
    it("takes an edge from each appended fix-round task, which depends on nothing before it", () => {
        const plan = [{ id: "t-1" }, { id: "t-2", deps: ["t-1"] }];
        expect(finalDeps([...plan, { id: "t-3" }, { id: "t-4" }])).toEqual(["t-2", "t-3", "t-4"]);
    });
    it("adds no node to a dag with no tasks", () => {
        expect(withFinalNode([])).toEqual([]);
    });
});

describe("selectedTaskOf", () => {
    it("reads the final node as no task selected, and a task as itself", () => {
        expect(selectedTaskOf(FINAL_NODE_ID)).toBeNull();
        expect(selectedTaskOf("t-1")).toBe("t-1");
        expect(selectedTaskOf(null)).toBeNull();
    });
});

describe("finalEdgeStyle", () => {
    it("waits while its source task is not done", () => {
        expect(finalEdgeStyle(task("a", "running"), false, null)).toEqual({
            kind: "waiting",
            dashed: true,
            faded: false,
        });
    });
    it("is live while the stage runs", () => {
        expect(finalEdgeStyle(task("a", "done"), true, null)).toEqual({ kind: "live", dashed: false, faded: false });
        expect(finalEdgeStyle(task("a", "skipped"), true, null).kind).toBe("live");
    });
    it("is satisfied once the stage has ended, and before it starts", () => {
        expect(finalEdgeStyle(task("a", "done"), false, null)).toEqual({
            kind: "satisfied",
            dashed: false,
            faded: false,
        });
    });
    it("is on the path of a selected task, since every task leads to the final node", () => {
        const tasks = withFinalNode([{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c" }]);
        const focus = { id: "a", rel: relatives(tasks, "a"), selected: true };
        expect(finalEdgeStyle(task("b", "done"), false, focus).kind).toBe("path");
        expect(finalEdgeStyle(task("c", "done"), false, focus)).toEqual({
            kind: "satisfied",
            dashed: false,
            faded: true,
        });
    });
});
