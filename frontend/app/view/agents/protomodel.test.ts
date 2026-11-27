// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    boardPicksKey,
    CAPTURE_ATTR,
    contextKey,
    contextPhrase,
    HIDE_WHILE_CAPTURING,
    markContext,
    picksToResend,
    PROTO_REPORT_MSG,
    protoReadout,
    protoReport,
    shownLetter,
    SLOT_PICK_MSG,
    slotPickMessage,
    type ProtoReport,
    type ProtoSlot,
} from "./protomodel";

const RECT = { x: 10, y: 20, w: 300, h: 120 };

function slot(over: Partial<ProtoSlot> = {}): ProtoSlot {
    return { id: "list", label: "danh sách", letters: ["A", "B", "C"], picked: "A", rect: RECT, ...over };
}

function report(over: Partial<ProtoReport> = {}): ProtoReport {
    return { screen: "Để sau", slots: [slot()], ...over };
}

describe("message names", () => {
    it("are the two types the board script and the frame agree on", () => {
        expect(PROTO_REPORT_MSG).toBe("arc-canvas-proto");
        expect(SLOT_PICK_MSG).toBe("arc-canvas-slot-pick");
    });
});

describe("protoReport", () => {
    it("reads a well-formed report", () => {
        const data = { type: PROTO_REPORT_MSG, screen: "Để sau", slots: [slot({ picked: "B" })] };
        expect(protoReport(data)).toEqual({ screen: "Để sau", slots: [slot({ picked: "B" })] });
    });

    it("keeps a report with no screen and no slots", () => {
        expect(protoReport({ type: PROTO_REPORT_MSG, screen: null, slots: [] })).toEqual({ screen: null, slots: [] });
    });

    it("reads a missing, empty or non-string screen as no screen", () => {
        for (const screen of [undefined, "", 3, {}]) {
            expect(protoReport({ type: PROTO_REPORT_MSG, screen, slots: [] })?.screen).toBeNull();
        }
    });

    it("rejects what is not a report", () => {
        const good = { type: PROTO_REPORT_MSG, screen: null, slots: [] };
        expect(protoReport(good)).not.toBeNull();
        expect(protoReport(null)).toBeNull();
        expect(protoReport(undefined)).toBeNull();
        expect(protoReport("arc-canvas-proto")).toBeNull();
        expect(protoReport(42)).toBeNull();
        expect(protoReport([good])).toBeNull();
        expect(protoReport({ ...good, type: "arc-canvas-height" })).toBeNull();
        expect(protoReport({ screen: null, slots: [] })).toBeNull();
        expect(protoReport({ type: PROTO_REPORT_MSG, screen: null })).toBeNull();
        expect(protoReport({ type: PROTO_REPORT_MSG, screen: null, slots: "list" })).toBeNull();
    });

    it("drops a malformed slot and keeps the report and its other slots", () => {
        const ok = slot({ id: "menu", label: "menu", letters: ["A", "B"] });
        const data = {
            type: PROTO_REPORT_MSG,
            screen: "Để sau",
            slots: [
                null,
                "list",
                { ...slot(), id: "" },
                { ...slot(), id: 7 },
                { ...slot(), letters: [] },
                { ...slot(), letters: "ABC" },
                { ...slot(), letters: ["A", 2] },
                { ...slot(), picked: 1 },
                { ...slot(), rect: null },
                { ...slot(), rect: { x: 0, y: 0, w: "300", h: 10 } },
                { ...slot(), rect: { x: 0, y: Number.NaN, w: 10, h: 10 } },
                { ...slot(), rect: { x: 0, y: 0, w: Infinity, h: 10 } },
                { ...slot(), rect: { x: 0, y: 0, w: -4, h: 10 } },
                ok,
            ],
        };
        expect(protoReport(data)).toEqual({ screen: "Để sau", slots: [ok] });
    });

    it("labels a slot by its id when the board gave no label", () => {
        const noLabel = { ...slot(), label: undefined };
        const emptyLabel = { ...slot({ id: "menu" }), label: "" };
        const r = protoReport({ type: PROTO_REPORT_MSG, screen: null, slots: [noLabel, emptyLabel] });
        expect(r?.slots.map((s) => s.label)).toEqual(["list", "menu"]);
    });

    it("keeps a picked letter the slot does not have (shownLetter decides what shows)", () => {
        const r = protoReport({ type: PROTO_REPORT_MSG, screen: null, slots: [slot({ picked: "Z" })] });
        expect(r?.slots[0].picked).toBe("Z");
    });
});

