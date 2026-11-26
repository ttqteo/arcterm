// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    capLabel,
    composerPlaceholder,
    newestPauseId,
    pairVietnamese,
    pauseActions,
    pauseCardOf,
    pauseHead,
} from "./pairpause";

const REASONS = ["no-new-points", "settled", "token-cap", "judges-gone"];

const item = (num: number, kind: string, text: string, over: Partial<PairItem> = {}): PairItem => ({
    num,
    kind,
    text,
    note: "",
    chips: [],
    msgid: "",
    reopenedby: "",
    newby: "",
    answer: "",
    ...over,
});

const decided = (over: Partial<PairDecided> = {}): PairDecided => ({ asks: [], agreed: [], open: [], ...over });

const person = (id: string, text: string): PairMessage =>
    ({ id, from: "person", tab: "", ts: 1, text, quote: "", replyto: "", to: "both", held: [] }) as PairMessage;
const worker = (id: string, text = "ok"): PairMessage =>
    ({ id, from: "worker", tab: "w", ts: 1, text, quote: "", replyto: "", to: "", held: [] }) as PairMessage;
const pauseMsg = (id: string, reason: string, over: Partial<PairPause> = {}): PairMessage =>
    ({
        id,
        from: "system",
        tab: "",
        ts: 1,
        text: "Paused: x",
        quote: "",
        replyto: "",
        to: "",
        held: [],
        pause: { reason, summary: "", decided: decided(), ...over },
    }) as PairMessage;

function view(over: Partial<PairView> = {}): PairView {
    return {
        id: "p1",
        state: "stopped",
        stopreason: "no-new-points",
        tokencap: 3_000_000,
        messages: [],
        decided: decided(),
        synced: false,
        canresume: false,
        ...over,
    } as unknown as PairView;
}

describe("pauseHead", () => {
    it("is the card's head words for each reason, in English and in Vietnamese", () => {
        expect(pauseHead("no-new-points", false)).toBe("Paused: the judge has no new points");
        expect(pauseHead("no-new-points", true)).toBe("Tạm dừng: judge không còn ý mới");
        expect(pauseHead("settled", false)).toBe("Paused: both agree");
        expect(pauseHead("settled", true)).toBe("Tạm dừng: hai bên đã thống nhất");
        expect(pauseHead("judges-gone", false)).toBe("Paused: no judge is left");
        expect(pauseHead("judges-gone", true)).toBe("Tạm dừng: không còn judge");
    });

    it("names the cap on a token-cap head only when given one, and says it is the judge's cap", () => {
        expect(pauseHead("token-cap", false, "3.0M")).toBe("Paused: judge token cap reached (3.0M)");
        expect(pauseHead("token-cap", true, "3.0M")).toBe("Tạm dừng: judge chạm trần token (3.0M)");
        expect(pauseHead("token-cap", false)).toBe("Paused: judge token cap reached");
        expect(pauseHead("token-cap", true)).toBe("Tạm dừng: judge chạm trần token");
        expect(pauseHead("token-cap", false, "")).toBe("Paused: judge token cap reached");
    });

    it("ignores a cap on any other reason", () => {
        expect(pauseHead("no-new-points", false, "3.0M")).toBe("Paused: the judge has no new points");
    });

    it("says only that the pair is paused for a reason it does not know", () => {
        expect(pauseHead("", false)).toBe("Paused");
        expect(pauseHead("something-new", true)).toBe("Tạm dừng");
    });
});

describe("capLabel", () => {
    it("is the cap in millions with one decimal, as the server's Paused line writes it", () => {
        expect(capLabel(3_000_000)).toBe("3.0M");
        expect(capLabel(2_450_000)).toBe("2.5M");
        expect(capLabel(500_000)).toBe("0.5M");
    });

    it("is empty for no cap", () => {
        expect(capLabel(0)).toBe("");
        expect(capLabel(undefined)).toBe("");
    });
});

