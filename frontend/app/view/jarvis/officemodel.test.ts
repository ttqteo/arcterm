// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { officeFloor, TASK_STATES, type OfficeRun } from "./officemodel";

const run = (tasks: OfficeRun["tasks"], stage: OfficeRun["stage"] = "working"): OfficeRun => ({
    runId: "r1",
    stage,
    tasks,
});
const task = (id: string, state: string, extra: Partial<OfficeRun["tasks"][number]> = {}) => ({
    id,
    label: "Task " + id,
    state,
    ...extra,
});

describe("officeFloor", () => {
    it("gives every engine task state its pose, screen and label", () => {
        const f = officeFloor(run(TASK_STATES.map((s, i) => task("t" + i, s))), []);
        const byState = Object.fromEntries(f.desks.map((d) => [d.state, d]));
        expect(byState["pending"]).toMatchObject({ pose: "empty", screen: "note", dim: true, label: "1 · waits" });
        expect(byState["ready"]).toMatchObject({ pose: "stand", screen: "prompt", tone: "muted", dim: false });
        expect(byState["running"]).toMatchObject({ pose: "type", screen: "lines", tone: "working", animated: true });
        expect(byState["stalled"]).toMatchObject({ pose: "slump", bubble: "?", tone: "asking" });
        expect(byState["reviewing"]).toMatchObject({ pose: "lean", visitor: true, screen: "diff" });
        expect(byState["review-failed"]).toMatchObject({ pose: "hands", screen: "fail", bubble: "!", tone: "error" });
        expect(byState["blocked-merge"]).toMatchObject({ pose: "box", bubble: "⇄", tone: "error" });
        expect(byState["verifying"]).toMatchObject({ pose: "box", screen: "bar", animated: true });
        expect(byState["verify-failed"]).toMatchObject({ pose: "hands", screen: "fail", bubble: "×", tone: "error" });
        expect(byState["done"]).toMatchObject({ pose: "lean", screen: "check", tone: "done", animated: false });
        expect(byState["failed"]).toMatchObject({ pose: "hands", bubble: "×", tone: "error" });
        expect(byState["cancelled"]).toMatchObject({ pose: "empty", screen: "off", dim: true });
        expect(byState["skipped"]).toMatchObject({ pose: "empty", dim: true });
        expect(Object.keys(byState).sort()).toEqual([...TASK_STATES].sort());
        expect(f.desks.every((d) => d.label.length > 0)).toBe(true);
    });

    it("draws an unknown state as an empty, dimmed desk that names the state", () => {
        const [d] = officeFloor(run([task("a", "teleporting")]), []).desks;
        expect(d).toMatchObject({ pose: "empty", dim: true, label: "1 · teleporting" });
    });

    it("dresses task n in lane n and keeps a task's look across calls", () => {
        const tasks = Array.from({ length: 8 }, (_, i) => task("t" + i, "running"));
        const a = officeFloor(run(tasks), []);
        expect(a.desks.map((d) => d.shirt)).toEqual([1, 2, 3, 4, 5, 6, 1, 2]);
        expect(officeFloor(run(tasks), []).desks.map((d) => d.look)).toEqual(a.desks.map((d) => d.look));
        expect(a.desks.every((d) => d.look >= 1 && d.look <= 4)).toBe(true);
        expect(a.lead.shirt).toBe(0);
    });

    it("raises the hand of a worker whose agent is asking, whatever the task state", () => {
        const f = officeFloor(run([task("a", "running", { runid: "w1" })]), [
            { id: "tab-w1", runId: "w1", state: "asking" },
        ]);
        expect(f.desks[0]).toMatchObject({
            pose: "handup",
            bubble: "!",
            tone: "asking",
            label: "Needs you",
            agentId: "tab-w1",
            animated: true,
        });
        expect(f.board).toEqual(["asking"]);
    });

    it("opens the worker, else the reviewer, else nothing", () => {
        const f = officeFloor(
            run([
                task("a", "running", { runid: "w1" }),
                task("b", "reviewing", { reviewrunid: "rv" }),
                task("c", "done"),
            ]),
            [
                { id: "tab-w1", runId: "w1", state: "working" },
                { id: "tab-rv", runId: "rv", state: "working" },
            ]
        );
        expect(f.desks.map((d) => d.agentId)).toEqual(["tab-w1", "tab-rv", undefined]);
    });

    it("opens the run from a pending, done or closed desk even while its worker's tab is still open", () => {
        const states = ["pending", "done", "failed", "cancelled", "skipped"];
        const f = officeFloor(
            run(states.map((s, i) => task("t" + i, s, { runid: "w" + i }))),
            states.map((_, i) => ({ id: "tab-w" + i, runId: "w" + i, state: "idle" as const }))
        );
        expect(f.desks.map((d) => d.agentId)).toEqual(states.map(() => undefined));
        expect(f.desks.every((d) => d.tip.endsWith("Click to open the run."))).toBe(true);
    });

    it("seats the lead by the run's stage, and an asking lead raises its hand", () => {
        const lead = (stage: OfficeRun["stage"]) => officeFloor(run([], stage), []).lead;
        expect(lead("planning")).toMatchObject({ pose: "type", label: "lead · planning" });
        expect(lead("plan-review")).toMatchObject({ pose: "lean", visitor: true });
        expect(lead("working")).toMatchObject({ pose: "lean", label: "lead · watching" });
        expect(lead("final-check")).toMatchObject({ pose: "box", screen: "bar" });
        expect(lead("wrapping-up")).toMatchObject({ pose: "type" });
        expect(lead("landing")).toMatchObject({ pose: "box", screen: "bar", tone: "working", label: "lead · landing" });
        expect(lead("land-held")).toMatchObject({ pose: "hands", bubble: "!", tone: "error" });
        expect(lead("landed")).toMatchObject({ pose: "empty", dim: true });
        expect(lead("complete")).toMatchObject({ pose: "empty", screen: "check", tone: "done", dim: true });
        expect(lead("cancelled")).toMatchObject({ pose: "empty", screen: "off", dim: true, label: "lead · cancelled" });
        const asking = officeFloor(run([], "working"), [{ id: "tab-l", runId: "r1", state: "asking" }]).lead;
        expect(asking).toMatchObject({ pose: "handup", label: "Needs you", agentId: "tab-l" });
    });

    it("gives a run with no dag only its lead", () => {
        const f = officeFloor(run([], "planning"), []);
        expect(f.desks).toEqual([]);
        expect(f.board).toEqual([]);
        expect(f.lead.key).toBe("lead");
    });
});
