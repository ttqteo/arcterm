// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    clampSelection,
    finalCheckEntry,
    roundLabel,
    roundTally,
    scenarioTally,
    shotPath,
    shotRounds,
    stepShot,
    type ShotRound,
} from "./finalshotsmodel";

type StepState = "pass" | "fail" | "skip";

function steps(...states: StepState[]): FinalShotStep[] {
    return states.map((state, i) => ({ step: `step ${i + 1}`, state }));
}

function files(name: string, n: number): string[] {
    return Array.from({ length: n }, (_, i) => `cdp-shots/${name}${i ? `-${i}` : ""}.png`);
}

// the Viewer board's five scenarios: 16 shots; round 1 failed jarvis-peek steps 4 and 5
function boardShots(round: number): FinalShot[] {
    const peek: StepState = round === 1 ? "fail" : "pass";
    return [
        { name: "surface-smoke", files: files("surface-smoke", 9), steps: steps(..."ppppppppps".split("").map(st)) },
        {
            name: "brief-peek",
            files: files("brief-peek", 1),
            steps: steps("pass", "pass", "pass", "pass", "pass", "pass"),
        },
        { name: "peek-ctrl-click", files: files("peek-ctrl-click", 1), steps: steps("pass", "pass", "pass", "pass") },
        {
            name: "jarvis-peek",
            files: files("jarvis-peek", 4),
            steps: steps("pass", "pass", "pass", peek, peek, "pass", "pass"),
        },
        {
            name: "resource-linking",
            files: files("resource-linking", 1),
            steps: steps("pass", "pass", "skip", "pass", "skip", "skip", "pass"),
        },
    ];
}

function st(c: string): StepState {
    return c === "p" ? "pass" : c === "f" ? "fail" : "skip";
}

function stage(state: string, round: number, shots: FinalShot[] = [], manifest = true): FinalStage {
    return { state, round, outdir: `C:/data/final-shots/48060136/${round}`, shots, shotsmanifest: manifest };
}

function group(
    final: FinalStage | undefined,
    pastfinals?: FinalStage[],
    finalcmd = "node final-verify.mjs"
): TaskGroup {
    return { oid: "48060136", finalcmd, final, pastfinals, tasks: [], status: "finalizing" } as unknown as TaskGroup;
}

function entryText(g: TaskGroup) {
    const e = finalCheckEntry(g);
    return (
        e && {
            tone: e.tone,
            head: e.head,
            right: e.right,
            dock: e.dockLabel,
            accent: e.dockAccent,
            disabled: e.dockDisabled,
        }
    );
}

describe("finalCheckEntry: the States board", () => {
    it("round 1 failed while the fix round is running", () => {
        const shots = boardShots(1);
        shots[0].files = files("surface-smoke", 10);
        expect(entryText(group({ state: "", round: 2 }, [stage("failed", 1, shots)]))).toEqual({
            tone: "fail",
            head: "failed · jarvis-peek 2 steps",
            right: "17 shots · round 1",
            dock: "Screenshots · 17",
            accent: true,
            disabled: false,
        });
    });

    // the earlier round's shots stay reachable while the next round runs: hiding them left a long Final with
    // no screenshots at all until it finished
    it("keeps the earlier round while the next round's commands or verifier run", () => {
        for (const state of ["checking", "final", "verifying"]) {
            expect(entryText(group({ state, round: 2 }, [stage("failed", 1, boardShots(1))]))).toMatchObject({
                head: "failed · jarvis-peek 2 steps",
                right: "16 shots · round 1",
                dock: "Screenshots · 16",
            });
        }
    });

    it("passed", () => {
        expect(entryText(group(stage("passed", 1, boardShots(2))))).toEqual({
            tone: "pass",
            head: "passed · 5 scenarios",
            right: "16 shots",
            dock: "Screenshots · 16",
            accent: false,
            disabled: false,
        });
    });

    it("unverified with no screenshots, as a plain listing of nothing", () => {
        expect(entryText(group(stage("unverified", 1, [], false)))).toEqual({
            tone: "warn",
            head: "unverified · no screenshots",
            right: "",
            dock: "Screenshots · 0",
            accent: false,
            disabled: true,
        });
    });

    it("a manifest whose scenarios kept no files reads as no screenshots", () => {
        const shots = [{ name: "a", files: [], steps: steps("pass") }];
        expect(finalCheckEntry(group(stage("passed", 1, shots)))?.head).toBe("passed · no screenshots");
    });

    it("a plain PNG listing", () => {
        const plain = ["top", "mid", "bottom"].map((name) => ({ name, files: [`${name}.png`] }));
        expect(entryText(group(stage("passed", 1, plain, false)))).toEqual({
            tone: "pass",
            head: "passed · 3 screenshots",
            right: "3 shots",
            dock: "Screenshots · 3",
            accent: false,
            disabled: false,
        });
        expect(finalCheckEntry(group(stage("passed", 1, plain, false)))?.strip.map((s) => s.verdict)).toEqual([
            "none",
            "none",
            "none",
        ]);
    });
});

