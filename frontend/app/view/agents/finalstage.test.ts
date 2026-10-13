// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    finalRowFocusId,
    finalStageId,
    finalStageRunId,
    finalStageView,
    isFinalStageId,
    outputTail,
    stepHasOutput,
    type FinalStageView,
} from "./finalstage";

const S = 1000;
const NOW = 10_000_000;
const HUMAN = "ended by the human: the dev app never came up";

const task = (id: string, state = "done") => ({ id, state }) as TaskNode;
const sevenDone = ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6", "t-7"].map((id) => task(id));

function dag(final: Partial<FinalStage> | undefined, over: Partial<TaskGroup> = {}): TaskGroup {
    return {
        oid: "dag-1",
        runid: "lead-run",
        status: "finalizing",
        tasks: sevenDone,
        check: "go build ./cmd/wsh/...",
        verify: "node scripts/verify.mjs ./pkg/x",
        finalcmd: "node scripts/cdp/final-verify.mjs surface-smoke",
        final,
        ...over,
    } as TaskGroup;
}

let seq = 0;
function ev(step: string, ms: number, ok = true, round = 1, ts = NOW): RunEvent {
    seq++;
    return {
        id: `e-${seq}`,
        runid: "lead-run",
        channelid: "ch",
        ts,
        kind: "final-step",
        detail: JSON.stringify({ round, step, ms, ok }),
    };
}

const states = (v: FinalStageView) => v.steps.map((s) => s.state);
const tones = (v: FinalStageView) => v.steps.map((s) => s.tone);
const times = (v: FinalStageView) => v.steps.map((s) => s.ms);

