// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_DIGIT_HINT, nextDigitHint, shownDigitHint, type DigitHintState, type HintEvent } from "./digithints";

const run = (events: HintEvent[], st: DigitHintState = NO_DIGIT_HINT) => events.reduce(nextDigitHint, st);
const shown = (events: HintEvent[], st: DigitHintState = NO_DIGIT_HINT) => shownDigitHint(run(events, st));
const down = (key: string, code?: string): HintEvent => ({ type: "keydown", key, code });
const up = (key: string): HintEvent => ({ type: "keyup", key });
const timer: HintEvent = { type: "timer" };

describe("nextDigitHint", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("shows a modifier's hints only once its delay runs out", () => {
        expect(shown([down("Alt")])).toBe(null);
        expect(shown([down("Alt"), timer])).toBe("alt");
        expect(shown([down("Control"), down("Control"), timer])).toBe("ctrl");
    });

    it("a chord before the delay never shows them: Ctrl+C, Alt+Z, Ctrl then Alt, a quick Ctrl+2", () => {
        expect(run([down("Control"), down("c"), timer])).toEqual(NO_DIGIT_HINT);
        expect(run([down("Alt"), down("z"), timer])).toEqual(NO_DIGIT_HINT);
        expect(run([down("Control"), down("Alt"), timer])).toEqual(NO_DIGIT_HINT);
        expect(run([down("Control"), down("2"), timer])).toEqual(NO_DIGIT_HINT);
    });

    it("a chord after they show hides them", () => {
        expect(run([down("Control"), timer, down("c")])).toEqual(NO_DIGIT_HINT);
    });

    it("the modifier still repeating after a chord does not bring them back", () => {
        expect(run([down("Control"), down("c"), { type: "keydown", key: "Control", repeat: true }, timer])).toEqual(
            NO_DIGIT_HINT
        );
    });

    it("released before the delay, they never show", () => {
        expect(run([down("Alt"), up("Alt"), timer])).toEqual(NO_DIGIT_HINT);
    });

    it("shown hints stay through the digits and go when the key comes up, or on a blur", () => {
        const st = run([down("Alt"), timer]);
        expect(run([down("2"), up("2"), down("3")], st)).toBe(st);
        expect(run([up("Shift")], st)).toBe(st);
        expect(run([up("Alt")], st)).toEqual(NO_DIGIT_HINT);
        expect(run([{ type: "blur" }], st)).toEqual(NO_DIGIT_HINT);
    });

    it("on a Mac the surface key is Command, and Option+digit counts as the digit by its code", () => {
        setPlatform("darwin");
        expect(shown([down("Meta"), timer])).toBe("ctrl");
        expect(run([down("Control"), timer])).toEqual(NO_DIGIT_HINT);
        expect(shown([down("Alt"), timer, down("¡", "Digit1")])).toBe("alt");
    });
});
