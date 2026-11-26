// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addedSend,
    choiceTurn,
    judgedChips,
    judgeKeysByItem,
    judgeLine,
    judgeReason,
    type JudgeLine,
} from "./chatjudge";
import type { ChatItem } from "./chatmodel";
import { suggestKey, type ChatChip } from "./chatsuggest";

const chip = (text: string): ChatChip => ({ text, kind: "reply", source: "model" });
const B = chip("B, bỏ cache");
const A = chip("A, sửa parseFrame");
const BOTH = chip("cả hai luôn");
const ROW = [B, A, BOTH];

const ADDED: ChatJudgeAdded = {
    label: "C, gom byte ở readLoop",
    desc: "sửa ở đó thay vì ở ba nơi gọi parseFrame",
    facts: ["readLoop đã gom đủ byte cho mọi khung khác (conn.go:212)"],
};

function rec(over: Partial<ChatJudgeRecord> = {}): ChatJudgeRecord {
    return {
        key: "ag:10:abc",
        ts: 1000,
        question: "A hay B?",
        options: ROW.map((c) => ({ text: c.text })),
        ...over,
    };
}

/** judgeLine's answer for a record that has a line: the test fails here when it is none, and the fields can be read */
function lineOf(...args: Parameters<typeof judgeLine>): Exclude<JudgeLine, { state: "none" }> {
    const line = judgeLine(...args);
    if (line.state === "none") {
        throw new Error("expected a line, got none");
    }
    return line;
}

/** a record whose light mark picked A */
const light = () => rec({ pick: A.text, reason: "A sửa đúng gốc" });

function done(over: Partial<ChatJudgeDeep> = {}): ChatJudgeDeep {
    return {
        state: "done",
        startts: 100_000,
        endts: 141_000,
        pick: B.text,
        reason: "B nhỏ hơn và conn.go:40 đã có cache",
        model: "sonnet",
        files: 14,
        ...over,
    };
}

describe("choiceTurn", () => {
    it("is true for a reply ending in an A-or-B question", () => {
        expect(choiceTurn("A sửa đúng gốc nhưng đụng ba nơi; B nhỏ hơn. Mình nghiêng A. A hay B?")).toBe(true);
        expect(choiceTurn("Which one do you want, A or B?")).toBe(true);
    });

    it("is false for a yes-or-no question", () => {
        expect(choiceTurn("Should I build it?")).toBe(false);
        expect(choiceTurn("Có build luôn không?")).toBe(false);
    });

    it("is false for a reply that is no question", () => {
        expect(choiceTurn("Đã sửa xong parseFrame.")).toBe(false);
        expect(choiceTurn("")).toBe(false);
    });
});

describe("addedSend", () => {
    it("is the label, the description, and the facts in a parenthesis", () => {
        expect(addedSend(ADDED)).toBe(
            "C, gom byte ở readLoop: sửa ở đó thay vì ở ba nơi gọi parseFrame (readLoop đã gom đủ byte cho mọi khung khác (conn.go:212))"
        );
    });

    it("joins several facts with a semicolon", () => {
        expect(addedSend({ label: "C", desc: "gom ở readLoop", facts: ["conn.go:212", "frame.go:9"] })).toBe(
            "C: gom ở readLoop (conn.go:212; frame.go:9)"
        );
    });

    it("leaves the parenthesis out with no facts", () => {
        expect(addedSend({ label: "C", desc: "gom ở readLoop" })).toBe("C: gom ở readLoop");
        expect(addedSend({ label: "C", desc: "gom ở readLoop", facts: [] })).toBe("C: gom ở readLoop");
    });
});

