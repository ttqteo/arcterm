// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { closeTargets, runStepView, runTreeText } from "./brainstormrunmodel";
import type { RunInfo } from "./runlineage";

const BLOCKED_ID = "9c6eb723-1111-4222-8333-444455556666";
const LANDED_ID = "95585dce-1111-4222-8333-444455556666";

function tasks(done: number, total: number): TaskNode[] {
    return Array.from(
        { length: total },
        (_, i) => ({ id: `t-${i + 1}`, state: i < done ? "done" : "running" }) as TaskNode
    );
}

function runOf(
    runId: string,
    opts: { done: number; total: number; final?: FinalStage; land?: RunLand; status?: string }
): RunInfo {
    return {
        runId,
        channelId: "ch",
        title: "Detector engine",
        project: "siem",
        status: opts.status ?? "executing",
        landPath: `C:\\land\\${runId}`,
        base: "main",
        land: opts.land,
        dag: {
            oid: "dag",
            runid: runId,
            status: "executing",
            tasks: tasks(opts.done, opts.total),
            final: opts.final,
        } as TaskGroup,
    };
}

describe("runStepView", () => {
    it("reads 9c6eb723 as built but held by its failed final, with the board's copy", () => {
        const run = runOf(BLOCKED_ID, { done: 10, total: 10, final: { state: "failed", round: 2 } });
        const v = runStepView(BLOCKED_ID, run, true);
        expect(v.state).toBe("final-failed");
        expect(v.headline).toBe("The run built every task, but its final check failed");
        expect(v.detail).toBe(
            "All 10 tasks landed on wave/9c6eb723. The final check failed in round 2, so nothing has merged into main yet. The run shows what failed and reruns the check."
        );
        expect(v.tree).toBe("final failed");
        expect(v.merged).toBe(false);
        expect(v.canClose).toBe(false);
        expect(v.round).toBe(2);
        expect({ done: v.done, total: v.total }).toEqual({ done: 10, total: 10 });
    });

    it("says how many tasks landed when a failed final came before all of them did", () => {
        const run = runOf(BLOCKED_ID, { done: 9, total: 10, final: { state: "failed", round: 1 } });
        const v = runStepView(BLOCKED_ID, run, true);
        expect(v.headline).toBe("The run’s final check failed");
        expect(v.detail.startsWith("9 of 10 tasks landed on wave/9c6eb723.")).toBe(true);
    });

    it("reads the final from the digest when the dag carries none", () => {
        const run = runOf(BLOCKED_ID, { done: 10, total: 10 });
        run.digest = { final: { state: "failed", round: 3 } } as DagStatusDigest;
        expect(runStepView(BLOCKED_ID, run, true)).toMatchObject({ state: "final-failed", round: 3 });
    });

    it("reads 95585dce, landed at a sha with its final passed, as merged and closable", () => {
        const run = runOf(LANDED_ID, {
            done: 11,
            total: 11,
            status: "done",
            final: { state: "passed", round: 1 },
            land: { state: "landed", commit: "7867142f00d" },
        });
        const v = runStepView(LANDED_ID, run, true);
        expect(v.state).toBe("merged");
        expect(v.headline).toBe("Built and merged into main at 7867142");
        expect(v.sha).toBe("7867142");
        expect(v.merged).toBe(true);
        expect(v.canClose).toBe(true);
        expect(v.closeOff).toBeNull();
        expect(v.tree).toBe("merged");
    });

    it("keeps the brainstorm when the run merged but its final is unverified", () => {
        const run = runOf(LANDED_ID, {
            done: 11,
            total: 11,
            status: "done",
            final: { state: "unverified", round: 1 },
            land: { state: "landed", commit: "7867142f00d" },
        });
        const v = runStepView(LANDED_ID, run, true);
        expect(v.state).toBe("merged");
        expect(v.merged).toBe(true);
        expect(v.canClose).toBe(false);
        expect(v.closeOff).toMatch(/could not verify/);
    });

    it("never reads merged from a passed final alone: the land decides", () => {
        const run = runOf(LANDED_ID, { done: 11, total: 11, status: "done", final: { state: "passed", round: 1 } });
        const v = runStepView(LANDED_ID, run, true);
        expect(v.merged).toBe(false);
        expect(v.canClose).toBe(false);
    });

    it("falls back to its base when the run names no base branch", () => {
        const run = {
            ...runOf(LANDED_ID, {
                done: 1,
                total: 1,
                land: { state: "landed", commit: "abcdef123" },
                final: { state: "passed", round: 1 },
            }),
            base: undefined,
        };
        expect(runStepView(LANDED_ID, run, true).headline).toBe("Built and merged into its base at abcdef1");
    });

    it("reads a run Arc has loaded and cannot find as missing", () => {
        const v = runStepView(BLOCKED_ID, undefined, true);
        expect(v.state).toBe("missing");
        expect(v.headline).toBe("Arc can’t find run 9c6eb723");
        expect(v.tree).toBe("not found");
        expect(v.canClose).toBe(false);
    });

    it("reads a run still loading as loading, with no tree text", () => {
        const v = runStepView(BLOCKED_ID, undefined, false);
        expect(v.state).toBe("loading");
        expect(v.tree).toBe("");
        expect(v.canClose).toBe(false);
    });

    it("names the other states in the tree", () => {
        const at = (opts: Parameters<typeof runOf>[1]) => runStepView(BLOCKED_ID, runOf(BLOCKED_ID, opts), true);
        expect(at({ done: 3, total: 10 }).tree).toBe("building 3/10");
        expect(at({ done: 10, total: 10, final: { state: "checking", round: 1 } }).tree).toBe("final check");
        expect(at({ done: 10, total: 10, land: { state: "held", reason: "the checkout is dirty" } }).tree).toBe(
            "land held"
        );
        expect(at({ done: 10, total: 10, land: { state: "pending" } }).tree).toBe("landing");
        expect(at({ done: 3, total: 10, status: "cancelled" }).tree).toBe("cancelled");
        expect(at({ done: 0, total: 0, status: "planning" }).tree).toBe("planning");
    });
});

