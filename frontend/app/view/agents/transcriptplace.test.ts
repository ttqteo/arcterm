// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { firstItemBelow, keepTranscriptPlace, PLACE_CAP, transcriptPlace } from "./transcriptplace";

describe("transcript places", () => {
    it("keeps where a transcript was left, by its id", () => {
        keepTranscriptPlace("kept", { key: 42, offset: 17 });
        expect(transcriptPlace("kept")).toEqual({ key: 42, offset: 17 });
        expect(transcriptPlace("never-kept")).toBeUndefined();
    });

    it("forgets the place of a transcript read to its end", () => {
        keepTranscriptPlace("read-to-end", { key: 3, offset: 0 });
        keepTranscriptPlace("read-to-end", null);
        expect(transcriptPlace("read-to-end")).toBeUndefined();
    });

    it("keeps at most PLACE_CAP places, dropping the one kept longest ago", () => {
        for (let i = 0; i <= PLACE_CAP; i++) {
            keepTranscriptPlace(`cap-${i}`, { key: i, offset: 0 });
        }
        expect(transcriptPlace("cap-0")).toBeUndefined();
        expect(transcriptPlace("cap-1")).toEqual({ key: 1, offset: 0 });
        expect(transcriptPlace(`cap-${PLACE_CAP}`)).toEqual({ key: PLACE_CAP, offset: 0 });
    });

    it("counts a place kept again as the newest", () => {
        for (let i = 0; i < PLACE_CAP; i++) {
            keepTranscriptPlace(`renew-${i}`, { key: i, offset: 0 });
        }
        keepTranscriptPlace("renew-0", { key: 0, offset: 5 });
        keepTranscriptPlace("renew-new", { key: 1, offset: 0 });
        expect(transcriptPlace("renew-0")).toEqual({ key: 0, offset: 5 });
        expect(transcriptPlace("renew-1")).toBeUndefined();
    });
});

describe("firstItemBelow", () => {
    const bottoms = [10, 20, 30];
    const below = (viewTop: number, of = bottoms) => firstItemBelow(of.length, (i) => of[i], viewTop);

    it("finds the item the top of the view cuts through", () => {
        expect(below(15)).toBe(1);
    });

    it("skips an item whose bottom edge is exactly at the top of the view", () => {
        expect(below(20)).toBe(2);
    });

    it("is the first item when the view starts above every item", () => {
        expect(below(-100)).toBe(0);
    });

    it("is the item count when the view starts below every item", () => {
        expect(below(30)).toBe(3);
        expect(below(0, [])).toBe(0);
    });
});