describe("finalStageView, the States board", () => {
    it("tasks still running: no row, and the node waits on every task", () => {
        const tasks = [...sevenDone.slice(0, 4), task("t-5", "running"), task("t-6", "pending"), task("t-7", "ready")];
        const v = finalStageView(dag(undefined, { status: "running", tasks }), [], NOW);
        expect(v.visible).toBe(false);
        expect(v.subline).toBe("after 3 more tasks");
        expect(v.nodeMeta).toBe("waits on every task");
        expect(v.tone).toBe("wait");
        expect(tones(v)).toEqual(["wait", "wait", "wait", "wait", "wait"]);
        expect(v.waitsOn).toEqual(["t-5", "t-6", "t-7"]);
    });

    it("preparing the tree", () => {
        const final = { state: "checking", round: 1, step: "tree", stepts: NOW - 22 * S, startedts: NOW - 22 * S };
        const v = finalStageView(dag(final), [], NOW);
        expect(v.visible).toBe(true);
        expect(v.subline).toBe("Tree · 22s · step 1 of 5");
        expect(v.nodeMeta).toBe("round 1 · Tree · 22s");
        expect(v.tone).toBe("run");
        expect(tones(v)).toEqual(["run", "wait", "wait", "wait", "wait"]);
        expect(v.headline).toBe("round 1 · preparing the tree · 22s");
        expect(v.output).toBe("");
    });

    it("a command running", () => {
        const stepts = NOW - 192 * S;
        const final = { state: "checking", round: 1, step: "verify", stepts, output: "ok pkg/x\n", startedts: 1 };
        const events = [ev("tree", 41 * S, true, 1, stepts - 18 * S), ev("check", 18 * S, true, 1, stepts)];
        const v = finalStageView(dag(final), events, NOW);
        expect(v.subline).toBe("Verify · 3m 12s · step 3 of 5");
        expect(v.nodeMeta).toBe("round 1 · Verify · 3m 12s");
        expect(v.headline).toBe("round 1 · running Verify · 3m 12s");
        expect(v.tone).toBe("run");
        expect(tones(v)).toEqual(["pass", "pass", "run", "wait", "wait"]);
        expect(v.steps.map((s) => s.text)).toEqual([
            "passed 41s",
            "passed 18s",
            "running 3m 12s",
            "waiting",
            "waiting",
        ]);
        expect(v.running).toBe("verify");
        expect(v.stepIndex).toBe(3);
        expect(v.elapsedMs).toBe(192 * S);
        // the round's time is every step's so far: 41s, 18s and 3m 12s
        expect(v.stageMs).toBe((41 + 18 + 192) * S);
        expect(v.output).toBe("ok pkg/x\n");
        expect(v.next).toBe("next Final, then the verifier");
        expect(v.steps[2].command).toBe("node scripts/verify.mjs ./pkg/x");
    });

    it("verifier alongside", () => {
        const final = { state: "checking", round: 1, step: "check", stepts: NOW - 11 * S, verifierrunid: "v-run" };
        const v = finalStageView(dag(final, { finalcmd: "" }), [ev("tree", 30 * S)], NOW);
        expect(v.subline).toBe("Check · 11s · verifier alongside");
        expect(v.nodeMeta).toBe("round 1 · Check · verifier");
        expect(v.tone).toBe("run");
        expect(tones(v)).toEqual(["pass", "run", "wait", "run"]);
        expect(v.alongside).toBe(true);
        expect(v.running).toBe("check");
        expect(v.next).toBe("next Verify");
    });

    it("verifier reviewing", () => {
        const final = { state: "verifying", round: 2, verifierrunid: "v-run", startedts: NOW - 242 * S };
        const v = finalStageView(dag(final), [], NOW);
        expect(v.subline).toBe("verifier reviewing · 4m 02s");
        expect(v.nodeMeta).toBe("round 2 · verifier · 4m 02s");
        expect(v.tone).toBe("run");
        expect(tones(v)).toEqual(["pass", "pass", "pass", "pass", "run"]);
        expect(v.running).toBe("verifier");
        expect(v.stepIndex).toBe(5);
        expect(v.alongside).toBe(false);
        expect(v.next).toBe("");
    });

    it("failed", () => {
        const final = { state: "failed", round: 1, detail: "Final `x` failed (exit 1):\njarvis-peek steps 4 and 5" };
        const events = [ev("tree", 41 * S), ev("check", 18 * S), ev("verify", 300 * S), ev("final", 125 * S, false)];
        const v = finalStageView(dag(final, { status: "blocked" }), events, NOW);
        expect(v.visible).toBe(true);
        expect(v.subline).toBe("failed at Final · round 1");
        expect(v.nodeMeta).toBe("round 1 · failed at Final");
        expect(v.tone).toBe("fail");
        expect(tones(v)).toEqual(["pass", "pass", "pass", "fail", "wait"]);
        expect(v.steps[3].text).toBe("failed 2m 05s");
        expect(v.steps[4].text).toBe("not run");
    });

    it("fix round under way", () => {
        const tasks = [...sevenDone, task("t-8", "running"), task("t-9", "pending")];
        const v = finalStageView(dag({ state: "", round: 2 }, { status: "running", tasks }), [], NOW);
        expect(v.visible).toBe(true);
        expect(v.subline).toBe("round 2 after 2 fix tasks");
        expect(v.nodeMeta).toBe("round 2 waits on t-8, t-9");
        expect(v.tone).toBe("wait");
        expect(tones(v)).toEqual(["wait", "wait", "wait", "wait", "wait"]);
    });

    it("unverified", () => {
        const final = { state: "unverified", round: 2, verifierrunid: "v-run", unverified: ["verifier: no dev app"] };
        const v = finalStageView(dag(final, { status: "done" }), [], NOW);
        expect(v.subline).toBe("unverified · 1 reason");
        expect(v.nodeMeta).toBe("round 2 · unverified");
        expect(v.tone).toBe("warn");
        expect(tones(v)).toEqual(["pass", "pass", "pass", "pass", "warn"]);
        expect(v.unverified).toEqual(["verifier: no dev app"]);
    });

    it("passed", () => {
        const final = { state: "passed", round: 2, verifierrunid: "v-run", startedts: NOW - 400 * S };
        const events = [41, 18, 300, 263].map((s, i) => ev(["tree", "check", "verify", "final"][i], s * S, true, 2));
        const v = finalStageView(dag(final, { status: "done" }), events, NOW, { completedts: NOW - 160 * S });
        expect(v.subline).toBe("passed · 14m 22s");
        expect(v.nodeMeta).toBe("round 2 · passed · 14m 22s");
        expect(v.tone).toBe("pass");
        expect(tones(v)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
        expect(v.stageMs).toBe(862 * S);
    });
});

describe("finalStageView, the steps", () => {
    it("has a step per command the dag has, between Tree and Verifier", () => {
        const keys = (over: Partial<TaskGroup>) =>
            finalStageView(dag(undefined, over), [], NOW).steps.map((s) => s.key);
        expect(keys({})).toEqual(["tree", "check", "verify", "final", "verifier"]);
        expect(keys({ finalcmd: "" })).toEqual(["tree", "check", "verify", "verifier"]);
        expect(keys({ check: "", verify: "", finalcmd: "" })).toEqual(["verifier"]);
    });

    it("times a running step from stepts, and gives a step with no stepts no time", () => {
        const at = (stepts: number) =>
            finalStageView(dag({ state: "checking", round: 1, step: "check", stepts }), [], NOW);
        expect(at(NOW - 7 * S).steps[1].ms).toBe(7 * S);
        expect(at(0).steps[1].ms).toBeUndefined();
        expect(at(0).steps[1].text).toBe("running");
        expect(at(0).subline).toBe("Check · step 2 of 5");
    });

    it("reads the steps before the running one as passed, timed only by an event", () => {
        const final = { state: "final", round: 1, step: "final", stepts: NOW - S };
        const v = finalStageView(dag(final), [ev("check", 18 * S)], NOW);
        expect(states(v)).toEqual(["passed", "passed", "passed", "running", "waiting"]);
        expect(times(v).slice(0, 3)).toEqual([undefined, 18 * S, undefined]);
        expect(v.steps[0].text).toBe("passed");
    });

    it("a failed stage fails at the step whose event is not ok, keeping the detail whole", () => {
        const detail = "Verify `v` failed on the merged result (exit 1):\n" + "x".repeat(5000) + "\n  trailing  ";
        const events = [ev("tree", S), ev("check", S), ev("verify", S, false)];
        const v = finalStageView(dag({ state: "failed", round: 1, detail }), events, NOW);
        expect(states(v)).toEqual(["passed", "passed", "failed", "notrun", "notrun"]);
        expect(v.detail).toBe(detail);

        const allOk = [...events.slice(0, 2), ev("verify", S), ev("final", S)];
        const byVerifier = finalStageView(
            dag({ state: "failed", round: 1, detail: "defects", verifierrunid: "v-run" }),
            allOk,
            NOW
        );
        expect(states(byVerifier)).toEqual(["passed", "passed", "passed", "passed", "failed"]);
        expect(byVerifier.subline).toBe("failed at Verifier · round 1");
    });

    it("a Check that failed on the base leaves the Verifier to fail the stage", () => {
        const events = [ev("tree", S), ev("check", S, false)];
        const final = { state: "failed", round: 1, detail: "defects", verifierrunid: "v-run" };
        const v = finalStageView(dag(final, { verify: "", finalcmd: "" }), events, NOW);
        expect(states(v)).toEqual(["passed", "unverified", "failed"]);
        expect(v.subline).toBe("failed at Verifier · round 1");
    });

    it("with the round's events gone, a failed stage fails at the command its detail names", () => {
        const v = finalStageView(dag({ state: "failed", round: 1, detail: "Verify `v` failed (exit 1):\nx" }), [], NOW);
        expect(states(v)).toEqual(["passed", "passed", "failed", "notrun", "notrun"]);
    });

    it("a failed Tree step in an unverified stage reads unverified, and the rest not run", () => {
        const final = { state: "unverified", round: 1, unverified: ["the final stage could not check: no tree"] };
        const v = finalStageView(dag(final), [ev("tree", 3 * S, false)], NOW);
        expect(states(v)).toEqual(["unverified", "notrun", "notrun", "notrun", "notrun"]);
    });

    it("a Final command that exited 3 leaves the Verifier to run", () => {
        const events = [ev("tree", S), ev("check", S), ev("verify", S), ev("final", S, false)];
        const reviewing = finalStageView(dag({ state: "verifying", round: 1, verifierrunid: "v-run" }), events, NOW);
        expect(states(reviewing)).toEqual(["passed", "passed", "passed", "unverified", "running"]);

        const failed = finalStageView(
            dag({ state: "failed", round: 1, detail: "defects", verifierrunid: "v-run" }),
            events,
            NOW
        );
        expect(states(failed)).toEqual(["passed", "passed", "passed", "unverified", "failed"]);
    });

    it("a stage a human ended stops at the first step with no passing event", () => {
        const passing = [ev("tree", S), ev("check", S)];
        const expected = ["passed", "passed", "stopped", "notrun", "notrun"];

        const failed = finalStageView(dag({ state: "failed", round: 1, detail: HUMAN }), passing, NOW);
        expect(states(failed)).toEqual(expected);
        expect(failed.detail).toBe(HUMAN);
        expect(failed.steps[2].tone).toBe("warn");
        expect(failed.steps[2].text).toBe("stopped");
        expect(failed.tone).toBe("fail");

        const withEvent = [...passing, ev("verify", 95 * S, false)];
        const unverified = finalStageView(
            dag({ state: "unverified", round: 1, unverified: ["flaky", HUMAN] }),
            withEvent,
            NOW
        );
        expect(states(unverified)).toEqual(expected);
        expect(unverified.unverified).toEqual(["flaky", HUMAN]);
        expect(unverified.steps[2].text).toBe("stopped 1m 35s");
        expect(unverified.subline).toBe("unverified · 2 reasons");
    });

    it("a stage a human ended while only the verifier ran stops at the Verifier", () => {
        const all = [ev("tree", S), ev("check", S), ev("verify", S), ev("final", S)];
        const final = { state: "unverified", round: 1, unverified: [HUMAN], verifierrunid: "v-run" };
        expect(states(finalStageView(dag(final), all, NOW))).toEqual([
            "passed",
            "passed",
            "passed",
            "passed",
            "stopped",
        ]);
        // the commands were over before the verifier started, whether or not their events are still held
        expect(states(finalStageView(dag(final), [], NOW))[4]).toBe("stopped");
        const alone = finalStageView(dag(final, { check: "", verify: "", finalcmd: "" }), [], NOW);
        expect(states(alone)).toEqual(["stopped"]);
    });

    it("ignores another round's events, and takes the newer of two for one step", () => {
        const final = { state: "checking", round: 2, step: "verify", stepts: NOW - S };
        const events = [
            ev("check", 50 * S, true, 2, NOW - 10 * S),
            ev("tree", 99 * S, false, 1),
            ev("check", 20 * S, true, 2, NOW - 5 * S),
            ev("check", 70 * S, true, 2, NOW - 20 * S),
        ];
        const v = finalStageView(dag(final), events, NOW);
        expect(v.steps[0].ms).toBeUndefined();
        expect(v.steps[0].state).toBe("passed");
        expect(v.steps[1].ms).toBe(20 * S);
    });

    it("with no events has no time and no total, and still reads a finished stage by its state", () => {
        const passed = finalStageView(dag({ state: "passed", round: 1 }), [], NOW);
        expect(times(passed)).toEqual([undefined, undefined, undefined, undefined, undefined]);
        expect(passed.stageMs).toBeUndefined();
        expect(passed.elapsedMs).toBeUndefined();
        expect(passed.subline).toBe("passed");
        expect(passed.nodeMeta).toBe("round 1 · passed");
        expect(states(passed)).toEqual(["passed", "passed", "passed", "passed", "passed"]);

        const detail = "Verify `v` failed on the merged result (exit 1):\nFAIL";
        const failed = finalStageView(dag({ state: "failed", round: 1, detail }), [], NOW);
        expect(states(failed)).toEqual(["passed", "passed", "failed", "notrun", "notrun"]);

        const malformed = [
            { ...ev("tree", S), detail: "{not json" },
            { ...ev("tree", S), detail: undefined },
        ];
        expect(finalStageView(dag({ state: "passed", round: 1 }), malformed, NOW).steps[0].ms).toBeUndefined();
    });

    it("totals the steps' times only when every step has one, the Verifier's from its session", () => {
        const final = { state: "passed", round: 1, verifierrunid: "v-run", startedts: NOW - 100 * S };
        const events = [ev("tree", 10 * S), ev("check", 20 * S), ev("verify", 30 * S), ev("final", 40 * S)];
        const whole = finalStageView(dag(final), events, NOW, { completedts: NOW - 40 * S });
        expect(whole.steps[4].ms).toBe(60 * S);
        expect(whole.stageMs).toBe(160 * S);
        expect(whole.elapsedMs).toBe(160 * S);

        expect(finalStageView(dag(final), events.slice(1), NOW, { completedts: NOW }).stageMs).toBeUndefined();
        const noRun = finalStageView(dag(final), events, NOW);
        expect(noRun.steps[4].ms).toBeUndefined();
        expect(noRun.stageMs).toBeUndefined();
        const noStart = finalStageView(dag({ ...final, startedts: 0 }), events, NOW, { completedts: NOW });
        expect(noStart.steps[4].ms).toBeUndefined();
    });

    it("starts the round at its earliest step event once a verifier has moved startedts", () => {
        const treeEnd = NOW - 300 * S;
        const final = { state: "verifying", round: 1, verifierrunid: "v-run", startedts: NOW - 60 * S };
        const events = [ev("check", 100 * S, true, 1, treeEnd + 100 * S), ev("tree", 40 * S, true, 1, treeEnd)];
        const v = finalStageView(dag(final), events, NOW);
        expect(v.stageMs).toBe(340 * S);
        expect(v.elapsedMs).toBe(60 * S);
        // no event left to say when the round began
        expect(finalStageView(dag(final), [], NOW).stageMs).toBeUndefined();
        // before a verifier starts, startedts is the round's own
        const early = { state: "checking", round: 1, step: "tree", stepts: NOW - 5 * S, startedts: NOW - 6 * S };
        expect(finalStageView(dag(early), [], NOW).stageMs).toBe(6 * S);
    });

    it("gives one line per earlier round, oldest first", () => {
        const pastfinals = [
            { state: "unverified", round: 2 },
            { state: "failed", round: 1, detail: "Final `x` failed (exit 1):\nnope" },
        ] as FinalStage[];
        const v = finalStageView(dag({ state: "", round: 3 }, { pastfinals }), [ev("final", S, false, 1)], NOW);
        expect(v.past).toEqual([
            { round: 1, tone: "fail", text: "round 1 · failed at Final" },
            { round: 2, tone: "warn", text: "round 2 · unverified" },
        ]);
    });

    it("points each command step that ended at the output it kept, versioned by its end", () => {
        const outdir = "C:/data/final-shots/dag-1/1";
        const final = { state: "final", round: 1, step: "final", stepts: NOW, outdir, output: "booting" };
        const events = [
            ev("tree", S, true, 1, NOW - 3 * S),
            ev("check", S, true, 1, NOW - 2 * S),
            ev("verify", S, false, 1, NOW - S),
        ];
        const v = finalStageView(dag(final), events, NOW);
        const kept = Object.fromEntries(v.steps.map((s) => [s.key, s.kept]));
        expect(kept).toEqual({
            tree: undefined,
            check: { path: `${outdir}-steps/check.txt`, ts: NOW - 2 * S },
            verify: { path: `${outdir}-steps/verify.txt`, ts: NOW - S },
            final: undefined,
            verifier: undefined,
        });
        // the running Final opens its live tail; Tree and the Verifier have no output of their own
        expect(v.steps.filter(stepHasOutput).map((s) => s.key)).toEqual(["check", "verify", "final"]);
    });

    it("keeps no output for a step with no event, or a stage with no out dir", () => {
        const done = { state: "passed", round: 1 };
        expect(finalStageView(dag(done), [ev("check", S)], NOW).steps.some((s) => s.kept)).toBe(false);
        const withDir = { ...done, outdir: "/d/1" };
        expect(finalStageView(dag(withDir), [], NOW).steps.some((s) => s.kept)).toBe(false);
    });

    it("is invisible with nothing running for no dag and for a dag with no tasks", () => {
        for (const v of [finalStageView(undefined, [], NOW), finalStageView(dag(undefined, { tasks: [] }), [], NOW)]) {
            expect(v.visible).toBe(false);
            expect(v.steps).toEqual([]);
            expect(v.running).toBeUndefined();
            expect(v.stepIndex).toBe(0);
        }
    });
});

describe("the stage's focus id", () => {
    it("round-trips the run id", () => {
        const id = finalStageId("lead-run");
        expect(isFinalStageId(id)).toBe(true);
        expect(finalStageRunId(id)).toBe("lead-run");
        expect(isFinalStageId("ended:lead-run:t-1")).toBe(false);
        expect(finalStageRunId("agent-1")).toBeUndefined();
    });

    it("focuses the verifier agent only when it holds the current round's verifier run", () => {
        const run = { runId: "lead-run", dag: dag({ state: "verifying", round: 2, verifierrunid: "v-2" }) };
        const earlier = { id: "tab-old", runId: "v-1" };
        expect(finalRowFocusId(run, [earlier, { id: "tab-new", runId: "v-2" }])).toBe("tab-new");
        expect(finalRowFocusId(run, [earlier])).toBe(finalStageId("lead-run"));
        expect(finalRowFocusId(run, [])).toBe(finalStageId("lead-run"));
        const noVerifier = { runId: "lead-run", dag: dag({ state: "checking", round: 1 }) };
        expect(finalRowFocusId(noVerifier, [{ id: "plain", runId: undefined }])).toBe(finalStageId("lead-run"));
    });
});

describe("outputTail", () => {
    it("keeps the last lines", () => {
        expect(outputTail("a\nb\r\nc\nd\n", 3)).toBe("b\nc\nd");
        expect(outputTail("a\nb", 5)).toBe("a\nb");
        expect(outputTail("a\nb", 0)).toBe("");
        expect(outputTail("", 3)).toBe("");
    });
});