describe("runTreeText", () => {
    it("puts the run's state ahead of the short run id", () => {
        expect(runTreeText(BLOCKED_ID, { tree: "final failed" })).toBe("final failed · run 9c6eb723");
    });

    it("reads the run id alone while the run loads", () => {
        expect(runTreeText(BLOCKED_ID, { tree: "" })).toBe("run 9c6eb723");
    });
});

describe("closeTargets", () => {
    const cwd = "C:\\code\\siem";

    it("deletes the canvas first, then the brainstorm", () => {
        expect(closeTargets(cwd, "engine-rule-severity", "engine-rule-severity")).toEqual({
            ok: true,
            paths: [
                "C:\\code\\siem\\.superpowers\\design\\engine-rule-severity",
                "C:\\code\\siem\\.superpowers\\brainstorm\\engine-rule-severity",
            ],
        });
    });

    it("deletes only the brainstorm when no canvas is named", () => {
        expect(closeTargets("/home/k/siem", "topic")).toEqual({
            ok: true,
            paths: ["/home/k/siem/.superpowers/brainstorm/topic"],
        });
    });

    for (const bad of ["..", "a/b", "a\\b", "", "."]) {
        it(`refuses the topic ${JSON.stringify(bad)}`, () => {
            const r = closeTargets(cwd, bad, "canvas");
            expect("reason" in r && r.reason).toContain(`“${bad}”`);
        });

        it(`refuses the canvas ${JSON.stringify(bad)}`, () => {
            const r = closeTargets(cwd, "topic", bad);
            expect("reason" in r && r.reason).toContain(`“${bad}”`);
        });
    }
});
