// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_DIGIT_HINT, nextDigitHint, type DigitHintState, type HintEvent } from "./digithints";

const run = (events: HintEvent[], st: DigitHintState = NO_DIGIT_HINT) => events.reduce(nextDigitHint, st);
const down = (key: string): HintEvent => ({ type: "keydown", key });
const up = (key: string): HintEvent => ({ type: "keyup", key });
const timer: HintEvent = { type: "timer" };

describe("nextDigitHint", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("shows a modifier's hints once it has been held on its own past the delay", () => {
        expect(run([down("Alt")])).toEqual({ armed: "alt", shown: null });
        expect(run([down("Alt"), timer])).toEqual({ armed: null, shown: "alt" });
        expect(run([down("Control"), down("Control"), timer])).toEqual({ armed: null, shown: "ctrl" });
    });

    it("a chord pressed before the delay never shows them: Ctrl+C, Alt+Z, Ctrl then Alt", () => {
        expect(run([down("Control"), down("c"), timer])).toEqual(NO_DIGIT_HINT);
        expect(run([down("Alt"), down("z"), timer])).toEqual(NO_DIGIT_HINT);
        expect(run([down("Control"), down("Alt"), timer])).toEqual(NO_DIGIT_HINT);
    });

    it("shown hints stay through the digits and go when the key comes up, or on a blur", () => {
        const shown = run([down("Alt"), timer]);
        expect(run([down("2"), up("2"), down("3")], shown)).toEqual(shown);
        expect(run([up("Shift")], shown)).toEqual(shown);
        expect(run([up("Alt")], shown)).toEqual(NO_DIGIT_HINT);
        expect(run([{ type: "blur" }], shown)).toEqual(NO_DIGIT_HINT);
    });

    it("releasing before the delay disarms, so a late timer shows nothing", () => {
        expect(run([down("Alt"), up("Alt"), timer])).toEqual(NO_DIGIT_HINT);
    });

    it("on a Mac the surface key is Command, not Control", () => {
        setPlatform("darwin");
        expect(run([down("Meta"), timer])).toEqual({ armed: null, shown: "ctrl" });
        expect(run([down("Control"), timer])).toEqual(NO_DIGIT_HINT);
    });
});
