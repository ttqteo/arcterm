// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    briefNavIds,
    cardAt,
    cardNavId,
    listNavId,
    listRowAt,
    navInitiative,
    resolveBriefCursor,
    type BriefNavParts,
} from "./briefnav";

const PARTS: BriefNavParts = {
    strip: ["waiting:gate-1"],
    cards: ["effort:c1", "effort:c2", "effort:c3", "effort:c4"],
    list: ["effort:l1", "effort:l2"],
    activity: ["sessions:run:run:r1", "councils:k1"],
    behind: ["behind:e1"],
    shipped: ["shipped:run:r0"],
    ideas: ["initiatives:effort:i1"],
    later: ["later:s1"],
};

describe("briefNavIds", () => {
    it("walks the strip, the cards row by row, the list, Activity, then the side column", () => {
        expect(briefNavIds(PARTS)).toEqual([
            "waiting:gate-1",
            "card:effort:c1",
            "card:effort:c2",
            "card:effort:c3",
            "card:effort:c4",
            "list:effort:l1",
            "list:effort:l2",
            "sessions:run:run:r1",
            "councils:k1",
            "behind:e1",
            "shipped:run:r0",
            "initiatives:effort:i1",
            "later:s1",
        ]);
    });

    it("keeps a card and a list row of one initiative apart", () => {
        const ids = briefNavIds({ ...PARTS, cards: ["effort:x"], list: ["effort:x"] });
        expect(ids.filter((id) => id.endsWith("effort:x"))).toEqual(["card:effort:x", "list:effort:x"]);
    });

    it("leaves out a part with nothing drawn", () => {
        expect(briefNavIds({ ...PARTS, strip: [], cards: [], activity: [] })[0]).toBe("list:effort:l1");
    });
});

describe("navInitiative", () => {
    it("names the initiative under a card, a list row or an idea", () => {
        expect(navInitiative(cardNavId("effort:a"))).toBe("effort:a");
        expect(navInitiative(listNavId("effort:b"))).toBe("effort:b");
        expect(navInitiative("initiatives:effort:c")).toBe("effort:c");
    });

    it("names none under any other row", () => {
        expect(navInitiative("waiting:gate-1")).toBeNull();
        expect(navInitiative("sessions:run:run:r1")).toBeNull();
        expect(navInitiative("behind:effort:e1")).toBeNull();
        expect(navInitiative(undefined)).toBeNull();
    });

    it("tells a card from a list row", () => {
        expect(cardAt(cardNavId("effort:a"))).toBe("effort:a");
        expect(cardAt(listNavId("effort:a"))).toBeNull();
        expect(listRowAt(listNavId("effort:a"))).toBe("effort:a");
        expect(listRowAt(cardNavId("effort:a"))).toBeNull();
    });
});

describe("resolveBriefCursor", () => {
    it("keeps a cursor that still names a row", () => {
        expect(resolveBriefCursor(["a", "b"], "b")).toBe("b");
    });

    it("falls back to the first row when the cursor's row resolved away", () => {
        expect(resolveBriefCursor(["a", "b"], "gone")).toBe("a");
    });

    it("starts at the first row when nothing is selected yet", () => {
        expect(resolveBriefCursor(["a", "b"], undefined)).toBe("a");
    });

    it("has no cursor at all when there are no rows", () => {
        expect(resolveBriefCursor([], "a")).toBeUndefined();
    });
});
