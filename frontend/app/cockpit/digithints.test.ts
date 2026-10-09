// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_DIGIT_HINT, nextDigitHint, type DigitHintState, type HintEvent } from "./digithints";

const run = (events: HintEvent[], st: DigitHintState = NO_DIGIT_HINT) => events.reduce(nextDigitHint, st);
const down = (key: string, code?: string): HintEvent => ({ type: "keydown", key, code });
const up = (key: string): HintEvent => ({ type: "keyup", key });

describe("nextDigitHint", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("shows a modifier's hints the moment it goes down", () => {
        expect(run([down("Alt")])).toBe("alt");
        expect(run([down("Control"), down("Control")])).toBe("ctrl");
    });

    it("a chord hides them: Ctrl+C, Alt+Z, Ctrl then Alt", () => {
        expect(run([down("Control"), down("c")])).toBe(NO_DIGIT_HINT);
        expect(run([down("Alt"), down("z")])).toBe(NO_DIGIT_HINT);
        expect(run([down("Control"), down("Alt")])).toBe(NO_DIGIT_HINT);
    });

    it("the modifier still repeating after a chord does not bring them back", () => {
        expect(run([down("Control"), down("c"), { type: "keydown", key: "Control", repeat: true }])).toBe(
            NO_DIGIT_HINT
        );
    });

    it("shown hints stay through the digits and go when the key comes up, or on a blur", () => {
        const shown = run([down("Alt")]);
        expect(run([down("2"), up("2"), down("3")], shown)).toBe(shown);
        expect(run([up("Shift")], shown)).toBe(shown);
        expect(run([up("Alt")], shown)).toBe(NO_DIGIT_HINT);
        expect(run([{ type: "blur" }], shown)).toBe(NO_DIGIT_HINT);
    });

    it("on a Mac the surface key is Command, and Option+digit counts as the digit by its code", () => {
        setPlatform("darwin");
        expect(run([down("Meta")])).toBe("ctrl");
        expect(run([down("Control")])).toBe(NO_DIGIT_HINT);
        expect(run([down("Alt"), down("¡", "Digit1")])).toBe("alt");
    });
});
