import { describe, expect, it } from "vitest";
import { FINAL_FILL, SEG_FILL, STRIP_MAX, taskStrip, taskStripLabel } from "./runstrip";

const task = (id: string, state: string): TaskNode => ({ id, label: id, state }) as TaskNode;
const dagOf = (...states: string[]) => ({ tasks: states.map((s, i) => task(`t-${i + 1}`, s)) }) as TaskGroup;
// workerAsk reads waitreason "ask" as a question the user holds
const askingYou = (taskid: string) => ({ tasks: [{ taskid, waitreason: "ask" }] }) as DagStatusDigest;

describe("taskStrip", () => {
    it("has no strip without a dag or tasks", () => {
        expect(taskStrip(undefined, undefined)).toBeUndefined();
        expect(taskStrip({ tasks: [] } as TaskGroup, undefined)).toBeUndefined();
    });
    it("is one segment per task in plan order", () => {
        expect(taskStrip(dagOf("done", "running", "pending", "failed"), undefined)).toEqual({
            kind: "segments",
            states: ["done", "working", "pending", "failed"],
        });
    });
    it("marks a task whose question you hold as asking", () => {
        expect(taskStrip(dagOf("done", "running"), askingYou("t-2"))).toEqual({
            kind: "segments",
            states: ["done", "asking"],
        });
    });
    it("keeps segments at exactly STRIP_MAX tasks", () => {
        const s = taskStrip(dagOf(...Array(STRIP_MAX).fill("pending")), undefined);
        expect(s?.kind).toBe("segments");
    });
    it("becomes one done/total bar past STRIP_MAX", () => {
        const states = [...Array(10).fill("done"), ...Array(STRIP_MAX - 9).fill("pending")];
        expect(taskStrip(dagOf(...states), undefined)).toEqual({ kind: "bar", done: 10, total: STRIP_MAX + 1 });
    });
});

describe("taskStripLabel", () => {
    it("counts done tasks the way the row's N/M text does, skipped included", () => {
        expect(taskStripLabel(dagOf("done", "skipped", "running"), undefined)).toBe("2 of 3 tasks done");
    });
    it("names the questions waiting on you", () => {
        expect(taskStripLabel(dagOf("done", "running"), askingYou("t-2"))).toBe("1 of 2 tasks done, 1 asking you");
    });
});

describe("FINAL_FILL", () => {
    it("has a fill for every state of the slot", () => {
        for (const tone of ["wait", "run", "pass", "fail", "warn"] as const) {
            expect(FINAL_FILL[tone]).toMatch(/^bg-[a-z-]+(\/\d+)?( pulse-dot)?$/);
        }
    });
});

describe("SEG_FILL", () => {
    it("has a token fill for every lane state", () => {
        for (const st of ["done", "working", "asking", "lead", "pending", "failed", "muted"] as const) {
            expect(SEG_FILL[st]).toMatch(/^bg-[a-z-]+(\/\d+)?( pulse-dot)?$/);
        }
    });
});
