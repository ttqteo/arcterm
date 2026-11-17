// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    ageText,
    answerAct,
    canAnswer,
    formatTileAge,
    moveSelection,
    resolveSelection,
    sidecarKey,
    tileAgeMs,
} from "./sidecarkeys";
import type { SidecarTile } from "./sidecartypes";

describe("moveSelection", () => {
    // 10 items on 4 columns: rows of 4, 4, 2
    it("left and right step by one, in reading order, and stop at the ends", () => {
        expect(moveSelection(5, "ArrowRight", 4, 10)).toBe(6);
        expect(moveSelection(5, "ArrowLeft", 4, 10)).toBe(4);
        expect(moveSelection(3, "ArrowRight", 4, 10)).toBe(4);
        expect(moveSelection(4, "ArrowLeft", 4, 10)).toBe(3);
        expect(moveSelection(0, "ArrowLeft", 4, 10)).toBe(0);
        expect(moveSelection(9, "ArrowRight", 4, 10)).toBe(9);
    });

    it("up and down step by one row", () => {
        expect(moveSelection(5, "ArrowUp", 4, 10)).toBe(1);
        expect(moveSelection(5, "ArrowDown", 4, 10)).toBe(9);
        expect(moveSelection(0, "ArrowDown", 4, 10)).toBe(4);
    });

    it("a move off the grid stays where it is", () => {
        expect(moveSelection(2, "ArrowUp", 4, 10)).toBe(2);
        // 6 is in column 2; below it the last row has only columns 0 and 1
        expect(moveSelection(6, "ArrowDown", 4, 10)).toBe(6);
        expect(moveSelection(9, "ArrowDown", 4, 10)).toBe(9);
    });

    it("one column is a list", () => {
        expect(moveSelection(1, "ArrowDown", 1, 3)).toBe(2);
        expect(moveSelection(2, "ArrowDown", 1, 3)).toBe(2);
        expect(moveSelection(1, "ArrowUp", 1, 3)).toBe(0);
    });

    it("no items, or an index past the end, comes back inside the list", () => {
        expect(moveSelection(0, "ArrowRight", 3, 0)).toBe(0);
        expect(moveSelection(12, "ArrowLeft", 3, 5)).toBe(3);
    });
});

describe("resolveSelection", () => {
    const ids = (...s: string[]) => s;

    it("keeps the selected id when the order changes", () => {
        expect(resolveSelection("b", ids("a", "b", "c"), ids("c", "b", "a"))).toBe("b");
    });

    it("an item that leaves moves the selection to the same index", () => {
        expect(resolveSelection("b", ids("a", "b", "c"), ids("a", "c"))).toBe("c");
        expect(resolveSelection("a", ids("a", "b", "c"), ids("x", "b", "c"))).toBe("x");
    });

    it("clamps to the last item when the list got shorter than the index", () => {
        expect(resolveSelection("e", ids("a", "b", "c", "d", "e"), ids("a", "b"))).toBe("b");
    });

    it("selects the first item when nothing was selected, and none when nothing is there", () => {
        expect(resolveSelection(null, ids(), ids("a", "b"))).toBe("a");
        expect(resolveSelection("a", ids("a"), ids())).toBeNull();
        expect(resolveSelection(null, ids(), ids())).toBeNull();
    });

    it("an id the previous list never held falls back to the first item", () => {
        expect(resolveSelection("zzz", ids("a", "b"), ids("a", "b"))).toBe("a");
    });
});

describe("the age text", () => {
    const MIN = 60_000;
    const HOUR = 60 * MIN;

    it("formats under a minute, minutes, hours with minutes, and days", () => {
        expect(formatTileAge(0)).toBe("<1m");
        expect(formatTileAge(59_999)).toBe("<1m");
        expect(formatTileAge(MIN)).toBe("1m");
        expect(formatTileAge(33 * MIN + 20_000)).toBe("33m");
        expect(formatTileAge(HOUR)).toBe("1h");
        expect(formatTileAge(HOUR + 5 * MIN)).toBe("1h 05m");
        expect(formatTileAge(HOUR + 12 * MIN)).toBe("1h 12m");
        expect(formatTileAge(23 * HOUR + 59 * MIN)).toBe("23h 59m");
        expect(formatTileAge(24 * HOUR)).toBe("1d");
        expect(formatTileAge(24 * HOUR + 3 * HOUR + 40 * MIN)).toBe("1d 3h");
    });

    it("adds the time since the snapshot arrived to the snapshot's own now", () => {
        const now = 1_800_000_000_000;
        expect(tileAgeMs(now - 2 * MIN, now, 0)).toBe(2 * MIN);
        expect(tileAgeMs(now - 2 * MIN, now, 3 * MIN)).toBe(5 * MIN);
        expect(ageText(now - 2 * MIN, now, 0)).toBe("2m");
        expect(ageText(now - 2 * MIN, now, 30 * MIN)).toBe("32m");
    });

    it("has no age without a since, and never goes negative", () => {
        const now = 1_800_000_000_000;
        expect(ageText(undefined, now, 0)).toBe("");
        expect(tileAgeMs(now + 5000, now, 0)).toBe(0);
        expect(ageText(now + 5000, now, 0)).toBe("<1m");
        // a clock that ran backwards between the two readings adds nothing
        expect(tileAgeMs(now - MIN, now, -10_000)).toBe(MIN);
    });
});

describe("keys", () => {
    it("maps arrows, Enter and 1-9; anything else is not the dashboard's", () => {
        expect(sidecarKey("ArrowLeft")).toEqual({ kind: "move", key: "ArrowLeft" });
        expect(sidecarKey("ArrowDown")).toEqual({ kind: "move", key: "ArrowDown" });
        expect(sidecarKey("Enter")).toEqual({ kind: "open" });
        expect(sidecarKey("1")).toEqual({ kind: "answer", option: 0 });
        expect(sidecarKey("9")).toEqual({ kind: "answer", option: 8 });
        expect(sidecarKey("0")).toBeNull();
        expect(sidecarKey("a")).toBeNull();
        expect(sidecarKey("F11")).toBeNull();
        expect(sidecarKey("10")).toBeNull();
    });

    const tile = (over: Partial<SidecarTile> = {}): Pick<SidecarTile, "id" | "ask" | "sent"> => ({
        id: "t",
        ask: { question: "Q?", options: ["A", "B", "C"], answerable: true, key: "ask-t" },
        ...over,
    });

    it("answers only an answerable ask, not yet sent, with that option on it", () => {
        expect(canAnswer(tile(), 0)).toBe(true);
        expect(canAnswer(tile(), 2)).toBe(true);
        expect(canAnswer(tile(), 3)).toBe(false);
        expect(canAnswer(tile({ sent: true }), 0)).toBe(false);
        expect(canAnswer(tile({ ask: { question: "Q?", options: ["A"], answerable: false } }), 0)).toBe(false);
        expect(canAnswer({}, 0)).toBe(false);
        expect(canAnswer(undefined, 0)).toBe(false);
        // an ask with no key cannot be named by an answer
        expect(canAnswer(tile({ ask: { question: "Q?", options: ["A"], answerable: true } }), 0)).toBe(false);
    });

    it("builds the answer act naming the ask it answers", () => {
        expect(answerAct(tile(), 1)).toEqual({ kind: "answer", id: "t", option: 1, key: "ask-t" });
        expect(answerAct(tile(), 3)).toBeNull();
        expect(answerAct(tile({ sent: true }), 0)).toBeNull();
        expect(answerAct(undefined, 0)).toBeNull();
    });
});