describe("slotPickMessage", () => {
    it("carries the whole pick map under the pick type", () => {
        expect(slotPickMessage({ list: "B", menu: "C" })).toEqual({
            type: SLOT_PICK_MSG,
            picks: { list: "B", menu: "C" },
        });
    });

    it("is a copy: a later change to the stored map does not reach a message already built", () => {
        const picks: Record<string, string> = { list: "B" };
        const msg = slotPickMessage(picks);
        picks.list = "C";
        expect(msg.picks).toEqual({ list: "B" });
    });

    it("with no picks, carries an empty map", () => {
        expect(slotPickMessage({})).toEqual({ type: SLOT_PICK_MSG, picks: {} });
    });
});

describe("shownLetter", () => {
    it("is the picked letter when the slot has it", () => {
        expect(shownLetter(slot({ picked: "C" }))).toBe("C");
    });

    it("is the first letter when the reported picked is not one of the letters", () => {
        expect(shownLetter(slot({ picked: "Z" }))).toBe("A");
        expect(shownLetter(slot({ picked: "" }))).toBe("A");
    });

    it("is empty for a slot with no letters", () => {
        expect(shownLetter(slot({ letters: [], picked: "A" }))).toBe("");
    });
});

describe("picksToResend", () => {
    it("is false with no report or no slots", () => {
        expect(picksToResend(null, { list: "B" })).toBe(false);
        expect(picksToResend(report({ slots: [] }), { list: "B" })).toBe(false);
    });

    it("is false with no stored pick", () => {
        expect(picksToResend(report(), {})).toBe(false);
    });

    it("is false when the slot already shows the stored pick", () => {
        expect(picksToResend(report({ slots: [slot({ picked: "B" })] }), { list: "B" })).toBe(false);
    });

    it("is true when a board that reloaded shows its default and a pick is stored", () => {
        expect(picksToResend(report({ slots: [slot({ picked: "A" })] }), { list: "B" })).toBe(true);
    });

    it("is true when the slot shows its first letter because its reported picked was no letter of it", () => {
        expect(picksToResend(report({ slots: [slot({ picked: "Z" })] }), { list: "B" })).toBe(true);
    });

    it("is false for a stored pick the slot lacks: the board keeps its default, and a resend would change nothing", () => {
        const two = slot({ letters: ["A", "B"], picked: "A" });
        expect(picksToResend(report({ slots: [two] }), { list: "C" })).toBe(false);
    });

    it("is false for picks of slots the report does not list", () => {
        expect(picksToResend(report(), { elsewhere: "B" })).toBe(false);
    });

    it("is true when any one slot differs", () => {
        const slots = [slot({ id: "list", picked: "B" }), slot({ id: "menu", letters: ["A", "B"], picked: "A" })];
        expect(picksToResend(report({ slots }), { list: "B", menu: "B" })).toBe(true);
    });

    it("does not read a pick off the map's prototype", () => {
        expect(picksToResend(report({ slots: [slot({ id: "constructor" })] }), {})).toBe(false);
    });
});

describe("markContext", () => {
    it("is empty for no report", () => {
        expect(markContext(null)).toEqual({ screen: null, slots: [] });
    });

    it("names the screen and each slot's shown letter", () => {
        const r = report({
            slots: [slot({ picked: "B" }), slot({ id: "menu", label: "menu", letters: ["X", "Y"], picked: "Q" })],
        });
        expect(markContext(r)).toEqual({
            screen: "Để sau",
            slots: [
                { id: "list", label: "danh sách", letter: "B" },
                { id: "menu", label: "menu", letter: "X" },
            ],
        });
    });
});

