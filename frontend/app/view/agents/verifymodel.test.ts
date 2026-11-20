// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { rerunLine, verifyTile } from "./verifymodel";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

function row(over: Partial<VerifyRowData> & { scenario: string }): VerifyRowData {
    return {
        state: "passed",
        passed: 0,
        total: 0,
        done: 0,
        of: 0,
        shots: 0,
        started: NOW - 30 * MIN,
        ended: NOW - 25 * MIN,
        ...over,
    };
}

function state(over: Partial<VerifyStateData> = {}): VerifyStateData {
    return { rows: [], verdict: "", notrun: false, notrunskipped: false, ...over };
}

const FAILED_STEPS = [
    "7. a council started through PowerShell draws its card",
    "8. the card keeps its seats",
    "9. the card opens the report",
];

const CHANGED = [
    "frontend/app/view/agents/agentrailtabs.tsx",
    "frontend/app/view/agents/councilrail.tsx",
    "frontend/app/view/agents/railverify.tsx",
];

describe("verifyTile: no tile", () => {
    it("is not shown before the first reading", () => {
        const vm = verifyTile(null, NOW);
        expect(vm.shown).toBe(false);
        expect(vm.rows).toEqual([]);
        expect(vm.chip).toBeNull();
        expect(vm.strip).toBeNull();
        expect(vm.warning).toBeNull();
    });

    it("is not shown for an empty state: config present, nothing changed or run", () => {
        const vm = verifyTile(state(), NOW);
        expect(vm.shown).toBe(false);
        expect(vm.folded).toBe(false);
        expect(vm.chip).toBeNull();
        expect(vm.strip).toBeNull();
    });
});