describe("judgedChips", () => {
    it("gives the row as it is when there is no record", () => {
        expect(judgedChips(ROW, undefined)).toEqual(ROW);
    });

    it("puts the light pick first and marks it judged, the others keep their order", () => {
        const out = judgedChips(ROW, light());
        expect(out.map((c) => c.text)).toEqual([A.text, B.text, BOTH.text]);
        expect(out.map((c) => c.judged)).toEqual([true, undefined, undefined]);
        expect(out[1]).toBe(B);
    });

    it("keeps a light pick that is first already, and marks it", () => {
        const out = judgedChips([A, B], light());
        expect(out.map((c) => c.text)).toEqual([A.text, B.text]);
        expect(out[0].judged).toBe(true);
    });

    it("does not change the chips it was given", () => {
        judgedChips(ROW, light());
        expect(ROW.map((c) => c.judged)).toEqual([undefined, undefined, undefined]);
        expect(ROW.map((c) => c.text)).toEqual([B.text, A.text, BOTH.text]);
    });

    it("lets the deep pick take the first place when deep is done, and the light chip loses judged", () => {
        const out = judgedChips(ROW, { ...light(), deep: done({ pick: BOTH.text }) });
        expect(out.map((c) => c.text)).toEqual([BOTH.text, B.text, A.text]);
        expect(out.filter((c) => c.judged).map((c) => c.text)).toEqual([BOTH.text]);
    });

    it("keeps to the light pick while the deep judge reads, fails or is stopped", () => {
        for (const state of ["reading", "failed", "stopped"]) {
            const out = judgedChips(ROW, { ...light(), deep: done({ state, pick: BOTH.text }) });
            expect(out.map((c) => c.text)).toEqual([A.text, B.text, BOTH.text]);
            expect(out.filter((c) => c.judged).map((c) => c.text)).toEqual([A.text]);
        }
    });

    it("puts an added option first with its send when it is the pick", () => {
        const out = judgedChips(ROW, { ...light(), deep: done({ pick: ADDED.label, added: ADDED }) });
        expect(out.map((c) => c.text)).toEqual([ADDED.label, B.text, A.text, BOTH.text]);
        expect(out[0]).toEqual({
            text: ADDED.label,
            kind: "reply",
            source: "judge",
            send: addedSend(ADDED),
            judged: true,
        });
        expect(out.filter((c) => c.judged)).toHaveLength(1);
    });

    it("seats an added option that is not the pick right after the judged chip", () => {
        const out = judgedChips(ROW, { ...light(), deep: done({ pick: BOTH.text, added: ADDED }) });
        expect(out.map((c) => c.text)).toEqual([BOTH.text, ADDED.label, B.text, A.text]);
        expect(out[0].judged).toBe(true);
        expect(out[1].judged).toBeUndefined();
        expect(out[1].send).toBe(addedSend(ADDED));
        expect(out[1].source).toBe("judge");
    });

    it("leaves the row alone when the pick names no chip", () => {
        expect(judgedChips(ROW, rec({ pick: "không có chip này" }))).toEqual(ROW);
        expect(judgedChips(ROW, { ...light(), deep: done({ pick: "không có chip này", added: ADDED }) })).toEqual(ROW);
    });

    it("leaves the row alone when the record has no pick at all", () => {
        expect(judgedChips(ROW, rec())).toEqual(ROW);
    });

    it("gives an empty row back empty", () => {
        expect(judgedChips([], light())).toEqual([]);
    });
});

describe("judgeReason", () => {
    it("is the light reason, or null with no record or no pick", () => {
        expect(judgeReason(light())).toBe("A sửa đúng gốc");
        expect(judgeReason(undefined)).toBeNull();
        expect(judgeReason(rec())).toBeNull();
        expect(judgeReason(rec({ pick: A.text }))).toBeNull();
    });

    it("is the deep reason once deep is done", () => {
        expect(judgeReason({ ...light(), deep: done() })).toBe("B nhỏ hơn và conn.go:40 đã có cache");
    });

    it("stays the light reason while deep is not done", () => {
        expect(judgeReason({ ...light(), deep: done({ state: "reading" }) })).toBe("A sửa đúng gốc");
        expect(judgeReason({ ...light(), deep: done({ state: "failed" }) })).toBe("A sửa đúng gốc");
    });
});