describe("contextKey", () => {
    it("is equal for equal contexts and differs by screen or by a slot's letter", () => {
        const a = markContext(report({ slots: [slot({ picked: "B" })] }));
        expect(contextKey(a)).toBe(contextKey(markContext(report({ slots: [slot({ picked: "B" })] }))));
        expect(contextKey(a)).not.toBe(contextKey(markContext(report({ slots: [slot({ picked: "A" })] }))));
        expect(contextKey(a)).not.toBe(
            contextKey(markContext(report({ screen: "Home", slots: [slot({ picked: "B" })] })))
        );
        expect(contextKey(a)).not.toBe(
            contextKey(markContext(report({ screen: null, slots: [slot({ picked: "B" })] })))
        );
    });

    it("does not depend on a slot's label or on the order the board listed slots in", () => {
        const one = slot({ id: "list", picked: "B" });
        const two = slot({ id: "menu", letters: ["A", "B"], picked: "A" });
        const ab = markContext(report({ slots: [one, two] }));
        const ba = markContext(report({ slots: [two, { ...one, label: "other name" }] }));
        expect(contextKey(ab)).toBe(contextKey(ba));
    });

    it("tells a missing screen from a screen named null, and an empty context from a screen with none of the slots", () => {
        const none = contextKey(markContext(null));
        expect(none).not.toBe(contextKey({ screen: "null", slots: [] }));
        expect(none).not.toBe(contextKey({ screen: "", slots: [] }));
    });
});

describe("contextPhrase", () => {
    it("names the screen and the slot", () => {
        const ctx = markContext(report({ slots: [slot({ picked: "B" })] }));
        expect(contextPhrase(ctx)).toBe('screen "Để sau", slot danh sách = B');
    });

    it("names several slots in the order the board listed them", () => {
        const ctx = markContext(
            report({
                slots: [slot({ picked: "B" }), slot({ id: "menu", label: "menu", letters: ["A", "C"], picked: "C" })],
            })
        );
        expect(contextPhrase(ctx)).toBe('screen "Để sau", slot danh sách = B, slot menu = C');
    });

    it("names the screen alone, or the slots alone", () => {
        expect(contextPhrase({ screen: "Để sau", slots: [] })).toBe('screen "Để sau"');
        expect(contextPhrase({ screen: null, slots: [{ id: "list", label: "danh sách", letter: "B" }] })).toBe(
            "slot danh sách = B"
        );
    });

    it("is empty with no screen and no slots", () => {
        expect(contextPhrase({ screen: null, slots: [] })).toBe("");
        expect(contextPhrase(markContext(null))).toBe("");
    });

    it("keeps a quote in a screen name from ending the name early, on one line", () => {
        expect(contextPhrase({ screen: 'Say "hi"\nnow', slots: [] })).toBe('screen "Say \\"hi\\"\\nnow"');
    });

    it("falls back to the id for a slot with no label", () => {
        expect(contextPhrase({ screen: null, slots: [{ id: "list", label: "", letter: "A" }] })).toBe("slot list = A");
    });
});

describe("protoReadout", () => {
    it("reads the screen and the slot's label and shown letter", () => {
        expect(protoReadout(report({ slots: [slot({ picked: "B" })] }))).toBe("Để sau · danh sách B");
    });

    it("joins several slots", () => {
        const r = report({ slots: [slot(), slot({ id: "menu", label: "menu", letters: ["A", "B"], picked: "B" })] });
        expect(protoReadout(r)).toBe("Để sau · danh sách A · menu B");
    });

    it("leads with the slot alone when there is no screen, and with the screen alone when there are no slots", () => {
        expect(protoReadout(report({ screen: null }))).toBe("danh sách A");
        expect(protoReadout(report({ slots: [] }))).toBe("Để sau");
    });

    it("is empty with no report, or with nothing in it", () => {
        expect(protoReadout(null)).toBe("");
        expect(protoReadout({ screen: null, slots: [] })).toBe("");
    });
});

describe("boardPicksKey", () => {
    it("drops the query and the hash", () => {
        const base = "http://127.0.0.1:61234/t0k3n/gallery-alpha/project/Main.dc.html";
        expect(boardPicksKey(base)).toBe(base);
        expect(boardPicksKey(`${base}?v=123`)).toBe(base);
        expect(boardPicksKey(`${base}#screen`)).toBe(base);
        expect(boardPicksKey(`${base}?v=1&x=2#a?b`)).toBe(base);
        expect(boardPicksKey(`${base}#a?b`)).toBe(base);
    });

    it("leaves a string with neither alone, whatever it holds", () => {
        expect(boardPicksKey("")).toBe("");
        expect(boardPicksKey("Main.dc.html")).toBe("Main.dc.html");
    });
});

describe("capture markers", () => {
    it("name the attribute the frame carries and the class every overlay wears for it", () => {
        expect(CAPTURE_ATTR).toBe("data-canvas-capturing");
        expect(HIDE_WHILE_CAPTURING).toContain(CAPTURE_ATTR.replace(/^data-/, ""));
    });
});