describe("verifyTile: the spec's state table", () => {
    it("running: green pulsing dot, `2 of 3`, head `running`, no chip, a pulsing strip icon", () => {
        const vm = verifyTile(
            state({
                verdict: "running",
                rows: [
                    row({
                        scenario: "chat-council-card",
                        state: "running",
                        done: 2,
                        of: 3,
                        ended: 0,
                        started: NOW - 3 * MIN,
                    }),
                ],
            }),
            NOW
        );
        expect(vm.shown).toBe(true);
        expect(vm.folded).toBe(false);
        expect(vm.rows[0]).toMatchObject({
            name: "chat-council-card",
            state: "running",
            tone: "green",
            pulsing: true,
            result: "2 of 3",
            age: "3m",
        });
        expect(vm.head.parts).toEqual([{ text: "running", tone: "green" }]);
        expect(vm.head.count).toBe("1 scenario");
        expect(vm.chip).toBeNull();
        expect(vm.strip).toEqual({ tone: "green", label: "", struck: false, pulsing: true });
    });

    it("skipped: grey dot, `Skipped`, counts as passed, no chip", () => {
        const vm = verifyTile(
            state({
                verdict: "passed",
                rows: [
                    row({ scenario: "a", passed: 14, total: 14 }),
                    row({ scenario: "b", state: "skipped", passed: 0, total: 9 }),
                ],
            }),
            NOW
        );
        const skipped = vm.rows.find((r) => r.name === "b")!;
        expect(skipped).toMatchObject({
            state: "skipped",
            tone: "muted",
            result: "Skipped",
            skipped: true,
            canRerun: false,
            canSkip: false,
        });
        expect(vm.head.parts).toEqual([{ text: "2 passed", tone: "green" }]);
        expect(vm.folded).toBe(true);
        expect(vm.chip).toBeNull();
        expect(vm.strip).toEqual({ tone: "muted", label: "2", struck: false, pulsing: false });
    });

    it("passed: green dot, muted `14/14`, `3 passed`, folded, a muted counted strip, no chip", () => {
        const vm = verifyTile(
            state({
                verdict: "passed",
                rows: [
                    row({ scenario: "a", passed: 14, total: 14 }),
                    row({ scenario: "b", passed: 5, total: 5 }),
                    row({ scenario: "c", passed: 2, total: 2 }),
                ],
            }),
            NOW
        );
        expect(vm.rows[0]).toMatchObject({ state: "passed", tone: "green", resultTone: "muted", pulsing: false });
        expect(vm.rows.map((r) => r.result)).toEqual(["14/14", "5/5", "2/2"]);
        expect(vm.head.parts).toEqual([{ text: "3 passed", tone: "green" }]);
        expect(vm.head.count).toBe("3 scenarios");
        expect(vm.folded).toBe(true);
        expect(vm.warning).toBeNull();
        expect(vm.chip).toBeNull();
        expect(vm.strip).toEqual({ tone: "muted", label: "3", struck: false, pulsing: false });
    });

    it("failed: red dot and `6/9`, `1 failed`, a red chip, a struck red strip count", () => {
        const vm = verifyTile(
            state({
                verdict: "red",
                rows: [
                    row({
                        scenario: "chat-council-card",
                        state: "failed",
                        passed: 6,
                        total: 9,
                        failed: FAILED_STEPS,
                        shots: 9,
                        shotsdir: "D:/repo/cdp-shots",
                        command: "task verify:ui -- chat-council-card",
                    }),
                ],
            }),
            NOW
        );
        const r = vm.rows[0];
        expect(r).toMatchObject({
            name: "chat-council-card",
            state: "failed",
            tone: "red",
            resultTone: "red",
            result: "6/9",
            age: "25m",
            startsOpen: true,
            failed: FAILED_STEPS,
            passedMore: 6,
            note: null,
            command: "task verify:ui -- chat-council-card",
            canRerun: true,
            canSkip: true,
        });
        expect(vm.folded).toBe(false);
        expect(vm.head.parts).toEqual([{ text: "1 failed", tone: "red" }]);
        expect(vm.chip).toMatchObject({ text: "Verify: 1 failed", tone: "red" });
        expect(vm.chip!.title).toBe("chat-council-card failed steps 7, 8, 9");
        expect(vm.strip).toEqual({ tone: "red", label: "1", struck: true, pulsing: false });
    });

    it("no result: amber dot and `No result`, `1 no result`, the chip `Verify: no result`, an amber strip count", () => {
        const vm = verifyTile(
            state({
                verdict: "amber",
                rows: [
                    row({
                        scenario: "rail-council-tab",
                        state: "noresult",
                        command: "task verify:ui -- rail-council-tab",
                    }),
                ],
            }),
            NOW
        );
        expect(vm.rows[0]).toMatchObject({
            state: "noresult",
            tone: "amber",
            resultTone: "amber",
            result: "No result",
            startsOpen: false,
            note: "Stopped during rail-council-tab: the run ended without a result, so its steps were not checked.",
            canRerun: true,
            canSkip: true,
        });
        expect(vm.head.parts).toEqual([{ text: "1 no result", tone: "amber" }]);
        expect(vm.chip).toMatchObject({ text: "Verify: no result", tone: "amber" });
        expect(vm.chip!.title).toBe("rail-council-tab has no result");
        expect(vm.strip).toEqual({ tone: "amber", label: "1", struck: false, pulsing: false });
        expect(vm.warning).toBeNull();
    });

    it("no result with a reason: the note is the reason the run gave", () => {
        const reason = 'Could not start the dev app: the "beforeDevCommand" terminated with a non-zero status code.';
        const vm = verifyTile(state({ rows: [row({ scenario: "x", state: "noresult", reason })] }), NOW);
        expect(vm.rows[0].note).toBe(reason);
    });

    it("not run: no rows, a warning line with both buttons, head `not run`, the chip `Verify: not run`, a `!` strip", () => {
        const vm = verifyTile(
            state({ verdict: "amber", notrun: true, changed: CHANGED, rerun: "task verify:ui -- <name>" }),
            NOW
        );
        expect(vm.shown).toBe(true);
        expect(vm.rows).toEqual([]);
        expect(vm.warning).toEqual({
            kind: "notrun",
            text: "agentrailtabs.tsx and 2 more UI files changed, and no scenario has run in this session.",
            skippable: true,
            skipped: false,
        });
        expect(vm.head.parts).toEqual([{ text: "not run", tone: "amber" }]);
        expect(vm.head.count).toBe("");
        expect(vm.folded).toBe(false);
        expect(vm.chip).toMatchObject({ text: "Verify: not run", tone: "amber" });
        expect(vm.chip!.title).toBe("agentrailtabs.tsx and 2 more UI files changed and no scenario has run");
        expect(vm.strip).toEqual({ tone: "amber", label: "!", struck: false, pulsing: false });
    });

    it("not run, skipped: the warning stays for its Undo but counts toward nothing", () => {
        const vm = verifyTile(state({ verdict: "", notrun: true, notrunskipped: true, changed: CHANGED }), NOW);
        expect(vm.shown).toBe(true);
        expect(vm.warning).toMatchObject({ kind: "notrun", skippable: false, skipped: true });
        expect(vm.head.parts).toEqual([{ text: "skipped", tone: "muted" }]);
        expect(vm.folded).toBe(true);
        expect(vm.chip).toBeNull();
        expect(vm.strip).toEqual({ tone: "muted", label: "", struck: false, pulsing: false });
    });

    it("out of date: green dot and a muted `12/12`, a note, `1 out of date`, the chip `Verify: out of date`, a `!` strip", () => {
        const vm = verifyTile(
            state({
                verdict: "amber",
                changed: CHANGED,
                rows: [
                    row({
                        scenario: "agent-rail-tabs",
                        state: "outofdate",
                        passed: 12,
                        total: 12,
                        ended: NOW - 2 * HOUR,
                        started: NOW - 2 * HOUR - 4 * MIN,
                        changedfile: "frontend/app/view/agents/agentrailtabs.tsx",
                    }),
                ],
            }),
            NOW
        );
        expect(vm.rows[0]).toMatchObject({
            state: "outofdate",
            tone: "green",
            resultTone: "muted",
            result: "12/12",
            age: "2h",
            note: "Passed 2h ago, before agentrailtabs.tsx changed.",
            canRerun: true,
            canSkip: true,
            startsOpen: false,
        });
        expect(vm.warning).toEqual({
            kind: "outofdate",
            text: "agentrailtabs.tsx and 2 more UI files changed after agent-rail-tabs last ran.",
            skippable: false,
            skipped: false,
        });
        expect(vm.head.parts).toEqual([{ text: "1 out of date", tone: "amber" }]);
        expect(vm.folded).toBe(false);
        expect(vm.chip).toMatchObject({ text: "Verify: out of date", tone: "amber" });
        expect(vm.chip!.title).toBe("agent-rail-tabs passed before agentrailtabs.tsx changed");
        expect(vm.strip).toEqual({ tone: "amber", label: "!", struck: false, pulsing: false });
    });
});