describe("pairVietnamese", () => {
    it("is true when one of the person's messages in the pair has a Vietnamese letter", () => {
        expect(pairVietnamese(view({ messages: [worker("m1"), person("m2", "làm tiếp đi")] }))).toBe(true);
    });

    it("is false when the person writes English, or the pair holds no message of theirs", () => {
        expect(pairVietnamese(view({ messages: [person("m1", "go on")] }))).toBe(false);
        expect(pairVietnamese(view({ messages: [] }))).toBe(false);
        expect(pairVietnamese(view({ messages: undefined }))).toBe(false);
    });

    it("reads only the person's messages: an agent's Vietnamese does not count", () => {
        expect(pairVietnamese(view({ messages: [worker("m1", "đã xong"), person("m2", "go on")] }))).toBe(false);
    });
});

describe("pauseCardOf", () => {
    it("is null for a message with no pause", () => {
        expect(pauseCardOf(view(), worker("m1"))).toBeNull();
        expect(pauseCardOf(view(), { pause: null })).toBeNull();
    });

    it("heads the card with the reason's words, the cap given on a token cap", () => {
        for (const reason of REASONS) {
            const card = pauseCardOf(view({ stopreason: reason }), pauseMsg("m9", reason));
            expect(card?.head).toBe(pauseHead(reason, false, reason === "token-cap" ? "3.0M" : undefined));
        }
        expect(pauseCardOf(view(), pauseMsg("m9", "token-cap"))?.head).toBe("Paused: judge token cap reached (3.0M)");
    });

    it("reads the head from the message's own reason, not the pair's present one", () => {
        const card = pauseCardOf(view({ stopreason: "settled" }), pauseMsg("m9", "no-new-points"));
        expect(card?.head).toBe("Paused: the judge has no new points");
    });

    it("speaks Vietnamese when the person writes it", () => {
        const v = view({ messages: [person("m1", "tiếp tục")] });
        const card = pauseCardOf(
            v,
            pauseMsg("m9", "settled", { decided: decided({ agreed: [item(1, "agreed", "x")] }) })
        );
        expect(card?.head).toBe("Tạm dừng: hai bên đã thống nhất");
        expect(card?.sections.map((s) => s.label)).toEqual(["Đã thống nhất"]);
    });

    it("orders the sections Waits on you, Still open, Agreed, and leaves out an empty one", () => {
        const pause = pauseMsg("m9", "no-new-points", {
            decided: decided({
                agreed: [item(1, "agreed", "a")],
                open: [item(4, "open", "o")],
                asks: [item(3, "asks", "q", { chips: ["yes"] })],
            }),
        });
        const card = pauseCardOf(view(), pause);
        expect(card?.sections.map((s) => [s.kind, s.label, s.items.map((i) => i.num)])).toEqual([
            ["asks", "Waits on you", [3]],
            ["open", "Still open", [4]],
            ["agreed", "Agreed", [1]],
        ]);

        const onlyAgreed = pauseCardOf(
            view(),
            pauseMsg("m9", "settled", { decided: decided({ agreed: [item(1, "agreed", "a")] }) })
        );
        expect(onlyAgreed?.sections.map((s) => s.kind)).toEqual(["agreed"]);

        const none = pauseCardOf(view(), pauseMsg("m9", "settled"));
        expect(none?.sections).toEqual([]);
    });

    it("keeps the items of each section in the snapshot's order", () => {
        const pause = pauseMsg("m9", "settled", {
            decided: decided({ agreed: [item(2, "agreed", "b"), item(1, "agreed", "a")] }),
        });
        expect(pauseCardOf(view(), pause)?.sections[0].items.map((i) => i.num)).toEqual([2, 1]);
    });

    it("reads a snapshot whose lists came over the wire as null", () => {
        const pause = pauseMsg("m9", "settled", {
            decided: { asks: null, agreed: null, open: null } as unknown as PairDecided,
        });
        expect(pauseCardOf(view(), pause)?.sections).toEqual([]);
    });

    it("carries the summary, trimmed, and an empty one when the judge wrote none", () => {
        expect(pauseCardOf(view(), pauseMsg("m9", "no-new-points", { summary: "  Two left.\n" }))?.summary).toBe(
            "Two left."
        );
        expect(pauseCardOf(view(), pauseMsg("m9", "token-cap"))?.summary).toBe("");
    });

    it("lays the live answer over an ask by its number", () => {
        const pause = pauseMsg("m9", "no-new-points", {
            decided: decided({ asks: [item(3, "asks", "q", { chips: ["50%, go on"] }), item(5, "asks", "r")] }),
        });
        const live = view({
            decided: decided({
                asks: [item(3, "asks", "q", { chips: ["50%, go on"], answer: "50%, go on" }), item(5, "asks", "r")],
            }),
        });
        const asks = pauseCardOf(live, pause)?.sections[0].items;
        expect(asks?.map((i) => [i.num, i.answer])).toEqual([
            [3, "50%, go on"],
            [5, ""],
        ]);
    });

    it("keeps the snapshot's own answer for an ask that left the live list, and does not touch the snapshot", () => {
        const snapshot = decided({ asks: [item(3, "asks", "q", { answer: "kept" })] });
        const pause = pauseMsg("m9", "no-new-points", { decided: snapshot });
        const card = pauseCardOf(view({ decided: decided({ agreed: [item(3, "agreed", "q")] }) }), pause);
        expect(card?.sections[0].items[0].answer).toBe("kept");
        expect(snapshot.asks[0].answer).toBe("kept");
    });

    it("lays no live answer over Still open and Agreed items", () => {
        const pause = pauseMsg("m9", "settled", {
            decided: decided({ open: [item(4, "open", "o")], agreed: [item(1, "agreed", "a")] }),
        });
        const live = view({
            decided: decided({
                open: [item(4, "open", "o", { answer: "x" })],
                agreed: [item(1, "agreed", "a", { answer: "y" })],
            }),
        });
        const card = pauseCardOf(live, pause);
        expect(card?.sections.flatMap((s) => s.items.map((i) => i.answer))).toEqual(["", ""]);
    });

    it("has a note only on a judges-gone pause, saying Add judge pairs one again", () => {
        expect(pauseCardOf(view(), pauseMsg("m9", "judges-gone"))?.note).toBe(
            "Add judge in the header pairs one again"
        );
        const vi = view({ messages: [person("m1", "thêm đi")] });
        expect(pauseCardOf(vi, pauseMsg("m9", "judges-gone"))?.note).toBe("Bấm Add judge ở đầu trang để thêm judge");
        for (const reason of ["no-new-points", "settled", "token-cap"]) {
            expect(pauseCardOf(view(), pauseMsg("m9", reason))?.note).toBe("");
        }
    });
});