describe("judgeLine", () => {
    it("is none with no record", () => {
        expect(judgeLine(undefined, 0, true, true)).toEqual({ state: "none" });
    });

    describe("the light mark", () => {
        it("names the pick, hints at the hover and offers the deep judge on the live turn", () => {
            expect(judgeLine(light(), 0, true, true)).toEqual({
                state: "light",
                head: "Gợi ý",
                name: A.text,
                hint: "rê vào để xem lý do",
                reason: "A sửa đúng gốc",
                source: "haiku, chỉ đọc reply",
                action: "judge",
            });
        });

        it("speaks English for a person who writes it", () => {
            expect(judgeLine(light(), 0, false, true)).toEqual({
                state: "light",
                head: "Suggested",
                name: A.text,
                hint: "hover for why",
                reason: "A sửa đúng gốc",
                source: "haiku, read the reply only",
                action: "judge",
            });
        });

        it("gives the last message's card no hover hint", () => {
            expect(judgeLine(light(), 0, true, true, true)).toEqual({
                state: "light",
                head: "Gợi ý",
                name: A.text,
                reason: "A sửa đúng gốc",
                source: "haiku, chỉ đọc reply",
                action: "judge",
            });
            expect(lineOf(rec({ pick: A.text }), 0, true, true, true)).not.toHaveProperty("hint");
        });

        it("shows no action on an old turn", () => {
            const line = judgeLine(light(), 0, true, false);
            expect(line.state).toBe("light");
            expect(line).not.toHaveProperty("action");
        });

        it("reads a stopped judge as the light mark", () => {
            const line = judgeLine({ ...light(), deep: done({ state: "stopped", pick: undefined }) }, 0, true, true);
            expect(line).toEqual(judgeLine(light(), 0, true, true));
        });
    });

    describe("with no light pick", () => {
        it("is the action alone on the live turn, so the deep judge is reachable", () => {
            expect(judgeLine(rec(), 0, true, true)).toEqual({ state: "light", action: "judge" });
            expect(judgeLine(rec(), 0, false, true)).toEqual({ state: "light", action: "judge" });
        });

        it("is the action alone after a stopped judge too", () => {
            expect(judgeLine(rec({ deep: done({ state: "stopped", pick: undefined }) }), 0, true, true)).toEqual({
                state: "light",
                action: "judge",
            });
        });

        it("draws nothing on an old turn", () => {
            expect(judgeLine(rec(), 0, true, false)).toEqual({ state: "none" });
            expect(judgeLine(rec({ deep: done({ state: "stopped" }) }), 0, true, false)).toEqual({ state: "none" });
        });
    });

    describe("reading", () => {
        const reading = () => ({ ...light(), deep: { state: "reading", startts: 100_000 } });

        it("says it is blind to the agent's lean, ticks the seconds and offers Stop", () => {
            expect(judgeLine(reading(), 134_000, true, true)).toEqual({
                state: "reading",
                head: "Judge đang đọc code, không thấy agent khuyên gì",
                tail: "34 s",
                action: "stop",
            });
        });

        it("ticks from now", () => {
            expect(lineOf(reading(), 100_000, true, true).tail).toBe("0 s");
            expect(lineOf(reading(), 100_999, true, true).tail).toBe("0 s");
            expect(lineOf(reading(), 101_000, true, true).tail).toBe("1 s");
            expect(lineOf(reading(), 161_500, true, true).tail).toBe("61 s");
        });

        it("never reads a negative time when the clocks differ a little", () => {
            expect(lineOf(reading(), 99_000, true, true).tail).toBe("0 s");
        });

        it("speaks English, and shows no Stop on an old turn", () => {
            const line = lineOf(reading(), 134_000, false, false);
            expect(line.head).toBe("Judge is reading the code, blind to the agent's lean");
            expect(line.tail).toBe("34 s");
            expect(line).not.toHaveProperty("action");
        });
    });

    describe("done", () => {
        it("names the deep pick, its cost and its reason, with no action", () => {
            expect(judgeLine({ ...light(), deep: done() }, 0, true, true)).toEqual({
                state: "done",
                head: "Đã đọc code: chọn",
                name: B.text,
                tail: "sonnet · 14 file · 41 s",
                reason: "B nhỏ hơn và conn.go:40 đã có cache",
                source: "sonnet · 14 file · 41 s",
            });
        });

        it("leaves the last message's card the cost as its tail, with no source", () => {
            expect(judgeLine({ ...light(), deep: done() }, 0, true, true, true)).toEqual({
                state: "done",
                head: "Đã đọc code: chọn",
                name: B.text,
                tail: "sonnet · 14 file · 41 s",
                reason: "B nhỏ hơn và conn.go:40 đã có cache",
            });
        });

        it("counts files in English", () => {
            const line = lineOf({ ...light(), deep: done() }, 0, false, true);
            expect(line.head).toBe("Read the code: picks");
            expect(line.tail).toBe("sonnet · 14 files · 41 s");
            expect(line.source).toBe("sonnet · 14 files · 41 s");
            expect(lineOf({ ...light(), deep: done({ files: 1 }) }, 0, false, true).tail).toBe(
                "sonnet · 1 file · 41 s"
            );
        });

        it("says the agent did not name an added pick", () => {
            const line = lineOf({ ...light(), deep: done({ pick: ADDED.label, added: ADDED }) }, 0, true, true);
            expect(line.name).toBe(ADDED.label);
            expect(line.note).toBe("agent không nêu");
            expect(lineOf({ ...light(), deep: done({ pick: ADDED.label, added: ADDED }) }, 0, false, true).note).toBe(
                "the agent did not name it"
            );
        });

        it("has no note when the pick is a listed option, even with an added option beside it", () => {
            expect(judgeLine({ ...light(), deep: done({ added: ADDED }) }, 0, true, true)).not.toHaveProperty("note");
        });

        it("has no action, on the live turn or an old one", () => {
            expect(judgeLine({ ...light(), deep: done() }, 0, true, true)).not.toHaveProperty("action");
            expect(judgeLine({ ...light(), deep: done() }, 0, true, false)).not.toHaveProperty("action");
        });

        it("counts no files as none, and leaves out a time it was not given", () => {
            expect(lineOf(rec({ deep: done({ files: undefined }) }), 0, true, true).tail).toBe(
                "sonnet · 0 file · 41 s"
            );
            expect(lineOf(rec({ deep: done({ endts: undefined }) }), 0, true, true).tail).toBe("sonnet · 14 file");
        });

        it("shows a done judge with no light pick too", () => {
            expect(judgeLine(rec({ deep: done() }), 0, true, false).state).toBe("done");
        });
    });

    describe("failed", () => {
        const failed = (over: Partial<ChatJudgeRecord> = {}) =>
            ({
                ...light(),
                ...over,
                deep: { state: "failed", startts: 100_000, endts: 105_000, error: "hết giờ sau 180 s" },
            }) as ChatJudgeRecord;

        it("keeps the light mark, says what happened and offers Retry on the live turn", () => {
            expect(judgeLine(failed(), 0, true, true)).toEqual({
                state: "failed",
                head: "Gợi ý",
                name: A.text,
                reason: "A sửa đúng gốc",
                source: "haiku, chỉ đọc reply",
                note: "Judge không xong: hết giờ sau 180 s",
                action: "retry",
            });
        });

        it("is the same on the last message's card", () => {
            expect(judgeLine(failed(), 0, true, true, true)).toEqual(judgeLine(failed(), 0, true, true));
        });

        it("speaks English", () => {
            const line = lineOf(failed(), 0, false, true);
            expect(line.head).toBe("Suggested");
            expect(line.note).toBe("Judge failed: hết giờ sau 180 s");
        });

        it("is the note and Retry alone when haiku wrote no pick", () => {
            expect(judgeLine(failed({ pick: undefined, reason: undefined }), 0, true, true)).toEqual({
                state: "failed",
                note: "Judge không xong: hết giờ sau 180 s",
                action: "retry",
            });
        });

        it("shows no Retry on an old turn", () => {
            const line = judgeLine(failed(), 0, true, false);
            expect(line.state).toBe("failed");
            expect(line).not.toHaveProperty("action");
        });

        it("leaves the colon out when there is no error text", () => {
            const rec2 = { ...light(), deep: { state: "failed", startts: 1 } } as ChatJudgeRecord;
            expect(lineOf(rec2, 0, true, true).note).toBe("Judge không xong");
            expect(lineOf(rec2, 0, false, true).note).toBe("Judge failed");
        });
    });
});