describe("verifyTile: several rows", () => {
    const mixed = state({
        verdict: "red",
        changed: CHANGED,
        rows: [
            row({ scenario: "p", passed: 3, total: 3 }),
            row({ scenario: "o", state: "outofdate", passed: 4, total: 4, changedfile: CHANGED[0] }),
            row({ scenario: "n", state: "noresult" }),
            row({ scenario: "f", state: "failed", passed: 1, total: 2, failed: ["2. the card opens"] }),
        ],
    });

    it("sorts worst first: failed, no result, running, out of date, passed, skipped", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "s", state: "skipped" }),
                    row({ scenario: "p", passed: 1, total: 1 }),
                    row({ scenario: "o", state: "outofdate", passed: 1, total: 1 }),
                    row({ scenario: "r", state: "running", done: 0, of: 1, ended: 0 }),
                    row({ scenario: "n", state: "noresult" }),
                    row({ scenario: "f", state: "failed", passed: 0, total: 1, failed: ["1. x"] }),
                ],
            }),
            NOW
        );
        expect(vm.rows.map((r) => r.name)).toEqual(["f", "n", "r", "o", "p", "s"]);
    });

    it("keeps the newest run first among rows of one state", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "old", passed: 1, total: 1, ended: NOW - 5 * HOUR }),
                    row({ scenario: "new", passed: 1, total: 1, ended: NOW - 5 * MIN }),
                ],
            }),
            NOW
        );
        expect(vm.rows.map((r) => r.name)).toEqual(["new", "old"]);
    });

    it("names every red or amber kind in row order, joined by the head parts", () => {
        const vm = verifyTile(mixed, NOW);
        expect(vm.head.parts).toEqual([
            { text: "1 failed", tone: "red" },
            { text: "1 no result", tone: "amber" },
            { text: "1 out of date", tone: "amber" },
        ]);
        expect(vm.head.count).toBe("4 scenarios");
    });

    it("counts rows of a kind, not steps", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "a", state: "failed", passed: 0, total: 3, failed: ["1. a", "2. b", "3. c"] }),
                    row({ scenario: "b", state: "failed", passed: 1, total: 2, failed: ["2. d"] }),
                ],
            }),
            NOW
        );
        expect(vm.head.parts).toEqual([{ text: "2 failed", tone: "red" }]);
        expect(vm.chip!.text).toBe("Verify: 2 failed");
        expect(vm.strip!.label).toBe("2");
    });

    it("the chip and strip follow the worst kind, and the chip title names all of them", () => {
        const vm = verifyTile(mixed, NOW);
        expect(vm.chip).toMatchObject({ text: "Verify: 1 failed", tone: "red" });
        expect(vm.chip!.title).toBe("f failed step 2; n has no result; o passed before agentrailtabs.tsx changed");
        expect(vm.strip).toEqual({ tone: "red", label: "1", struck: true, pulsing: false });
    });

    it("a no-result row ranks above an out-of-date one for the chip and the strip count", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "o", state: "outofdate", passed: 1, total: 1, changedfile: CHANGED[0] }),
                    row({ scenario: "n", state: "noresult" }),
                ],
            }),
            NOW
        );
        expect(vm.chip).toMatchObject({ text: "Verify: no result", tone: "amber" });
        expect(vm.strip).toEqual({ tone: "amber", label: "1", struck: false, pulsing: false });
    });

    it("a running row alone with a red one does not turn the verdict into `running`", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "r", state: "running", done: 1, of: 2, ended: 0 }),
                    row({ scenario: "f", state: "failed", passed: 0, total: 1, failed: ["1. x"] }),
                ],
            }),
            NOW
        );
        expect(vm.head.parts).toEqual([{ text: "1 failed", tone: "red" }]);
        expect(vm.strip!.pulsing).toBe(false);
    });
});

