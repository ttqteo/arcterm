// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { foldPaused, nextMorning, parsePauseText, pauseEndLabel } from "./foldpause";

// local times, so the tests hold in any time zone
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const evening = at(13, 21, 0);

describe("foldPaused", () => {
    it("holds the fold off only before a set time", () => {
        expect(foldPaused(undefined, evening)).toBe(false);
        expect(foldPaused(0, evening)).toBe(false);
        expect(foldPaused(evening - 1, evening)).toBe(false);
        expect(foldPaused(evening + 1, evening)).toBe(true);
        expect(foldPaused("9999999999999", evening)).toBe(false);
    });
});

describe("nextMorning", () => {
    it("is tomorrow's 8:00 from the evening", () => expect(nextMorning(evening)).toBe(at(14, 8)));
    it("is this morning's before 8:00", () => expect(nextMorning(at(14, 2))).toBe(at(14, 8)));
    it("is tomorrow's at 8:00 itself", () => expect(nextMorning(at(14, 8))).toBe(at(15, 8)));
});

describe("parsePauseText", () => {
    it("reads lengths", () => {
        expect(parsePauseText("2h", evening)).toBe(at(13, 23));
        expect(parsePauseText("30m", evening)).toBe(at(13, 21, 30));
        expect(parsePauseText("45 min", evening)).toBe(at(13, 21, 45));
        expect(parsePauseText("1h30", evening)).toBe(at(13, 22, 30));
        expect(parsePauseText("1h 30m", evening)).toBe(at(13, 22, 30));
        expect(parsePauseText("1.5h", evening)).toBe(at(13, 22, 30));
    });
    it("reads clock times as the next one to come", () => {
        expect(parsePauseText("23:15", evening)).toBe(at(13, 23, 15));
        expect(parsePauseText("14:30", evening)).toBe(at(14, 14, 30));
        expect(parsePauseText("8", evening)).toBe(at(14, 8));
        expect(parsePauseText("8am", evening)).toBe(at(14, 8));
        expect(parsePauseText("10pm", evening)).toBe(at(13, 22));
        expect(parsePauseText("12am", evening)).toBe(at(14, 0));
        expect(parsePauseText("8:30 AM", evening)).toBe(at(14, 8, 30));
    });
    it("refuses what is neither, and lengths of nothing or over a week", () => {
        for (const t of ["", "soon", "25:00", "8:61", "13pm", "0m", "0h", "200h", "h", "1h2h"]) {
            expect(parsePauseText(t, evening), t).toBeNull();
        }
    });
});

describe("pauseEndLabel", () => {
    it("names the clock time today, tomorrow or by weekday", () => {
        expect(pauseEndLabel(at(13, 22, 5), evening)).toBe("22:05");
        expect(pauseEndLabel(at(14, 8), evening)).toBe("8:00 tomorrow");
        expect(pauseEndLabel(at(16, 8), evening)).toBe("Fri 8:00");
    });
});
