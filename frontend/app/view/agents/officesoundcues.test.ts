// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { PlanAgent, PlanRun } from "./officeplanmodel";
import {
    CUE_GAP_MS,
    cueSnapshot,
    diffCues,
    pickCue,
    soundGate,
    STEP_SOUND_PX,
    stepSound,
    withBoardBaseline,
} from "./officesoundcues";

const agent = (id: string, state: PlanAgent["state"] = "working"): PlanAgent => ({
    id,
    name: id,
    state,
    finished: false,
});
const run = (id: string, states: string[], o: Partial<PlanRun> = {}): PlanRun => ({
    id,
    title: id,
    done: false,
    leadAsking: false,
    tasks: states.map((state, i) => ({ id: `t${i + 1}`, label: `t${i + 1}`, state, asking: false })),
    ...o,
});
const snap = (agents: PlanAgent[], runs: PlanRun[], board: { key: string; kind: string }[] | null = []) =>
    cueSnapshot(agents, runs, board);

describe("diffCues", () => {
    it("is silent on the first snapshot", () => {
        expect(diffCues(null, snap([agent("a", "asking")], [run("r", ["done"], { landed: true })]))).toEqual([]);
    });

    it("gives taskDone when a task turns done, setback when one fails", () => {
        const a = snap([], [run("r", ["running", "running"])]);
        expect(diffCues(a, snap([], [run("r", ["done", "running"])]))).toEqual(["taskDone"]);
        expect(diffCues(a, snap([], [run("r", ["running", "review-failed"])]))).toEqual(["setback"]);
    });

    it("gives landed when a known run lands, never for a cancelled run", () => {
        const a = snap([], [run("r", ["done"])]);
        expect(diffCues(a, snap([], [run("r", ["done"], { done: true, landed: true })]))).toEqual(["landed"]);
        expect(diffCues(a, snap([], [run("r", ["done"], { done: true })]))).toEqual([]);
    });

    it("gives needsYou when an agent, a lead or a task starts asking", () => {
        const a = snap([agent("a")], [run("r", ["running"])]);
        expect(diffCues(a, snap([agent("a", "asking")], [run("r", ["running"])]))).toEqual(["needsYou"]);
        expect(diffCues(a, snap([agent("a")], [run("r", ["running"], { leadAsking: true })]))).toEqual(["needsYou"]);
        const asking = run("r", ["running"]);
        asking.tasks[0].asking = true;
        expect(diffCues(a, snap([agent("a")], [asking]))).toEqual(["needsYou"]);
    });

    it("sorts a new Needs you row by its kind", () => {
        const a = snap([], []);
        expect(diffCues(a, snap([], [], [{ key: "k1", kind: "plan-review" }]))).toEqual(["needsYou"]);
        expect(diffCues(a, snap([], [], [{ key: "k2", kind: "run-land-held" }]))).toEqual(["setback"]);
        expect(diffCues(a, snap([], [], [{ key: "k3", kind: "run-unverified" }]))).toEqual(["setback"]);
    });

    it("says nothing for what only came into view", () => {
        const a = snap([], []);
        expect(diffCues(a, snap([agent("a", "asking")], [run("r", ["done"], { landed: true })]))).toEqual([]);
    });

    it("takes the Needs you list's first load as a baseline too", () => {
        const loading = snap([], [], null);
        const loaded = snap([], [], [{ key: "k1", kind: "plan-review" }]);
        expect(diffCues(loading, loaded)).toEqual([]);
        expect(
            diffCues(
                loaded,
                snap(
                    [],
                    [],
                    [
                        { key: "k1", kind: "plan-review" },
                        { key: "k2", kind: "lead-ask" },
                    ]
                )
            )
        ).toEqual(["needsYou"]);
    });

    it("gives one cue for five tasks done at once", () => {
        const a = snap([], [run("r", ["running", "running", "running", "running", "running"])]);
        expect(diffCues(a, snap([], [run("r", ["done", "done", "done", "done", "done"])]))).toEqual(["taskDone"]);
    });

    it("lists every cue of a mixed burst in rank order", () => {
        const a = snap([agent("a")], [run("r", ["running", "running"])]);
        expect(diffCues(a, snap([agent("a", "asking")], [run("r", ["done", "failed"])]))).toEqual([
            "needsYou",
            "setback",
            "taskDone",
        ]);
    });
});

describe("withBoardBaseline", () => {
    it("keeps null null", () => {
        expect(withBoardBaseline(null)).toBeNull();
    });

    it("makes rows that only came into view through a filter change a baseline", () => {
        const prev = snap([], [], [{ key: "a", kind: "plan-review" }]);
        const next = snap(
            [],
            [],
            [
                { key: "a", kind: "plan-review" },
                { key: "b", kind: "plan-review" },
            ]
        );
        expect(diffCues(prev, next)).toEqual(["needsYou"]);
        expect(diffCues(withBoardBaseline(prev), next)).toEqual([]);
        expect(prev.board).not.toBeNull();
    });

    it("leaves the agents' and tasks' cues alone", () => {
        const prev = snap([agent("a")], [run("r", ["running", "running"])], [{ key: "a", kind: "plan-review" }]);
        const next = snap(
            [agent("a", "asking")],
            [run("r", ["done", "failed"])],
            [
                { key: "a", kind: "plan-review" },
                { key: "b", kind: "run-land-held" },
            ]
        );
        expect(diffCues(withBoardBaseline(prev), next)).toEqual(["needsYou", "setback", "taskDone"]);
        expect(diffCues(withBoardBaseline(snap([], [run("r", ["running"])])), snap([], [run("r", ["done"])]))).toEqual([
            "taskDone",
        ]);
    });
});

describe("pickCue", () => {
    it("plays the highest ranked of a burst, once", () => {
        expect(pickCue(["taskDone", "landed", "setback"], null, 0)).toBe("setback");
        expect(pickCue(["taskDone", "needsYou"], null, 0)).toBe("needsYou");
        expect(pickCue(["setback", "needsYou"], null, 0)).toBe("needsYou");
        expect(pickCue(["landed", "taskDone"], null, 0)).toBe("landed");
        expect(pickCue([], null, 0)).toBeNull();
    });

    it("drops a cue inside the gap", () => {
        expect(pickCue(["taskDone"], 1000, 1000 + CUE_GAP_MS - 1)).toBeNull();
        expect(pickCue(["taskDone"], 1000, 1000 + CUE_GAP_MS)).toBe("taskDone");
    });
});

describe("soundGate", () => {
    const s = { events: true, ui: true, music: true, volume: 0.5, muted: false };
    it("lets each kind through by its switch while focused and not muted", () => {
        expect(soundGate(s, true)).toEqual({ events: true, ui: true, music: true, volume: 0.5 });
        expect(soundGate({ ...s, ui: false }, true).ui).toBe(false);
    });
    it("silences everything unfocused or muted", () => {
        expect(soundGate(s, false)).toMatchObject({ events: false, ui: false, music: false });
        expect(soundGate({ ...s, muted: true }, true)).toMatchObject({ events: false, ui: false, music: false });
    });
});

describe("stepSound", () => {
    it("ticks once per STEP_SOUND_PX walked", () => {
        expect(stepSound(0, STEP_SOUND_PX - 3)).toEqual({ acc: STEP_SOUND_PX - 3, play: false });
        expect(stepSound(STEP_SOUND_PX - 3, 6)).toEqual({ acc: 3, play: true });
    });
});