describe("finalCheckEntry: the Main board", () => {
    const g = group(stage("unverified", 2, boardShots(2)), [stage("failed", 1, boardShots(1))]);

    it("shows the latest round, its count alone, and the failed round's caption", () => {
        const e = finalCheckEntry(g);
        expect(e).toMatchObject({
            tone: "warn",
            head: "unverified · 5 scenarios",
            right: "16 shots · 2 rounds",
            dockLabel: "Screenshots · 16",
            dockAccent: false,
            dockDisabled: false,
            caption: "Round 1 failed on jarvis-peek steps 4 and 5.",
            latestRound: 2,
        });
        expect(e?.strip.map((s) => s.name)).toEqual([
            "surface-smoke",
            "brief-peek",
            "peek-ctrl-click",
            "jarvis-peek",
            "resource-linking",
        ]);
        expect(e?.strip[0].file).toBe("cdp-shots/surface-smoke.png");
    });

    it("names one failing step singular and joins several scenarios", () => {
        const shots = [
            { name: "a", files: ["a.png"], steps: steps("fail", "pass") },
            { name: "b", files: ["b.png"], steps: steps("pass", "fail", "fail", "fail") },
        ];
        const e = finalCheckEntry(group(stage("passed", 2, boardShots(2)), [stage("failed", 1, shots)]));
        expect(e?.caption).toBe("Round 1 failed on a step 1, b steps 2, 3 and 4.");
        expect(finalCheckEntry(group(stage("failed", 1, shots)))?.head).toBe("failed · 2 scenarios failed");
        expect(finalCheckEntry(group(stage("failed", 1, [shots[0]])))?.head).toBe("failed · a 1 step");
    });

    it("a failed round with no failing steps is captioned by its number alone", () => {
        const e = finalCheckEntry(group(stage("passed", 2, boardShots(2)), [stage("failed", 1, [], false)]));
        expect(e?.caption).toBe("Round 1 failed.");
    });

    it("has no caption when no earlier round failed", () => {
        expect(finalCheckEntry(group(stage("failed", 1, boardShots(1))))?.caption).toBeNull();
    });
});

describe("finalCheckEntry: when there is none", () => {
    it("is null for a dag with no Final command", () => {
        expect(finalCheckEntry(group(stage("passed", 1, boardShots(2)), undefined, ""))).toBeNull();
    });

    it("is null before any round finished, and for no dag", () => {
        expect(finalCheckEntry(group({ state: "", round: 1 }))).toBeNull();
        expect(finalCheckEntry(group({ state: "checking", round: 1 }))).toBeNull();
        expect(finalCheckEntry(group(undefined))).toBeNull();
        expect(finalCheckEntry(null)).toBeNull();
    });
});

describe("shotRounds", () => {
    it("lists past rounds then the finished current one, failed scenarios first", () => {
        const rounds = shotRounds(group(stage("unverified", 2, boardShots(2)), [stage("failed", 1, boardShots(1))]));
        expect(rounds.map(roundLabel)).toEqual(["Round 1 failed", "Round 2 unverified"]);
        expect(rounds[0].scenarios.map((s) => `${s.name}:${s.verdict}`)).toEqual([
            "jarvis-peek:fail",
            "surface-smoke:pass",
            "brief-peek:pass",
            "peek-ctrl-click:pass",
            "resource-linking:pass",
        ]);
        expect(rounds[1].scenarios[0].name).toBe("surface-smoke");
        expect(rounds.map((r) => r.shotCount)).toEqual([16, 16]);
    });

    it("leaves out a round still running", () => {
        expect(shotRounds(group({ state: "verifying", round: 2 }, [stage("failed", 1)])).map((r) => r.round)).toEqual([
            1,
        ]);
    });

    it("joins the out dir and a file", () => {
        const [r] = shotRounds(group(stage("passed", 1, boardShots(2))));
        expect(shotPath(r, "cdp-shots/brief-peek.png")).toBe("C:/data/final-shots/48060136/1/cdp-shots/brief-peek.png");
    });
});

