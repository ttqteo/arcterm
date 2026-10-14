import { describe, expect, it } from "vitest";
import type { RunInfo } from "./runlineage";
import { runStage } from "./runstage";

type R = Pick<RunInfo, "status" | "land" | "dag">;
const dag = (status: string, final?: Partial<FinalStage>): TaskGroup =>
    ({ status, tasks: [], final: final ? { round: 1, ...final } : undefined }) as unknown as TaskGroup;
const pips = (r: R, asking = false) => runStage(r, asking).tail.map((p) => p.state);

describe("runStage", () => {
    it("names each stage once, in the one vocabulary", () => {
        const cases: [R, string][] = [
            [{ status: "planning" }, "Planning"],
            [{ status: "awaiting-review" }, "Plan review"],
            [{ status: "executing", dag: dag("plan-review") }, "Plan review"],
            [{ status: "executing", dag: dag("running") }, "Working"],
            [{ status: "executing" }, "Working"],
            [{ status: "executing", dag: dag("finalizing", { state: "checking", step: "final" }) }, "Final check"],
            [{ status: "executing", dag: dag("done", { state: "passed" }) }, "Wrapping up"],
            [{ status: "done", land: { state: "pending" }, dag: dag("done", { state: "passed" }) }, "Landing"],
            [{ status: "done", land: { state: "queued", queuedts: 20 }, dag: dag("done") }, "Landing · in line"],
            [
                { status: "done", land: { state: "resolving", conflicts: ["CHANGELOG.md"] }, dag: dag("done") },
                "Landing · resolving conflicts",
            ],
            [{ status: "done", land: { state: "held", reason: "staged changes" }, dag: dag("done") }, "Land held"],
            [{ status: "done", land: { state: "landed" }, dag: dag("done", { state: "passed" }) }, "Landed"],
            [{ status: "done", dag: dag("done") }, "Complete"],
            [{ status: "executing", dag: dag("cancelled") }, "Cancelled"],
            [{ status: "cancelled" }, "Cancelled"],
        ];
        for (const [r, want] of cases) {
            expect(runStage(r).label, JSON.stringify(r)).toBe(want);
        }
    });

    // run office reads the RunStageKey union: a land in line or being resolved is still the landing stage
    it("keeps a queued and a resolving land under the landing key, which needs nobody and is not complete", () => {
        for (const state of ["pending", "queued", "resolving"]) {
            const stage = runStage({ status: "done", land: { state }, dag: dag("done", { state: "passed" }) });
            expect(stage, state).toMatchObject({ key: "landing", needsYou: false, complete: false, tone: "running" });
            expect(
                stage.tail.map((p) => p.state),
                state
            ).toEqual(["done", "done", "active"]);
        }
    });

    it("is complete only once nothing is left: landed, or done with nothing to land", () => {
        expect(runStage({ status: "done", land: { state: "landed" }, dag: dag("done") }).complete).toBe(true);
        expect(runStage({ status: "done", dag: dag("done") }).complete).toBe(true);
        expect(runStage({ status: "done", land: { state: "pending" }, dag: dag("done") }).complete).toBe(false);
        expect(runStage({ status: "done", land: { state: "held" }, dag: dag("done") }).complete).toBe(false);
        expect(runStage({ status: "executing", dag: dag("done") }).complete).toBe(false);
        expect(runStage({ status: "executing", dag: dag("finalizing") }).complete).toBe(false);
    });

    it("reads a landed run as landed whatever its dag says, and a done run with an unfinished dag as not complete", () => {
        // a human can land a run whose final stage failed: the dag stays blocked, but the run is in its base
        expect(runStage({ status: "done", land: { state: "landed" }, dag: dag("blocked") })).toMatchObject({
            key: "landed",
            complete: true,
        });
        expect(runStage({ status: "done", dag: dag("blocked") })).toMatchObject({ key: "working", complete: false });
        expect(runStage({ status: "done", dag: dag("running") })).toMatchObject({ key: "working", complete: false });
    });

    it("says when the run needs you, apart from where it is", () => {
        expect(runStage({ status: "executing", dag: dag("running") }, true).needsYou).toBe(true);
        expect(runStage({ status: "executing", dag: dag("blocked") }).needsYou).toBe(true);
        expect(runStage({ status: "awaiting-review" }).needsYou).toBe(true);
        expect(runStage({ status: "done", land: { state: "held" }, dag: dag("done") }).needsYou).toBe(true);
        expect(runStage({ status: "done", land: { state: "held", dismissed: true }, dag: dag("done") }).needsYou).toBe(
            false
        );
        expect(runStage({ status: "executing", dag: dag("finalizing") }).needsYou).toBe(false);
    });

    it("draws the tail: Final check, Wrap-up, Land", () => {
        expect(pips({ status: "executing", dag: dag("running") })).toEqual(["pending", "pending", "pending"]);
        expect(pips({ status: "executing", dag: dag("finalizing", { state: "final" }) })).toEqual([
            "active",
            "pending",
            "pending",
        ]);
        expect(pips({ status: "executing", dag: dag("running", { state: "failed" }) })).toEqual([
            "failed",
            "pending",
            "pending",
        ]);
        expect(pips({ status: "executing", dag: dag("done", { state: "passed" }) })).toEqual([
            "done",
            "active",
            "pending",
        ]);
        expect(pips({ status: "done", land: { state: "pending" }, dag: dag("done", { state: "passed" }) })).toEqual([
            "done",
            "done",
            "active",
        ]);
        expect(pips({ status: "done", land: { state: "held" }, dag: dag("done", { state: "passed" }) })).toEqual([
            "done",
            "done",
            "held",
        ]);
        expect(pips({ status: "done", land: { state: "landed" }, dag: dag("done", { state: "unverified" }) })).toEqual([
            "held",
            "done",
            "done",
        ]);
        expect(pips({ status: "done", dag: dag("done", { state: "passed" }) })).toEqual(["done", "done", "skipped"]);
        expect(pips({ status: "cancelled", dag: dag("cancelled") })).toEqual(["skipped", "skipped", "skipped"]);
    });

    it("gives a run with no dag the Land pip alone", () => {
        expect(runStage({ status: "executing" }).tail).toEqual([{ name: "Land", state: "pending" }]);
        expect(runStage({ status: "done", land: { state: "landed" } }).tail).toEqual([{ name: "Land", state: "done" }]);
    });

    it("carries the final outcome and tones by it", () => {
        const landed = (state: string) =>
            runStage({ status: "done", land: { state: "landed" }, dag: dag("done", { state }) });
        expect(landed("passed")).toMatchObject({ outcome: "passed", tone: "done" });
        expect(landed("unverified")).toMatchObject({ outcome: "unverified", tone: "asking" });
        expect(runStage({ status: "executing", dag: dag("finalizing", { state: "failed" }) }).tone).toBe("error");
        expect(runStage({ status: "cancelled" }).tone).toBe("muted");
        expect(runStage({ status: "executing", dag: dag("running") }).tone).toBe("working");
        expect(runStage({ status: "executing", dag: dag("finalizing") }).tone).toBe("running");
    });
});
