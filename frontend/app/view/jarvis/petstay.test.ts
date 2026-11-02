import { describe, expect, it } from "vitest";
import {
    PET_ROAM,
    PET_STAY_CHOICES,
    isStaying,
    parsePetStay,
    shownStayChoice,
    stayEndsInMs,
    stayFor,
    stayUntilLabel,
    type PetStay,
} from "./petstay";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

describe("stayFor", () => {
    it("roam has no end", () => {
        expect(stayFor("roam", NOW)).toEqual({ choice: "roam", until: null });
        expect(stayFor("roam", NOW)).toEqual(PET_ROAM);
    });

    it("1h ends an hour from now", () => {
        expect(stayFor("1h", NOW)).toEqual({ choice: "1h", until: NOW + HOUR });
    });

    it("4h ends four hours from now", () => {
        expect(stayFor("4h", NOW)).toEqual({ choice: "4h", until: NOW + 4 * HOUR });
    });

    it("forever has no end", () => {
        expect(stayFor("forever", NOW)).toEqual({ choice: "forever", until: null });
    });
});

describe("parsePetStay", () => {
    it.each([
        ["a missing value", null],
        ["an empty value", ""],
        ["text that is not JSON", "{not json"],
        ["a JSON value that is not an object", "42"],
        ["a JSON null", "null"],
        ["an unknown choice", JSON.stringify({ choice: "2h", until: NOW + HOUR })],
        ["a timed stay with no end", JSON.stringify({ choice: "1h", until: null })],
        ["a timed stay with a text end", JSON.stringify({ choice: "4h", until: "soon" })],
        ["a timed stay with a non-finite end", `{"choice":"1h","until":1e999}`],
    ])("reads %s as roam", (_, raw) => {
        expect(parsePetStay(raw, NOW)).toEqual(PET_ROAM);
    });

    it("reads a timed stay that has already ended as roam", () => {
        expect(parsePetStay(JSON.stringify({ choice: "1h", until: NOW - 1 }), NOW)).toEqual(PET_ROAM);
        expect(parsePetStay(JSON.stringify({ choice: "4h", until: NOW }), NOW)).toEqual(PET_ROAM);
    });

    it("keeps a timed stay that has not ended", () => {
        const stay = { choice: "1h", until: NOW + 1 };
        expect(parsePetStay(JSON.stringify(stay), NOW)).toEqual(stay);
        const longer = { choice: "4h", until: NOW + 3 * HOUR };
        expect(parsePetStay(JSON.stringify(longer), NOW)).toEqual(longer);
    });

    it("keeps forever, whatever end it was stored with", () => {
        expect(parsePetStay(JSON.stringify({ choice: "forever", until: null }), NOW)).toEqual({
            choice: "forever",
            until: null,
        });
        expect(parsePetStay(JSON.stringify({ choice: "forever", until: NOW - HOUR }), NOW)).toEqual({
            choice: "forever",
            until: null,
        });
    });

    it("reads a stored roam as roam", () => {
        expect(parsePetStay(JSON.stringify(PET_ROAM), NOW)).toEqual(PET_ROAM);
    });

    it("round-trips what stayFor makes", () => {
        for (const choice of ["roam", "1h", "4h", "forever"] as const) {
            const stay = stayFor(choice, NOW);
            expect(parsePetStay(JSON.stringify(stay), NOW)).toEqual(stay);
        }
    });
});