describe("pauseActions", () => {
    const none = { resume: null, judgeAgain: null, hint: null };
    const local = { local: true };

    it("has nothing on a pair that is not stopped", () => {
        expect(pauseActions(view({ state: "relaying", stopreason: "", canresume: true }), local)).toEqual(none);
        expect(pauseActions(view({ state: "ended", stopreason: "settled", canresume: true }), local)).toEqual(none);
    });

    it("has nothing on a pair of the other machine, whichever way it says so", () => {
        for (const reason of REASONS) {
            expect(pauseActions(view({ synced: true, stopreason: reason, canresume: true }), local)).toEqual(none);
            expect(pauseActions(view({ stopreason: reason, canresume: true }), { local: false })).toEqual(none);
        }
    });

    it("gives a judges-gone pause no action at all, not even the hint", () => {
        expect(pauseActions(view({ stopreason: "judges-gone", canresume: false }), local)).toEqual(none);
        expect(pauseActions(view({ stopreason: "judges-gone", canresume: true }), local)).toEqual(none);
    });

    it("offers Resume with the judge's cap after a token cap when something would be delivered", () => {
        expect(pauseActions(view({ stopreason: "token-cap", canresume: true }), local)).toEqual({
            resume: "Resume · judge +3.0M",
            judgeAgain: null,
            hint: null,
        });
        const vi = view({ stopreason: "token-cap", canresume: true, messages: [person("m1", "ừ")] });
        expect(pauseActions(vi, local).resume).toBe("Chạy tiếp · judge thêm 3.0M");
    });

    it("words the token-cap Resume with the pair's own cap, and plainly with no cap", () => {
        expect(
            pauseActions(view({ stopreason: "token-cap", canresume: true, tokencap: 1_500_000 }), local).resume
        ).toBe("Resume · judge +1.5M");
        expect(pauseActions(view({ stopreason: "token-cap", canresume: true, tokencap: 0 }), local).resume).toBe(
            "Resume"
        );
    });

    it("gives a token cap with nothing to deliver the hint only", () => {
        expect(pauseActions(view({ stopreason: "token-cap", canresume: false }), local)).toEqual({
            resume: null,
            judgeAgain: null,
            hint: "Message to go on",
        });
    });

    it("offers Judge again, and the hint when nothing would be delivered, after no new points or both agree", () => {
        for (const reason of ["no-new-points", "settled"]) {
            expect(pauseActions(view({ stopreason: reason, canresume: false }), local)).toEqual({
                resume: null,
                judgeAgain: "Judge again",
                hint: "Message to go on",
            });
        }
        const vi = view({ stopreason: "settled", canresume: false, messages: [person("m1", "ừ")] });
        expect(pauseActions(vi, local)).toEqual({ resume: null, judgeAgain: "Judge tiếp", hint: "Nhắn để bàn tiếp" });
    });

    it("offers a plain Resume beside Judge again when a no-new-points pause still has something queued", () => {
        expect(pauseActions(view({ stopreason: "no-new-points", canresume: true }), local)).toEqual({
            resume: "Resume",
            judgeAgain: "Judge again",
            hint: null,
        });
        const vi = view({ stopreason: "settled", canresume: true, messages: [person("m1", "ừ")] });
        expect(pauseActions(vi, local)).toEqual({ resume: "Chạy tiếp", judgeAgain: "Judge tiếp", hint: null });
    });

    it("covers every reason × canresume × synced/ended", () => {
        for (const reason of REASONS) {
            for (const canresume of [true, false]) {
                const actions = pauseActions(view({ stopreason: reason, canresume }), local);
                expect(actions.resume !== null).toBe(reason !== "judges-gone" && canresume);
                expect(actions.judgeAgain !== null).toBe(reason === "no-new-points" || reason === "settled");
                expect(actions.hint !== null).toBe(reason !== "judges-gone" && !canresume);
                for (const off of [{ synced: true }, { state: "ended" }, { state: "relaying" }]) {
                    expect(pauseActions(view({ stopreason: reason, canresume, ...off }), local)).toEqual(none);
                }
            }
        }
    });
});

describe("newestPauseId", () => {
    it("is the id of the last message that carries a pause", () => {
        const v = view({
            messages: [pauseMsg("m3", "no-new-points"), worker("m4"), pauseMsg("m7", "token-cap"), person("m8", "go")],
        });
        expect(newestPauseId(v)).toBe("m7");
    });

    it("is null when no message carries one, a pause line from before the snapshot included", () => {
        const old = { ...worker("m1"), from: "system" } as PairMessage;
        expect(newestPauseId(view({ messages: [worker("m1"), old] }))).toBeNull();
        expect(newestPauseId(view({ messages: undefined }))).toBeNull();
    });
});

describe("composerPlaceholder", () => {
    it("tells what a message to both does, and how to ask the judge now", () => {
        expect(composerPlaceholder(view())).toBe(
            "To both: the worker answers, then the judge judges it · @judge to ask the judge now"
        );
    });

    it("is Vietnamese when the person writes it", () => {
        expect(composerPlaceholder(view({ messages: [person("m1", "tiếp đi")] }))).toBe(
            "Gửi cả hai: worker trả lời trước, judge chấm câu trả lời · @judge để hỏi judge ngay"
        );
    });
});