describe("judgeKeysByItem", () => {
    const REPLY = "Có hai hướng. A sửa đúng gốc; B nhỏ hơn. Mình nghiêng A. A hay B?";
    const agentItem = (key: string, ...texts: string[]): ChatItem => ({
        kind: "agent",
        key,
        parts: texts.map((text) => ({ kind: "prose" as const, text })),
    });
    const records = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, rec({ key: k })]));

    it("matches an agent item whose prose gives a key the records hold", () => {
        const key = suggestKey("ag", REPLY);
        const items = [agentItem("agent:2", "Xong rồi."), agentItem("agent:6", REPLY)];
        expect([...judgeKeysByItem("ag", items, records(key))]).toEqual([["agent:6", key]]);
    });

    it("finds the prose among an item's parts, and the last matching part wins", () => {
        const first = "Hướng nào? A hay B?";
        const keys = [suggestKey("ag", first), suggestKey("ag", REPLY)];
        const items = [agentItem("agent:2", first, "đang làm", REPLY)];
        expect(judgeKeysByItem("ag", items, records(...keys)).get("agent:2")).toBe(keys[1]);
    });

    it("gives nothing for another agent's record, no records, or a text no record holds", () => {
        const items = [agentItem("agent:6", REPLY), agentItem("agent:9", "khác hẳn", "A hay B?")];
        expect(judgeKeysByItem("ag", items, records(suggestKey("other", REPLY))).size).toBe(0);
        expect(judgeKeysByItem("ag", items, {}).size).toBe(0);
        expect(judgeKeysByItem("ag", items, records(suggestKey("ag", "A hay B nữa?"))).size).toBe(0);
    });

    it("leaves out a key whose length matches a text but whose hash does not", () => {
        // the same length as REPLY, one letter changed: the length prefilter lets it through and the whole key says no
        const same = REPLY.replace("nghiêng", "nghiềng");
        expect(same.length).toBe(REPLY.length);
        expect(judgeKeysByItem("ag", [agentItem("agent:6", REPLY)], records(suggestKey("ag", same))).size).toBe(0);
    });

    it("ignores items that are not the agent's", () => {
        const items: ChatItem[] = [{ kind: "you", key: "you:1", text: REPLY } as ChatItem];
        expect(judgeKeysByItem("ag", items, records(suggestKey("ag", REPLY))).size).toBe(0);
    });
});