describe("tallies: the Viewer board's strings", () => {
    const [r1, r2] = shotRounds(group(stage("unverified", 2, boardShots(2)), [stage("failed", 1, boardShots(1))]));
    const byName = (r: ShotRound, name: string) => r.scenarios.find((s) => s.name === name)!;

    it("tallies a scenario short and long", () => {
        expect(scenarioTally(byName(r1, "jarvis-peek"))).toEqual({ short: "5/7", long: "2 failed, 5 of 7 passed" });
        expect(scenarioTally(byName(r1, "surface-smoke"))).toEqual({ short: "9/9", long: "9 of 9 passed, 1 skipped" });
        expect(scenarioTally(byName(r1, "resource-linking"))).toEqual({
            short: "4/4",
            long: "4 of 4 passed, 3 skipped",
        });
        expect(scenarioTally(byName(r2, "jarvis-peek"))).toEqual({ short: "7/7", long: "7 of 7 passed" });
        const mixed = shotRounds(
            group(
                stage("failed", 1, [
                    { name: "x", files: [], steps: steps("pass", "fail", "pass", "skip", "pass", "pass") },
                ])
            )
        );
        expect(scenarioTally(mixed[0].scenarios[0])).toEqual({
            short: "4/5",
            long: "1 failed, 4 of 5 passed, 1 skipped",
        });
    });

    it("tallies a round", () => {
        expect(roundTally(r1)).toBe("28 of 30 steps passed, 4 skipped");
        expect(roundTally(r2)).toBe("30 of 30 steps passed, 4 skipped");
    });

    it("a plain listing has no step tallies", () => {
        const [plain] = shotRounds(group(stage("passed", 1, [{ name: "top", files: ["top.png"] }], false)));
        expect(scenarioTally(plain.scenarios[0])).toEqual({ short: "", long: "" });
        expect(roundTally(plain)).toBe("1 screenshot");
    });
});

describe("clampSelection", () => {
    const [round] = shotRounds(group(stage("passed", 1, boardShots(2))));
    const shrunk: ShotRound = { ...round, scenarios: round.scenarios.slice(0, 2), shotCount: 10 };

    it("keeps an index that is still in bounds", () => {
        expect(clampSelection(round, 3, 2)).toEqual({ s: 3, k: 2 });
    });

    it("clamps the scenario and then the shot into a round that shrank", () => {
        // jarvis-peek (index 3) shot 3 → brief-peek (index 1) has one shot
        expect(clampSelection(shrunk, 3, 3)).toEqual({ s: 1, k: 0 });
        expect(clampSelection(round, 0, 20)).toEqual({ s: 0, k: 8 });
    });

    it("clamps to zero for a round with no scenarios or a scenario with no files", () => {
        expect(clampSelection({ ...round, scenarios: [], shotCount: 0 }, 2, 2)).toEqual({ s: 0, k: 0 });
        const empty: ShotRound = { ...round, scenarios: [{ name: "x", files: [], steps: [], verdict: "pass" }] };
        expect(clampSelection(empty, 0, 3)).toEqual({ s: 0, k: 0 });
    });
});

describe("stepShot", () => {
    const [round] = shotRounds(group(stage("passed", 2, boardShots(2))));

    it("moves within a scenario's shots", () => {
        expect(stepShot(round, 0, 3, 1)).toEqual({ s: 0, k: 4 });
        expect(stepShot(round, 3, 2, -1)).toEqual({ s: 3, k: 1 });
    });

    it("crosses into the next scenario's first shot and the previous one's last", () => {
        // surface-smoke's ninth shot → brief-peek; jarvis-peek's first ← peek-ctrl-click
        expect(stepShot(round, 0, 8, 1)).toEqual({ s: 1, k: 0 });
        expect(stepShot(round, 4, 0, -1)).toEqual({ s: 3, k: 3 });
        expect(stepShot(round, 1, 0, -1)).toEqual({ s: 0, k: 8 });
    });

    it("walks a plain listing, one shot per scenario", () => {
        const listing = [1, 2, 3].map((i) => ({ name: `${i}.png`, files: [`${i}.png`] }));
        const [plain] = shotRounds(group(stage("failed", 1, listing, false)));
        expect(stepShot(plain, 0, 0, 1)).toEqual({ s: 1, k: 0 });
        expect(stepShot(plain, 2, 0, -1)).toEqual({ s: 1, k: 0 });
    });

    it("skips a scenario with no shots and stops at the round's ends", () => {
        const gap: ShotRound = {
            ...round,
            scenarios: [round.scenarios[1], { name: "x", files: [], steps: [], verdict: "pass" }, round.scenarios[2]],
        };
        expect(stepShot(gap, 0, 0, 1)).toEqual({ s: 2, k: 0 });
        expect(stepShot(round, 0, 0, -1)).toBeNull();
        expect(stepShot(round, 4, 0, 1)).toBeNull();
    });
});
