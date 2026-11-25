// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { answerChip, linkedMessage, openReason, waitsOnYou } from "./raildecided";

const item = (num: number, kind: string, extra: Partial<PairItem> = {}): PairItem => ({
    num,
    kind,
    text: `item ${num}`,
    note: "",
    chips: [],
    msgid: "",
    reopenedby: "",
    newby: "",
    answer: "",
    ...extra,
});

const decided = (d: Partial<PairDecided> = {}): PairDecided => ({ asks: [], agreed: [], open: [], ...d });

describe("waitsOnYou", () => {
    it("is true while an A item has no answer", () => {
        expect(waitsOnYou(decided({ asks: [item(3, "asks", { chips: ["50%, go on"] })] }))).toBe(true);
        expect(waitsOnYou(decided({ asks: [item(3, "asks", { answer: "50%, go on" }), item(5, "asks")] }))).toBe(true);
    });
    it("is false with no asks, or once every ask is answered", () => {
        expect(waitsOnYou(decided())).toBe(false);
        expect(waitsOnYou(decided({ agreed: [item(1, "agreed")], open: [item(2, "open")] }))).toBe(false);
        expect(waitsOnYou(decided({ asks: [item(3, "asks", { answer: "50%, go on" })] }))).toBe(false);
    });
    it("reads null lists (nil slices over the wire) as empty", () => {
        expect(waitsOnYou({ asks: null, agreed: null, open: null } as unknown as PairDecided)).toBe(false);
        expect(waitsOnYou(undefined)).toBe(false);
    });
});

describe("openReason", () => {
    const judgeTab = "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6";
    it("says which judge reopened an item", () => {
        expect(openReason(item(2, "open", { reopenedby: judgeTab }), 1)).toBe("reopened by judge 4c6ba858");
        expect(openReason(item(2, "open", { reopenedby: judgeTab }), 2)).toBe("reopened by judge 4c6ba858");
    });
    it("says a judge's new point, naming the judge only when there are several", () => {
        expect(openReason(item(0, "open", { newby: judgeTab }), 1)).toBe("judge's new point");
        expect(openReason(item(0, "open", { newby: judgeTab }), 2)).toBe("judge 4c6ba858's new point");
    });
    it("is empty for an item the working agent itself left open", () => {
        expect(openReason(item(4, "open"), 1)).toBe("");
    });
});

describe("answerChip", () => {
    it("sends the chip to both sides, naming the A item it answers and replying to no message", () => {
        expect(answerChip("pair-1", item(3, "asks", { chips: ["50%, go on"] }), "50%, go on")).toEqual({
            pairid: "pair-1",
            text: "50%, go on",
            to: "both",
            replyto: "",
            item: 3,
        });
    });
});

describe("linkedMessage", () => {
    const messages = [{ id: "m1" }, { id: "m2" }] as PairMessage[];
    it("finds the message an item links to", () => {
        expect(linkedMessage(messages, item(1, "agreed", { msgid: "m2" }))?.id).toBe("m2");
    });
    it("is null when the item links to none, or to a message no longer in the conversation", () => {
        expect(linkedMessage(messages, item(1, "agreed"))).toBeNull();
        expect(linkedMessage(messages, item(1, "agreed", { msgid: "gone" }))).toBeNull();
        expect(linkedMessage(undefined, item(1, "agreed", { msgid: "m1" }))).toBeNull();
    });
});