describe("verifyTile: the warning line", () => {
    it("names a lone changed file, one more, and several", () => {
        const text = (changed: string[]) => verifyTile(state({ notrun: true, changed }), NOW).warning!.text;
        expect(text(["a/b/councilrail.tsx"])).toBe("councilrail.tsx changed, and no scenario has run in this session.");
        expect(text(["a/councilrail.tsx", "a/x.css"])).toBe(
            "councilrail.tsx and 1 more UI file changed, and no scenario has run in this session."
        );
        expect(text(["a/councilrail.tsx", "a/x.css", "a/y.css"])).toBe(
            "councilrail.tsx and 2 more UI files changed, and no scenario has run in this session."
        );
    });

    it("reads a Windows path by its file name", () => {
        const vm = verifyTile(state({ notrun: true, changed: ["frontend\\app\\view\\agents\\councilrail.tsx"] }), NOW);
        expect(vm.warning!.text).toBe("councilrail.tsx changed, and no scenario has run in this session.");
    });

    it("does not say `not run` beside rows that already speak for the change", () => {
        const vm = verifyTile(
            state({
                notrun: true,
                changed: CHANGED,
                rows: [row({ scenario: "a", state: "outofdate", passed: 1, total: 1, changedfile: CHANGED[0] })],
            }),
            NOW
        );
        expect(vm.head.parts).toEqual([{ text: "1 out of date", tone: "amber" }]);
        expect(vm.warning!.kind).toBe("outofdate");
        expect(vm.chip!.text).toBe("Verify: out of date");
    });

    it("holds no warning when every row passed", () => {
        const vm = verifyTile(state({ rows: [row({ scenario: "a", passed: 1, total: 1 })], changed: [] }), NOW);
        expect(vm.warning).toBeNull();
    });
});