describe("isStaying and shownStayChoice", () => {
    const timed: PetStay = { choice: "1h", until: NOW + HOUR };

    it("roam is never staying and shows roam", () => {
        expect(isStaying(PET_ROAM, NOW)).toBe(false);
        expect(shownStayChoice(PET_ROAM, NOW)).toBe("roam");
    });

    it("forever is staying at any time", () => {
        const forever = stayFor("forever", NOW);
        expect(isStaying(forever, NOW)).toBe(true);
        expect(isStaying(forever, NOW + 1000 * HOUR)).toBe(true);
        expect(shownStayChoice(forever, NOW + 1000 * HOUR)).toBe("forever");
    });

    it("a timed stay is staying before its end", () => {
        expect(isStaying(timed, NOW)).toBe(true);
        expect(isStaying(timed, timed.until! - 1)).toBe(true);
        expect(shownStayChoice(timed, timed.until! - 1)).toBe("1h");
    });

    it("a timed stay is over at its end and after it", () => {
        expect(isStaying(timed, timed.until!)).toBe(false);
        expect(shownStayChoice(timed, timed.until!)).toBe("roam");
        expect(isStaying(timed, timed.until! + 1)).toBe(false);
        expect(shownStayChoice(timed, timed.until! + 1)).toBe("roam");
    });

    it("an ended 4h stay shows roam too", () => {
        const four = stayFor("4h", NOW);
        expect(shownStayChoice(four, NOW + 4 * HOUR + 1)).toBe("roam");
        expect(shownStayChoice(four, NOW + 4 * HOUR - 1)).toBe("4h");
    });

    it("a timed choice without an end is not staying", () => {
        expect(isStaying({ choice: "4h", until: null }, NOW)).toBe(false);
        expect(shownStayChoice({ choice: "4h", until: null }, NOW)).toBe("roam");
    });
});

describe("stayEndsInMs", () => {
    it("counts down to the end of a timed stay", () => {
        const stay = stayFor("1h", NOW);
        expect(stayEndsInMs(stay, NOW)).toBe(HOUR);
        expect(stayEndsInMs(stay, NOW + HOUR - 250)).toBe(250);
    });

    it("is 0 once a timed stay has ended, never negative", () => {
        const stay = stayFor("1h", NOW);
        expect(stayEndsInMs(stay, NOW + HOUR)).toBe(0);
        expect(stayEndsInMs(stay, NOW + 2 * HOUR)).toBe(0);
    });

    it("is null when there is nothing to time", () => {
        expect(stayEndsInMs(PET_ROAM, NOW)).toBeNull();
        expect(stayEndsInMs(stayFor("forever", NOW), NOW)).toBeNull();
        expect(stayEndsInMs({ choice: "1h", until: null }, NOW)).toBeNull();
    });
});

describe("stayUntilLabel", () => {
    // built from local-time parts, so the expected text holds in any time zone
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m, 30).getTime();

    it("names the local end time of a timed stay, 24-hour", () => {
        expect(stayUntilLabel({ choice: "1h", until: at(15, 30) })).toBe("until 15:30");
        expect(stayUntilLabel({ choice: "4h", until: at(23, 59) })).toBe("until 23:59");
    });

    it("pads the hour and the minute to two digits", () => {
        expect(stayUntilLabel({ choice: "1h", until: at(9, 5) })).toBe("until 09:05");
        expect(stayUntilLabel({ choice: "4h", until: at(0, 0) })).toBe("until 00:00");
    });

    it("has no label for roam, forever, or a timed choice without an end", () => {
        expect(stayUntilLabel(PET_ROAM)).toBeNull();
        expect(stayUntilLabel(stayFor("forever", NOW))).toBeNull();
        expect(stayUntilLabel({ choice: "1h", until: null })).toBeNull();
    });
});

describe("PET_STAY_CHOICES", () => {
    it("lists Roam, 1h, 4h, forever in the Settings order", () => {
        expect(PET_STAY_CHOICES.map((c) => c.id)).toEqual(["roam", "1h", "4h", "forever"]);
    });

    it("words each choice for Settings", () => {
        expect(PET_STAY_CHOICES.map((c) => c.label)).toEqual(["Roam", "Stay 1h", "Stay 4h", "Stay"]);
    });

    it("words each choice for the peek menu", () => {
        expect(PET_STAY_CHOICES.map((c) => c.menuLabel)).toEqual([
            "Roam again",
            "Stay 1 hour",
            "Stay 4 hours",
            "Stay until I turn it off",
        ]);
    });
});
