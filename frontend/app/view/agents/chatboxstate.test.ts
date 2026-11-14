// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { boxPlaceholder, boxState, boxTabPlaceholder, type BoxState, type BoxStateInput } from "./chatboxstate";

const none: BoxStateInput = { asleep: false, running: false, dragging: false, suggesting: false, bash: false };
const of = (patch: Partial<BoxStateInput>): BoxState => boxState({ ...none, ...patch });

describe("boxState", () => {
    it("is idle with nothing going on", () => {
        expect(of({})).toBe("idle");
    });

    it("is running while the agent works", () => {
        expect(of({ running: true })).toBe("running");
    });

    it("is asleep for a sleeping agent", () => {
        expect(of({ asleep: true })).toBe("asleep");
    });

    it("is bash for a `!` command", () => {
        expect(of({ bash: true })).toBe("bash");
    });

    it("is suggest while the / or @ list is open", () => {
        expect(of({ suggesting: true })).toBe("suggest");
    });

    it("is drop while files are dragged over", () => {
        expect(of({ dragging: true })).toBe("drop");
    });

    describe("precedence: drop > suggest > bash > asleep > running > idle", () => {
        it("dragging while running is drop", () => {
            expect(of({ dragging: true, running: true })).toBe("drop");
        });

        it("dragging beats every other state", () => {
            expect(of({ dragging: true, suggesting: true, bash: true, asleep: true, running: true })).toBe("drop");
        });

        it("suggesting while bash is suggest", () => {
            expect(of({ suggesting: true, bash: true })).toBe("suggest");
        });

        it("suggesting while running is suggest", () => {
            expect(of({ suggesting: true, running: true })).toBe("suggest");
        });

        it("bash while asleep is bash", () => {
            expect(of({ bash: true, asleep: true })).toBe("bash");
        });

        it("bash while running is bash", () => {
            expect(of({ bash: true, running: true })).toBe("bash");
        });

        it("asleep while running is asleep", () => {
            expect(of({ asleep: true, running: true })).toBe("asleep");
        });
    });
});

describe("boxPlaceholder", () => {
    it("idle names the agent and the two triggers", () => {
        expect(boxPlaceholder("idle", "Atlas")).toBe("Reply to Atlas, @ to mention, / for commands");
    });

    it("running says the reply waits for the turn to end", () => {
        expect(boxPlaceholder("running", "Atlas")).toBe("Reply to Atlas; it waits for the turn to end");
    });

    it("asleep says Enter wakes the agent", () => {
        expect(boxPlaceholder("asleep", "Atlas")).toBe("message Atlas to wake it… (Enter)");
    });

    it("the states that show text over the placeholder fall back to the idle line", () => {
        for (const s of ["drop", "suggest"] as const) {
            expect(boxPlaceholder(s, "Atlas")).toBe("Reply to Atlas, @ to mention, / for commands");
        }
    });

    it("bash says the box takes a shell command and how to leave, over an override", () => {
        expect(boxPlaceholder("bash", "Atlas")).toBe("a command for the agent's shell; Backspace leaves bash mode");
        expect(boxPlaceholder("bash", "Atlas", "Answer question 2 in your own words")).toBe(
            "a command for the agent's shell; Backspace leaves bash mode"
        );
    });

    it("an override wins in every other state", () => {
        const states: BoxState[] = ["idle", "running", "drop", "suggest", "asleep"];
        for (const s of states) {
            expect(boxPlaceholder(s, "Atlas", "Answer question 2 in your own words")).toBe(
                "Answer question 2 in your own words"
            );
        }
    });

    it("a null or empty override is not given", () => {
        expect(boxPlaceholder("idle", "Atlas", null)).toBe("Reply to Atlas, @ to mention, / for commands");
        expect(boxPlaceholder("running", "Atlas", "")).toBe("Reply to Atlas; it waits for the turn to end");
        expect(boxPlaceholder("asleep", "Atlas", undefined)).toBe("message Atlas to wake it… (Enter)");
    });
});

describe("boxTabPlaceholder", () => {
    it("names Tab as a key in the idle line", () => {
        expect(boxTabPlaceholder("Atlas")).toEqual([
            "Reply to Atlas, ",
            { key: "Tab" },
            " for suggestions, @ to mention, / for commands",
        ]);
    });
});