describe("verifyTile: folding", () => {
    it("folds only when every row passed or was skipped and no warning stands", () => {
        const passed = row({ scenario: "a", passed: 1, total: 1 });
        const skipped = row({ scenario: "b", state: "skipped" });
        expect(verifyTile(state({ rows: [passed, skipped] }), NOW).folded).toBe(true);
        expect(
            verifyTile(state({ rows: [passed, row({ scenario: "c", state: "running", ended: 0 })] }), NOW).folded
        ).toBe(false);
        expect(
            verifyTile(state({ rows: [passed, row({ scenario: "c", state: "failed", failed: ["1. x"] })] }), NOW).folded
        ).toBe(false);
        expect(verifyTile(state({ rows: [passed, row({ scenario: "c", state: "noresult" })] }), NOW).folded).toBe(
            false
        );
        expect(verifyTile(state({ rows: [passed, row({ scenario: "c", state: "outofdate" })] }), NOW).folded).toBe(
            false
        );
        expect(verifyTile(state({ rows: [passed], notrun: true }), NOW).folded).toBe(true);
    });

    it("starts open only the failed rows", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "f", state: "failed", failed: ["1. x"] }),
                    row({ scenario: "n", state: "noresult" }),
                    row({ scenario: "o", state: "outofdate" }),
                    row({ scenario: "p", passed: 1, total: 1 }),
                ],
            }),
            NOW
        );
        expect(vm.rows.map((r) => r.startsOpen)).toEqual([true, false, false, false]);
    });
});

describe("verifyTile: a row", () => {
    it("formats its age as the rail's other ages", () => {
        const ageOf = (ended: number, started = 0) =>
            verifyTile(state({ rows: [row({ scenario: "a", passed: 1, total: 1, ended, started })] }), NOW).rows[0].age;
        expect(ageOf(NOW - 3 * MIN)).toBe("3m");
        expect(ageOf(NOW - 2 * HOUR)).toBe("2h");
        expect(ageOf(NOW - 26 * HOUR)).toBe("1d");
        expect(ageOf(NOW - 10_000)).toBe("<1m");
        // an unfinished run has no end: its age is how long it has run
        expect(ageOf(0, NOW - 7 * MIN)).toBe("7m");
        expect(ageOf(0, 0)).toBe("");
    });

    it("offers the screenshots only when the run took some and says where", () => {
        const shots = (n: number, dir?: string) =>
            verifyTile(state({ rows: [row({ scenario: "a", passed: 1, total: 1, shots: n, shotsdir: dir })] }), NOW)
                .rows[0];
        expect(shots(9, "D:/repo/cdp-shots")).toMatchObject({
            shots: "Open the 9 screenshots",
            shotsDir: "D:/repo/cdp-shots",
        });
        expect(shots(1, "D:/repo/cdp-shots").shots).toBe("Open the screenshot");
        expect(shots(0, "D:/repo/cdp-shots").shots).toBeNull();
        expect(shots(9, undefined)).toMatchObject({ shots: null, shotsDir: "" });
    });

    it("carries the command the run reported, else the harness's own default", () => {
        const cmd = (command?: string) =>
            verifyTile(state({ rows: [row({ scenario: "chat-council-card", passed: 1, total: 1, command })] }), NOW)
                .rows[0].command;
        expect(cmd("node scripts/cdp/final-verify.mjs rail-verify")).toBe(
            "node scripts/cdp/final-verify.mjs rail-verify"
        );
        expect(cmd(undefined)).toBe("task verify:ui -- chat-council-card");
    });

    it("offers Rerun and Skip on a failed, no-result or out-of-date row only", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({ scenario: "f", state: "failed", failed: ["1. x"] }),
                    row({ scenario: "n", state: "noresult" }),
                    row({ scenario: "o", state: "outofdate" }),
                    row({ scenario: "r", state: "running", ended: 0 }),
                    row({ scenario: "p", passed: 1, total: 1 }),
                    row({ scenario: "s", state: "skipped" }),
                ],
            }),
            NOW
        );
        expect(vm.rows.map((r) => [r.name, r.canRerun, r.canSkip])).toEqual([
            ["f", true, true],
            ["n", true, true],
            ["r", false, false],
            ["o", true, true],
            ["p", false, false],
            ["s", false, false],
        ]);
    });

    it("reads a passed row with no steps as `Passed`", () => {
        const vm = verifyTile(state({ rows: [row({ scenario: "a", passed: 0, total: 0 })] }), NOW);
        expect(vm.rows[0].result).toBe("Passed");
    });

    it("says `Passed just now` for an out-of-date run under a minute old", () => {
        const vm = verifyTile(
            state({
                rows: [
                    row({
                        scenario: "a",
                        state: "outofdate",
                        passed: 1,
                        total: 1,
                        ended: NOW - 5_000,
                        changedfile: "x/y.tsx",
                    }),
                ],
            }),
            NOW
        );
        expect(vm.rows[0].note).toBe("Passed just now, before y.tsx changed.");
    });
});

describe("rerunLine", () => {
    function tileRow(st: VerifyStateData, name: string) {
        return verifyTile(st, NOW).rows.find((r) => r.name === name)!;
    }

    it("failed: names the command and the failed steps", () => {
        const st = state({
            rows: [
                row({
                    scenario: "chat-council-card",
                    state: "failed",
                    passed: 6,
                    total: 9,
                    failed: FAILED_STEPS,
                    command: "task verify:ui -- chat-council-card",
                }),
            ],
        });
        expect(rerunLine(tileRow(st, "chat-council-card"), st)).toBe(
            "Run `task verify:ui -- chat-council-card` again and fix the steps that fail: 7, 8, 9."
        );
    });

    it("failed with steps that carry no number: leaves the list out", () => {
        const st = state({
            rows: [row({ scenario: "a", state: "failed", failed: ["the card"], command: "task verify:ui -- a" })],
        });
        expect(rerunLine(tileRow(st, "a"), st)).toBe("Run `task verify:ui -- a` again and fix the steps that fail.");
    });

    it("no result: says where the last run stopped when steps came back", () => {
        const st = state({
            rows: [
                row({
                    scenario: "rail-council-tab",
                    state: "noresult",
                    passed: 8,
                    total: 8,
                    command: "task verify:ui -- rail-council-tab",
                }),
            ],
        });
        expect(rerunLine(tileRow(st, "rail-council-tab"), st)).toBe(
            "Run `task verify:ui -- rail-council-tab` again: the last run stopped after step 8 without a result."
        );
    });

    it("no result with no steps: says the last run stopped without a result", () => {
        const st = state({ rows: [row({ scenario: "a", state: "noresult", command: "task verify:ui -- a" })] });
        expect(rerunLine(tileRow(st, "a"), st)).toBe(
            "Run `task verify:ui -- a` again: the last run stopped without a result."
        );
    });

    it("out of date: names the file that changed after it passed", () => {
        const st = state({
            rows: [
                row({
                    scenario: "agent-rail-tabs",
                    state: "outofdate",
                    passed: 12,
                    total: 12,
                    command: "task verify:ui -- agent-rail-tabs",
                    changedfile: "frontend/app/view/agents/agentrailtabs.tsx",
                }),
            ],
        });
        expect(rerunLine(tileRow(st, "agent-rail-tabs"), st)).toBe(
            "Run `task verify:ui -- agent-rail-tabs` again: agentrailtabs.tsx changed after it passed."
        );
    });

    it("not run: names the changed files and the project's command", () => {
        const st = state({
            notrun: true,
            changed: ["a/councilrail.tsx", "a/b.css", "a/c.css"],
            rerun: "task verify:ui -- <name>",
        });
        expect(rerunLine("notrun", st)).toBe(
            "You changed councilrail.tsx and 2 more UI files without running a scenario. Run the scenarios that cover them (`task verify:ui -- <name>`), and add a step where none does."
        );
    });

    it("not run: one file, and a project with no rerun command", () => {
        const st = state({ notrun: true, changed: ["a/councilrail.tsx"] });
        expect(rerunLine("notrun", st)).toBe(
            "You changed councilrail.tsx without running a scenario. Run the scenarios that cover it (`task verify:ui -- <name>`), and add a step where none does."
        );
    });
});
